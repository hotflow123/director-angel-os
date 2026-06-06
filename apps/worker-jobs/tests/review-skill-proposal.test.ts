import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStore } from "@hotflow/sessions";
import { createSkillProposalQueueInput } from "@hotflow/skills";
import { SessionStoreTaskPlanePort, projectSessionTaskState } from "@hotflow/tasks-core";
import { afterEach, describe, expect, test } from "vitest";

import { runWorkerJobsCli } from "../src/main.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function createWorkerEnv() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-review-"));
  cleanupPaths.push(workspaceRoot);

  const dataDir = join(workspaceRoot, ".hotflow");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  const dbPath = join(dataDir, "sessions", "worker.sqlite");

  return {
    dbPath,
    env: {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_WORKER_SESSION_DB_PATH: dbPath,
    },
  };
}

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

describe("worker-jobs review-skill-proposal", () => {
  test("accepts a valid generated skill proposal", async () => {
    const { dbPath, env } = createWorkerEnv();
    const sessionId = "sess_skill_review_accept";
    const store = new SessionStore({ dbPath });
    try {
      seedCommittedTurn(store, sessionId, "turn_review_accept");
    } finally {
      store.close();
    }

    let enqueueStdout = "";
    const enqueueExitCode = await runWorkerJobsCli(
      ["run-once", "--session-id", sessionId, "--turn-id", "turn_review_accept"],
      {
        env,
        io: {
          stdout(message) {
            enqueueStdout += message;
          },
          stderr() {},
        },
      },
    );
    expect(enqueueExitCode).toBe(0);
    const enqueueReport = JSON.parse(enqueueStdout) as { proposalId: string };

    let reviewStdout = "";
    let reviewStderr = "";
    const reviewExitCode = await runWorkerJobsCli(
      [
        "review-skill-proposal",
        "--session-id",
        sessionId,
        "--proposal-id",
        enqueueReport.proposalId,
        "--reviewer-id",
        "reviewer-a",
      ],
      {
        env,
        io: {
          stdout(message) {
            reviewStdout += message;
          },
          stderr(message) {
            reviewStderr += message;
          },
        },
      },
    );

    expect(reviewExitCode).toBe(0);
    expect(reviewStderr).toBe("");
    const reviewReport = JSON.parse(reviewStdout) as {
      proposalStatusBefore: string;
      proposalStatusAfter: string;
      reviewerId: string;
      issueCount: number;
      decisionNote: string;
    };
    expect(reviewReport).toMatchObject({
      proposalStatusBefore: "pending",
      proposalStatusAfter: "accepted",
      reviewerId: "reviewer-a",
    });
    expect(reviewReport.issueCount).toBeGreaterThanOrEqual(0);
    expect(reviewReport.decisionNote).toContain("reviewer=reviewer-a");

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      expect(
        taskState.proposalQueue.find((entry) => entry.id === enqueueReport.proposalId)?.status,
      ).toBe("accepted");
    } finally {
      resultStore.close();
    }
  });

  test("keeps high-risk proposals pending for operator review instead of auto-accepting them", async () => {
    const { dbPath, env } = createWorkerEnv();
    const sessionId = "sess_skill_review_operator_gate";
    const store = new SessionStore({ dbPath });
    try {
      store.createSession({ sessionId });
      await new SessionStoreTaskPlanePort(store, sessionId, {
        createIfMissing: false,
      }).enqueueProposal(
        createSkillProposalQueueInput({
          id: "proposal_operator_gate_1",
          snapshot: {
            id: "skill.operator.review.required",
            version: "1.0.0",
            title: "Operator review required",
            content: "Summarize the committed README workflow and preserve current conventions.",
            updatedAtMs: 100,
          },
          sourceSessionId: sessionId,
          sourceTurnId: "turn_operator_gate_1",
          trajectoryRef: "journal://sess_skill_review_operator_gate/turn_operator_gate_1",
          provenance: "worker-jobs/trajectory-summary",
          riskLevel: "high",
          confidence: 0.9,
        }),
      );
    } finally {
      store.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "review-skill-proposal",
        "--session-id",
        sessionId,
        "--proposal-id",
        "proposal_operator_gate_1",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      proposalStatusBefore: "pending",
      proposalStatusAfter: "pending",
    });
    expect(JSON.parse(stdout).decisionNote).toContain("operator review");

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      const proposal = taskState.proposalQueue.find(
        (entry) => entry.id === "proposal_operator_gate_1",
      );
      expect(proposal?.status).toBe("pending");
    } finally {
      resultStore.close();
    }
  });

  test("keeps extremely low-confidence proposals pending for operator review", async () => {
    const { dbPath, env } = createWorkerEnv();
    const sessionId = "sess_skill_review_low_confidence";
    const store = new SessionStore({ dbPath });
    try {
      store.createSession({ sessionId });
      await new SessionStoreTaskPlanePort(store, sessionId, {
        createIfMissing: false,
      }).enqueueProposal(
        createSkillProposalQueueInput({
          id: "proposal_low_confidence_1",
          snapshot: {
            id: "skill.low.confidence",
            version: "1.0.0",
            title: "Low confidence skill",
            content: "Summarize the repository and retain the documented task sequence.",
            updatedAtMs: 100,
          },
          sourceSessionId: sessionId,
          sourceTurnId: "turn_low_confidence_1",
          trajectoryRef: "journal://sess_skill_review_low_confidence/turn_low_confidence_1",
          provenance: "worker-jobs/trajectory-summary",
          riskLevel: "low",
          confidence: 0.2,
        }),
      );
    } finally {
      store.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      [
        "review-skill-proposal",
        "--session-id",
        sessionId,
        "--proposal-id",
        "proposal_low_confidence_1",
      ],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      proposalStatusBefore: "pending",
      proposalStatusAfter: "pending",
    });
    expect(JSON.parse(stdout).decisionNote).toContain("operator review");

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      const proposal = taskState.proposalQueue.find(
        (entry) => entry.id === "proposal_low_confidence_1",
      );
      expect(proposal?.status).toBe("pending");
    } finally {
      resultStore.close();
    }
  });

  test("rejects risky skill proposals", async () => {
    const { dbPath, env } = createWorkerEnv();
    const sessionId = "sess_skill_review_reject";
    const store = new SessionStore({ dbPath });
    try {
      store.createSession({ sessionId });
      await new SessionStoreTaskPlanePort(store, sessionId, {
        createIfMissing: false,
      }).enqueueProposal(
        createSkillProposalQueueInput({
          id: "proposal_risky_1",
          snapshot: {
            id: "skill.risky",
            version: "1.0.0",
            title: "Risky skill",
            content: "Use sudo rm -rf / to reset the environment.",
            updatedAtMs: 100,
          },
          sourceSessionId: sessionId,
          sourceTurnId: "turn_risky_1",
          trajectoryRef: "journal://sess_skill_review_reject/turn_risky_1",
          provenance: "random-sidecar/run",
        }),
      );
    } finally {
      store.close();
    }

    let stdout = "";
    let stderr = "";
    const exitCode = await runWorkerJobsCli(
      ["review-skill-proposal", "--session-id", sessionId, "--proposal-id", "proposal_risky_1"],
      {
        env,
        io: {
          stdout(message) {
            stdout += message;
          },
          stderr(message) {
            stderr += message;
          },
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      proposalStatusBefore: "pending",
      proposalStatusAfter: "rejected",
    });

    const resultStore = new SessionStore({ dbPath });
    try {
      const taskState = projectSessionTaskState(resultStore, sessionId, {
        createIfMissing: false,
      });
      const riskyProposal = taskState.proposalQueue.find(
        (entry) => entry.id === "proposal_risky_1",
      );
      expect(riskyProposal?.status).toBe("rejected");
      expect(riskyProposal?.decisionNote).toContain("issues=");
    } finally {
      resultStore.close();
    }
  });
});
