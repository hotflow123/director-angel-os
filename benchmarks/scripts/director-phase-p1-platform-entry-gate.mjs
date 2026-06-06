import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getBenchmarksPaths, runWorkspaceBuild } from "./cli-command.mjs";

const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(
  benchmarksDir,
  "fixtures",
  "director-phase-p1-platform-entry-gate.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function runBuild(target) {
  const result = runWorkspaceBuild(target);

  if (result.status !== 0) {
    fail(
      `Failed to build ${target} before Director Phase P1 platform-entry gate.`,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
  }
}

function createEntryClarificationRequest() {
  return {
    apiVersion: "director-entry.v1",
    entry: {
      hostId: "lark",
      channel: "lark-im",
      routeKind: "direct",
      sessionKey: "agent:director:direct:user_clarify",
      messageId: "msg-entry-clarify-1",
      receivedAt: "2026-04-13T11:00:00.000Z",
    },
    snapshot: {
      apiVersion: "director-host-api.v1",
      schemaId: "director.host.snapshot.v1",
      snapshotId: "snapshot-entry-clarify-1",
      createdAt: "2026-04-13T11:00:00.000Z",
      host: {
        hostId: "lark",
        triggerSource: "api",
        sessionId: "agent:director:direct:user_clarify",
      },
      project: {
        projectId: "project-clarify-1",
      },
      group: {
        groupId: "group-clarify-1",
        generationType: "extend",
        sceneCount: 1,
        anchorIds: [],
      },
      runtime: {
        runtimeId: "runtime-1",
        status: "ready",
        availableBindings: ["binding-a"],
        maxPromptChars: 4096,
        supportsVideo: true,
      },
      intent: {
        bindingPolicy: "auto",
      },
    },
    intake: {
      intakeId: "intake-entry-clarify-1",
      submittedAt: "2026-04-13T11:00:00.000Z",
      objective: "Continue the existing story.",
      desiredOutcome: "Continue the existing story.",
    },
  };
}

function assert(condition, message, failures) {
  if (!condition) {
    failures.push(message);
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const headers = {
    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text.length === 0 ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

async function withApp(modules, runCase) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "director-phase-p1-platform-entry-"));
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: join(workspaceRoot, ".hotflow"),
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
  };
  const app = modules.createDirectorHostApiApp({ env });
  const { host, port } = await app.start({ host: "127.0.0.1", port: 0 });
  const baseUrl = `http://${host}:${port}`;

  try {
    return await runCase({
      baseUrl,
      workspaceRoot,
      modules,
    });
  } finally {
    await app.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

async function runGoldenPathCase(context) {
  const failures = [];
  const message = context.modules.createChannelTransportEnvelope({
    channel: "lark-im",
    agentId: "director",
    peerId: "user_golden",
    messageId: "msg-entry-golden-1",
    receivedAtMs: 1_713_000_000_000,
    text: "Create a director-ready launch brief.",
    routingHint: {
      agentId: "director",
      channel: "lark-im",
      routeKind: "direct",
      peerId: "user_golden",
    },
  });

  const intakeResponse = await requestJson(context.baseUrl, "/v1/entry/message", {
    method: "POST",
    body: JSON.stringify({
      apiVersion: "director-entry.v1",
      hostId: "lark",
      message,
    }),
  });
  assert(intakeResponse.status === 200, "entry/message should succeed.", failures);
  assert(
    intakeResponse.body?.session?.state === "ready_for_blueprint",
    "entry session should become ready_for_blueprint.",
    failures,
  );

  const entrySessionId = intakeResponse.body?.session?.entrySessionId;
  assert(
    typeof entrySessionId === "string",
    "entry/message should return entrySessionId.",
    failures,
  );

  const blueprintResponse = await requestJson(
    context.baseUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/blueprint`,
    {
      method: "POST",
    },
  );
  assert(blueprintResponse.status === 200, "entry blueprint route should succeed.", failures);
  assert(
    blueprintResponse.body?.session?.state === "ready_for_run",
    "entry session should become ready_for_run after blueprint.",
    failures,
  );

  const runResponse = await requestJson(
    context.baseUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/runs`,
    {
      method: "POST",
    },
  );
  assert(runResponse.status === 201, "entry runs route should create a run.", failures);

  const runId = runResponse.body?.run?.runId;
  assert(typeof runId === "string", "entry runs route should return runId.", failures);

  const startResponse = await requestJson(
    context.baseUrl,
    `/v1/runs/${encodeURIComponent(runId)}/start`,
    {
      method: "POST",
    },
  );
  assert(startResponse.status === 200, "run start should succeed.", failures);

  const statusResponse = await requestJson(
    context.baseUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/status`,
  );
  assert(statusResponse.status === 200, "entry status route should succeed.", failures);
  assert(
    statusResponse.body?.session?.state === "run_in_progress",
    "entry status should project run_in_progress after start.",
    failures,
  );
  assert(
    statusResponse.body?.session?.nextAction === "wait",
    "entry status should recommend wait while run is in progress.",
    failures,
  );
  assert(
    statusResponse.body?.run?.status === "running",
    "entry status should expose running run status.",
    failures,
  );
  assert(
    typeof statusResponse.body?.report?.reportId === "string",
    "entry status should expose a report id.",
    failures,
  );

  return {
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    notes: [
      `entrySessionId=${entrySessionId}`,
      `runId=${runId}`,
      `reportId=${statusResponse.body?.report?.reportId ?? "(missing)"}`,
    ],
  };
}

async function runClarificationGateCase(context) {
  const failures = [];
  const intakeResponse = await requestJson(context.baseUrl, "/v1/entry/intake", {
    method: "POST",
    body: JSON.stringify(createEntryClarificationRequest()),
  });

  assert(
    intakeResponse.status === 200,
    "entry/intake should accept clarification-required input.",
    failures,
  );
  assert(
    intakeResponse.body?.session?.state === "clarification_required",
    "clarification case should stay in clarification_required state.",
    failures,
  );
  assert(
    intakeResponse.body?.session?.nextAction === "clarify",
    "clarification case should recommend clarify as the next action.",
    failures,
  );
  assert(
    intakeResponse.body?.intake?.alignmentState === "pending",
    "clarification case should leave alignmentState as pending.",
    failures,
  );
  assert(
    (intakeResponse.body?.intake?.clarification?.questions?.length ?? 0) > 0,
    "clarification case should return clarification questions.",
    failures,
  );

  const entrySessionId = intakeResponse.body?.session?.entrySessionId;
  const blueprintResponse = await requestJson(
    context.baseUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/blueprint`,
    {
      method: "POST",
    },
  );
  assert(
    blueprintResponse.status === 409,
    "clarification-required session should reject blueprint continuation.",
    failures,
  );
  assert(
    blueprintResponse.body?.code === "ENTRY_SESSION_STATE_CONFLICT",
    "clarification-required blueprint rejection should surface ENTRY_SESSION_STATE_CONFLICT.",
    failures,
  );

  return {
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    notes: [
      `entrySessionId=${entrySessionId}`,
      `clarificationQuestions=${intakeResponse.body?.intake?.clarification?.questions?.length ?? 0}`,
      `blueprintStatus=${blueprintResponse.status}`,
    ],
  };
}

async function runFailureRetryGateCase(context) {
  const failures = [];
  const message = context.modules.createChannelTransportEnvelope({
    channel: "lark-im",
    agentId: "director",
    peerId: "user_retry",
    messageId: "msg-entry-retry-1",
    receivedAtMs: 1_713_000_240_000,
    text: "Create a launch brief that will need retry.",
    routingHint: {
      agentId: "director",
      channel: "lark-im",
      routeKind: "direct",
      peerId: "user_retry",
    },
  });

  const intakeResponse = await requestJson(context.baseUrl, "/v1/entry/message", {
    method: "POST",
    body: JSON.stringify({
      apiVersion: "director-entry.v1",
      hostId: "lark",
      message,
    }),
  });
  const entrySessionId = intakeResponse.body?.session?.entrySessionId;

  await requestJson(
    context.baseUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/blueprint`,
    { method: "POST" },
  );
  const runResponse = await requestJson(
    context.baseUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/runs`,
    { method: "POST" },
  );
  const runId = runResponse.body?.run?.runId;
  const assignmentId = runResponse.body?.run?.assignments?.[0]?.assignmentId;
  await requestJson(context.baseUrl, `/v1/runs/${encodeURIComponent(runId)}/start`, {
    method: "POST",
  });
  assert(
    typeof assignmentId === "string",
    "entry run should expose at least one assignmentId.",
    failures,
  );

  const abortResponse = await requestJson(
    context.baseUrl,
    `/v1/runs/${encodeURIComponent(runId)}/abort`,
    {
      method: "POST",
    },
  );
  assert(abortResponse.status === 200, "run abort should succeed.", failures);

  const failedStatus = await requestJson(
    context.baseUrl,
    `/v1/entry/sessions/${encodeURIComponent(entrySessionId)}/status`,
  );
  assert(
    failedStatus.status === 200,
    "entry status should succeed after an aborted run.",
    failures,
  );
  assert(
    failedStatus.body?.session?.state === "run_failed",
    "entry status should project run_failed after terminal abort.",
    failures,
  );
  assert(
    failedStatus.body?.session?.nextAction === "review_report",
    "terminally failed entry run should recommend review_report.",
    failures,
  );
  assert(
    failedStatus.body?.run?.status === "aborted",
    "failed entry status should expose aborted run status.",
    failures,
  );
  assert(
    Array.isArray(failedStatus.body?.report?.flags) &&
      failedStatus.body.report.flags.includes("has-aborted-assignments"),
    "failed entry status should expose aborted-assignment flag.",
    failures,
  );

  const retryResponse = await requestJson(
    context.baseUrl,
    `/v1/runs/${encodeURIComponent(runId)}/retry`,
    {
      method: "POST",
      body: JSON.stringify({
        assignmentId,
      }),
    },
  );
  assert(
    retryResponse.status === 409,
    "retry surface should reject retry on an aborted run.",
    failures,
  );
  assert(
    retryResponse.body?.code === "RUN_STATE_CONFLICT",
    "retry rejection should surface RUN_STATE_CONFLICT.",
    failures,
  );
  assert(
    typeof retryResponse.body?.message === "string" &&
      retryResponse.body.message.includes("cannot retry assignments"),
    "retry rejection should explain why the aborted run cannot retry.",
    failures,
  );

  return {
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    notes: [
      `entrySessionId=${entrySessionId}`,
      `runId=${runId}`,
      `assignmentId=${assignmentId ?? "(missing)"}`,
      `failedReportId=${failedStatus.body?.report?.reportId ?? "(missing)"}`,
      `retryStatus=${retryResponse.status}`,
    ],
  };
}

async function runCase(benchmarkCase, modules) {
  const started = process.hrtime.bigint();

  try {
    const result = await withApp(modules, async (context) => {
      if (benchmarkCase.id === "director_p1_entry_golden_path") {
        return runGoldenPathCase(context);
      }
      if (benchmarkCase.id === "director_p1_entry_clarification_gate") {
        return runClarificationGateCase(context);
      }
      if (benchmarkCase.id === "director_p1_entry_failure_retry_gate") {
        return runFailureRetryGateCase(context);
      }
      return {
        status: "failed",
        failures: [`Unknown benchmark case id: ${benchmarkCase.id}`],
        notes: [],
      };
    });

    return {
      id: benchmarkCase.id,
      label: benchmarkCase.label,
      description: benchmarkCase.description,
      status: result.status,
      durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
      failures: result.failures,
      notes: result.notes,
    };
  } catch (error) {
    return {
      id: benchmarkCase.id,
      label: benchmarkCase.label,
      description: benchmarkCase.description,
      status: "failed",
      durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
      failures: [error instanceof Error ? error.message : String(error)],
      notes: [],
    };
  }
}

async function main() {
  for (const target of [
    "@hotflow/contracts",
    "@hotflow/channels-core",
    "@hotflow/director-entry-contracts",
    "@hotflow/director-execution",
    "@hotflow/director-host-api",
  ]) {
    runBuild(target);
  }

  const [{ createChannelTransportEnvelope }, hostApiModule] = await Promise.all([
    import(pathToFileURL(resolve(repoRoot, "packages", "contracts", "dist", "index.js")).href),
    import(pathToFileURL(resolve(repoRoot, "apps", "director-host-api", "dist", "server.js")).href),
  ]);

  const modules = {
    createChannelTransportEnvelope,
    createDirectorHostApiApp: hostApiModule.createDirectorHostApiApp,
  };

  mkdirSync(resultsDir, { recursive: true });
  const caseResults = [];
  for (const benchmarkCase of fixture.cases ?? []) {
    caseResults.push(await runCase(benchmarkCase, modules));
  }

  const failed = caseResults.filter((result) => result.status !== "passed");
  const report = {
    suiteId: fixture.suiteId,
    fixturePath,
    generatedAt: new Date().toISOString(),
    summary: {
      total: caseResults.length,
      failed: failed.length,
      passed: caseResults.length - failed.length,
      totalDurationMs: Number(
        caseResults.reduce((sum, result) => sum + result.durationMs, 0).toFixed(2),
      ),
    },
    caseResults: caseResults.map((result) => ({
      ...result,
      durationMs: Number(result.durationMs.toFixed(2)),
    })),
  };

  const latestPath = resolve(resultsDir, "director-phase-p1-platform-entry-gate-latest.json");
  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Director Phase P1 platform-entry gate completed: ${caseResults.length} runs, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Phase P1 platform-entry gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
