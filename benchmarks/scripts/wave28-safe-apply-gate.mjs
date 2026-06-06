import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapCli } from "../../apps/cli/dist/bootstrap.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import {
  SkillSnapshotFileStore,
  createSkillProposalQueueInput,
  resolveApprovedSkillSnapshotPath,
} from "../../packages/skills/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const SKILL_ID = "skill.readme.summary";
const SESSION_ID = "sess_wave28_safe_apply";
const INITIAL_CONTENT = "Read the README, then summarize the repository briefly.";
const UPDATED_CONTENT = "Read the README carefully, then summarize the repository clearly.";

function recordFailure(failures, message) {
  failures.push(message);
}

function extractAuditEvidence(sessionDbPath, sessionId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const events = store.listAuditEvents(sessionId);
    const kinds = events.map((entry) => entry.event.kind);
    const controlActionEvents = events.filter((entry) => entry.event.kind === "control.action");
    const successfulActions = controlActionEvents
      .map((entry) => entry.event.payload)
      .filter((payload) => payload && typeof payload === "object" && !Array.isArray(payload))
      .filter((payload) => payload.ok === true && typeof payload.action === "string")
      .map((payload) => payload.action);

    return {
      totalAuditEvents: events.length,
      auditKinds: [...new Set(kinds)].sort(),
      successfulActions: [...new Set(successfulActions)].sort(),
    };
  } finally {
    store.close();
  }
}

async function runGate() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-wave28-gate-"));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", "wave28-safe-apply.sqlite");
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };
  const failures = [];
  const evidence = {};

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(join(workspaceRoot, "README.md"), "Wave 28 safe apply benchmark.\n", "utf8");

  try {
    const snapshotPath = resolveApprovedSkillSnapshotPath({ dataDir }, env);
    const snapshotStore = new SkillSnapshotFileStore(snapshotPath, {
      now: () => 100,
    });
    snapshotStore.writeApproved([
      {
        id: SKILL_ID,
        version: "1.0.0",
        title: "README Summary",
        content: INITIAL_CONTENT,
        updatedAtMs: 50,
      },
    ]);

    const runtimeBeforeReload = bootstrapCli({ env });
    try {
      evidence.beforeApplySkillContent =
        runtimeBeforeReload.skillRepository.getApproved(SKILL_ID)?.content ?? null;

      const enqueueResult = await runtimeBeforeReload.controlPlane.dispatch({
        type: "proposal-enqueue",
        sessionId: SESSION_ID,
        proposal: createSkillProposalQueueInput({
          id: "proposal_wave28_apply",
          snapshot: {
            id: SKILL_ID,
            version: "1.1.0",
            title: "README Summary",
            content: UPDATED_CONTENT,
            updatedAtMs: 150,
          },
          sourceSessionId: SESSION_ID,
          sourceTurnId: "turn_wave28_apply",
          trajectoryRef: `journal://${SESSION_ID}/turn_wave28_apply`,
          provenance: "bench-wave28",
        }),
      });
      if (!enqueueResult.ok) {
        recordFailure(failures, "proposal-enqueue failed during wave28 gate.");
      }

      const acceptResult = await runtimeBeforeReload.controlPlane.dispatch({
        type: "proposal-transition",
        sessionId: SESSION_ID,
        proposalId: "proposal_wave28_apply",
        status: "accepted",
      });
      if (!acceptResult.ok) {
        recordFailure(failures, "proposal-transition -> accepted failed during wave28 gate.");
      }

      const previewResult = await runtimeBeforeReload.controlPlane.dispatch({
        type: "proposal-preview",
        sessionId: SESSION_ID,
        proposalId: "proposal_wave28_apply",
      });
      if (!previewResult.ok) {
        recordFailure(failures, "proposal-preview failed during wave28 gate.");
      }

      const preview = previewResult.data;
      evidence.preview = preview;
      if (
        !preview ||
        typeof preview !== "object" ||
        Array.isArray(preview) ||
        preview.currentHeadVersion !== 1 ||
        preview.nextHeadVersion !== 2
      ) {
        recordFailure(failures, "proposal-preview did not expose the expected head version plan.");
      }
      if (
        !Array.isArray(preview?.changedFields) ||
        !preview.changedFields.some(
          (entry) => entry && typeof entry === "object" && entry.field === "content",
        )
      ) {
        recordFailure(failures, "proposal-preview did not include a content field diff.");
      }

      const applyResult = await runtimeBeforeReload.controlPlane.dispatch({
        type: "proposal-apply",
        sessionId: SESSION_ID,
        proposalId: "proposal_wave28_apply",
      });
      if (!applyResult.ok) {
        recordFailure(failures, "proposal-apply failed during wave28 gate.");
      }

      evidence.beforeReloadRuntimeContent =
        runtimeBeforeReload.skillRepository.getApproved(SKILL_ID)?.content ?? null;
      evidence.afterApplyHeadContent =
        runtimeBeforeReload.approvedSkillRepository.getApproved(SKILL_ID)?.content ?? null;

      if (runtimeBeforeReload.skillRepository.getApproved(SKILL_ID)?.content !== INITIAL_CONTENT) {
        recordFailure(
          failures,
          "Applied skill became visible before reload in runtime skillRepository.",
        );
      }
      if (
        runtimeBeforeReload.approvedSkillRepository.getApproved(SKILL_ID)?.content !==
        UPDATED_CONTENT
      ) {
        recordFailure(failures, "Approved head did not reflect the applied skill snapshot.");
      }
    } finally {
      runtimeBeforeReload.sessionStore.close();
    }

    const runtimeAfterReload = bootstrapCli({ env });
    try {
      evidence.afterReloadRuntimeContent =
        runtimeAfterReload.skillRepository.getApproved(SKILL_ID)?.content ?? null;
      if (runtimeAfterReload.skillRepository.getApproved(SKILL_ID)?.content !== UPDATED_CONTENT) {
        recordFailure(failures, "Applied skill was not visible after reloading the runtime.");
      }

      const rollbackResult = await runtimeAfterReload.controlPlane.dispatch({
        type: "proposal-rollback",
        sessionId: SESSION_ID,
      });
      if (!rollbackResult.ok) {
        recordFailure(failures, "proposal-rollback failed during wave28 gate.");
      }

      evidence.rollback = rollbackResult.data;
      evidence.afterRollbackHeadContent =
        runtimeAfterReload.approvedSkillRepository.getApproved(SKILL_ID)?.content ?? null;
      evidence.duringRollbackRuntimeContent =
        runtimeAfterReload.skillRepository.getApproved(SKILL_ID)?.content ?? null;

      if (
        runtimeAfterReload.approvedSkillRepository.getApproved(SKILL_ID)?.content !==
        INITIAL_CONTENT
      ) {
        recordFailure(failures, "Rollback did not restore the previous approved head snapshot.");
      }
      if (runtimeAfterReload.skillRepository.getApproved(SKILL_ID)?.content !== UPDATED_CONTENT) {
        recordFailure(failures, "Rollback polluted the current runtime without a reload boundary.");
      }
    } finally {
      runtimeAfterReload.sessionStore.close();
    }

    const runtimeAfterRestoreReload = bootstrapCli({ env });
    try {
      evidence.afterRestoreReloadRuntimeContent =
        runtimeAfterRestoreReload.skillRepository.getApproved(SKILL_ID)?.content ?? null;
      if (
        runtimeAfterRestoreReload.skillRepository.getApproved(SKILL_ID)?.content !== INITIAL_CONTENT
      ) {
        recordFailure(
          failures,
          "Restored snapshot did not become visible after the next runtime bootstrap.",
        );
      }
    } finally {
      runtimeAfterRestoreReload.sessionStore.close();
    }

    const auditEvidence = extractAuditEvidence(sessionDbPath, SESSION_ID);
    evidence.audit = auditEvidence;

    for (const requiredKind of [
      "control.action",
      "skills.proposal_apply",
      "skills.snapshot_write",
      "skills.rollback",
    ]) {
      if (!auditEvidence.auditKinds.includes(requiredKind)) {
        recordFailure(failures, `Missing audit evidence kind: ${requiredKind}`);
      }
    }

    for (const requiredAction of ["proposal-preview", "proposal-apply", "proposal-rollback"]) {
      if (!auditEvidence.successfulActions.includes(requiredAction)) {
        recordFailure(failures, `Missing successful control.action audit for ${requiredAction}.`);
      }
    }

    return {
      ok: failures.length === 0,
      failures,
      evidence,
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { resultsDir } = getBenchmarksPaths();
const result = await runGate();
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave28-safe-apply-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: "wave28-safe-apply-gate",
        timestamp: new Date().toISOString(),
        totalRuns: 1,
        failedRuns: result.ok ? 0 : 1,
      },
      runs: [
        {
          caseId: "wave28-safe-apply",
          ok: result.ok,
          failures: result.failures,
          actual: result.evidence,
        },
      ],
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 28 safe apply gate completed: failed ${result.ok ? 0 : 1}\nReport: ${outputPath}\n`,
);

if (!result.ok) {
  process.exitCode = 1;
}
