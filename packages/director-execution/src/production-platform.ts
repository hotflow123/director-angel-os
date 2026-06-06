import type { ArtifactKind } from "@hotflow/director-host-contracts";

export const PRODUCTION_PLATFORM_TRACE_SCHEMA_VERSION =
  "director.production_platform.trace.v1" as const;
export const PRODUCTION_PLATFORM_REPORT_SCHEMA_VERSION =
  "director.production_platform.report.v1" as const;

export const PRODUCTION_PLATFORM_ACTION_KINDS = [
  "create_project",
  "upload_asset",
  "render_preview",
] as const;
export const PRODUCTION_PLATFORM_TRACE_STATUSES = [
  "proposed",
  "dry_run",
  "completed",
  "blocked",
  "failed",
] as const;

export type ProductionPlatformActionKind = (typeof PRODUCTION_PLATFORM_ACTION_KINDS)[number];
export type ProductionPlatformExecutionMode = "proposal" | "dry-run" | "operator-approved";
export type ProductionPlatformTraceStatus = (typeof PRODUCTION_PLATFORM_TRACE_STATUSES)[number];
export type ProductionPlatformFailureReason =
  | "permission_denied"
  | "validation_error"
  | "not_found"
  | "provider_error"
  | "adapter_unavailable";
export type ProductionPlatformReportStatus = "ok" | "degraded" | "blocked";

export interface ProductionPlatformFailure {
  readonly reason: ProductionPlatformFailureReason;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ProductionPlatformActionOptions {
  readonly mode?: ProductionPlatformExecutionMode;
  readonly operatorApprovalId?: string;
  readonly requestedBy?: string;
  readonly attempt?: number;
}

export interface ProductionPlatformCreateProjectInput {
  readonly title: string;
  readonly brief?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ProductionPlatformUploadAssetInput {
  readonly projectRef: string;
  readonly assetName: string;
  readonly artifactKind: ArtifactKind;
  readonly contentDigest: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ProductionPlatformRenderPreviewInput {
  readonly projectRef: string;
  readonly assetRefs: readonly string[];
  readonly profile?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ProductionPlatformProjectOutput {
  readonly projectRef: string;
  readonly projectUrl: string;
}

export interface ProductionPlatformAssetOutput {
  readonly assetRef: string;
  readonly projectRef: string;
}

export interface ProductionPlatformPreviewOutput {
  readonly previewRef: string;
  readonly projectRef: string;
  readonly assetRefs: readonly string[];
}

export interface ProductionPlatformActionTrace<TOutput = ProductionPlatformActionOutput> {
  readonly schemaVersion: typeof PRODUCTION_PLATFORM_TRACE_SCHEMA_VERSION;
  readonly traceId: string;
  readonly adapterId: string;
  readonly provider: string;
  readonly action: ProductionPlatformActionKind;
  readonly mode: ProductionPlatformExecutionMode;
  readonly status: ProductionPlatformTraceStatus;
  readonly recordedAt: string;
  readonly attempt: number;
  readonly requestSummary: string;
  readonly proposalRequired: boolean;
  readonly operatorApprovalRequired: boolean;
  readonly externalSideEffect: false;
  readonly operatorApprovalId?: string;
  readonly requestedBy?: string;
  readonly output?: TOutput;
  readonly failure?: ProductionPlatformFailure;
  readonly notes?: readonly string[];
}

export type ProductionPlatformActionOutput =
  | ProductionPlatformProjectOutput
  | ProductionPlatformAssetOutput
  | ProductionPlatformPreviewOutput;

export type ProductionPlatformProjectTrace =
  ProductionPlatformActionTrace<ProductionPlatformProjectOutput>;
export type ProductionPlatformAssetTrace =
  ProductionPlatformActionTrace<ProductionPlatformAssetOutput>;
export type ProductionPlatformPreviewTrace =
  ProductionPlatformActionTrace<ProductionPlatformPreviewOutput>;

export interface ProductionPlatformRunReportCounts {
  readonly byAction: Readonly<Record<ProductionPlatformActionKind, number>>;
  readonly byStatus: Readonly<Record<ProductionPlatformTraceStatus, number>>;
  readonly retryableFailures: number;
}

export interface ProductionPlatformRunReport {
  readonly schemaVersion: typeof PRODUCTION_PLATFORM_REPORT_SCHEMA_VERSION;
  readonly reportId: string;
  readonly adapterId: string;
  readonly status: ProductionPlatformReportStatus;
  readonly recordedAt: string;
  readonly traceCount: number;
  readonly counts: ProductionPlatformRunReportCounts;
  readonly summary: readonly string[];
  readonly flags: readonly string[];
  readonly nextActions: readonly string[];
  readonly traces: readonly ProductionPlatformActionTrace[];
}

export interface ProductionPlatformAdapter {
  readonly adapterId: string;
  readonly provider: string;
  readonly mockOnly: boolean;
  readonly dryRunSupported: boolean;

  createProject(
    input: ProductionPlatformCreateProjectInput,
    options?: ProductionPlatformActionOptions,
  ): Promise<ProductionPlatformProjectTrace>;

  uploadAsset(
    input: ProductionPlatformUploadAssetInput,
    options?: ProductionPlatformActionOptions,
  ): Promise<ProductionPlatformAssetTrace>;

  renderPreview(
    input: ProductionPlatformRenderPreviewInput,
    options?: ProductionPlatformActionOptions,
  ): Promise<ProductionPlatformPreviewTrace>;

  listTraces(): readonly ProductionPlatformActionTrace[];
}

export interface MockProductionPlatformAdapterOptions {
  readonly adapterId?: string;
  readonly provider?: string;
  readonly now?: () => string;
  readonly failurePlan?: Partial<
    Record<ProductionPlatformActionKind, readonly ProductionPlatformFailure[]>
  >;
}

export interface ProductionPlatformWorkflowAssetInput {
  readonly assetName: string;
  readonly artifactKind: ArtifactKind;
  readonly contentDigest: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ProductionPlatformVerticalSliceInput {
  readonly title: string;
  readonly brief?: string;
  readonly assets: readonly ProductionPlatformWorkflowAssetInput[];
  readonly previewProfile?: string;
  readonly mode?: ProductionPlatformExecutionMode;
  readonly operatorApprovalId?: string;
  readonly requestedBy?: string;
  readonly maxRetries?: number;
  readonly reportId?: string;
  readonly recordedAt?: string;
}

export interface BuildProductionPlatformRunReportInput {
  readonly reportId: string;
  readonly adapterId: string;
  readonly recordedAt: string;
  readonly traces: readonly ProductionPlatformActionTrace[];
}

class InMemoryMockProductionPlatformAdapter implements ProductionPlatformAdapter {
  public readonly adapterId: string;
  public readonly provider: string;
  public readonly mockOnly = true;
  public readonly dryRunSupported = true;

  private readonly now: () => string;
  private readonly traces: ProductionPlatformActionTrace[] = [];
  private readonly failurePlan = new Map<
    ProductionPlatformActionKind,
    ProductionPlatformFailure[]
  >();
  private nextNumericId = 1;

  public constructor(options: MockProductionPlatformAdapterOptions = {}) {
    this.adapterId = options.adapterId ?? "mock-production-platform";
    this.provider = options.provider ?? "director-mock-production-platform";
    this.now = options.now ?? (() => new Date().toISOString());

    for (const action of PRODUCTION_PLATFORM_ACTION_KINDS) {
      const failures = options.failurePlan?.[action];
      if (failures !== undefined) {
        this.failurePlan.set(action, [...failures]);
      }
    }
  }

  public async createProject(
    input: ProductionPlatformCreateProjectInput,
    options: ProductionPlatformActionOptions = {},
  ): Promise<ProductionPlatformProjectTrace> {
    if (input.title.trim().length === 0) {
      return this.recordFailure("create_project", options, "project title", {
        reason: "validation_error",
        message: "Production platform project title must not be empty.",
        retryable: false,
      });
    }

    return this.recordAction("create_project", options, `project ${input.title}`, () => {
      const projectRef = `mock-project-${slugify(input.title)}-${this.allocateId()}`;
      return {
        projectRef,
        projectUrl: `mock://production-platform/projects/${projectRef}`,
      };
    });
  }

  public async uploadAsset(
    input: ProductionPlatformUploadAssetInput,
    options: ProductionPlatformActionOptions = {},
  ): Promise<ProductionPlatformAssetTrace> {
    if (input.projectRef.trim().length === 0 || input.assetName.trim().length === 0) {
      return this.recordFailure("upload_asset", options, "asset upload", {
        reason: "validation_error",
        message: "Production platform asset upload requires projectRef and assetName.",
        retryable: false,
      });
    }

    return this.recordAction(
      "upload_asset",
      options,
      `${input.assetName} -> ${input.projectRef}`,
      () => {
        const assetRef = `mock-asset-${slugify(input.assetName)}-${this.allocateId()}`;
        return {
          assetRef,
          projectRef: input.projectRef,
        };
      },
    );
  }

  public async renderPreview(
    input: ProductionPlatformRenderPreviewInput,
    options: ProductionPlatformActionOptions = {},
  ): Promise<ProductionPlatformPreviewTrace> {
    if (input.projectRef.trim().length === 0 || input.assetRefs.length === 0) {
      return this.recordFailure("render_preview", options, "preview render", {
        reason: "validation_error",
        message: "Production platform preview render requires projectRef and at least one asset.",
        retryable: false,
      });
    }

    return this.recordAction(
      "render_preview",
      options,
      `${input.profile ?? "default"} preview for ${input.projectRef}`,
      () => {
        const previewRef = `mock-preview-${slugify(input.profile ?? "default")}-${this.allocateId()}`;
        return {
          previewRef,
          projectRef: input.projectRef,
          assetRefs: [...input.assetRefs],
        };
      },
    );
  }

  public listTraces(): readonly ProductionPlatformActionTrace[] {
    return this.traces.map((trace) => cloneTrace(trace));
  }

  private recordAction<TOutput extends ProductionPlatformActionOutput>(
    action: ProductionPlatformActionKind,
    options: ProductionPlatformActionOptions,
    requestSummary: string,
    createOutput: () => TOutput,
  ): ProductionPlatformActionTrace<TOutput> {
    const mode = options.mode ?? "dry-run";
    const approvalFailure = resolveApprovalFailure(mode, options.operatorApprovalId);
    if (approvalFailure !== null) {
      return this.recordFailure(action, options, requestSummary, approvalFailure);
    }

    const plannedFailure = this.consumePlannedFailure(action);
    if (plannedFailure !== null) {
      return this.recordFailure(action, options, requestSummary, plannedFailure);
    }

    const status = resolveTraceStatus(mode);
    return this.recordTrace<TOutput>({
      action,
      mode,
      status,
      options,
      requestSummary,
      output: createOutput(),
      notes: [
        mode === "operator-approved"
          ? "mock-only operator-approved simulation; no external side effect was triggered"
          : "proposal/dry-run trace only; no external side effect was triggered",
      ],
    });
  }

  private recordFailure<TOutput extends ProductionPlatformActionOutput>(
    action: ProductionPlatformActionKind,
    options: ProductionPlatformActionOptions,
    requestSummary: string,
    failure: ProductionPlatformFailure,
  ): ProductionPlatformActionTrace<TOutput> {
    const mode = options.mode ?? "dry-run";
    const status: ProductionPlatformTraceStatus =
      failure.reason === "permission_denied" ? "blocked" : "failed";

    return this.recordTrace<TOutput>({
      action,
      mode,
      status,
      options,
      requestSummary,
      failure,
      notes: ["production platform action did not execute"],
    });
  }

  private recordTrace<TOutput extends ProductionPlatformActionOutput>(input: {
    readonly action: ProductionPlatformActionKind;
    readonly mode: ProductionPlatformExecutionMode;
    readonly status: ProductionPlatformTraceStatus;
    readonly options: ProductionPlatformActionOptions;
    readonly requestSummary: string;
    readonly output?: TOutput;
    readonly failure?: ProductionPlatformFailure;
    readonly notes?: readonly string[];
  }): ProductionPlatformActionTrace<TOutput> {
    const trace: ProductionPlatformActionTrace<TOutput> = {
      schemaVersion: PRODUCTION_PLATFORM_TRACE_SCHEMA_VERSION,
      traceId: `production-trace-${this.allocateId()}`,
      adapterId: this.adapterId,
      provider: this.provider,
      action: input.action,
      mode: input.mode,
      status: input.status,
      recordedAt: this.now(),
      attempt: input.options.attempt ?? 1,
      requestSummary: input.requestSummary,
      proposalRequired: input.mode !== "operator-approved" || input.status === "blocked",
      operatorApprovalRequired: input.mode === "operator-approved",
      externalSideEffect: false,
      ...(input.options.operatorApprovalId === undefined
        ? {}
        : { operatorApprovalId: input.options.operatorApprovalId }),
      ...(input.options.requestedBy === undefined
        ? {}
        : { requestedBy: input.options.requestedBy }),
      ...(input.output === undefined ? {} : { output: input.output }),
      ...(input.failure === undefined ? {} : { failure: input.failure }),
      ...(input.notes === undefined ? {} : { notes: [...input.notes] }),
    };

    this.traces.push(trace);
    return cloneTrace(trace);
  }

  private consumePlannedFailure(
    action: ProductionPlatformActionKind,
  ): ProductionPlatformFailure | null {
    const failures = this.failurePlan.get(action);
    if (failures === undefined || failures.length === 0) {
      return null;
    }
    const [nextFailure, ...remaining] = failures;
    this.failurePlan.set(action, remaining);
    return nextFailure ?? null;
  }

  private allocateId(): number {
    const value = this.nextNumericId;
    this.nextNumericId += 1;
    return value;
  }
}

export function createMockProductionPlatformAdapter(
  options: MockProductionPlatformAdapterOptions = {},
): ProductionPlatformAdapter {
  return new InMemoryMockProductionPlatformAdapter(options);
}

export async function runProductionPlatformVerticalSlice(
  adapter: ProductionPlatformAdapter,
  input: ProductionPlatformVerticalSliceInput,
): Promise<ProductionPlatformRunReport> {
  const maxRetries = input.maxRetries ?? 0;
  const traceOffset = adapter.listTraces().length;
  const actionOptions = (attempt: number): ProductionPlatformActionOptions => ({
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.operatorApprovalId === undefined
      ? {}
      : { operatorApprovalId: input.operatorApprovalId }),
    ...(input.requestedBy === undefined ? {} : { requestedBy: input.requestedBy }),
    attempt,
  });

  const project = await runWithRetry(
    (attempt) =>
      adapter.createProject(
        {
          title: input.title,
          ...(input.brief === undefined ? {} : { brief: input.brief }),
        },
        actionOptions(attempt),
      ),
    maxRetries,
  );
  if (project.output === undefined) {
    return buildReportForNewTraces(adapter, input, traceOffset);
  }
  const projectRef = project.output.projectRef;

  const assetRefs: string[] = [];
  for (const asset of input.assets) {
    const uploaded = await runWithRetry(
      (attempt) =>
        adapter.uploadAsset(
          {
            projectRef,
            assetName: asset.assetName,
            artifactKind: asset.artifactKind,
            contentDigest: asset.contentDigest,
            ...(asset.metadata === undefined ? {} : { metadata: asset.metadata }),
          },
          actionOptions(attempt),
        ),
      maxRetries,
    );
    if (uploaded.output === undefined) {
      return buildReportForNewTraces(adapter, input, traceOffset);
    }
    assetRefs.push(uploaded.output.assetRef);
  }

  await runWithRetry(
    (attempt) =>
      adapter.renderPreview(
        {
          projectRef,
          assetRefs,
          ...(input.previewProfile === undefined ? {} : { profile: input.previewProfile }),
        },
        actionOptions(attempt),
      ),
    maxRetries,
  );

  return buildReportForNewTraces(adapter, input, traceOffset);
}

export function buildProductionPlatformRunReport(
  input: BuildProductionPlatformRunReportInput,
): ProductionPlatformRunReport {
  const traces = input.traces.map((trace) => cloneTrace(trace));
  const counts = countTraces(traces);
  const blockedTraces = traces.filter((trace) => trace.status === "blocked");
  const failedTraces = traces.filter((trace) => trace.status === "failed");
  const recoveredFailures = failedTraces.filter((trace) => hasLaterSuccess(traces, trace));
  const unrecoveredFailures = failedTraces.filter((trace) => !hasLaterSuccess(traces, trace));
  const status: ProductionPlatformReportStatus =
    blockedTraces.length > 0 ? "blocked" : unrecoveredFailures.length > 0 ? "degraded" : "ok";
  const flags = buildReportFlags(traces, blockedTraces, recoveredFailures, unrecoveredFailures);
  const summary = buildReportSummary(input.adapterId, status, traces, counts, recoveredFailures);

  return {
    schemaVersion: PRODUCTION_PLATFORM_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    adapterId: input.adapterId,
    status,
    recordedAt: input.recordedAt,
    traceCount: traces.length,
    counts,
    summary,
    flags,
    nextActions: buildNextActions(status, blockedTraces, unrecoveredFailures),
    traces,
  };
}

async function runWithRetry<TOutput extends ProductionPlatformActionOutput>(
  operation: (attempt: number) => Promise<ProductionPlatformActionTrace<TOutput>>,
  maxRetries: number,
): Promise<ProductionPlatformActionTrace<TOutput>> {
  let attempt = 1;
  let result = await operation(attempt);

  while (
    result.status === "failed" &&
    result.failure?.retryable === true &&
    attempt <= maxRetries
  ) {
    attempt += 1;
    result = await operation(attempt);
  }

  return result;
}

function buildReportForNewTraces(
  adapter: ProductionPlatformAdapter,
  input: ProductionPlatformVerticalSliceInput,
  traceOffset: number,
): ProductionPlatformRunReport {
  return buildProductionPlatformRunReport({
    reportId: input.reportId ?? `production-platform-report-${Date.now()}`,
    adapterId: adapter.adapterId,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    traces: adapter.listTraces().slice(traceOffset),
  });
}

function resolveApprovalFailure(
  mode: ProductionPlatformExecutionMode,
  operatorApprovalId: string | undefined,
): ProductionPlatformFailure | null {
  if (mode !== "operator-approved" || operatorApprovalId !== undefined) {
    return null;
  }

  return {
    reason: "permission_denied",
    message: "Operator approval is required before an operator-approved production action.",
    retryable: false,
  };
}

function resolveTraceStatus(mode: ProductionPlatformExecutionMode): ProductionPlatformTraceStatus {
  if (mode === "proposal") {
    return "proposed";
  }
  if (mode === "operator-approved") {
    return "completed";
  }
  return "dry_run";
}

function countTraces(
  traces: readonly ProductionPlatformActionTrace[],
): ProductionPlatformRunReportCounts {
  const byAction = Object.fromEntries(
    PRODUCTION_PLATFORM_ACTION_KINDS.map((action) => [action, 0]),
  ) as Record<ProductionPlatformActionKind, number>;
  const byStatus = Object.fromEntries(
    PRODUCTION_PLATFORM_TRACE_STATUSES.map((status) => [status, 0]),
  ) as Record<ProductionPlatformTraceStatus, number>;
  let retryableFailures = 0;

  for (const trace of traces) {
    byAction[trace.action] += 1;
    byStatus[trace.status] += 1;
    if (trace.failure?.retryable === true) {
      retryableFailures += 1;
    }
  }

  return {
    byAction,
    byStatus,
    retryableFailures,
  };
}

function buildReportFlags(
  traces: readonly ProductionPlatformActionTrace[],
  blockedTraces: readonly ProductionPlatformActionTrace[],
  recoveredFailures: readonly ProductionPlatformActionTrace[],
  unrecoveredFailures: readonly ProductionPlatformActionTrace[],
): readonly string[] {
  const flags = new Set<string>();

  if (traces.length > 0 && traces.every((trace) => trace.mode === "dry-run")) {
    flags.add("dry-run-only");
  }
  if (traces.length > 0 && traces.every((trace) => trace.externalSideEffect === false)) {
    flags.add("no-external-side-effects");
  }
  if (blockedTraces.some((trace) => trace.failure?.reason === "permission_denied")) {
    flags.add("operator-approval-required");
  }
  if (recoveredFailures.length > 0) {
    flags.add("retry-recovered");
  }
  if (unrecoveredFailures.some((trace) => trace.failure?.retryable === true)) {
    flags.add("retry-available");
  }

  return [...flags].sort((left, right) => left.localeCompare(right));
}

function buildReportSummary(
  adapterId: string,
  status: ProductionPlatformReportStatus,
  traces: readonly ProductionPlatformActionTrace[],
  counts: ProductionPlatformRunReportCounts,
  recoveredFailures: readonly ProductionPlatformActionTrace[],
): readonly string[] {
  const summary = [
    `production platform status=${status} adapter=${adapterId} traces=${traces.length}`,
    `actions: ${PRODUCTION_PLATFORM_ACTION_KINDS.map(
      (action) => `${action}=${counts.byAction[action]}`,
    ).join(" ")}`,
    `statuses: ${PRODUCTION_PLATFORM_TRACE_STATUSES.map(
      (traceStatus) => `${traceStatus}=${counts.byStatus[traceStatus]}`,
    ).join(" ")}`,
  ];

  for (const failure of recoveredFailures) {
    summary.push(`retried ${failure.action} after ${failure.failure?.reason ?? "unknown"}`);
  }

  return summary;
}

function buildNextActions(
  status: ProductionPlatformReportStatus,
  blockedTraces: readonly ProductionPlatformActionTrace[],
  unrecoveredFailures: readonly ProductionPlatformActionTrace[],
): readonly string[] {
  if (blockedTraces.some((trace) => trace.failure?.reason === "permission_denied")) {
    return ["Provide operator approval before running operator-approved production actions."];
  }
  if (unrecoveredFailures.some((trace) => trace.failure?.retryable === true)) {
    return ["Retry the retryable production platform action after inspecting the dry-run trace."];
  }
  if (status === "degraded") {
    return ["Inspect failed production platform traces before continuing the workflow."];
  }
  return ["Review dry-run traces before enabling any real production platform adapter."];
}

function hasLaterSuccess(
  traces: readonly ProductionPlatformActionTrace[],
  failure: ProductionPlatformActionTrace,
): boolean {
  const failureIndex = traces.findIndex((trace) => trace.traceId === failure.traceId);
  return traces
    .slice(failureIndex + 1)
    .some(
      (trace) =>
        trace.action === failure.action &&
        trace.attempt > failure.attempt &&
        (trace.status === "dry_run" || trace.status === "completed" || trace.status === "proposed"),
    );
}

function cloneTrace<TOutput>(
  trace: ProductionPlatformActionTrace<TOutput>,
): ProductionPlatformActionTrace<TOutput> {
  return {
    ...trace,
    ...(trace.output === undefined ? {} : { output: cloneOutput(trace.output) }),
    ...(trace.failure === undefined ? {} : { failure: { ...trace.failure } }),
    ...(trace.notes === undefined ? {} : { notes: [...trace.notes] }),
  };
}

function cloneOutput<TOutput>(output: TOutput): TOutput {
  if (typeof output !== "object" || output === null) {
    return output;
  }
  return {
    ...output,
    ...("assetRefs" in output && Array.isArray(output.assetRefs)
      ? { assetRefs: [...output.assetRefs] }
      : {}),
  };
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  return slug.length === 0 ? "item" : slug;
}
