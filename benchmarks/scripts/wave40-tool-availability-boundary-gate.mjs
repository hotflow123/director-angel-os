import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ToolDispatcher, ToolRegistry } from "../../packages/tools/dist/index.js";
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
        `build failed for ${target} during wave40 tool availability boundary gate.`,
        build.stderr,
      );
    }
  }

  const envKey = "HOTFLOW_WAVE40_REQUIRED_TOKEN";
  const previousValue = process.env[envKey];
  delete process.env[envKey];

  const auditEvents = [];
  const registry = new ToolRegistry();
  registry.register({
    name: "test.requires-env",
    description: "wave40 availability boundary tool",
    timeoutMs: 100,
    readOnly: true,
    capabilities: ["test.requires-env"],
    riskLevel: "low",
    requiresEnv: [envKey],
    async execute() {
      return {
        toolCallId: "ignored",
        toolName: "ignored",
        ok: true,
        output: "ok",
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
                metadata: event.result.metadata,
              },
      });
    },
  });

  const failures = [];

  try {
    const availableWithoutEnv = registry.listAvailable();
    if (availableWithoutEnv.length !== 0) {
      failures.push(
        `Expected no available tools before setting ${envKey}, but received ${availableWithoutEnv.map((tool) => tool.name).join(", ")}.`,
      );
    }

    const missingResult = await dispatcher.dispatch(
      {
        id: "call_wave40_missing_env",
        name: "test.requires-env",
        args: {},
      },
      { sessionId: "session_wave40_missing_env" },
    );

    if (missingResult.ok !== false) {
      failures.push("Expected missing-env dispatch result ok=false.");
    }
    if (missingResult.resolution !== "missing") {
      failures.push(
        `Expected missing-env dispatch resolution=missing but received ${missingResult.resolution}.`,
      );
    }
    if (
      missingResult.error !==
      `Tool "test.requires-env" is unavailable because required environment variables are missing: ${envKey}.`
    ) {
      failures.push(`Unexpected missing-env error message: ${String(missingResult.error)}`);
    }
    if (missingResult.metadata?.availabilityReason !== "missing_required_env") {
      failures.push(
        `Expected availabilityReason=missing_required_env but received ${String(missingResult.metadata?.availabilityReason)}.`,
      );
    }

    process.env[envKey] = "token-present";
    const availableWithEnv = registry.listAvailable();
    if (availableWithEnv.map((tool) => tool.name).join(",") !== "test.requires-env") {
      failures.push(
        `Expected available tools to include test.requires-env after setting ${envKey}, but received ${availableWithEnv.map((tool) => tool.name).join(", ")}.`,
      );
    }

    const executedResult = await dispatcher.dispatch(
      {
        id: "call_wave40_env_present",
        name: "test.requires-env",
        args: {},
      },
      { sessionId: "session_wave40_env_present" },
    );

    if (executedResult.ok !== true || executedResult.resolution !== "executed") {
      failures.push(
        `Expected env-present dispatch to execute, but received ok=${String(executedResult.ok)} resolution=${String(executedResult.resolution)}.`,
      );
    }
  } finally {
    if (previousValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousValue;
    }
  }

  const auditKinds = auditEvents.map((event) => event.kind);
  const expectedAuditKinds = [
    "tool.dispatch.started",
    "tool.dispatch.completed",
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
    join(resultsDir, "wave40-tool-availability-boundary-gate-latest.json"),
    JSON.stringify(
      {
        gate: "wave40-tool-availability-boundary",
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
    fail("wave40 tool availability boundary gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave40 tool availability boundary gate passed.\n");
}

await runGate();
