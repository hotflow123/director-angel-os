import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { SchemaVersionMismatchError, SessionArchivedError, SessionStore } from "../src/index.js";

const scratchDirs: string[] = [];
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const tsxLoaderPath = join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");
const sessionSourcePath = join(packageRoot, "src", "index.ts");

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), "hotflow-sessions-"));
  scratchDirs.push(dir);
  return new SessionStore({
    dbPath: join(dir, "sessions.sqlite"),
  });
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

async function runConcurrentOpen(dbPath: string) {
  const scriptDir = mkdtempSync(join(tmpdir(), "hotflow-sessions-open-"));
  scratchDirs.push(scriptDir);

  const scriptPath = join(scriptDir, "open-store.ts");
  writeFileSync(
    scriptPath,
    [
      `import { SessionStore } from ${JSON.stringify(sessionSourcePath)};`,
      "async function main() {",
      "  const dbPath = process.argv[2];",
      "  const store = new SessionStore({ dbPath });",
      "  await new Promise((resolve) => setTimeout(resolve, 250));",
      "  store.close();",
      "}",
      "main();",
    ].join("\n"),
  );

  const runChild = (label: string) =>
    new Promise<{ label: string; code: number | null; stderr: string }>((resolveChild) => {
      const child = spawn(process.execPath, ["--import", tsxLoaderPath, scriptPath, dbPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        resolveChild({ label, code, stderr });
      });
    });

  return Promise.all([runChild("first"), runChild("second")]);
}

describe("SessionStore", () => {
  it("recovers journal-only state", () => {
    const store = createStore();
    const session = store.createSession();
    store.appendJournal(session.sessionId, {
      eventType: "todo.added",
      payload: { items: ["draft"] },
    });

    const recovered = store.recover<{ items: string[] }>(session.sessionId, {
      initialState: { items: [] },
      reducer(state, event) {
        if (event.eventType === "todo.added") {
          return { items: [...state.items, ...(event.payload.items as string[])] };
        }
        return state;
      },
    });

    expect(recovered.state.items).toEqual(["draft"]);
    expect(recovered.lastAppliedSeq).toBe(1);
    store.close();
  });

  it("replays journal after latest checkpoint", () => {
    const store = createStore();
    const session = store.createSession();
    store.appendJournal(session.sessionId, {
      eventType: "todo.added",
      payload: { items: ["draft"] },
    });
    store.createCheckpoint(session.sessionId, {
      state: { items: ["draft"] },
    });
    store.appendJournal(session.sessionId, {
      eventType: "todo.added",
      payload: { items: ["review"] },
    });

    const recovered = store.recover<{ items: string[] }>(session.sessionId, {
      reducer(state, event) {
        if (event.eventType === "todo.added") {
          return { items: [...state.items, ...(event.payload.items as string[])] };
        }
        return state;
      },
    });

    expect(recovered.checkpoint?.uptoSeq).toBe(1);
    expect(recovered.state.items).toEqual(["draft", "review"]);
    expect(recovered.lastAppliedSeq).toBe(2);
    store.close();
  });

  it("blocks writes after archive", () => {
    const store = createStore();
    const session = store.createSession();
    store.archiveSession(session.sessionId, { reason: "done" });

    expect(() =>
      store.appendJournal(session.sessionId, {
        eventType: "todo.added",
        payload: { items: ["blocked"] },
      }),
    ).toThrow(SessionArchivedError);
    store.close();
  });

  it("archives a durable transcript before hard deleting a session", () => {
    const store = createStore();
    const session = store.createSession({ metadata: { title: "closed chat" } });
    store.appendJournal(session.sessionId, {
      eventType: "assistant.output",
      turnId: "turn_delete_1",
      payload: { text: "这段内容删除后不能再被检索。" },
      createdAtMs: 1_000,
    });
    const artifact = store.appendToolResultArtifact(session.sessionId, {
      turnId: "turn_delete_1",
      stepIndex: 0,
      toolUseId: "toolu_delete_1",
      toolName: "web_extract",
      status: "success",
      content: "artifact body that should be cleaned up",
    });

    const result = store.deleteSession(session.sessionId, {
      reason: "user closed session",
    });

    expect(result).toMatchObject({
      deleted: true,
      sessionId: session.sessionId,
      archivedSession: {
        status: "archived",
        archiveReason: "user closed session",
      },
      transcript: {
        entryCount: 2,
        latestTurnId: "turn_delete_1",
      },
    });
    expect(store.getSession(session.sessionId)).toBeNull();
    expect(store.search({ query: "删除后不能再被检索", status: "all" }).hits).toStrictEqual([]);
    expect(existsSync(artifact.artifact.absolutePath)).toBe(false);
    expect(() => store.recover(session.sessionId)).toThrow("Cannot recover missing session");
    store.close();
  });

  it("advances session updatedAtMs on journal and checkpoint writes", () => {
    const store = createStore();
    const session = store.createSession();

    store.appendJournal(session.sessionId, {
      eventType: "todo.added",
      payload: { items: ["draft"] },
      createdAtMs: session.updatedAtMs + 10,
    });
    const afterJournal = store.getSession(session.sessionId);

    store.createCheckpoint(session.sessionId, {
      state: { items: ["draft"] },
      createdAtMs: session.updatedAtMs + 20,
    });
    const afterCheckpoint = store.getSession(session.sessionId);

    expect(afterJournal?.updatedAtMs).toBe(session.updatedAtMs + 10);
    expect(afterCheckpoint?.updatedAtMs).toBe(session.updatedAtMs + 20);
    store.close();
  });

  it("rejects schema mismatches during recovery", () => {
    const store = createStore();
    const session = store.createSession({
      schemaVersion: "sessions/v1",
    });

    expect(() =>
      store.recover(session.sessionId, {
        expectedSchemaVersion: "sessions/v2",
      }),
    ).toThrow(SchemaVersionMismatchError);
    store.close();
  });

  it("persists step journal envelopes and step checkpoint metadata", () => {
    const store = createStore();
    const session = store.createSession();

    const stepEntry = store.appendStepJournal(session.sessionId, {
      turnId: "turn_step_1",
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "draft" },
    });
    const stepCheckpoint = store.createStepCheckpoint(session.sessionId, {
      turnId: "turn_step_1",
      stepIndex: 0,
      eventType: "step.model_output",
      state: { text: "draft" },
      uptoSeq: stepEntry.seq,
    });

    expect(stepEntry.turnId).toBe("turn_step_1");
    expect(stepEntry.payload).toEqual({
      stepIndex: 0,
      data: { text: "draft" },
    });
    expect(stepCheckpoint.metadata).toEqual({
      scope: "step",
      turnId: "turn_step_1",
      stepIndex: 0,
      eventType: "step.model_output",
    });
    store.close();
  });

  it("persists and lists stream/audit event envelopes", () => {
    const store = createStore();
    const session = store.createSession();

    store.appendStreamEvent(session.sessionId, {
      turnId: "turn_stream_1",
      event: {
        id: "stream_1",
        kind: "stream.started",
        schemaVersion: "0.1.0",
        occurredAtMs: 100,
        payload: {
          turnId: "turn_stream_1",
        },
      },
      createdAtMs: 100,
    });
    store.appendAuditEvent(session.sessionId, {
      turnId: "turn_stream_1",
      event: {
        id: "audit_1",
        kind: "runtime.degraded",
        schemaVersion: "0.1.0",
        occurredAtMs: 101,
        payload: {
          stage: "tool",
          reason: "fallback",
        },
      },
      createdAtMs: 101,
    });

    const streamEvents = store.listStreamEvents(session.sessionId, { turnId: "turn_stream_1" });
    const auditEvents = store.listAuditEvents(session.sessionId, { turnId: "turn_stream_1" });

    expect(streamEvents).toHaveLength(1);
    expect(streamEvents[0]?.event.kind).toBe("stream.started");
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.entry.eventType).toBe("audit.event");
    store.close();
  });

  it("recovers interrupted turns at step granularity", () => {
    const store = createStore();
    const session = store.createSession();
    const turnId = "turn_recover_1";

    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "step0 output" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.tools_planned",
      payload: { tools: ["tasks.todo_write"] },
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.tool_result",
      payload: { tool: "tasks.todo_write", ok: true },
    });
    store.createStepCheckpoint(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.tool_result",
      state: { items: ["draft"] },
    });

    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 1,
      eventType: "step.model_output",
      payload: { text: "step1 output" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 1,
      eventType: "step.tools_planned",
      payload: { tools: ["filesystem.read_text"] },
    });

    const recovered = store.recoverStep(session.sessionId, { turnId });

    expect(recovered.stepCheckpoint?.metadata).toEqual({
      scope: "step",
      turnId,
      stepIndex: 0,
      eventType: "step.tool_result",
    });
    expect(recovered.replay.modelOutput).toHaveLength(1);
    expect(recovered.replay.plannedTools).toHaveLength(1);
    expect(recovered.replay.toolResults).toHaveLength(0);
    expect(recovered.replay.finalOutput).toHaveLength(0);
    expect(recovered.replayWindow).toEqual({
      fromSeqExclusive: recovered.checkpoint?.uptoSeq ?? 0,
      toSeqInclusive: recovered.lastAppliedSeq,
    });
    expect(recovered.stepJournal.map((entry) => entry.stepIndex)).toEqual([1, 1]);
    expect(recovered.lastStepEvent?.eventType).toBe("step.tools_planned");
    expect(recovered.resumeAction).toBe("continue-current-step");
    expect(recovered.nextStepIndex).toBe(1);
    store.close();
  });

  it("advances to the next step when the latest step event is a tool result", () => {
    const store = createStore();
    const session = store.createSession();
    const turnId = "turn_recover_2";

    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "output" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.tool_result",
      payload: { tool: "noop", ok: true },
    });

    const recovered = store.recoverStep(session.sessionId, { turnId });
    expect(recovered.lastStepEvent?.eventType).toBe("step.tool_result");
    expect(recovered.resumeAction).toBe("start-next-step");
    expect(recovered.nextStepIndex).toBe(1);
    store.close();
  });

  it("marks turn-complete when final output is the latest step event", () => {
    const store = createStore();
    const session = store.createSession();
    const turnId = "turn_recover_3";

    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "output" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.final_output",
      payload: { text: "done" },
    });

    const recovered = store.recoverStep(session.sessionId, { turnId });
    expect(recovered.lastStepEvent?.eventType).toBe("step.final_output");
    expect(recovered.resumeAction).toBe("turn-complete");
    expect(recovered.nextStepIndex).toBe(1);
    store.close();
  });

  it("recovers from step checkpoint progress when no new step journal exists", () => {
    const store = createStore();
    const session = store.createSession();
    const turnId = "turn_recover_4";

    const entry = store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 2,
      eventType: "step.tools_planned",
      payload: { tools: ["filesystem.read_text"] },
    });
    store.createStepCheckpoint(session.sessionId, {
      turnId,
      stepIndex: 2,
      eventType: "step.tools_planned",
      state: { marker: "planned" },
      uptoSeq: entry.seq,
    });

    const recovered = store.recoverStep(session.sessionId, { turnId });
    expect(recovered.stepJournal).toHaveLength(0);
    expect(recovered.stepCheckpoint?.metadata.eventType).toBe("step.tools_planned");
    expect(recovered.resumeAction).toBe("continue-current-step");
    expect(recovered.nextStepIndex).toBe(2);
    store.close();
  });

  it("returns no-progress when no step checkpoint or step journal exists for turn", () => {
    const store = createStore();
    const session = store.createSession();
    const turnId = "turn_missing_progress";

    store.appendJournal(session.sessionId, {
      eventType: "user.input",
      payload: { text: "hello" },
    });

    const recovered = store.recoverStep(session.sessionId, { turnId });
    expect(recovered.stepCheckpoint).toBeNull();
    expect(recovered.stepJournal).toHaveLength(0);
    expect(recovered.lastStepEvent).toBeNull();
    expect(recovered.resumeAction).toBe("no-progress");
    expect(recovered.nextStepIndex).toBe(0);
    store.close();
  });

  it("resolves latest turn id from sessions API instead of caller-side journal scanning", () => {
    const store = createStore();
    const session = store.createSession();

    store.appendJournal(session.sessionId, {
      eventType: "user.input",
      payload: { text: "pre-turn" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId: "turn_alpha",
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "alpha" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId: "turn_beta",
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "beta" },
    });

    expect(store.getLatestTurnId(session.sessionId)).toBe("turn_beta");
    store.close();
  });

  it("provides recoverLatestStep helper for stable status observation", () => {
    const store = createStore();
    const session = store.createSession();

    const noTurn = store.recoverLatestStep(session.sessionId);
    expect(noTurn.latestTurnId).toBeNull();
    expect(noTurn.stepRecovery).toBeNull();

    const turnId = "turn_observe_1";
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "draft" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.tools_planned",
      payload: { tools: ["tasks.todo_write"] },
    });

    const observed = store.recoverLatestStep(session.sessionId);
    expect(observed.latestTurnId).toBe(turnId);
    expect(observed.stepRecovery?.turnId).toBe(turnId);
    expect(observed.stepRecovery?.resumeAction).toBe("continue-current-step");

    const explicit = store.recoverLatestStep(session.sessionId, {
      turnId,
    });
    expect(explicit.latestTurnId).toBe(turnId);
    expect(explicit.stepRecovery?.lastStepEvent?.eventType).toBe("step.tools_planned");
    store.close();
  });

  it("keeps completed-turn step visibility after a general checkpoint closes the turn", () => {
    const store = createStore();
    const session = store.createSession();
    const turnId = "turn_completed_observe";

    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "draft" },
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.final_output",
      payload: { text: "done" },
    });
    store.appendJournal(session.sessionId, {
      eventType: "assistant.output",
      payload: { text: "done" },
    });
    store.createCheckpoint(session.sessionId, {
      state: { text: "done" },
    });

    const observed = store.recoverLatestStep(session.sessionId);

    expect(observed.latestTurnId).toBe(turnId);
    expect(observed.stepRecovery?.resumeAction).toBe("turn-complete");
    expect(observed.stepRecovery?.lastStepEvent?.eventType).toBe("step.final_output");
    expect(observed.stepRecovery?.stepJournal).toHaveLength(2);
    expect(observed.stepRecovery?.replay.modelOutput).toHaveLength(1);
    expect(observed.stepRecovery?.replay.finalOutput).toHaveLength(1);
    expect(observed.stepRecovery?.replayWindow.toSeqInclusive).toBe(
      observed.stepRecovery?.stepJournal.at(-1)?.entry.seq,
    );
    store.close();
  });

  it("rewinds to the previous checkpoint without deleting history", () => {
    const store = createStore();
    const session = store.createSession({
      metadata: {
        runtime: {
          latestTurn: {
            turnId: "turn_future",
            runtimeStatus: "healthy",
            turnBranch: "normal",
          },
        },
      },
    });

    store.appendJournal(session.sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_1", content: "draft", status: "todo" }],
      },
    });
    const previousCheckpoint = store.createCheckpoint(session.sessionId, {
      state: {
        tasks: {
          items: [{ id: "todo_1", content: "draft", status: "todo" }],
        },
      },
    });
    store.appendJournal(session.sessionId, {
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "todo_2", content: "review", status: "doing" }],
      },
      turnId: "turn_future",
    });
    const currentCheckpoint = store.createCheckpoint(session.sessionId, {
      state: {
        tasks: {
          items: [{ id: "todo_2", content: "review", status: "doing" }],
        },
      },
    });

    const rewind = store.rewind(session.sessionId);

    expect(rewind.selection).toBe("previous");
    expect(rewind.targetCheckpointId).toBe(previousCheckpoint.checkpointId);
    expect(rewind.currentCheckpointId).toBeGreaterThan(currentCheckpoint.checkpointId);
    expect(rewind.latestTurnId).toBeNull();
    expect(rewind.clearedLatestTurn).toBe(true);
    expect(store.getLatestTurnId(session.sessionId)).toBeNull();

    const recovered = store.recover<{ tasks: { items: Array<{ id: string }> } }>(session.sessionId);
    expect(recovered.state.tasks.items.map((item) => item.id)).toEqual(["todo_1"]);
    expect(recovered.checkpoint?.checkpointId).toBe(rewind.currentCheckpointId);
    expect(store.listCheckpoints(session.sessionId, { limit: 1 })[0]?.checkpointId).toBe(
      rewind.currentCheckpointId,
    );
    const updatedSession = store.getSession(session.sessionId);
    expect(
      updatedSession?.metadata.runtime &&
        typeof updatedSession.metadata.runtime === "object" &&
        !Array.isArray(updatedSession.metadata.runtime)
        ? "latestTurn" in (updatedSession.metadata.runtime as object)
        : false,
    ).toBe(false);

    const rewindJournal = store.journal
      .list(session.sessionId)
      .find((entry) => entry.eventType === "control.rewind");
    expect(rewindJournal?.payload).toMatchObject({
      selection: "previous",
      targetCheckpointId: previousCheckpoint.checkpointId,
    });
    store.close();
  });

  it("anchors latest-step recovery to a rewound step checkpoint", () => {
    const store = createStore();
    const session = store.createSession();
    const turnAlpha = "turn_alpha_rewind";
    const turnBeta = "turn_beta_rewind";

    store.appendStepJournal(session.sessionId, {
      turnId: turnAlpha,
      stepIndex: 0,
      eventType: "step.tool_result",
      payload: { tool: "tasks.todo_write", ok: true },
    });
    const alphaCheckpoint = store.createStepCheckpoint(session.sessionId, {
      turnId: turnAlpha,
      stepIndex: 0,
      eventType: "step.tool_result",
      state: { items: ["alpha"] },
    });

    store.appendStepJournal(session.sessionId, {
      turnId: turnBeta,
      stepIndex: 1,
      eventType: "step.model_output",
      payload: { text: "beta" },
    });
    store.createStepCheckpoint(session.sessionId, {
      turnId: turnBeta,
      stepIndex: 1,
      eventType: "step.model_output",
      state: { items: ["beta"] },
    });

    const rewind = store.rewind(session.sessionId, {
      checkpointId: alphaCheckpoint.checkpointId,
    });
    const observed = store.recoverLatestStep(session.sessionId);

    expect(rewind.selection).toBe("explicit");
    expect(rewind.latestTurnId).toBe(turnAlpha);
    expect(observed.latestTurnId).toBe(turnAlpha);
    expect(observed.stepRecovery?.resumeAction).toBe("start-next-step");
    expect(observed.stepRecovery?.nextStepIndex).toBe(1);
    expect(observed.stepRecovery?.stepCheckpoint?.metadata.turnId).toBe(turnAlpha);
    expect(observed.stepRecovery?.stepJournal).toHaveLength(0);
    store.close();
  });

  it("records and lists runtime evidence across audit and stream channels", () => {
    const store = createStore();
    const session = store.createSession();
    const turnId = "turn_evidence_1";

    store.recordRuntimeEvidence(session.sessionId, {
      turnId,
      kind: "runtime.degraded",
      payload: {
        stage: "tool",
        reason: "fallback",
      },
      occurredAtMs: 1_000,
      channel: "both",
      eventId: "evidence_degraded",
    });
    store.recordRuntimeEvidence(session.sessionId, {
      turnId,
      kind: "provider.transient_failure",
      payload: {
        providerId: "openai-compatible",
        code: "HTTP_429",
      },
      occurredAtMs: 1_001,
      channel: "audit",
      eventId: "evidence_transient",
    });

    const evidence = store.listRuntimeEvidence(session.sessionId, { turnId });
    expect(evidence).toHaveLength(3);
    expect(evidence.map((item) => item.kind)).toEqual([
      "runtime.degraded",
      "runtime.degraded",
      "provider.transient_failure",
    ]);
    expect(evidence.map((item) => item.channel)).toEqual(["audit", "stream", "audit"]);
    store.close();
  });

  it("builds a durable transcript across journal, step, stream, and audit entries", () => {
    const store = createStore();
    const session = store.createSession({
      metadata: {
        title: "handoff run",
        surface: "desktop",
      },
    });
    const turnId = "turn_transcript_1";

    store.appendJournal(session.sessionId, {
      eventType: "user.input",
      turnId,
      payload: { text: "请总结这个网页" },
      createdAtMs: 1_000,
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.model_output",
      payload: { text: "需要读取网页正文" },
      createdAtMs: 1_001,
    });
    store.appendStreamEvent(session.sessionId, {
      turnId,
      event: {
        id: "stream_started_1",
        kind: "stream.started",
        schemaVersion: "0.1.0",
        occurredAtMs: 1_002,
        payload: { source: "desktop" },
      },
      createdAtMs: 1_002,
    });
    store.appendAuditEvent(session.sessionId, {
      turnId,
      event: {
        id: "audit_media_1",
        kind: "media.unauthorized",
        schemaVersion: "0.1.0",
        occurredAtMs: 1_003,
        payload: { mediaCount: 2 },
      },
      createdAtMs: 1_003,
    });
    store.appendStepJournal(session.sessionId, {
      turnId,
      stepIndex: 0,
      eventType: "step.final_output",
      payload: { text: "文本已读，媒体未理解。" },
      createdAtMs: 1_004,
    });

    const transcript = store.buildDurableTranscript(session.sessionId);

    expect(transcript).toMatchObject({
      schemaVersion: "sessions.durable-transcript/v1",
      sessionId: session.sessionId,
      session: {
        metadata: {
          title: "handoff run",
          surface: "desktop",
        },
      },
      latestTurnId: turnId,
      fromSeq: 1,
      toSeq: 5,
      entryCount: 5,
      resumeAnchor: {
        sessionId: session.sessionId,
        latestTurnId: turnId,
        lastSeq: 5,
        lastEventType: "step.final_output",
      },
    });
    expect(transcript.entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(transcript.entries.map((entry) => entry.kind)).toEqual([
      "journal",
      "step",
      "stream",
      "audit",
      "step",
    ]);
    expect(transcript.entries[1]).toMatchObject({
      channel: "step",
      stepIndex: 0,
      payload: { text: "需要读取网页正文" },
    });
    expect(transcript.entries[2]).toMatchObject({
      channel: "stream",
      eventId: "stream_started_1",
      envelopeKind: "stream.started",
    });
    expect(transcript.entries[3]).toMatchObject({
      channel: "audit",
      eventId: "audit_media_1",
      envelopeKind: "media.unauthorized",
      payload: { mediaCount: 2 },
    });
    expect(transcript.entries[4]?.payload).toEqual({ text: "文本已读，媒体未理解。" });
    store.close();
  });

  it("filters durable transcript entries by seq, turn, and event type", () => {
    const store = createStore();
    const session = store.createSession();

    store.appendJournal(session.sessionId, {
      eventType: "user.input",
      turnId: "turn_alpha",
      payload: { text: "alpha" },
    });
    store.appendJournal(session.sessionId, {
      eventType: "assistant.output",
      turnId: "turn_alpha",
      payload: { text: "alpha done" },
    });
    store.appendJournal(session.sessionId, {
      eventType: "assistant.output",
      turnId: "turn_beta",
      payload: { text: "beta done" },
    });

    const transcript = store.buildDurableTranscript(session.sessionId, {
      afterSeq: 1,
      turnId: "turn_alpha",
      eventTypes: ["assistant.output"],
      limit: 1,
    });

    expect(transcript.fromSeq).toBe(2);
    expect(transcript.toSeq).toBe(2);
    expect(transcript.entryCount).toBe(1);
    expect(transcript.entries.map((entry) => entry.turnId)).toEqual(["turn_alpha"]);
    expect(transcript.entries.map((entry) => entry.eventType)).toEqual(["assistant.output"]);
    expect(transcript.resumeAnchor.lastSeq).toBe(2);
    store.close();
  });

  it("persists large tool results as artifacts and keeps transcript payload projected", () => {
    const store = createStore();
    const session = store.createSession();
    const fullContent = Array.from({ length: 24 }, (_, index) => `line-${index}`).join("\n");

    const artifact = store.appendToolResultArtifact(session.sessionId, {
      turnId: "turn_tool_artifact",
      stepIndex: 0,
      toolUseId: "toolu_read_1",
      toolName: "web_extract",
      status: "success",
      content: fullContent,
      mimeType: "text/plain",
      previewMaxChars: 32,
      replacement: '<persisted-output toolUseId="toolu_read_1">see artifact</persisted-output>',
      createdAtMs: 3_000,
    });

    expect(artifact.entry.eventType).toBe("step.tool_result");
    expect(artifact.entry.payload.data).toMatchObject({
      toolUseId: "toolu_read_1",
      toolName: "web_extract",
      status: "success",
      contentProjection: {
        originalSizeBytes: Buffer.byteLength(fullContent, "utf8"),
        preview: fullContent.slice(0, 32),
        hasMore: true,
        isJson: false,
        replacement: '<persisted-output toolUseId="toolu_read_1">see artifact</persisted-output>',
      },
    });
    expect(JSON.stringify(artifact.entry.payload)).not.toContain("line-23");
    expect(existsSync(artifact.artifact.absolutePath)).toBe(true);
    expect(readFileSync(artifact.artifact.absolutePath, "utf8")).toBe(fullContent);

    const restored = store.readToolResultArtifact(session.sessionId, artifact.artifact.artifactId);
    expect(restored.content).toBe(fullContent);
    expect(restored.artifact.sha256).toBe(artifact.artifact.sha256);

    const transcript = store.buildDurableTranscript(session.sessionId);
    expect(transcript.entries[0]).toMatchObject({
      kind: "step",
      eventType: "step.tool_result",
      payload: {
        toolUseId: "toolu_read_1",
        toolName: "web_extract",
        contentProjection: {
          preview: fullContent.slice(0, 32),
          hasMore: true,
        },
      },
    });
    expect(JSON.stringify(transcript.entries[0]?.payload)).not.toContain("line-23");
    store.close();
  });

  it("creates and reads a durable handoff summary anchored to transcript progress", () => {
    const store = createStore();
    const session = store.createSession({
      metadata: {
        title: "handoff summary run",
      },
    });
    const first = store.appendJournal(session.sessionId, {
      eventType: "user.input",
      turnId: "turn_handoff",
      payload: { text: "继续完成剩余任务" },
      createdAtMs: 4_000,
    });
    const second = store.appendStepJournal(session.sessionId, {
      turnId: "turn_handoff",
      stepIndex: 0,
      eventType: "step.tool_result",
      payload: { tool: "web_extract", ok: true },
      createdAtMs: 4_001,
    });

    const handoff = store.createHandoffSummary(session.sessionId, {
      lastSummarizedSeq: second.seq,
      sourceFromSeq: first.seq,
      sourceToSeq: second.seq,
      latestTurnId: "turn_handoff",
      currentState: "已读取网页正文，媒体未授权理解。",
      task: "继续完成 evidence 入库前置检查。",
      filesAndFunctions: ["packages/sessions/src/store.ts#createHandoffSummary"],
      workflow: ["读取 transcript", "生成 operator 可读交接"],
      errorsAndCorrections: ["无"],
      keyResults: ["文本证据可回放"],
      worklog: ["完成 handoff summary 快照"],
      nextActions: ["接入上层 runtime 使用"],
      createdAtMs: 4_002,
    });

    expect(handoff.entry.eventType).toBe("session.handoff_summary");
    expect(handoff.summary).toMatchObject({
      schemaVersion: "sessions.handoff-summary/v1",
      sessionId: session.sessionId,
      lastSummarizedSeq: second.seq,
      sourceFromSeq: first.seq,
      sourceToSeq: second.seq,
      latestTurnId: "turn_handoff",
      currentState: "已读取网页正文，媒体未授权理解。",
      nextActions: ["接入上层 runtime 使用"],
    });

    const latest = store.getLatestHandoffSummary(session.sessionId);
    expect(latest?.summary).toEqual(handoff.summary);
    expect(latest?.entry.seq).toBe(handoff.entry.seq);

    const transcript = store.buildDurableTranscript(session.sessionId, {
      eventTypes: ["session.handoff_summary"],
    });
    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0]?.payload).toMatchObject({
      currentState: "已读取网页正文，媒体未授权理解。",
      lastSummarizedSeq: second.seq,
    });
    store.close();
  });

  it("filters runtime evidence by selected kinds", () => {
    const store = createStore();
    const session = store.createSession();

    store.recordRuntimeEvidence(session.sessionId, {
      kind: "stream.error",
      payload: { code: "INVALID_STREAM_EVENT" },
      channel: "stream",
      occurredAtMs: 2_000,
    });
    store.recordRuntimeEvidence(session.sessionId, {
      kind: "runtime.failed",
      payload: { stage: "model" },
      channel: "audit",
      occurredAtMs: 2_001,
    });

    const onlyFailed = store.listRuntimeEvidence(session.sessionId, {
      kinds: ["runtime.failed"],
    });
    expect(onlyFailed).toHaveLength(1);
    expect(onlyFailed[0]?.kind).toBe("runtime.failed");
    expect(onlyFailed[0]?.channel).toBe("audit");
    store.close();
  });

  it("searches journal entries across sessions and returns matched context", () => {
    const store = createStore();
    const matching = store.createSession({
      metadata: {
        title: "storyboard run",
        surface: "weixin",
      },
    });
    const unrelated = store.createSession({
      metadata: {
        title: "utility chat",
        surface: "desktop",
      },
    });

    store.appendJournal(matching.sessionId, {
      eventType: "runtime.final",
      turnId: "turn_storyboard_style",
      payload: {
        text: "小猫旅行短片采用水墨风格，保持三镜头结构。",
      },
      createdAtMs: 1_000,
    });
    store.appendJournal(unrelated.sessionId, {
      eventType: "runtime.final",
      turnId: "turn_other",
      payload: {
        text: "普通桌面问候，不应该被风格检索排到前面。",
      },
      createdAtMs: 1_001,
    });

    const result = store.search({
      query: "水墨风格",
      limit: 3,
    });

    expect(result.hits[0]?.session.sessionId).toBe(matching.sessionId);
    expect(result.hits[0]?.entry?.eventType).toBe("runtime.final");
    expect(result.hits[0]?.source).toBe("journal-payload");
    expect(result.hits[0]?.matchedText).toContain("水墨风格");
    store.close();
  });

  it("finds prior run context from natural follow-up wording", () => {
    const store = createStore();
    const session = store.createSession({
      metadata: {
        title: "published production draft",
      },
    });

    store.appendJournal(session.sessionId, {
      eventType: "assistant.output",
      turnId: "turn_previous_style",
      payload: {
        summary: "上一次制作采用水墨风格，主角是一只小猫。",
        artifactIds: ["script_1"],
      },
      createdAtMs: 2_000,
    });

    const result = store.search({
      query: "按上次那个风格继续",
      limit: 5,
    });

    expect(result.hits[0]?.session.sessionId).toBe(session.sessionId);
    expect(result.hits[0]?.entry?.turnId).toBe("turn_previous_style");
    expect(result.hits[0]?.matchedText).toContain("水墨风格");
    store.close();
  });

  it("waits for concurrent openers instead of failing during sqlite pragma setup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hotflow-sessions-race-"));
    scratchDirs.push(dir);
    const dbPath = join(dir, "sessions.sqlite");

    const results = await runConcurrentOpen(dbPath);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.code, `${result.label} failed with stderr:\n${result.stderr}`).toBe(0);
      expect(result.stderr).not.toContain("database is locked");
    }
  });
});
