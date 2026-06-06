import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ToolDispatcher,
  ToolInputValidationError,
  ToolRegistry,
  defineToolInputSchema,
} from "../../packages/tools/dist/index.js";
import { getBenchmarksPaths, runWorkspaceBuild } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();

  for (const target of ["@hotflow/contracts", "@hotflow/policy-runtime", "@hotflow/tools"]) {
    const build = runWorkspaceBuild(target, process.env);
    if (build.status !== 0) {
      fail(
        `build failed for ${target} during wave41 tool input validation boundary gate.`,
        build.stderr,
      );
    }
  }

  const auditEvents = [];
  const registry = new ToolRegistry();
  registry.register({
    name: "test.schema",
    description: "wave41 input validation boundary tool",
    timeoutMs: 100,
    readOnly: true,
    inputSchema: defineToolInputSchema((input) => {
      if (
        typeof input !== "object" ||
        input === null ||
        Array.isArray(input) ||
        typeof input.value !== "string"
      ) {
        throw new ToolInputValidationError("Expected args.value to be a string.");
      }

      return { value: input.value };
    }),
    capabilities: ["test.schema"],
    riskLevel: "low",
    async execute(args) {
      return {
        toolCallId: "ignored",
        toolName: "ignored",
        ok: true,
        output: args.value.toUpperCase(),
      };
    },
  });

  const dispatcher = new ToolDispatcher(registry, {
    auditSink(event) {
      auditEvents.push({
        kind: event.kind,
        result:
          event.result === undefined
            ? undefined
            : {
                ok: event.result.ok,
                resolution: event.result.resolution,
                error: event.result.error,
                output: event.result.output,
                metadata: event.result.metadata,
              },
      });
    },
  });

  const failures = [];

  const invalidResult = await dispatcher.dispatch(
    {
      id: "call_wave41_invalid",
      name: "test.schema",
      args: { value: 42 },
    },
    { sessionId: "session_wave41_invalid" },
  );

  if (invalidResult.ok !== false) {
    failures.push("Expected invalid-schema dispatch result ok=false.");
  }
  if (invalidResult.resolution !== "failed") {
    failures.push(
      `Expected invalid-schema dispatch resolution=failed but received ${invalidResult.resolution}.`,
    );
  }
  if (
    invalidResult.error !==
    'Tool "test.schema" input validation failed: Expected args.value to be a string.'
  ) {
    failures.push(`Unexpected invalid-schema error message: ${String(invalidResult.error)}`);
  }
  if (invalidResult.metadata?.validationError !== "Expected args.value to be a string.") {
    failures.push(
      `Expected validationError metadata to be preserved but received ${String(invalidResult.metadata?.validationError)}.`,
    );
  }

  const validResult = await dispatcher.dispatch(
    {
      id: "call_wave41_valid",
      name: "test.schema",
      args: { value: "ready" },
    },
    { sessionId: "session_wave41_valid" },
  );

  if (validResult.ok !== true || validResult.resolution !== "executed") {
    failures.push(
      `Expected valid-schema dispatch to execute, but received ok=${String(validResult.ok)} resolution=${String(validResult.resolution)}.`,
    );
  }
  if (validResult.output !== "READY") {
    failures.push(`Expected valid-schema output READY but received ${String(validResult.output)}.`);
  }

  const auditKinds = auditEvents.map((event) => event.kind);
  const expectedAuditKinds = [
    "tool.dispatch.started",
    "tool.dispatch.failed",
    "tool.dispatch.started",
    "tool.dispatch.policy_decision",
    "tool.dispatch.completed",
  ];
  if (JSON.stringify(auditKinds) !== JSON.stringify(expectedAuditKinds)) {
    failures.push(
      `Expected audit kinds ${JSON.stringify(expectedAuditKinds)} but received ${JSON.stringify(auditKinds)}.`,
    );
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave41-tool-input-validation-boundary-gate-latest.json"),
    JSON.stringify(
      {
        gate: "wave41-tool-input-validation-boundary",
        auditEvents,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    fail("wave41 tool input validation boundary gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave41 tool input validation boundary gate passed.\n");
}

await runGate();
