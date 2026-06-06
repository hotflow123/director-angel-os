import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import type { SessionStore } from "@hotflow/sessions";
import {
  type DelegationObservedWriteSetSource,
  type DelegationRecord,
  SessionStoreTaskPlanePort,
  type TaskBackedSubagentRun,
  type TaskBackedSubagentSchedulerDispatchPlan,
  type TaskBackedSubagentSchedulerHeartbeat,
  type TaskBackedSubagentScheduling,
  projectSubagentRunsFromTaskState,
  projectSubagentSchedulerDispatchPlanFromTaskState,
  projectSubagentSchedulerHeartbeatFromTaskState,
  readCommittedSessionTaskSnapshot,
  readSessionDelegationMailbox,
  readSessionVerificationMailbox,
} from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface RunDelegationInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly workerId: string;
  readonly verifierId?: string;
  readonly delegationId?: string;
  readonly verificationId?: string;
  readonly requirement?: string;
  readonly failureReason?: string;
  readonly resultSummary?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: DelegationObservedWriteSetSource;
  readonly observedWriteSetArtifact?: string;
  readonly observedWriteSetFromGitDiff?: boolean;
  readonly maxClaims?: number;
  readonly sessionStore?: SessionStore;
}

export type RunDelegationLoopStoppedReason = "max-claims" | "scheduler-blocked" | "mailbox-empty";

export interface RunDelegationReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly workerId: string;
  readonly delegationId: string;
  readonly specialization?: "explore" | "plan" | "verify" | "general";
  readonly targetAgent?: string;
  readonly initialDelegationMailboxSize: number;
  readonly remainingDelegationMailboxSize: number;
  readonly finalDelegationStatus: "completed" | "failed";
  readonly verificationId: string | null;
  readonly verificationStatus: "pending" | null;
  readonly verificationSource: "none" | "delegation" | "input" | "mixed";
  readonly pendingVerificationMailboxSize: number;
  readonly snapshotDelegationCount: number;
  readonly snapshotVerificationCount: number;
  readonly resultDelegationCount: number;
  readonly resultVerificationCount: number;
  readonly journalDelta: number;
  readonly latestTurnId: string | null;
  readonly subagentRun: TaskBackedSubagentRun | null;
  readonly scheduler?: TaskBackedSubagentScheduling;
  readonly skippedSchedulerBlockedDelegationIds?: readonly string[];
  readonly claimedDelegationIds?: readonly string[];
  readonly finalDelegationStatuses?: readonly ("completed" | "failed")[];
  readonly subagentRuns?: readonly TaskBackedSubagentRun[];
  readonly schedulerLoop?: {
    readonly maxClaims: number;
    readonly claimedCount: number;
    readonly stoppedReason: RunDelegationLoopStoppedReason;
  };
  readonly schedulerHeartbeat: TaskBackedSubagentSchedulerHeartbeat;
  readonly schedulerDispatchPlan: TaskBackedSubagentSchedulerDispatchPlan;
}

const MAX_RUN_DELEGATION_CLAIMS = 10;
const MAX_OBSERVED_WRITE_SET_ARTIFACT_BYTES = 1_000_000;
const MAX_GIT_INDEX_BYTES = 10_000_000;

export async function runDelegationJob(input: RunDelegationInput): Promise<RunDelegationReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);

  try {
    const before = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, input.sessionId, {
      createIfMissing: false,
    });

    const initialMailbox = readDelegationMailbox(sessionStore, input);
    const maxClaims = input.delegationId === undefined ? normalizeMaxClaims(input.maxClaims) : 1;
    const claimedDelegations: DelegationRecord[] = [];
    const finalDelegationStatuses: ("completed" | "failed")[] = [];
    const selectedSchedulings: TaskBackedSubagentScheduling[] = [];
    const skippedSchedulerBlockedDelegationIds = new Set<string>();
    let stoppedReason: RunDelegationLoopStoppedReason = "mailbox-empty";
    let verificationId: string | null = null;
    let verificationStatus: "pending" | null = null;
    let verificationSource: RunDelegationReport["verificationSource"] = "none";
    let pendingVerifierId: string | undefined;
    const observedWriteSetEvidence = resolveObservedWriteSetEvidence(input);

    for (let claimIndex = 0; claimIndex < maxClaims; claimIndex += 1) {
      const snapshot =
        claimIndex === 0 ? before : readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
      const mailbox =
        claimIndex === 0 ? initialMailbox : readDelegationMailbox(sessionStore, input);
      const mailboxScheduling = createDelegationSchedulingMap(snapshot.taskState);
      const schedulerBlockedDelegationIds = mailbox
        .filter((record) => mailboxScheduling.get(record.id)?.readyToStart === false)
        .map((record) => record.id);
      for (const delegationId of schedulerBlockedDelegationIds) {
        skippedSchedulerBlockedDelegationIds.add(delegationId);
      }
      const schedulerReadyMailbox = mailbox.filter(
        (record) => mailboxScheduling.get(record.id)?.readyToStart !== false,
      );
      const delegation =
        input.delegationId === undefined
          ? selectNextReadyDelegation(
              schedulerReadyMailbox,
              schedulerBlockedDelegationIds,
              input.workerId,
              claimedDelegations.length,
            )
          : selectMailboxRecord(
              mailbox,
              input.delegationId,
              `No queued delegation found for worker: ${input.workerId}`,
              "delegation",
            );

      if (delegation === null) {
        stoppedReason =
          schedulerBlockedDelegationIds.length > 0 ? "scheduler-blocked" : "mailbox-empty";
        break;
      }

      const selectedScheduling = mailboxScheduling.get(delegation.id);
      await taskPlane.claimDelegation({
        id: delegation.id,
        workerId: input.workerId,
        respectScheduler: true,
      });

      const finalDelegationStatus = input.failureReason === undefined ? "completed" : "failed";
      await taskPlane.setDelegationStatus({
        id: delegation.id,
        status: finalDelegationStatus,
        resultSummary:
          input.resultSummary ??
          `Delegation ${delegation.id} ${finalDelegationStatus} by worker ${input.workerId}.`,
        ...(observedWriteSetEvidence.writeSet === undefined
          ? {}
          : { observedWriteSet: observedWriteSetEvidence.writeSet }),
        ...(observedWriteSetEvidence.source === undefined
          ? {}
          : { observedWriteSetSource: observedWriteSetEvidence.source }),
        ...(input.failureReason === undefined ? {} : { error: input.failureReason }),
      });

      claimedDelegations.push(delegation);
      finalDelegationStatuses.push(finalDelegationStatus);
      if (selectedScheduling !== undefined) {
        selectedSchedulings.push(selectedScheduling);
      }

      const verificationResolution = resolveVerificationRequest(input, delegation);
      if (claimIndex === 0) {
        verificationSource = verificationResolution.source;
        pendingVerifierId = verificationResolution.verifierId;
      }

      if (finalDelegationStatus === "completed" && verificationResolution.verifierId) {
        const resolvedVerificationId = resolveDelegationVerificationId({
          input,
          delegation,
          claimIndex,
          ...(verificationResolution.verificationId === undefined
            ? {}
            : { verificationId: verificationResolution.verificationId }),
        });
        if (verificationId === null) {
          verificationId = resolvedVerificationId;
          verificationStatus = "pending";
        }
        await taskPlane.upsertVerification({
          id: resolvedVerificationId,
          verifierId: verificationResolution.verifierId,
          requirement:
            verificationResolution.requirement ??
            `Verify delegation ${delegation.id} completed for worker ${input.workerId}.`,
          status: "pending",
          ...(delegation.taskId === undefined ? {} : { taskId: delegation.taskId }),
        });
      }

      if (claimedDelegations.length >= maxClaims) {
        stoppedReason = "max-claims";
        break;
      }
    }

    const delegation = claimedDelegations[0];
    if (delegation === undefined) {
      const initialScheduling = createDelegationSchedulingMap(before.taskState);
      const schedulerBlockedDelegationIds = initialMailbox
        .filter((record) => initialScheduling.get(record.id)?.readyToStart === false)
        .map((record) => record.id);
      throw new Error(
        schedulerBlockedDelegationIds.length > 0
          ? `No scheduler-ready queued delegation found for worker: ${input.workerId}; blocked=${schedulerBlockedDelegationIds.join(",")}`
          : `No queued delegation found for worker: ${input.workerId}`,
      );
    }

    const after = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const projectedSubagentRuns = projectSubagentRunsFromTaskState(after.taskState);
    const schedulerHeartbeat = projectSubagentSchedulerHeartbeatFromTaskState(after.taskState);
    const schedulerDispatchPlan = projectSubagentSchedulerDispatchPlanFromTaskState(
      after.taskState,
    );
    const subagentRuns = claimedDelegations
      .map((claimedDelegation) =>
        projectedSubagentRuns.find((run) => run.subagentId === claimedDelegation.id),
      )
      .filter((run): run is TaskBackedSubagentRun => run !== undefined);
    const subagentRun = subagentRuns[0] ?? null;
    const remainingDelegationMailboxSize = readDelegationMailbox(sessionStore, input).length;
    const pendingVerificationMailboxSize =
      pendingVerifierId === undefined
        ? 0
        : readSessionVerificationMailbox(
            sessionStore,
            input.sessionId,
            {
              verifierId: pendingVerifierId,
              statuses: ["pending"],
            },
            { createIfMissing: false },
          ).length;

    return {
      status: "ok",
      sessionId: input.sessionId,
      workerId: input.workerId,
      delegationId: delegation.id,
      ...(delegation.specialization === undefined
        ? {}
        : { specialization: delegation.specialization }),
      ...(delegation.targetAgent === undefined ? {} : { targetAgent: delegation.targetAgent }),
      initialDelegationMailboxSize: initialMailbox.length,
      remainingDelegationMailboxSize,
      finalDelegationStatus: finalDelegationStatuses[0] ?? "completed",
      verificationId,
      verificationStatus,
      verificationSource,
      pendingVerificationMailboxSize,
      snapshotDelegationCount: before.taskState.delegation.length,
      snapshotVerificationCount: before.taskState.verification.length,
      resultDelegationCount: after.taskState.delegation.length,
      resultVerificationCount: after.taskState.verification.length,
      journalDelta: after.journal.length - before.journal.length,
      latestTurnId: after.latestTurnId,
      subagentRun,
      ...(selectedSchedulings[0] === undefined ? {} : { scheduler: selectedSchedulings[0] }),
      ...(skippedSchedulerBlockedDelegationIds.size === 0
        ? {}
        : { skippedSchedulerBlockedDelegationIds: [...skippedSchedulerBlockedDelegationIds] }),
      claimedDelegationIds: claimedDelegations.map((entry) => entry.id),
      finalDelegationStatuses,
      subagentRuns,
      schedulerLoop: {
        maxClaims,
        claimedCount: claimedDelegations.length,
        stoppedReason,
      },
      schedulerHeartbeat,
      schedulerDispatchPlan,
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}

function normalizeObservedWriteSet(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function resolveObservedWriteSetEvidence(
  input: Pick<
    RunDelegationInput,
    | "env"
    | "observedWriteSet"
    | "observedWriteSetArtifact"
    | "observedWriteSetFromGitDiff"
    | "observedWriteSetSource"
  >,
): {
  readonly writeSet?: readonly string[];
  readonly source?: DelegationObservedWriteSetSource;
} {
  const explicitWriteSet = normalizeObservedWriteSet(input.observedWriteSet ?? []);
  const artifactEvidence =
    input.observedWriteSetArtifact === undefined
      ? undefined
      : loadObservedWriteSetArtifact({
          artifactPath: input.observedWriteSetArtifact,
          ...(input.observedWriteSetSource === undefined
            ? {}
            : { preferredSource: input.observedWriteSetSource }),
          readableRoots: getObservedWriteSetArtifactReadableRoots(input),
        });
  const gitDiffEvidence =
    input.observedWriteSetFromGitDiff === true ? loadObservedWriteSetFromGitDiff(input) : undefined;
  const writeSet = normalizeObservedWriteSet([
    ...explicitWriteSet,
    ...(artifactEvidence?.writeSet ?? []),
    ...(gitDiffEvidence?.writeSet ?? []),
  ]);
  if (writeSet.length === 0) {
    return {};
  }
  const source =
    input.observedWriteSetSource ?? artifactEvidence?.source ?? gitDiffEvidence?.source;
  return {
    writeSet,
    ...(source === undefined ? {} : { source }),
  };
}

function loadObservedWriteSetArtifact(input: {
  readonly artifactPath: string;
  readonly preferredSource?: DelegationObservedWriteSetSource;
  readonly readableRoots: readonly string[];
}): {
  readonly writeSet: readonly string[];
  readonly source: DelegationObservedWriteSetSource;
} {
  const artifactPath = input.artifactPath;
  const resolvedPath = resolve(artifactPath);
  if (!isPathInsideAnyRoot(resolvedPath, input.readableRoots)) {
    throw new Error(
      `Observed write-set artifact must be inside an allowed worker artifact root: ${artifactPath}`,
    );
  }
  const stat = statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`Observed write-set artifact must be a file: ${artifactPath}`);
  }
  if (stat.size > MAX_OBSERVED_WRITE_SET_ARTIFACT_BYTES) {
    throw new Error(
      `Observed write-set artifact is too large: ${stat.size} bytes > ${MAX_OBSERVED_WRITE_SET_ARTIFACT_BYTES} bytes.`,
    );
  }

  const source = input.preferredSource ?? inferObservedWriteSetSource(resolvedPath);
  const content = readFileSync(resolvedPath, "utf8");
  const writeSet = extractObservedWriteSetFromArtifact(content);
  if (writeSet.length === 0) {
    throw new Error(`No observed write-set paths found in artifact: ${artifactPath}`);
  }
  return { writeSet, source };
}

function loadObservedWriteSetFromGitDiff(input: Pick<RunDelegationInput, "env">): {
  readonly writeSet: readonly string[];
  readonly source: DelegationObservedWriteSetSource;
} {
  const workspaceRoot = resolveWorkspaceRoot(input);
  const indexPath = resolve(workspaceRoot, ".git", "index");
  if (!isPathInsideAnyRoot(indexPath, [workspaceRoot])) {
    throw new Error("Git diff observed write-set index must stay inside HOTFLOW_WORKSPACE_ROOT.");
  }
  const indexStat = statSync(indexPath);
  if (!indexStat.isFile()) {
    throw new Error("Git diff observed write-set requires a workspace .git/index file.");
  }
  if (indexStat.size > MAX_GIT_INDEX_BYTES) {
    throw new Error(
      `Git index is too large for observed write-set scan: ${indexStat.size} bytes > ${MAX_GIT_INDEX_BYTES} bytes.`,
    );
  }
  const writeSet = readGitIndexEntries(readFileSync(indexPath))
    .filter((entry) => entry.path.length > 0)
    .filter((entry) => gitIndexEntryChanged(workspaceRoot, entry))
    .map((entry) => entry.path);
  if (writeSet.length === 0) {
    throw new Error("No observed write-set paths found in workspace git diff.");
  }
  return {
    writeSet: normalizeObservedWriteSet(writeSet),
    source: "diff",
  };
}

function resolveWorkspaceRoot(input: Pick<RunDelegationInput, "env">): string {
  const workspaceRoot = input.env?.HOTFLOW_WORKSPACE_ROOT ?? process.env.HOTFLOW_WORKSPACE_ROOT;
  if (workspaceRoot === undefined || workspaceRoot.trim().length === 0) {
    throw new Error("Git diff observed write-set requires HOTFLOW_WORKSPACE_ROOT.");
  }
  return resolve(workspaceRoot);
}

function readGitIndexEntries(buffer: Buffer): readonly {
  readonly path: string;
  readonly mtimeSeconds: number;
  readonly mtimeNanoseconds: number;
  readonly fileSize: number;
}[] {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "DIRC") {
    throw new Error("Git diff observed write-set requires a valid DIRC index.");
  }
  const version = buffer.readUInt32BE(4);
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported git index version for observed write-set scan: ${version}`);
  }
  const count = buffer.readUInt32BE(8);
  const entries: {
    readonly path: string;
    readonly mtimeSeconds: number;
    readonly mtimeNanoseconds: number;
    readonly fileSize: number;
  }[] = [];
  let offset = 12;
  for (let index = 0; index < count; index += 1) {
    if (offset + 62 > buffer.length) {
      throw new Error("Git index is truncated before an entry header.");
    }
    const mtimeSeconds = buffer.readUInt32BE(offset + 8);
    const mtimeNanoseconds = buffer.readUInt32BE(offset + 12);
    const fileSize = buffer.readUInt32BE(offset + 36);
    const flags = buffer.readUInt16BE(offset + 60);
    const declaredPathLength = flags & 0x0fff;
    const pathStart = offset + 62;
    let pathEnd = pathStart;
    if (declaredPathLength < 0x0fff) {
      pathEnd = pathStart + declaredPathLength;
    } else {
      while (pathEnd < buffer.length && buffer[pathEnd] !== 0) {
        pathEnd += 1;
      }
    }
    if (pathEnd >= buffer.length) {
      throw new Error("Git index is truncated before an entry path terminator.");
    }
    const path = normalizeObservedWritePath(buffer.toString("utf8", pathStart, pathEnd));
    if (path !== undefined) {
      entries.push({
        path,
        mtimeSeconds,
        mtimeNanoseconds,
        fileSize,
      });
    }
    const rawEntryLength = pathEnd + 1 - offset;
    offset += Math.ceil(rawEntryLength / 8) * 8;
  }
  return entries;
}

function gitIndexEntryChanged(
  workspaceRoot: string,
  entry: {
    readonly path: string;
    readonly mtimeSeconds: number;
    readonly mtimeNanoseconds: number;
    readonly fileSize: number;
  },
): boolean {
  const absolutePath = resolve(workspaceRoot, entry.path);
  if (!isPathInsideAnyRoot(absolutePath, [workspaceRoot])) {
    return false;
  }
  try {
    const fileStat = statSync(absolutePath);
    if (!fileStat.isFile()) {
      return true;
    }
    const mtimeMs = entry.mtimeSeconds * 1000 + Math.floor(entry.mtimeNanoseconds / 1_000_000);
    return fileStat.size !== entry.fileSize || Math.floor(fileStat.mtimeMs) !== mtimeMs;
  } catch {
    return true;
  }
}

function getObservedWriteSetArtifactReadableRoots(
  input: Pick<RunDelegationInput, "env">,
): readonly string[] {
  const env = {
    ...process.env,
    ...(input.env ?? {}),
  };
  return normalizeObservedArtifactRoots([
    env.HOTFLOW_WORKSPACE_ROOT,
    env.HOTFLOW_DATA_DIR,
    env.TMPDIR,
    env.TEMP,
    env.TMP,
  ]);
}

function normalizeObservedArtifactRoots(
  values: readonly (string | undefined)[],
): readonly string[] {
  return normalizeObservedWriteSet(values.filter(isDefined)).map((value) => resolve(value));
}

function isPathInsideAnyRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function inferObservedWriteSetSource(path: string): DelegationObservedWriteSetSource {
  const extension = extname(path).toLowerCase();
  if (extension === ".patch") {
    return "patch";
  }
  if (extension === ".diff") {
    return "diff";
  }
  return "artifact";
}

function extractObservedWriteSetFromArtifact(content: string): readonly string[] {
  const paths: string[] = [];

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    const diffPath = extractGitDiffPath(line);
    if (diffPath.length > 0) {
      paths.push(...diffPath);
      continue;
    }

    const unifiedPath = extractUnifiedDiffPath(line);
    if (unifiedPath !== undefined) {
      paths.push(unifiedPath);
      continue;
    }

    const renamePath = extractRenamePath(line);
    if (renamePath !== undefined) {
      paths.push(renamePath);
    }
  }

  return normalizeObservedWriteSet(paths.map(normalizeObservedWritePath).filter(isDefined));
}

function extractGitDiffPath(line: string): readonly string[] {
  if (!line.startsWith("diff --git ")) {
    return [];
  }
  const match = line.match(/^diff --git\s+a\/(.+)\s+b\/(.+)$/u);
  if (!match) {
    return [];
  }
  return [match[1], match[2]].filter(isDefined);
}

function extractUnifiedDiffPath(line: string): string | undefined {
  if (!line.startsWith("+++ ") && !line.startsWith("--- ")) {
    return undefined;
  }
  return line.slice(4);
}

function extractRenamePath(line: string): string | undefined {
  if (line.startsWith("rename from ")) {
    return line.slice("rename from ".length);
  }
  if (line.startsWith("rename to ")) {
    return line.slice("rename to ".length);
  }
  if (line.startsWith("copy from ")) {
    return line.slice("copy from ".length);
  }
  if (line.startsWith("copy to ")) {
    return line.slice("copy to ".length);
  }
  return undefined;
}

function normalizeObservedWritePath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const withoutTimestamp = value.split("\t")[0]?.trim() ?? "";
  const unquoted = stripSurroundingQuotes(withoutTimestamp);
  const withoutDiffPrefix =
    unquoted.startsWith("a/") || unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
  const normalized = withoutDiffPrefix.replace(/\\/gu, "/").replace(/^\.\/+/u, "");
  if (
    normalized.length === 0 ||
    normalized === "/dev/null" ||
    normalized === "dev/null" ||
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }
  return normalized;
}

function stripSurroundingQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function readDelegationMailbox(
  sessionStore: SessionStore,
  input: Pick<RunDelegationInput, "sessionId" | "workerId">,
): readonly DelegationRecord[] {
  return readSessionDelegationMailbox(
    sessionStore,
    input.sessionId,
    {
      workerId: input.workerId,
      statuses: ["queued"],
    },
    { createIfMissing: false },
  );
}

function normalizeMaxClaims(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_RUN_DELEGATION_CLAIMS) {
    throw new Error(`maxClaims must be an integer between 1 and ${MAX_RUN_DELEGATION_CLAIMS}.`);
  }
  return value;
}

function selectNextReadyDelegation(
  schedulerReadyMailbox: readonly DelegationRecord[],
  schedulerBlockedDelegationIds: readonly string[],
  workerId: string,
  claimedCount: number,
): DelegationRecord | null {
  if (schedulerReadyMailbox.length > 0) {
    return selectMailboxRecord(
      schedulerReadyMailbox,
      undefined,
      `No queued delegation found for worker: ${workerId}`,
      "delegation",
    );
  }
  if (claimedCount > 0) {
    return null;
  }
  throw new Error(
    schedulerBlockedDelegationIds.length > 0
      ? `No scheduler-ready queued delegation found for worker: ${workerId}; blocked=${schedulerBlockedDelegationIds.join(",")}`
      : `No queued delegation found for worker: ${workerId}`,
  );
}

function resolveDelegationVerificationId(input: {
  readonly input: RunDelegationInput;
  readonly delegation: DelegationRecord;
  readonly claimIndex: number;
  readonly verificationId?: string;
}): string {
  if (input.verificationId !== undefined) {
    return input.claimIndex === 0
      ? input.verificationId
      : `${input.verificationId}_${sanitizeToken(input.delegation.id)}`;
  }
  return `verification_${sanitizeToken(input.input.sessionId)}_${sanitizeToken(input.delegation.id)}`;
}

function createDelegationSchedulingMap(
  state: Parameters<typeof projectSubagentRunsFromTaskState>[0],
): ReadonlyMap<string, TaskBackedSubagentScheduling> {
  return new Map(
    projectSubagentRunsFromTaskState(state).flatMap((run) =>
      run.scheduling === undefined ? [] : [[run.subagentId, run.scheduling] as const],
    ),
  );
}

function resolveVerificationRequest(
  input: RunDelegationInput,
  delegation: DelegationRecord,
): {
  readonly verifierId?: string;
  readonly verificationId?: string;
  readonly requirement?: string;
  readonly source: "none" | "delegation" | "input" | "mixed";
} {
  const explicitInputProvided =
    input.verifierId !== undefined ||
    input.verificationId !== undefined ||
    input.requirement !== undefined;
  const delegationRequest = delegation.verificationRequest;
  const source = explicitInputProvided
    ? delegationRequest
      ? "mixed"
      : "input"
    : delegationRequest
      ? "delegation"
      : "none";
  const verifierId = input.verifierId ?? delegationRequest?.verifierId;
  const verificationId = input.verificationId ?? delegationRequest?.verificationId;
  const requirement = input.requirement ?? delegationRequest?.requirement;

  return {
    ...(verifierId === undefined ? {} : { verifierId }),
    ...(verificationId === undefined ? {} : { verificationId }),
    ...(requirement === undefined ? {} : { requirement }),
    source,
  };
}

function selectMailboxRecord<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  requestedId: string | undefined,
  emptyErrorMessage: string,
  label: string,
): TRecord {
  if (records.length === 0) {
    throw new Error(emptyErrorMessage);
  }
  if (requestedId === undefined) {
    const [firstRecord] = records;
    if (firstRecord === undefined) {
      throw new Error(emptyErrorMessage);
    }
    return firstRecord;
  }
  const selected = records.find((record) => record.id === requestedId);
  if (!selected) {
    throw new Error(`Unknown ${label} in mailbox: ${requestedId}`);
  }
  return selected;
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-z0-9_]+/giu, "_");
}
