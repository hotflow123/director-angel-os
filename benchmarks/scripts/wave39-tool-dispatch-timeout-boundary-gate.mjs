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
  const env = {
    ...process.env,
  };

  for (const target of ["@hotflow/contracts", "@hotflow/policy-runtime", "@hotflow/tools"]) {
    const build = runWorkspaceBuild(target, env);
    if (build.status !== 0) {
      fail(
        `build failed for ${target} during wave39 tool dispatch timeout boundary gate.`,
        build.stderr,
      );
    }
  }

  const auditEvents = [];
  const registry = new ToolRegistry();
  registry.register({
    name: "test.timeout",
    description: "wave39 timeout boundary tool",
    timeoutMs: 10,
    readOnly: true,
    capabilities: ["test.timeout"],
    riskLevel: "low",
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        toolCallId: "ignored",
        toolName: "ignored",
        ok: true,
        output: "late",
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
        error: event.error,
      });
    },
  });

  const started = process.hrtime.bigint();
  const result = await dispatcher.dispatch(
    {
      id: "call_wave39_timeout",
      name: "test.timeout",
      args: {},
    },
    { sessionId: "session_wave39_timeout" },
  );
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  const failures = [];
  if (result.ok !== false) {
    failures.push("Expected timeout dispatch result ok=false.");
  }
  if (result.resolution !== "failed") {
    failures.push(`Expected timeout dispatch resolution=failed but received ${result.resolution}.`);
  }
  if (result.error !== 'Tool "test.timeout" timed out after 10ms.') {
    failures.push(`Unexpected timeout error message: ${String(result.error)}`);
  }
  if (result.metadata?.timeoutMs !== 10) {
    failures.push(
      `Expected timeout metadata timeoutMs=10 but received ${String(result.metadata?.timeoutMs)}.`,
    );
  }

  const auditKinds = auditEvents.map((event) => event.kind);
  const expectedAuditKinds = [
    "tool.dispatch.started",
    "tool.dispatch.policy_decision",
    "tool.dispatch.failed",
  ];
  if (JSON.stringify(auditKinds) !== JSON.stringify(expectedAuditKinds)) {
    failures.push(
      `Expected timeout audit kinds ${JSON.stringify(expectedAuditKinds)} but received ${JSON.stringify(auditKinds)}.`,
    );
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave39-tool-dispatch-timeout-boundary-gate-latest.json"),
    JSON.stringify(
      {
        gate: "wave39-tool-dispatch-timeout-boundary",
        durationMs: Number(durationMs.toFixed(2)),
        result,
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
    fail("wave39 tool dispatch timeout boundary gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave39 tool dispatch timeout boundary gate passed.\n");
}

await runGate();
