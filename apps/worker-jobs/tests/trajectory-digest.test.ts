import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stringifyCanonicalJson } from "@hotflow/contracts";
import { SessionStore } from "@hotflow/sessions";
import { readCommittedSessionTaskSnapshot } from "@hotflow/tasks-core";
import { afterEach, describe, expect, test } from "vitest";

import { buildTrajectoryDigestFromCommittedSnapshot } from "../src/learning/trajectory-digest.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("trajectory digest builder", () => {
  test("produces byte-identical digests for equivalent committed turns", () => {
    const firstStore = createSessionStore("hotflow-wave25-digest-a-");
    const secondStore = createSessionStore("hotflow-wave25-digest-b-");
    const sessionId = "sess_wave25_digest";
    const turnId = "turn_wave25_digest";

    seedTurn(firstStore, sessionId, turnId, 100, {
      userText: "Summarize the repo",
      toolName: "filesystem.read_text",
      assistantText: "Here is the summary.",
    });
    seedTurn(secondStore, sessionId, turnId, 100, {
      userText: "Summarize the repo",
      toolName: "filesystem.read_text",
      assistantText: "Here is the summary.",
    });

    const firstDigest = buildTrajectoryDigestFromCommittedSnapshot(
      readCommittedSessionTaskSnapshot(firstStore, sessionId),
      { fallbackTurnId: turnId },
    );
    const secondDigest = buildTrajectoryDigestFromCommittedSnapshot(
      readCommittedSessionTaskSnapshot(secondStore, sessionId),
      { fallbackTurnId: turnId },
    );

    expect(stringifyCanonicalJson(firstDigest)).toBe(stringifyCanonicalJson(secondDigest));
  });

  test("scopes digest evidence and counts to the requested committed turn", () => {
    const store = createSessionStore("hotflow-wave25-boundary-");
    const sessionId = "sess_wave25_boundary";

    seedTurn(store, sessionId, "turn_noise", 10, {
      userText: "List the shell tasks",
      toolName: "shell.exec",
      assistantText: "Noise turn output.",
    });
    seedTurn(store, sessionId, "turn_target", 100, {
      userText: "Summarize the repo",
      toolName: "filesystem.read_text",
      assistantText: "Target turn output.",
    });

    const digest = buildTrajectoryDigestFromCommittedSnapshot(
      readCommittedSessionTaskSnapshot(store, sessionId),
      { fallbackTurnId: "turn_target" },
    );

    expect(digest.sourceTurnId).toBe("turn_target");
    expect(digest.latestUserText).toBe("Summarize the repo");
    expect(digest.toolNames).toEqual(["filesystem.read_text"]);
    expect(digest.counts).toEqual({
      journalEventsInTurn: 4,
      toolCallCount: 1,
      toolResultCount: 1,
      assistantOutputCount: 1,
    });
    expect(digest.evidence).toHaveLength(4);
    expect(digest.evidence.every((entry) => entry.turnId === "turn_target")).toBe(true);
    expect(digest.evidence.map((entry) => entry.eventType)).toEqual([
      "user.input",
      "tool.call_planned",
      "tool.result",
      "assistant.output",
    ]);
    expect(digest.toolNames).not.toContain("shell.exec");
  });

  test("builds a deterministic fallback digest when the committed snapshot has no turn journal", () => {
    const store = createSessionStore("hotflow-wave25-empty-");
    const sessionId = "sess_wave25_empty";
    store.createSession({ sessionId });

    const digest = buildTrajectoryDigestFromCommittedSnapshot(
      readCommittedSessionTaskSnapshot(store, sessionId),
      { fallbackTurnId: "turn_empty" },
    );

    expect(digest.sourceTurnId).toBe("turn_empty");
    expect(digest.createdAtMs).toBe(1);
    expect(digest.latestCommittedSeq).toBe(0);
    expect(digest.latestUserText).toBeNull();
    expect(digest.toolNames).toEqual([]);
    expect(digest.evidence).toEqual([]);
    expect(digest.counts).toEqual({
      journalEventsInTurn: 0,
      toolCallCount: 0,
      toolResultCount: 0,
      assistantOutputCount: 0,
    });
  });
});

function createSessionStore(prefix: string): SessionStore {
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(workspaceRoot);

  const dataDir = join(workspaceRoot, ".hotflow");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });

  return new SessionStore({
    dbPath: join(dataDir, "sessions", "worker.sqlite"),
  });
}

function seedTurn(
  store: SessionStore,
  sessionId: string,
  turnId: string,
  createdAtMsStart: number,
  input: {
    readonly userText: string;
    readonly toolName: string;
    readonly assistantText: string;
  },
): void {
  if (!store.getSession(sessionId)) {
    store.createSession({ sessionId });
  }

  store.appendJournal(sessionId, {
    eventType: "user.input",
    turnId,
    payload: { text: input.userText },
    createdAtMs: createdAtMsStart,
  });
  store.appendJournal(sessionId, {
    eventType: "tool.call_planned",
    turnId,
    payload: {
      toolCallId: `call_${turnId}`,
      toolName: input.toolName,
      args: { path: "README.md" },
    },
    createdAtMs: createdAtMsStart + 10,
  });
  store.appendJournal(sessionId, {
    eventType: "tool.result",
    turnId,
    payload: {
      toolName: input.toolName,
      ok: true,
      output: { text: `${input.toolName} output` },
      error: null,
    },
    createdAtMs: createdAtMsStart + 20,
  });
  store.appendJournal(sessionId, {
    eventType: "assistant.output",
    turnId,
    payload: { text: input.assistantText },
    createdAtMs: createdAtMsStart + 30,
  });
  store.createCheckpoint(sessionId, {
    state: {
      lastTurnId: turnId,
      lastAssistantOutput: input.assistantText,
    },
    createdAtMs: createdAtMsStart + 40,
  });
}
