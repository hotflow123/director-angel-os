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
      fail(`build failed for ${target} during wave42 tool journal closure gate.`, build.stderr);
    }
  }

  const trace = [];
  const journalEvents = [];
  const registry = new ToolRegistry();
  registry.register({
    name: "test.journal",
    description: "wave42 journal closure tool",
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
    capabilities: ["test.journal"],
    riskLevel: "low",
    async execute(args) {
      trace.push("execute");
      return {
        toolCallId: "ignored",
        toolName: "ignored",
        ok: true,
        output: { echoed: args.value },
        resolution: "executed",
      };
    },
  });

  const dispatcher = new ToolDispatcher(registry, {
    journalSink(event) {
      trace.push(`journal:${event.eventType}`);
      journalEvents.push({
        eventType: event.eventType,
        payload: event.payload,
      });
    },
  });

  const failures = [];

  const validResult = await dispatcher.dispatch(
    {
      id: "call_wave42_valid",
      name: "test.journal",
      args: { value: "ready" },
    },
    { sessionId: "session_wave42_valid", turnId: "turn_wave42_valid" },
  );

  if (dispatcher.managesJournalClosure !== true) {
    failures.push("Expected dispatcher.managesJournalClosure to be true when journalSink is set.");
  }
  if (validResult.ok !== true || validResult.resolution !== "executed") {
    failures.push(
      `Expected valid dispatch to execute, but received ok=${String(validResult.ok)} resolution=${String(validResult.resolution)}.`,
    );
  }
  if (
    JSON.stringify(trace) !==
    JSON.stringify(["journal:tool.call_planned", "execute", "journal:tool.result"])
  ) {
    failures.push(`Unexpected valid dispatch trace: ${JSON.stringify(trace)}.`);
  }

  const invalidResult = await dispatcher.dispatch(
    {
      id: "call_wave42_invalid",
      name: "test.journal",
      args: { value: 42 },
    },
    { sessionId: "session_wave42_invalid" },
  );

  if (invalidResult.ok !== false || invalidResult.resolution !== "failed") {
    failures.push(
      `Expected invalid dispatch to fail, but received ok=${String(invalidResult.ok)} resolution=${String(invalidResult.resolution)}.`,
    );
  }

  const eventTypes = journalEvents.map((event) => event.eventType);
  const expectedEventTypes = ["tool.call_planned", "tool.result", "tool.result"];
  if (JSON.stringify(eventTypes) !== JSON.stringify(expectedEventTypes)) {
    failures.push(
      `Expected journal event types ${JSON.stringify(expectedEventTypes)} but received ${JSON.stringify(eventTypes)}.`,
    );
  }

  if (journalEvents[0]?.payload?.toolCallId !== "call_wave42_valid") {
    failures.push(
      `Expected planned journal payload to preserve toolCallId but received ${String(journalEvents[0]?.payload?.toolCallId)}.`,
    );
  }
  if (journalEvents[1]?.payload?.resolution !== "executed") {
    failures.push(
      `Expected executed result journal payload but received ${String(journalEvents[1]?.payload?.resolution)}.`,
    );
  }
  if (journalEvents[2]?.eventType !== "tool.result") {
    failures.push("Expected invalid dispatch to still emit tool.result journal closure.");
  }
  if (journalEvents[2]?.payload?.resolution !== "failed") {
    failures.push(
      `Expected failed validation journal payload but received ${String(journalEvents[2]?.payload?.resolution)}.`,
    );
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave42-tool-journal-closure-gate-latest.json"),
    JSON.stringify(
      {
        gate: "wave42-tool-journal-closure",
        dispatcherManagesJournalClosure: dispatcher.managesJournalClosure,
        trace,
        journalEvents,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    fail("wave42 tool journal closure gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave42 tool journal closure gate passed.\n");
}

await runGate();
