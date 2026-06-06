import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SessionStore } from "../../packages/sessions/dist/index.js";
import { createSkillProposalQueueInput } from "../../packages/skills/dist/index.js";
import { SessionStoreTaskPlanePort } from "../../packages/tasks-core/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const REQUIRED_TASK_ACTIONS = [
  "proposal-list",
  "proposal-review",
  "proposal-explain",
  "proposal-accept",
  "proposal-reject",
];

function runPnpm(repoRoot, args, env = process.env) {
  return spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function runHotflowCli(repoRoot, command, env) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, ["--filter", "@hotflow/cli", "dev", "--", ...command], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
  };
}

function coerceJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    const jsonStart = output.indexOf("{");
    const jsonEnd = output.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      return null;
    }
    try {
      return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
  }
}

function toPreview(output, lines = 40) {
  return output.split("\n").slice(0, lines).join("\n");
}

async function seedProposalQueue(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    store.createSession({ sessionId });
    const taskPlane = new SessionStoreTaskPlanePort(store, sessionId, {
      createIfMissing: false,
    });

    await taskPlane.enqueueProposal(
      createSkillProposalQueueInput({
        id: "proposal_wave27_accept",
        snapshot: {
          id: "skill.wave27.accept",
          version: "1.0.0",
          title: "Wave 27 Accept Candidate",
          content: "Summarize evidence before final response.",
          updatedAtMs: 1_001,
        },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_wave27_accept",
        trajectoryRef: `journal://${sessionId}/turn_wave27_accept`,
        provenance: "bench-wave27/accept",
      }),
    );

    await taskPlane.enqueueProposal(
      createSkillProposalQueueInput({
        id: "proposal_wave27_reject",
        snapshot: {
          id: "skill.wave27.reject",
          version: "1.0.0",
          title: "Wave 27 Reject Candidate",
          content: "Use unsafe shell operations without checks.",
          updatedAtMs: 1_002,
        },
        sourceSessionId: sessionId,
        sourceTurnId: "turn_wave27_reject",
        trajectoryRef: `journal://${sessionId}/turn_wave27_reject`,
        provenance: "bench-wave27/reject",
      }),
    );
  } finally {
    store.close();
  }
}

function verifyCommandRun(run, expectedAction, expectedNeedle) {
  const failures = [];
  if (run.status !== 0) {
    failures.push(`Expected ${expectedAction} exit status 0 but received ${run.status}.`);
  }
  if (!run.stdout.includes(`Task action: ${expectedAction}`)) {
    failures.push(`Missing action marker for ${expectedAction}.`);
  }
  if (expectedNeedle && !run.stdout.includes(expectedNeedle)) {
    failures.push(`Expected ${expectedAction} stdout to include: ${expectedNeedle}`);
  }
  return failures;
}

function extractControlActionEvidence(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const events = store.listAuditEvents(sessionId);
    const controlEvents = events.filter((entry) => entry.event.kind === "control.action");
    const actionEvents = controlEvents.filter((entry) => {
      const payload = entry.event.payload;
      return (
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        REQUIRED_TASK_ACTIONS.includes(payload.action)
      );
    });

    const actionsWithEvidence = new Set();
    for (const entry of actionEvents) {
      const payload = entry.event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        continue;
      }
      const action = typeof payload.action === "string" ? payload.action : undefined;
      const ok = payload.ok === true;
      if (action && ok) {
        actionsWithEvidence.add(action);
      }
    }

    return {
      totalControlActions: controlEvents.length,
      totalRequiredActionAudits: actionEvents.length,
      actionsWithEvidence: [...actionsWithEvidence].sort(),
    };
  } finally {
    store.close();
  }
}

function verifyDoctorReport(doctorRun) {
  const failures = [];
  if (doctorRun.status !== 0) {
    failures.push(`Expected doctor --json exit status 0 but received ${doctorRun.status}.`);
    return { failures, report: null };
  }

  const report = coerceJson(doctorRun.stdout);
  if (!report) {
    failures.push("Doctor stdout was not valid JSON.");
    return { failures, report: null };
  }

  const checkIds = Array.isArray(report.checks)
    ? report.checks
        .map((check) => (check && typeof check === "object" ? check.id : null))
        .filter((value) => typeof value === "string")
    : [];

  for (const requiredCheck of [
    "learning.proposal_store",
    "learning.approved_snapshot",
    "learning.reload_visibility",
  ]) {
    if (!checkIds.includes(requiredCheck)) {
      failures.push(`Doctor report missing check: ${requiredCheck}`);
    }
  }

  return { failures, report };
}

async function runGate(paths) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave27-gate-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave27-operator.sqlite");
  const sessionId = "sess_wave27_operator";

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(join(workspaceRoot, "README.md"), "Wave 27 operator surface benchmark.\n", "utf8");

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  const commandRuns = [];
  const failures = [];

  try {
    await seedProposalQueue(sessionDbPath, sessionId);

    const commandPlan = [
      {
        action: "proposal-list",
        command: ["task", "proposal-list", sessionId, "--limit", "10"],
        expectedNeedle: "Proposal items:",
      },
      {
        action: "proposal-review",
        command: ["task", "proposal-review", sessionId, "--proposal-id", "proposal_wave27_accept"],
        expectedNeedle: "Review summary:",
      },
      {
        action: "proposal-explain",
        command: ["task", "proposal-explain", sessionId, "--proposal-id", "proposal_wave27_accept"],
        expectedNeedle: "Proposal explanation:",
      },
      {
        action: "proposal-accept",
        command: [
          "task",
          "proposal-accept",
          sessionId,
          "--proposal-id",
          "proposal_wave27_accept",
          "--decision-note",
          "bench-accept",
        ],
      },
      {
        action: "proposal-reject",
        command: [
          "task",
          "proposal-reject",
          sessionId,
          "--proposal-id",
          "proposal_wave27_reject",
          "--decision-note",
          "bench-reject",
        ],
      },
    ];

    for (const step of commandPlan) {
      const run = runHotflowCli(paths.repoRoot, step.command, env);
      commandRuns.push({
        action: step.action,
        command: step.command,
        status: run.status,
        durationMs: Number(run.durationMs.toFixed(2)),
        stdoutPreview: toPreview(run.stdout),
        stderr: run.stderr.trim(),
      });
      failures.push(...verifyCommandRun(run, step.action, step.expectedNeedle));
    }

    const auditEvidence = extractControlActionEvidence(sessionDbPath, sessionId);
    for (const action of REQUIRED_TASK_ACTIONS) {
      if (!auditEvidence.actionsWithEvidence.includes(action)) {
        failures.push(`Missing control.action audit evidence for ${action}.`);
      }
    }

    const doctorRun = runHotflowCli(paths.repoRoot, ["doctor", "--json"], env);
    const doctorResult = verifyDoctorReport(doctorRun);
    failures.push(...doctorResult.failures);

    return {
      ok: failures.length === 0,
      failures,
      runtime: {
        workspaceRoot,
        dataDir,
        sessionDbPath,
      },
      commandRuns,
      auditEvidence,
      doctor: {
        status: doctorRun.status,
        durationMs: Number(doctorRun.durationMs.toFixed(2)),
        stdoutPreview: toPreview(doctorRun.stdout),
        stderr: doctorRun.stderr.trim(),
        checkIds: Array.isArray(doctorResult.report?.checks)
          ? doctorResult.report.checks
              .map((check) => (check && typeof check === "object" ? check.id : null))
              .filter((value) => typeof value === "string")
          : [],
      },
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const paths = getBenchmarksPaths();
const buildResult = runPnpm(paths.repoRoot, ["--filter", "@hotflow/cli", "build"]);
if (buildResult.status !== 0) {
  process.stderr.write("Failed to build @hotflow/cli before Wave 27 operator surface gate.\n");
  process.stderr.write(`${buildResult.stderr}\n${buildResult.stdout}\n`);
  process.exit(1);
}

const run = await runGate(paths);
const summary = {
  suiteId: "wave27-operator-surface-gate",
  timestamp: new Date().toISOString(),
  totalRuns: 1,
  failedRuns: run.ok ? 0 : 1,
  passedRuns: run.ok ? 1 : 0,
};

mkdirSync(paths.resultsDir, { recursive: true });
const outputPath = resolve(paths.resultsDir, "wave27-operator-surface-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary,
      runs: [
        {
          caseId: "wave27-operator-surface-smoke",
          ...run,
        },
      ],
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 27 operator surface gate completed: ${summary.totalRuns} runs, failed ${summary.failedRuns}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (!run.ok) {
  process.exitCode = 1;
}
