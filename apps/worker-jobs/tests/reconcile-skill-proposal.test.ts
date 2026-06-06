import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import {
  SkillPromptIndex,
  SkillSnapshotFileStore,
  loadSkillRepository,
  resolveApprovedSkillSnapshotPath,
} from "@hotflow/skills";
import { SessionStoreTaskPlanePort, projectSessionTaskState } from "@hotflow/tasks-core";
import { afterEach, describe, expect, test } from "vitest";

import { runWorkerJobsCli } from "../src/main.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function seedCommittedTurn(store: SessionStore, sessionId: string, turnId: string): void {
  store.createSession({ sessionId });
  store.appendJournal(sessionId, {
    eventType: "user.input",
    turnId,
    payload: { text: "Summarize the repo" },
    createdAtMs: 100,
  });
  store.appendJournal(sessionId, {
    eventType: "tool.result",
    turnId,
    payload: {
      toolName: "filesystem.read_text",
      ok: true,
      output: { text: "Repository summary" },
      error: null,
    },
    createdAtMs: 110,
  });
  store.createCheckpoint(sessionId, {
    state: {
      lastTurnId: turnId,
      lastAssistantOutput: "Repository summary",
    },
    createdAtMs: 120,
  });
}

describe("worker-jobs reconcile-skill-proposal", () => {
  test("keeps approved skills invisible until reconcile applies them", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-reconcile-"));
    cleanupPaths.push(workspaceRoot);

    const dataDir = join(workspaceRoot, ".hotflow");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    const dbPath = join(dataDir, "sessions", "worker.sqlite");
    const env = {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_WORKER_SESSION_DB_PATH: dbPath,
    };
    const sessionId = "sess_skill_reconcile";
    const seedStore = new SessionStore({ dbPath });
    try {
      seedCommittedTurn(seedStore, sessionId, "turn_skill_1");
    } finally {
      seedStore.close();
    }

    let enqueueStdout = "";
    let enqueueStderr = "";
    const enqueueExitCode = await runWorkerJobsCli(
      ["run-once", "--session-id", sessionId, "--turn-id", "turn_skill_1"],
      {
        env,
        io: {
          stdout(message) {
            enqueueStdout += message;
          },
          stderr(message) {
            enqueueStderr += message;
          },
        },
      },
    );

    expect(enqueueExitCode).toBe(0);
    expect(enqueueStderr).toBe("");
    const enqueueReport = JSON.parse(enqueueStdout) as { proposalId: string };
    const snapshotPath = resolveApprovedSkillSnapshotPath({ dataDir }, env);
    const staleRepository = loadSkillRepository({
      approvedSkills: new SkillSnapshotFileStore(snapshotPath).readApproved(),
    });
    expect(staleRepository.listApproved()).toEqual([]);
    expect(
      new SkillPromptIndex(staleRepository).buildSections({
        limit: 1,
        userText: "turn_skill_1",
      }),
    ).toEqual([]);

    const store = new SessionStore({ dbPath });
    try {
      const taskPlane = new SessionStoreTaskPlanePort(store, sessionId, {
        createIfMissing: false,
      });
      await taskPlane.transitionProposal({
        proposalId: enqueueReport.proposalId,
        status: "accepted",
      });
    } finally {
      store.close();
    }

    let reconcileStdout = "";
    let reconcileStderr = "";
    const reconcileExitCode = await runWorkerJobsCli(
      [
        "reconcile-skill-proposal",
        "--session-id",
        sessionId,
        "--proposal-id",
        enqueueReport.proposalId,
      ],
      {
        env,
        io: {
          stdout(message) {
            reconcileStdout += message;
          },
          stderr(message) {
            reconcileStderr += message;
          },
        },
      },
    );

    expect(reconcileExitCode).toBe(0);
    expect(reconcileStderr).toBe("");
    expect(existsSync(snapshotPath)).toBe(true);
    expect(staleRepository.listApproved()).toEqual([]);

    const reloadedRepository = loadSkillRepository({
      approvedSkills: new SkillSnapshotFileStore(snapshotPath).readApproved(),
    });
    expect(reloadedRepository.listApproved()).toHaveLength(1);
    expect(
      new SkillPromptIndex(reloadedRepository).buildSections({
        limit: 1,
        userText: "turn_skill_1",
      }),
    ).toHaveLength(1);

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(
        taskState.proposalQueue.find((entry) => entry.id === enqueueReport.proposalId)?.status,
      ).toBe("applied");
    } finally {
      resultStore.close();
    }

    const reconcileReport = JSON.parse(reconcileStdout) as {
      proposalStatusBefore: string;
      proposalStatusAfter: string;
      approvedSkillCountBefore: number;
      approvedSkillCountAfter: number;
    };
    expect(reconcileReport).toMatchObject({
      proposalStatusBefore: "accepted",
      proposalStatusAfter: "applied",
      approvedSkillCountBefore: 0,
      approvedSkillCountAfter: 1,
    });
  });
});
