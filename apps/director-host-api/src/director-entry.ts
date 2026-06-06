import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { resolveChannelSessionTarget, validateChannelRoutingHint } from "@hotflow/channels-core";
import {
  DIRECTOR_ENTRY_API_VERSION,
  DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION,
  type DirectorEntryIntakeRequest,
  type DirectorEntryIntakeResponse,
  type DirectorEntryMessageRequest,
  type DirectorEntryNextAction,
  type DirectorEntrySession,
  type DirectorEntryState,
  type DirectorEntryTurn,
  isDirectorEntrySession,
} from "@hotflow/director-entry-contracts";
import {
  DIRECTOR_HOST_API_VERSION,
  type DirectorBlueprintRequest,
  type DirectorBlueprintResponse,
  type DirectorHostSnapshotEnvelope,
  type DirectorIntakePayload,
  type DirectorIntakeResponse,
} from "@hotflow/director-host-contracts";

import type { DirectorHostRuntime } from "./bootstrap.js";

const DIRECTOR_ENTRY_INDEX_SCHEMA_VERSION = "director.entry.index.v1" as const;
const ENTRY_MAX_PROMPT_CHARS = 4096;

interface DirectorEntryIndexEntry {
  readonly entrySessionId: string;
  readonly sessionKey: string;
  readonly updatedAt: string;
}

interface DirectorEntryIndexDocument {
  readonly schemaVersion: typeof DIRECTOR_ENTRY_INDEX_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly entries: readonly DirectorEntryIndexEntry[];
}

interface DirectorEntryStoredIntakeContext {
  readonly snapshot: DirectorHostSnapshotEnvelope;
  readonly intake: DirectorIntakePayload;
  readonly response: DirectorIntakeResponse;
}

interface DirectorEntryStoredBlueprintContext {
  readonly recordedAt: string;
  readonly blueprint: DirectorBlueprintResponse;
}

interface EntryRunProjection {
  readonly runId: string;
  readonly status: "created" | "running" | "paused" | "completed" | "failed" | "aborted";
  readonly updatedAt: string;
}

interface EntryReportProjection {
  readonly reportId: string;
  readonly runId: string;
  readonly recordedAt: string;
  readonly flags: readonly string[];
  readonly run: EntryRunProjection;
  readonly operatorSurface?: {
    readonly operatorSummary?: string;
    readonly nextAction?: string;
    readonly retryable?: boolean;
  };
}

interface StoredDirectorEntrySession extends DirectorEntrySession {
  readonly latestIntakeContext?: DirectorEntryStoredIntakeContext;
  readonly latestBlueprintContext?: DirectorEntryStoredBlueprintContext;
}

export interface FileSystemDirectorEntryStoreOptions {
  readonly rootPath: string;
  readonly now?: () => string;
  readonly createId?: (prefix: string) => string;
}

export class FileSystemDirectorEntryStore {
  private readonly now;
  private readonly createId;

  public constructor(private readonly options: FileSystemDirectorEntryStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId =
      options.createId ??
      ((prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  public async recordIntake(
    request: DirectorEntryIntakeRequest,
    intake: DirectorIntakeResponse,
  ): Promise<DirectorEntryIntakeResponse> {
    return this.withStoreLock(() => this.recordIntakeUnlocked(request, intake));
  }

  private async recordIntakeUnlocked(
    request: DirectorEntryIntakeRequest,
    intake: DirectorIntakeResponse,
  ): Promise<DirectorEntryIntakeResponse> {
    const existing = await this.loadStoredSessionBySessionKey(request.entry.sessionKey);
    const entrySessionId = existing?.entrySessionId ?? this.createId("entry-session");
    const entryTurnId = this.createId("entry-turn");
    const state = mapAlignmentStateToEntryState(intake.alignmentState);
    const nextAction = mapEntryStateToNextAction(state);
    const turn: DirectorEntryTurn = {
      entryTurnId,
      messageId: request.entry.messageId,
      receivedAt: request.entry.receivedAt,
      state,
      nextAction,
      summary: intake.clarification.summary,
      lineage: {
        sessionKey: request.entry.sessionKey,
        entrySessionId,
        entryTurnId,
        intakeId: intake.intakeId,
        ...(intake.alignmentLock === null ? {} : { alignmentLockId: intake.alignmentLock.lockId }),
      },
      ...(intake.clarification.questions.length === 0
        ? {}
        : {
            clarificationPrompts: intake.clarification.questions.map((question) => question.prompt),
          }),
    };

    const session: StoredDirectorEntrySession = {
      schemaVersion: DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION,
      entrySessionId,
      sessionKey: request.entry.sessionKey,
      hostId: request.entry.hostId,
      channel: request.entry.channel,
      routeKind: request.entry.routeKind,
      createdAt: existing?.createdAt ?? request.entry.receivedAt,
      updatedAt: this.now(),
      state,
      nextAction,
      latestTurnId: turn.entryTurnId,
      latestLineage: turn.lineage,
      turns: [...(existing?.turns ?? []), turn],
      latestIntakeContext: {
        snapshot: request.snapshot,
        intake: request.intake,
        response: intake,
      },
    };

    await this.writeSession(session);
    await this.writeIndexEntry({
      entrySessionId,
      sessionKey: session.sessionKey,
      updatedAt: session.updatedAt,
    });

    return {
      apiVersion: DIRECTOR_ENTRY_API_VERSION,
      directorApiVersion: DIRECTOR_HOST_API_VERSION,
      session: toPublicSession(session),
      turn,
      intake,
    };
  }

  public async loadSession(entrySessionId: string): Promise<DirectorEntrySession | null> {
    const session = await this.loadStoredSession(entrySessionId);
    return session === null ? null : toPublicSession(session);
  }

  public async loadSessionBySessionKey(sessionKey: string): Promise<DirectorEntrySession | null> {
    const session = await this.loadStoredSessionBySessionKey(sessionKey);
    return session === null ? null : toPublicSession(session);
  }

  public async loadBlueprintRequest(entrySessionId: string): Promise<DirectorBlueprintRequest> {
    const session = await this.loadStoredSessionOrThrow(entrySessionId);
    if (session.latestIntakeContext === undefined) {
      throw new Error(`Entry session ${entrySessionId} does not have an intake context.`);
    }
    const alignmentLock = session.latestIntakeContext.response.alignmentLock;
    if (
      session.latestIntakeContext.response.alignmentState !== "locked" ||
      alignmentLock === null
    ) {
      throw new Error(`Entry session ${entrySessionId} is not ready for blueprint creation.`);
    }
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: session.latestIntakeContext.snapshot,
      intake: session.latestIntakeContext.intake,
      alignmentLock,
    };
  }

  public async recordBlueprint(
    entrySessionId: string,
    blueprint: DirectorBlueprintResponse,
  ): Promise<DirectorEntrySession> {
    return this.withStoreLock(() => this.recordBlueprintUnlocked(entrySessionId, blueprint));
  }

  private async recordBlueprintUnlocked(
    entrySessionId: string,
    blueprint: DirectorBlueprintResponse,
  ): Promise<DirectorEntrySession> {
    const session = await this.loadStoredSessionOrThrow(entrySessionId);
    const {
      latestRun: _discardLatestRun,
      latestReport: _discardLatestReport,
      ...sessionBase
    } = session;
    void _discardLatestRun;
    void _discardLatestReport;
    const recordedAt = this.now();
    const state: DirectorEntryState = "ready_for_run";
    const nextAction: DirectorEntryNextAction = "run";
    const latestLineage = {
      sessionKey: session.latestLineage.sessionKey,
      entrySessionId: session.latestLineage.entrySessionId,
      entryTurnId: session.latestLineage.entryTurnId,
      ...(session.latestLineage.intakeId === undefined
        ? {}
        : { intakeId: session.latestLineage.intakeId }),
      ...(session.latestLineage.alignmentLockId === undefined
        ? {}
        : { alignmentLockId: session.latestLineage.alignmentLockId }),
      blueprintId: blueprint.blueprintId,
    };
    const nextSession: StoredDirectorEntrySession = {
      ...sessionBase,
      updatedAt: recordedAt,
      state,
      nextAction,
      latestLineage,
      latestBlueprint: {
        blueprintId: blueprint.blueprintId,
        handoffId: blueprint.handoff.handoffId,
        recordedAt,
      },
      latestBlueprintContext: {
        recordedAt,
        blueprint,
      },
      turns: updateLatestTurn(session, {
        state,
        nextAction,
        summary: `Blueprint ${blueprint.blueprintId} is ready for run creation.`,
        lineage: latestLineage,
      }),
    };

    await this.persistSession(nextSession);
    return toPublicSession(nextSession);
  }

  public async loadRunSource(entrySessionId: string): Promise<DirectorBlueprintResponse> {
    const session = await this.loadStoredSessionOrThrow(entrySessionId);
    if (session.latestBlueprintContext === undefined) {
      throw new Error(`Entry session ${entrySessionId} does not have a blueprint yet.`);
    }
    return session.latestBlueprintContext.blueprint;
  }

  public async recordRun(
    entrySessionId: string,
    run: EntryRunProjection,
  ): Promise<DirectorEntrySession> {
    return this.syncRunProjection(entrySessionId, run);
  }

  public async syncRunProjection(
    entrySessionId: string,
    run: EntryRunProjection,
    report?: EntryReportProjection,
  ): Promise<DirectorEntrySession> {
    return this.withStoreLock(() => this.syncRunProjectionUnlocked(entrySessionId, run, report));
  }

  private async syncRunProjectionUnlocked(
    entrySessionId: string,
    run: EntryRunProjection,
    report?: EntryReportProjection,
  ): Promise<DirectorEntrySession> {
    const session = await this.loadStoredSessionOrThrow(entrySessionId);
    const { latestReport: _discardLatestReport, ...sessionBase } = session;
    void _discardLatestReport;
    const progress = mapRunStatusToEntryProgress(run.status);
    const latestLineage = {
      sessionKey: session.latestLineage.sessionKey,
      entrySessionId: session.latestLineage.entrySessionId,
      entryTurnId: session.latestLineage.entryTurnId,
      ...(session.latestLineage.intakeId === undefined
        ? {}
        : { intakeId: session.latestLineage.intakeId }),
      ...(session.latestLineage.alignmentLockId === undefined
        ? {}
        : { alignmentLockId: session.latestLineage.alignmentLockId }),
      ...(session.latestLineage.blueprintId === undefined
        ? {}
        : { blueprintId: session.latestLineage.blueprintId }),
      runId: run.runId,
      ...(report === undefined ? {} : { reportId: report.reportId }),
    };
    const nextSession: StoredDirectorEntrySession = {
      ...sessionBase,
      updatedAt: report?.recordedAt ?? run.updatedAt ?? this.now(),
      state: progress.state,
      nextAction: progress.nextAction,
      latestLineage,
      latestRun: {
        runId: run.runId,
        status: run.status,
        updatedAt: run.updatedAt,
      },
      ...(report === undefined
        ? {}
        : {
            latestReport: {
              reportId: report.reportId,
              runId: report.runId,
              recordedAt: report.recordedAt,
              flags: [...report.flags],
              ...(report.operatorSurface?.operatorSummary === undefined
                ? {}
                : { operatorSummary: report.operatorSurface.operatorSummary }),
              ...(report.operatorSurface?.nextAction === undefined
                ? {}
                : { nextAction: report.operatorSurface.nextAction }),
              ...(report.operatorSurface?.retryable === undefined
                ? {}
                : { retryable: report.operatorSurface.retryable }),
            },
          }),
      turns: updateLatestTurn(session, {
        state: progress.state,
        nextAction: progress.nextAction,
        summary:
          report?.operatorSurface?.operatorSummary ??
          `Execution run ${run.runId} is currently ${run.status}.`,
        lineage: latestLineage,
      }),
    };

    await this.persistSession(nextSession);
    return toPublicSession(nextSession);
  }

  private async loadStoredSession(
    entrySessionId: string,
  ): Promise<StoredDirectorEntrySession | null> {
    try {
      const raw = await readFile(this.sessionPath(entrySessionId), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isDirectorEntrySession(parsed)) {
        throw new Error(`Invalid Director entry session document "${entrySessionId}".`);
      }
      return parsed as StoredDirectorEntrySession;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async loadStoredSessionOrThrow(
    entrySessionId: string,
  ): Promise<StoredDirectorEntrySession> {
    const session = await this.loadStoredSession(entrySessionId);
    if (session === null) {
      throw new Error(`Unknown entry session: ${entrySessionId}`);
    }
    return session;
  }

  private async loadStoredSessionBySessionKey(
    sessionKey: string,
  ): Promise<StoredDirectorEntrySession | null> {
    const index = await this.loadIndex({ allowMissing: true });
    const match = index.entries.find((entry) => entry.sessionKey === sessionKey);
    if (match === undefined) {
      return null;
    }
    return this.loadStoredSession(match.entrySessionId);
  }

  private async loadIndex(options: {
    readonly allowMissing: boolean;
  }): Promise<DirectorEntryIndexDocument> {
    try {
      const raw = await readFile(this.indexPath(), "utf8");
      const parsed = JSON.parse(raw) as DirectorEntryIndexDocument;
      if (
        parsed.schemaVersion !== DIRECTOR_ENTRY_INDEX_SCHEMA_VERSION ||
        !Array.isArray(parsed.entries)
      ) {
        throw new Error("Director entry index schema is invalid.");
      }
      return parsed;
    } catch (error) {
      if (options.allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          schemaVersion: DIRECTOR_ENTRY_INDEX_SCHEMA_VERSION,
          updatedAt: this.now(),
          entries: [],
        };
      }
      throw error;
    }
  }

  private async writeSession(session: StoredDirectorEntrySession): Promise<void> {
    await this.writeJson(this.sessionPath(session.entrySessionId), session);
  }

  private async persistSession(session: StoredDirectorEntrySession): Promise<void> {
    await this.writeSession(session);
    await this.writeIndexEntry({
      entrySessionId: session.entrySessionId,
      sessionKey: session.sessionKey,
      updatedAt: session.updatedAt,
    });
  }

  private async writeIndexEntry(entry: DirectorEntryIndexEntry): Promise<void> {
    const index = await this.loadIndex({ allowMissing: true });
    const entries = new Map(
      index.entries.map((candidate) => [candidate.entrySessionId, candidate]),
    );
    entries.set(entry.entrySessionId, entry);

    await this.writeJson(this.indexPath(), {
      schemaVersion: DIRECTOR_ENTRY_INDEX_SCHEMA_VERSION,
      updatedAt: this.now(),
      entries: [...entries.values()].sort((left, right) =>
        left.updatedAt === right.updatedAt
          ? left.entrySessionId.localeCompare(right.entrySessionId)
          : left.updatedAt.localeCompare(right.updatedAt),
      ),
    });
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  }

  private async withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = join(this.options.rootPath, ".lock");
    await mkdir(dirname(lockPath), { recursive: true });
    const startedAt = Date.now();
    const timeoutMs = 5000;
    const staleMs = 30000;

    while (true) {
      try {
        await mkdir(lockPath);
        break;
      } catch (error) {
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(
            `Timed out waiting for Director entry store lock at ${lockPath}: ${String(error)}`,
          );
        }

        try {
          const stats = await stat(lockPath);
          if (Date.now() - stats.mtimeMs > staleMs) {
            await rm(lockPath, { recursive: true, force: true });
            continue;
          }
        } catch {
          // The lock disappeared between attempts; retry immediately.
        }

        await delay(25);
      }
    }

    try {
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private indexPath(): string {
    return join(this.options.rootPath, "index.json");
  }

  private sessionPath(entrySessionId: string): string {
    return join(this.options.rootPath, "sessions", `${entrySessionId}.json`);
  }
}

export function buildEntryIntakeRequestFromMessage(
  runtime: DirectorHostRuntime,
  request: DirectorEntryMessageRequest,
): DirectorEntryIntakeRequest {
  validateChannelRoutingHint(request.message.routingHint);
  const target = resolveChannelSessionTarget(request.message.routingHint);
  const receivedAt = new Date(request.message.receivedAtMs).toISOString();
  const text = request.message.text?.trim();
  if (text === undefined || text.length === 0) {
    throw new Error("Director entry message must include non-empty text.");
  }
  const runtimeCapabilities = runtime.adapterRegistry.deriveCoreRuntimeCapabilities({
    runtimeId: runtime.runtimeCapabilitySnapshot.runtimeId,
    runtimeStatus: runtime.runtimeCapabilitySnapshot.status,
    switchState: runtime.switchState,
    maxPromptChars: ENTRY_MAX_PROMPT_CHARS,
  });
  const scopeId = buildEntryScopeId(request.hostId, request.message.channel, target.sessionKey);
  const snapshot: DirectorHostSnapshotEnvelope = {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.snapshot.v1",
    snapshotId: `snapshot-${request.message.messageId}`,
    createdAt: receivedAt,
    host: {
      hostId: request.hostId,
      triggerSource: "api",
      sessionId: target.sessionKey,
    },
    project: {
      projectId: `project-${scopeId}`,
      title: `${request.hostId}:${request.message.channel}`,
      outline: text,
    },
    group: {
      groupId: `group-${scopeId}`,
      generationType: "new",
      sceneCount: 1,
      anchorIds: [],
    },
    runtime: {
      runtimeId: runtimeCapabilities.runtimeId,
      status: runtimeCapabilities.status,
      availableBindings: [...runtimeCapabilities.availableBindings],
      maxPromptChars: runtimeCapabilities.maxPromptChars,
      supportsVideo: runtimeCapabilities.supportsVideo,
      ...(runtimeCapabilities.deterministicMode === undefined
        ? {}
        : { deterministicMode: runtimeCapabilities.deterministicMode }),
    },
    intent: {
      bindingPolicy: "auto",
    },
  };
  const intake: DirectorIntakePayload = {
    intakeId: `intake-${request.message.messageId}`,
    submittedAt: receivedAt,
    objective: text,
    desiredOutcome: text,
    metadata: {
      hostId: request.hostId,
      channel: request.message.channel,
      routeKind: request.message.routingHint.routeKind,
      messageId: request.message.messageId,
      sessionKey: target.sessionKey,
    },
  };

  return {
    apiVersion: DIRECTOR_ENTRY_API_VERSION,
    entry: {
      hostId: request.hostId,
      channel: request.message.channel,
      routeKind: request.message.routingHint.routeKind,
      sessionKey: target.sessionKey,
      messageId: request.message.messageId,
      receivedAt,
    },
    snapshot,
    intake,
  };
}

function mapAlignmentStateToEntryState(
  state: DirectorIntakeResponse["alignmentState"],
): DirectorEntryState {
  if (state === "locked") {
    return "ready_for_blueprint";
  }
  if (state === "blocked") {
    return "blocked";
  }
  return "clarification_required";
}

function mapEntryStateToNextAction(state: DirectorEntryState): DirectorEntryNextAction {
  if (state === "ready_for_blueprint") {
    return "blueprint";
  }
  if (state === "ready_for_run") {
    return "run";
  }
  if (state === "run_in_progress") {
    return "wait";
  }
  if (state === "run_failed" || state === "run_completed") {
    return "review_report";
  }
  if (state === "blocked") {
    return "none";
  }
  return "clarify";
}

function mapRunStatusToEntryProgress(runStatus: EntryRunProjection["status"]): {
  readonly state: DirectorEntryState;
  readonly nextAction: DirectorEntryNextAction;
} {
  if (runStatus === "created") {
    return {
      state: "ready_for_run",
      nextAction: "run",
    };
  }
  if (runStatus === "running" || runStatus === "paused") {
    return {
      state: "run_in_progress",
      nextAction: "wait",
    };
  }
  if (runStatus === "completed") {
    return {
      state: "run_completed",
      nextAction: "review_report",
    };
  }
  return {
    state: "run_failed",
    nextAction: "review_report",
  };
}

function updateLatestTurn(
  session: StoredDirectorEntrySession,
  update: {
    readonly state: DirectorEntryState;
    readonly nextAction: DirectorEntryNextAction;
    readonly summary: string;
    readonly lineage: DirectorEntrySession["latestLineage"];
  },
): DirectorEntryTurn[] {
  return session.turns.map((turn) =>
    turn.entryTurnId === session.latestTurnId
      ? {
          ...turn,
          state: update.state,
          nextAction: update.nextAction,
          summary: update.summary,
          lineage: update.lineage,
        }
      : turn,
  );
}

function toPublicSession(session: StoredDirectorEntrySession): DirectorEntrySession {
  return {
    schemaVersion: session.schemaVersion,
    entrySessionId: session.entrySessionId,
    sessionKey: session.sessionKey,
    hostId: session.hostId,
    channel: session.channel,
    routeKind: session.routeKind,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    state: session.state,
    nextAction: session.nextAction,
    latestTurnId: session.latestTurnId,
    latestLineage: session.latestLineage,
    ...(session.latestBlueprint === undefined ? {} : { latestBlueprint: session.latestBlueprint }),
    ...(session.latestRun === undefined ? {} : { latestRun: session.latestRun }),
    ...(session.latestReport === undefined ? {} : { latestReport: session.latestReport }),
    turns: [...session.turns],
  };
}

function buildEntryScopeId(hostId: string, channel: string, sessionKey: string): string {
  return `${hostId}-${channel}-${sessionKey}`
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/gu, "-")
    .replace(/-+/gu, "-");
}
