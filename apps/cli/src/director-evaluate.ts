import { readFile } from "node:fs/promises";
import {
  type ExecutionRun,
  type ExecutionRunReport,
  isExecutionRun,
  isExecutionRunReport,
} from "@hotflow/director-execution-contracts";
import {
  type AlignmentLock,
  DIRECTOR_HOST_API_VERSION,
  type DirectorBlueprintRequest,
  type DirectorBlueprintResponse,
  type DirectorClarifyRequest,
  type DirectorClarifyResponse,
  type DirectorEvaluateRequest,
  type DirectorEvaluateResponse,
  type DirectorHostSnapshotEnvelope,
  type DirectorIntakePayload,
  type DirectorIntakeRequest,
  type DirectorIntakeResponse,
  type DirectorOutcomeRequest,
  type DirectorOutcomeResponse,
  type DirectorRuntimeCapabilitySnapshotResponse,
  isDirectorBlueprintRequest,
  isDirectorBlueprintResponse,
  isDirectorClarifyRequest,
  isDirectorClarifyResponse,
  isDirectorEvaluateRequest,
  isDirectorEvaluateResponse,
  isDirectorHostSnapshotEnvelope,
  isDirectorIntakeRequest,
  isDirectorIntakeResponse,
  isDirectorOutcomeRequest,
  isDirectorOutcomeResponse,
  isDirectorRuntimeCapabilitySnapshotResponse,
} from "@hotflow/director-host-contracts";

export interface DirectorApiOptions {
  readonly hostUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

type LegacyOutcomeFile = {
  readonly apiVersion?: string;
  readonly snapshotId: string;
  readonly blueprintId?: string;
  readonly handoffId?: string;
  readonly runtimeId?: string;
  readonly outcome: {
    readonly status: "accepted" | "edited" | "rejected" | "abandoned";
    readonly summary?: string;
    readonly notes?: readonly string[];
  };
};

async function readJsonFile(path: string): Promise<unknown> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLegacyOutcomeFile(value: unknown): value is LegacyOutcomeFile {
  return (
    isRecord(value) &&
    typeof value.snapshotId === "string" &&
    (value.blueprintId === undefined || typeof value.blueprintId === "string") &&
    (value.handoffId === undefined || typeof value.handoffId === "string") &&
    (value.runtimeId === undefined || typeof value.runtimeId === "string") &&
    isRecord(value.outcome) &&
    (value.outcome.status === "accepted" ||
      value.outcome.status === "edited" ||
      value.outcome.status === "rejected" ||
      value.outcome.status === "abandoned") &&
    (value.outcome.summary === undefined || typeof value.outcome.summary === "string") &&
    (value.outcome.notes === undefined ||
      (Array.isArray(value.outcome.notes) &&
        value.outcome.notes.every((note) => typeof note === "string")))
  );
}

function resolveHostUrl(options: DirectorApiOptions): string {
  return (options.hostUrl ?? "http://127.0.0.1:3201").replace(/\/+$/u, "");
}

function buildDefaultIntake(snapshot: DirectorHostSnapshotEnvelope): DirectorIntakePayload {
  const objective =
    snapshot.project.outline ??
    snapshot.project.title ??
    `${snapshot.group.generationType} plan for ${snapshot.group.groupId}`;

  return {
    intakeId: `intake-${snapshot.snapshotId}`,
    submittedAt: snapshot.createdAt,
    objective,
    ...(snapshot.project.outline === undefined ? {} : { desiredOutcome: snapshot.project.outline }),
    deliverables: [`${snapshot.group.generationType} blueprint for ${snapshot.group.groupId}`],
    constraints: (snapshot.locks?.lockedFields ?? []).map((lock) => ({
      field: lock.field,
      requirement: lock.reason ?? "Respect the locked field during director planning.",
      priority: lock.level === "hard_lock" ? "required" : "preferred",
      ...(lock.reason === undefined ? {} : { rationale: lock.reason }),
    })),
    notes: ["CLI synthesized intake from a host snapshot for Beta-1 preview mode."],
  };
}

function buildDefaultAlignmentLock(
  snapshot: DirectorHostSnapshotEnvelope,
  intake: DirectorIntakePayload,
): AlignmentLock {
  return {
    lockId: `lock-${snapshot.snapshotId}`,
    sourceIntakeId: intake.intakeId,
    state: "locked",
    lockedAt: snapshot.createdAt,
    objective: intake.objective,
    ...(intake.desiredOutcome === undefined ? {} : { desiredOutcome: intake.desiredOutcome }),
    deliverables: intake.deliverables ?? [],
    lockedConstraints: intake.constraints ?? [],
    lockedFields: snapshot.locks?.lockedFields ?? [],
    notes: ["CLI synthesized an alignment lock for preview-only blueprint routing."],
  };
}

function toEvaluateRequest(payload: unknown): DirectorEvaluateRequest {
  if (isDirectorEvaluateRequest(payload)) {
    return payload;
  }
  if (isDirectorHostSnapshotEnvelope(payload)) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: payload,
    };
  }
  throw new Error("Input file is not a valid Director evaluate request or host snapshot.");
}

function toIntakeRequest(payload: unknown): DirectorIntakeRequest {
  if (isDirectorIntakeRequest(payload)) {
    return payload;
  }
  if (isDirectorHostSnapshotEnvelope(payload)) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: payload,
      intake: buildDefaultIntake(payload),
    };
  }
  if (isDirectorEvaluateRequest(payload)) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: payload.snapshot,
      intake: buildDefaultIntake(payload.snapshot),
      ...(payload.operatorId === undefined ? {} : { operatorId: payload.operatorId }),
    };
  }
  throw new Error("Input file is not a valid Director intake request or host snapshot.");
}

function toClarifyRequest(payload: unknown): DirectorClarifyRequest {
  if (isDirectorClarifyRequest(payload)) {
    return payload;
  }
  if (isDirectorIntakeRequest(payload)) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: payload.snapshot,
      intake: payload.intake,
      answers: [],
      ...(payload.operatorId === undefined ? {} : { operatorId: payload.operatorId }),
    };
  }
  if (isDirectorHostSnapshotEnvelope(payload) || isDirectorEvaluateRequest(payload)) {
    const snapshot = isDirectorHostSnapshotEnvelope(payload) ? payload : payload.snapshot;
    const operatorId =
      !isDirectorHostSnapshotEnvelope(payload) && payload.operatorId !== undefined
        ? payload.operatorId
        : undefined;

    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot,
      intake: buildDefaultIntake(snapshot),
      answers: [],
      ...(operatorId === undefined ? {} : { operatorId }),
    };
  }
  throw new Error("Input file is not a valid Director clarify request or compatible snapshot.");
}

function toBlueprintRequest(payload: unknown): DirectorBlueprintRequest {
  if (isDirectorBlueprintRequest(payload)) {
    return payload;
  }
  const clarifyRequest = isDirectorClarifyRequest(payload)
    ? payload
    : isDirectorIntakeRequest(payload)
      ? undefined
      : undefined;

  if (clarifyRequest) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: clarifyRequest.snapshot,
      intake: clarifyRequest.intake,
      alignmentLock: buildDefaultAlignmentLock(clarifyRequest.snapshot, clarifyRequest.intake),
      ...(clarifyRequest.operatorId === undefined ? {} : { operatorId: clarifyRequest.operatorId }),
    };
  }

  if (isDirectorIntakeRequest(payload)) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot: payload.snapshot,
      intake: payload.intake,
      alignmentLock: buildDefaultAlignmentLock(payload.snapshot, payload.intake),
      ...(payload.operatorId === undefined ? {} : { operatorId: payload.operatorId }),
    };
  }

  if (isDirectorHostSnapshotEnvelope(payload) || isDirectorEvaluateRequest(payload)) {
    const snapshot = isDirectorHostSnapshotEnvelope(payload) ? payload : payload.snapshot;
    const intake = buildDefaultIntake(snapshot);
    const operatorId =
      !isDirectorHostSnapshotEnvelope(payload) && payload.operatorId !== undefined
        ? payload.operatorId
        : undefined;

    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshot,
      intake,
      alignmentLock: buildDefaultAlignmentLock(snapshot, intake),
      ...(operatorId === undefined ? {} : { operatorId }),
    };
  }

  throw new Error("Input file is not a valid Director blueprint request or compatible snapshot.");
}

function toOutcomeRequest(payload: unknown): DirectorOutcomeRequest {
  if (isDirectorOutcomeRequest(payload)) {
    return payload;
  }
  if (isLegacyOutcomeFile(payload)) {
    const recordedAt = new Date().toISOString();
    const note = payload.outcome.summary ?? payload.outcome.notes?.join(" | ");
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: payload.snapshotId,
      blueprintId: payload.blueprintId ?? `blueprint-${payload.snapshotId}`,
      handoffId: payload.handoffId ?? `handoff-${payload.snapshotId}`,
      outcome: {
        outcomeId: `outcome-${payload.snapshotId}`,
        status: payload.outcome.status,
        recordedAt,
        ...(note === undefined ? {} : { notes: note }),
      },
    };
  }
  throw new Error("Outcome file is not a valid Director outcome request.");
}

async function postJson<TRequest, TResponse>(
  route: string,
  requestBody: TRequest,
  options: DirectorApiOptions,
  validator: (value: unknown) => value is TResponse,
  errorLabel: string,
): Promise<TResponse> {
  const hostUrl = resolveHostUrl(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${hostUrl}${route}`, {
    method: "POST",
    headers: createDirectorHostApiRequestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorDetail = await readErrorDetail(response);
    throw new Error(
      `${errorLabel} failed (${response.status} ${response.statusText})${errorDetail === undefined ? "" : `: ${errorDetail}`}`,
    );
  }

  const body = (await response.json()) as unknown;
  if (!validator(body)) {
    throw new Error(`${errorLabel} returned an invalid payload.`);
  }

  return body;
}

async function getJson<TResponse>(
  route: string,
  options: DirectorApiOptions,
  validator: (value: unknown) => value is TResponse,
  errorLabel: string,
): Promise<TResponse> {
  const hostUrl = resolveHostUrl(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${hostUrl}${route}`, {
    headers: createDirectorHostApiRequestHeaders(),
  });

  if (!response.ok) {
    const errorDetail = await readErrorDetail(response);
    throw new Error(
      `${errorLabel} failed (${response.status} ${response.statusText})${errorDetail === undefined ? "" : `: ${errorDetail}`}`,
    );
  }

  const body = (await response.json()) as unknown;
  if (!validator(body)) {
    throw new Error(`${errorLabel} returned an invalid payload.`);
  }

  return body;
}

function createDirectorHostApiRequestHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const token = readDirectorHostApiBearerToken();
  return token === undefined
    ? headers
    : {
        ...headers,
        authorization: `Bearer ${token}`,
      };
}

function readDirectorHostApiBearerToken(): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const token = process.env?.DIRECTOR_HOST_API_BEARER_TOKEN?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  const text = (await response.text()).trim();
  if (text.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
        return parsed.message.trim();
      }
      if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
        return parsed.error.trim();
      }
    }
  } catch {
    // Fall back to raw response text.
  }

  return text;
}

async function postRunCommand(
  runId: string,
  action: "start" | "pause" | "resume" | "abort",
  options: DirectorApiOptions,
): Promise<ExecutionRun> {
  return postJson(
    `/v1/runs/${encodeURIComponent(runId)}/${action}`,
    {},
    options,
    isExecutionRun,
    `Director run ${action}`,
  );
}

export async function evaluateSnapshotWithDirector(
  snapshotPath: string,
  options: DirectorApiOptions = {},
): Promise<DirectorEvaluateResponse> {
  const payload = await readJsonFile(snapshotPath);
  return postJson(
    "/v1/evaluate",
    toEvaluateRequest(payload),
    options,
    isDirectorEvaluateResponse,
    "Director evaluation",
  );
}

export async function submitDirectorIntake(
  snapshotPath: string,
  options: DirectorApiOptions = {},
): Promise<DirectorIntakeResponse> {
  const payload = await readJsonFile(snapshotPath);
  return postJson(
    "/v1/intake",
    toIntakeRequest(payload),
    options,
    isDirectorIntakeResponse,
    "Director intake",
  );
}

export async function submitDirectorClarify(
  snapshotPath: string,
  options: DirectorApiOptions = {},
): Promise<DirectorClarifyResponse> {
  const payload = await readJsonFile(snapshotPath);
  return postJson(
    "/v1/clarify",
    toClarifyRequest(payload),
    options,
    isDirectorClarifyResponse,
    "Director clarify",
  );
}

export async function submitDirectorBlueprint(
  snapshotPath: string,
  options: DirectorApiOptions = {},
): Promise<DirectorBlueprintResponse> {
  const payload = await readJsonFile(snapshotPath);
  return postJson(
    "/v1/blueprint",
    toBlueprintRequest(payload),
    options,
    isDirectorBlueprintResponse,
    "Director blueprint",
  );
}

export async function submitDirectorRunCreate(
  inputPath: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  const payload = await readJsonFile(inputPath);
  const blueprint = isDirectorBlueprintResponse(payload)
    ? payload
    : await submitDirectorBlueprint(inputPath, options);

  return postJson("/v1/runs", blueprint, options, isExecutionRun, "Director run create");
}

export async function fetchDirectorRuntimeSnapshot(
  options: DirectorApiOptions = {},
): Promise<DirectorRuntimeCapabilitySnapshotResponse> {
  return getJson(
    "/v1/runtime/snapshot",
    options,
    isDirectorRuntimeCapabilitySnapshotResponse,
    "Director runtime snapshot",
  );
}

export async function fetchDirectorRunStatus(
  runId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return getJson(
    `/v1/runs/${encodeURIComponent(runId)}`,
    options,
    isExecutionRun,
    "Director run status",
  );
}

export async function submitDirectorRunStart(
  runId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return postRunCommand(runId, "start", options);
}

export async function submitDirectorRunPause(
  runId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return postRunCommand(runId, "pause", options);
}

export async function submitDirectorRunResume(
  runId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return postRunCommand(runId, "resume", options);
}

export async function submitDirectorRunAbort(
  runId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return postRunCommand(runId, "abort", options);
}

export async function submitDirectorRunRetry(
  runId: string,
  assignmentId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return postJson(
    `/v1/runs/${encodeURIComponent(runId)}/retry`,
    { assignmentId },
    options,
    isExecutionRun,
    "Director run retry",
  );
}

export async function submitDirectorRunApprove(
  runId: string,
  assignmentId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return postJson(
    `/v1/runs/${encodeURIComponent(runId)}/approve`,
    { assignmentId },
    options,
    isExecutionRun,
    "Director run approve",
  );
}

export async function submitDirectorRunReroute(
  runId: string,
  assignmentId: string,
  adapterId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRun> {
  return postJson(
    `/v1/runs/${encodeURIComponent(runId)}/reroute`,
    { assignmentId, adapterId },
    options,
    isExecutionRun,
    "Director run reroute",
  );
}

export async function fetchDirectorRunReport(
  runId: string,
  options: DirectorApiOptions = {},
): Promise<ExecutionRunReport> {
  return getJson(
    `/v1/runs/${encodeURIComponent(runId)}/report`,
    options,
    isExecutionRunReport,
    "Director run report",
  );
}

export async function submitDirectorOutcome(
  outcomePath: string,
  options: DirectorApiOptions = {},
): Promise<DirectorOutcomeResponse> {
  const payload = await readJsonFile(outcomePath);
  return postJson(
    "/v1/outcome",
    toOutcomeRequest(payload),
    options,
    isDirectorOutcomeResponse,
    "Director outcome",
  );
}
