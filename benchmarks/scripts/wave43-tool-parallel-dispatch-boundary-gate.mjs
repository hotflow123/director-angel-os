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

function createDeferredSignal() {
  let resolveSignal;
  const promise = new Promise((resolve) => {
    resolveSignal = resolve;
  });

  return {
    promise,
    resolve() {
      resolveSignal?.();
    },
  };
}

async function flushDispatchQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();

  for (const target of ["@hotflow/contracts", "@hotflow/policy-runtime", "@hotflow/tools"]) {
    const build = runWorkspaceBuild(target, process.env);
    if (build.status !== 0) {
      fail(
        `build failed for ${target} during wave43 tool parallel dispatch boundary gate.`,
        build.stderr,
      );
    }
  }

  const failures = [];
  const started = [];
  const finished = [];
  const controlled = new Map();
  const registry = new ToolRegistry();

  const registerControlledTool = (name, readOnly) => {
    registry.register({
      name,
      description: `${name} controlled gate tool`,
      timeoutMs: 1_000,
      readOnly,
      capabilities: [name],
      riskLevel: "low",
      async execute() {
        started.push(name);
        const signal = createDeferredSignal();
        controlled.set(name, signal);
        await signal.promise;
        finished.push(name);
        return {
          toolCallId: `ignored_${name}`,
          toolName: name,
          ok: true,
          output: name,
          resolution: "executed",
        };
      },
    });
  };

  registerControlledTool("read.alpha", true);
  registerControlledTool("read.beta", true);
  registerControlledTool("write.gamma", false);
  registerControlledTool("read.delta", true);

  const dispatcher = new ToolDispatcher(registry);
  const orderedPending = dispatcher.dispatchMany(
    [
      { id: "call_alpha", name: "read.alpha", args: {} },
      { id: "call_beta", name: "read.beta", args: {} },
      { id: "call_gamma", name: "write.gamma", args: {} },
      { id: "call_delta", name: "read.delta", args: {} },
    ],
    { sessionId: "session_wave43_ordered" },
    "ordered",
  );

  await flushDispatchQueue();
  if (JSON.stringify(started) !== JSON.stringify(["read.alpha", "read.beta"])) {
    failures.push(
      `Expected first batch to start in parallel, but received ${JSON.stringify(started)}.`,
    );
  }

  controlled.get("read.alpha")?.resolve();
  await flushDispatchQueue();
  if (JSON.stringify(started) !== JSON.stringify(["read.alpha", "read.beta"])) {
    failures.push(
      `Expected write barrier to wait for both read-only calls, but received ${JSON.stringify(started)} after resolving read.alpha.`,
    );
  }

  controlled.get("read.beta")?.resolve();
  await flushDispatchQueue();
  if (JSON.stringify(started) !== JSON.stringify(["read.alpha", "read.beta", "write.gamma"])) {
    failures.push(
      `Expected write barrier to start only after read batch completed, but received ${JSON.stringify(started)}.`,
    );
  }

  controlled.get("write.gamma")?.resolve();
  await flushDispatchQueue();
  if (
    JSON.stringify(started) !==
    JSON.stringify(["read.alpha", "read.beta", "write.gamma", "read.delta"])
  ) {
    failures.push(
      `Expected trailing read-only batch to wait for write barrier, but received ${JSON.stringify(started)}.`,
    );
  }

  controlled.get("read.delta")?.resolve();
  const orderedResults = await orderedPending;
  if (
    JSON.stringify(orderedResults.map((result) => result.toolName)) !==
    JSON.stringify(["read.alpha", "read.beta", "write.gamma", "read.delta"])
  ) {
    failures.push(
      `Expected ordered results to preserve input order, but received ${JSON.stringify(orderedResults.map((result) => result.toolName))}.`,
    );
  }

  const mergeRegistry = new ToolRegistry();
  mergeRegistry.register({
    name: "read.fail",
    description: "parallel fail",
    timeoutMs: 100,
    readOnly: true,
    capabilities: ["read.fail"],
    riskLevel: "low",
    async execute() {
      return {
        toolCallId: "ignored_fail",
        toolName: "read.fail",
        ok: false,
        error: "miss",
        resolution: "failed",
      };
    },
  });
  mergeRegistry.register({
    name: "read.hit",
    description: "parallel hit",
    timeoutMs: 100,
    readOnly: true,
    capabilities: ["read.hit"],
    riskLevel: "low",
    async execute() {
      return {
        toolCallId: "ignored_hit",
        toolName: "read.hit",
        ok: true,
        output: "hit",
        resolution: "executed",
      };
    },
  });
  const mergeDispatcher = new ToolDispatcher(mergeRegistry);
  const firstWinsResults = await mergeDispatcher.dispatchMany(
    [
      { id: "call_fail", name: "read.fail", args: {} },
      { id: "call_hit", name: "read.hit", args: {} },
    ],
    { sessionId: "session_wave43_first_wins" },
    "first-wins",
  );
  if (
    firstWinsResults.length !== 1 ||
    firstWinsResults[0]?.toolName !== "read.hit" ||
    firstWinsResults[0]?.ok !== true
  ) {
    failures.push(
      `Expected first-wins to keep only the first successful result, but received ${JSON.stringify(firstWinsResults)}.`,
    );
  }

  const allOrNothingRegistry = new ToolRegistry();
  allOrNothingRegistry.register({
    name: "read.one",
    description: "parallel success",
    timeoutMs: 100,
    readOnly: true,
    capabilities: ["read.one"],
    riskLevel: "low",
    async execute() {
      return {
        toolCallId: "ignored_one",
        toolName: "read.one",
        ok: true,
        output: "one",
        resolution: "executed",
      };
    },
  });
  allOrNothingRegistry.register({
    name: "read.two",
    description: "parallel failure",
    timeoutMs: 100,
    readOnly: true,
    capabilities: ["read.two"],
    riskLevel: "low",
    async execute() {
      return {
        toolCallId: "ignored_two",
        toolName: "read.two",
        ok: false,
        error: "boom",
        resolution: "failed",
      };
    },
  });
  const allOrNothingDispatcher = new ToolDispatcher(allOrNothingRegistry);
  const allOrNothingResults = await allOrNothingDispatcher.dispatchMany(
    [
      { id: "call_one", name: "read.one", args: {} },
      { id: "call_two", name: "read.two", args: {} },
    ],
    { sessionId: "session_wave43_all_or_nothing" },
    "all-or-nothing",
  );
  if (JSON.stringify(allOrNothingResults) !== JSON.stringify([])) {
    failures.push(
      `Expected all-or-nothing to drop mixed results, but received ${JSON.stringify(allOrNothingResults)}.`,
    );
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave43-tool-parallel-dispatch-boundary-gate-latest.json"),
    JSON.stringify(
      {
        gate: "wave43-tool-parallel-dispatch-boundary",
        started,
        finished,
        orderedResults,
        firstWinsResults,
        allOrNothingResults,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    fail("wave43 tool parallel dispatch boundary gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave43 tool parallel dispatch boundary gate passed.\n");
}

await runGate();
