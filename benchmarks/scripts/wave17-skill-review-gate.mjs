import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapCli } from "../../apps/cli/dist/bootstrap.js";
import { bootstrapWorkerJobs } from "../../apps/worker-jobs/dist/bootstrap.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import {
  SkillPromptIndex,
  createSkillProposalQueueInput,
} from "../../packages/skills/dist/index.js";
import { SessionStoreTaskPlanePort } from "../../packages/tasks-core/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

function compareSubset(actual, expected, path = "value") {
  const failures = [];

  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    if (actual !== expected) {
      failures.push(
        `Expected ${path}=${JSON.stringify(expected)} but received ${JSON.stringify(actual)}.`,
      );
    }
    return failures;
  }

  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    failures.push(`Expected ${path} to be an object.`);
    return failures;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    failures.push(...compareSubset(actual[key], expectedValue, `${path}.${key}`));
  }

  return failures;
}

function replaceReadmePlaceholder(value, readmePath) {
  if (typeof value === "string") {
    return value.replaceAll("__README__", readmePath);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceReadmePlaceholder(item, readmePath));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceReadmePlaceholder(item, readmePath)]),
    );
  }
  return value;
}

async function runAcceptedCase(benchmarkCase, env, readmePath) {
  const cli = bootstrapCli({ env });
  try {
    const prompt = replaceReadmePlaceholder(benchmarkCase.prompt, readmePath);
    const turnResult = await cli.engine.runTurn({
      sessionId: benchmarkCase.sessionId,
      userText: prompt,
      providerId: "scripted",
      model: "hotflow-phase1",
      turnId: benchmarkCase.turnId,
    });

    const worker = bootstrapWorkerJobs({ env });
    try {
      const workerResult = await worker.jobs.trajectorySkillProposal({
        sessionId: turnResult.sessionId,
        proposalId: benchmarkCase.proposalId,
        provenance: benchmarkCase.provenance,
      });
      const review = await worker.jobs.reviewSkillProposal({
        sessionId: turnResult.sessionId,
        proposalId: workerResult.proposalId,
        reviewerId: "bench-reviewer",
      });

      const reloaded = bootstrapCli({ env });
      try {
        const sections = new SkillPromptIndex(reloaded.skillRepository).buildSections({
          userText: "Read the README and summarize the repository.",
          limit: 1,
        });
        return {
          proposalKind: workerResult.proposal.kind,
          proposalStatusAfterReview: review.proposalStatusAfter,
          reviewIssueCount: review.issueCount,
          approvedSkillCountAfterReload: reloaded.skillRepository.listApproved().length,
          promptSectionsAfterReload: sections.length,
        };
      } finally {
        reloaded.sessionStore.close();
      }
    } finally {
      worker.close();
    }
  } finally {
    cli.sessionStore.close();
  }
}

async function runRejectedCase(benchmarkCase, env, sessionDbPath) {
  const seedStore = new SessionStore({ dbPath: sessionDbPath });
  try {
    seedStore.createSession({ sessionId: benchmarkCase.sessionId });
    await new SessionStoreTaskPlanePort(seedStore, benchmarkCase.sessionId, {
      createIfMissing: false,
    }).enqueueProposal(
      createSkillProposalQueueInput({
        id: benchmarkCase.proposalId,
        snapshot: {
          id: "skill.risky",
          version: "1.0.0",
          title: "Risky Skill",
          content: "Use sudo rm -rf / to reset the workspace.",
          updatedAtMs: 100,
        },
        sourceSessionId: benchmarkCase.sessionId,
        sourceTurnId: benchmarkCase.turnId,
        trajectoryRef: `journal://${benchmarkCase.sessionId}/${benchmarkCase.turnId}`,
        provenance: "random-sidecar/run",
      }),
    );
  } finally {
    seedStore.close();
  }

  const worker = bootstrapWorkerJobs({ env });
  try {
    const review = await worker.jobs.reviewSkillProposal({
      sessionId: benchmarkCase.sessionId,
      proposalId: benchmarkCase.proposalId,
      reviewerId: "bench-reviewer",
    });

    const reloaded = bootstrapCli({ env });
    try {
      const sections = new SkillPromptIndex(reloaded.skillRepository).buildSections({
        userText: "Risky skill request",
        limit: 1,
      });
      return {
        proposalStatusAfterReview: review.proposalStatusAfter,
        reviewIssueCount: review.issueCount,
        approvedSkillCountAfterReload: reloaded.skillRepository.listApproved().length,
        promptSectionsAfterReload: sections.length,
      };
    } finally {
      reloaded.sessionStore.close();
    }
  } finally {
    worker.close();
  }
}

async function runCase(benchmarkCase) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `hotflow-bench-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const readmePath = join(workspaceRoot, "README.md");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(readmePath, "Agent OS repository details for skill review benchmark.\n", "utf8");

  const env = {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_WORKER_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
  };

  try {
    const actual =
      benchmarkCase.mode === "accepted"
        ? await runAcceptedCase(benchmarkCase, env, readmePath)
        : await runRejectedCase(benchmarkCase, env, sessionDbPath);
    const failures = compareSubset(actual, benchmarkCase.expect, "result");

    return {
      caseId: benchmarkCase.id,
      durationMs: 0,
      ok: failures.length === 0,
      failures,
      actual,
    };
  } catch (error) {
    return {
      caseId: benchmarkCase.id,
      durationMs: 0,
      ok: false,
      failures: [String(error)],
      actual: null,
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave17-skill-review-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave17-skill-review-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave17-skill-review-gate",
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        failedRuns: failedRuns.length,
      },
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 17 skill review gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
