import type {
  ConversationRuntimeMemoryRecallBenchmarkHit,
  ConversationRuntimeMemoryRecallBenchmarkProvenance,
} from "./memory-recall-benchmark.js";
import type { ConversationRuntimeMemorySignal } from "./memory.js";

export type ConversationRuntimeMemoryRetrievalProviderKind =
  | "bm25"
  | "vector"
  | "knowledge-graph"
  | "hybrid"
  | "mempalace"
  | (string & {});

export type ConversationRuntimeMemoryRetrievalDomain =
  | "script"
  | "scene"
  | "shot"
  | "asset"
  | "decision"
  | "evidence"
  | "memory"
  | (string & {});

export interface ConversationRuntimeMemoryRetrievalProviderManifest {
  readonly id: string;
  readonly kind: ConversationRuntimeMemoryRetrievalProviderKind;
  readonly label?: string;
  readonly description?: string;
  readonly capabilities?: readonly string[];
  readonly directStoreAccess?: boolean;
  readonly internalStores?: readonly string[];
  readonly storeImports?: readonly string[];
  readonly contracts?: Readonly<Record<string, readonly string[]>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRetrievalRequest {
  readonly query: string;
  readonly domains?: readonly ConversationRuntimeMemoryRetrievalDomain[];
  readonly maxHits?: number;
  readonly maxChars?: number;
  readonly scope?: Readonly<Record<string, unknown>>;
  readonly evidenceRefIds?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly policyEnvelopeRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRetrievalHit {
  readonly id: string;
  readonly source: ConversationRuntimeMemorySignal["source"] | (string & {});
  readonly status?: ConversationRuntimeMemorySignal["status"];
  readonly title?: string;
  readonly summary?: string;
  readonly content?: string;
  readonly score?: number;
  readonly latencyMs?: number;
  readonly provenance?: ConversationRuntimeMemoryRecallBenchmarkProvenance;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRetrievalProviderResult {
  readonly status?: "hit" | "miss" | "degraded";
  readonly hits: readonly ConversationRuntimeMemoryRetrievalHit[];
  readonly latencyMs?: number;
  readonly degradedReason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRetrievalProvider {
  readonly manifest: ConversationRuntimeMemoryRetrievalProviderManifest;
  readonly recall: (
    request: ConversationRuntimeMemoryRetrievalRequest,
  ) =>
    | ConversationRuntimeMemoryRetrievalProviderResult
    | Promise<ConversationRuntimeMemoryRetrievalProviderResult>;
}

export interface ConversationRuntimeMemoryRetrievalProviderIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly path?: string;
}

export interface ConversationRuntimeMemoryRetrievalProviderPlan {
  readonly schemaVersion: "conversation-runtime.memory-retrieval-provider-plan.v1";
  readonly providerId: string;
  readonly status: "admissible" | "blocked";
  readonly kind: ConversationRuntimeMemoryRetrievalProviderKind;
  readonly directStoreAccessAllowed: false;
  readonly capabilities: readonly string[];
  readonly issues: readonly ConversationRuntimeMemoryRetrievalProviderIssue[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRetrievalProviderRegistration {
  readonly registered: boolean;
  readonly plan: ConversationRuntimeMemoryRetrievalProviderPlan;
}

export interface ConversationRuntimeMemoryRetrievalProviderTrace {
  readonly providerId: string;
  readonly kind: ConversationRuntimeMemoryRetrievalProviderKind;
  readonly label?: string;
  readonly status: "hit" | "miss" | "degraded" | "failed" | "blocked";
  readonly hitCount: number;
  readonly latencyMs: number;
  readonly summary?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRetrievalResult {
  readonly schemaVersion: "conversation-runtime.memory-retrieval-result.v1";
  readonly query: string;
  readonly status: "hit" | "miss" | "degraded";
  readonly hits: readonly ConversationRuntimeMemorySignal[];
  readonly providerTraces: readonly ConversationRuntimeMemoryRetrievalProviderTrace[];
  readonly degradedReason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryRetrievalProviderRegistry {
  readonly register: (
    provider: ConversationRuntimeMemoryRetrievalProvider,
  ) => ConversationRuntimeMemoryRetrievalProviderRegistration;
  readonly listPlans: () => readonly ConversationRuntimeMemoryRetrievalProviderPlan[];
  readonly recall: (
    request: ConversationRuntimeMemoryRetrievalRequest,
  ) => Promise<ConversationRuntimeMemoryRetrievalResult>;
}

export type ConversationRuntimeMempalaceMemoryLayer = "L0" | "L1" | "L2" | "L3";

export interface ConversationRuntimeMempalaceLayerRetrievalPlanInput {
  readonly query: string;
  readonly requestedLayers?: readonly string[];
  readonly wing?: string;
  readonly room?: string;
  readonly deepSearchAuthorized?: boolean;
}

export interface ConversationRuntimeMempalaceLayerRetrievalPlan {
  readonly schemaVersion: "conversation-runtime.mempalace-layer-retrieval-plan.v1";
  readonly mode: "wake_up" | "on_demand" | "deep_search" | "blocked";
  readonly allowedLayers: readonly ConversationRuntimeMempalaceMemoryLayer[];
  readonly maxHits: number;
  readonly maxChars: number;
  readonly query: string;
  readonly scope?: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly degraded?: {
    readonly reason: string;
    readonly message: string;
  };
}

interface RegisteredMemoryRetrievalProvider {
  readonly provider: ConversationRuntimeMemoryRetrievalProvider;
  readonly plan: ConversationRuntimeMemoryRetrievalProviderPlan;
}

export function createConversationRuntimeMemoryRetrievalProviderPlan(
  manifest: ConversationRuntimeMemoryRetrievalProviderManifest,
): ConversationRuntimeMemoryRetrievalProviderPlan {
  const providerId = normalizeMemoryProviderId(manifest.id);
  const issues: ConversationRuntimeMemoryRetrievalProviderIssue[] = [];
  if (providerId.length === 0) {
    issues.push({
      code: "provider-id-required",
      message: "Memory retrieval provider id is required.",
      severity: "error",
      path: "id",
    });
  }
  if (manifest.directStoreAccess === true) {
    issues.push({
      code: "direct-store-access-forbidden",
      message: "Memory retrieval providers must use injected ports instead of direct store access.",
      severity: "error",
      path: "directStoreAccess",
    });
  }
  if ((manifest.internalStores ?? []).length > 0) {
    issues.push({
      code: "internal-store-import-forbidden",
      message: "Memory retrieval providers may not declare internal store dependencies.",
      severity: "error",
      path: "internalStores",
    });
  }
  if ((manifest.storeImports ?? []).length > 0) {
    issues.push({
      code: "internal-store-import-forbidden",
      message: "Memory retrieval providers may not import renderer or runtime stores directly.",
      severity: "error",
      path: "storeImports",
    });
  }
  const blocked = issues.some((issue) => issue.severity === "error");
  return {
    schemaVersion: "conversation-runtime.memory-retrieval-provider-plan.v1",
    providerId,
    status: blocked ? "blocked" : "admissible",
    kind: manifest.kind,
    directStoreAccessAllowed: false,
    capabilities: [...(manifest.capabilities ?? [])],
    issues,
    ...(manifest.metadata === undefined ? {} : { metadata: manifest.metadata }),
  };
}

export function createConversationRuntimeMemoryRetrievalProviderRegistry(): ConversationRuntimeMemoryRetrievalProviderRegistry {
  const providers = new Map<string, RegisteredMemoryRetrievalProvider>();
  const plans = new Map<string, ConversationRuntimeMemoryRetrievalProviderPlan>();
  return {
    register: (provider) => {
      const plan = createConversationRuntimeMemoryRetrievalProviderPlan(provider.manifest);
      plans.set(plan.providerId, plan);
      if (plan.status !== "admissible") {
        providers.delete(plan.providerId);
        return { registered: false, plan };
      }
      providers.set(plan.providerId, { provider, plan });
      return { registered: true, plan };
    },
    listPlans: () => [...plans.values()],
    recall: async (request) => recallFromMemoryRetrievalProviders([...providers.values()], request),
  };
}

export function planConversationRuntimeMempalaceLayerRetrieval(
  input: ConversationRuntimeMempalaceLayerRetrievalPlanInput,
): ConversationRuntimeMempalaceLayerRetrievalPlan {
  const query = input.query.trim();
  const requestedLayers = normalizeMempalaceMemoryLayers(input.requestedLayers);
  const allowedLayers: readonly ConversationRuntimeMempalaceMemoryLayer[] =
    requestedLayers.length === 0 ? (["L0", "L1"] as const) : requestedLayers;
  const scope = buildMempalaceLayerScope(input);
  if (allowedLayers.includes("L3") && input.deepSearchAuthorized !== true) {
    return {
      schemaVersion: "conversation-runtime.mempalace-layer-retrieval-plan.v1",
      mode: "blocked",
      allowedLayers: [],
      maxHits: 0,
      maxChars: 0,
      query,
      ...(scope === undefined ? {} : { scope }),
      metadata: {
        requestedLayers: allowedLayers,
        failClosed: true,
      },
      degraded: {
        reason: "mempalace-l3-deep-search-authorization-required",
        message: "L3 Deep Search requires explicit authorization before broad memory retrieval.",
      },
    };
  }
  const mode = allowedLayers.includes("L3")
    ? "deep_search"
    : allowedLayers.includes("L2")
      ? "on_demand"
      : "wake_up";
  return {
    schemaVersion: "conversation-runtime.mempalace-layer-retrieval-plan.v1",
    mode,
    allowedLayers,
    maxHits: resolveMempalaceLayerMaxHits(mode),
    maxChars: resolveMempalaceLayerMaxChars(mode),
    query,
    ...(scope === undefined ? {} : { scope }),
    metadata: {
      requestedLayers: allowedLayers,
      retrievalStrategy:
        mode === "wake_up"
          ? "identity-essential-story"
          : mode === "on_demand"
            ? "wing-room-filtered"
            : "authorized-deep-search",
    },
  };
}

export function mapMemoryRetrievalResultToBenchmarkHits(
  result: ConversationRuntimeMemoryRetrievalResult,
): readonly ConversationRuntimeMemoryRecallBenchmarkHit[] {
  return result.hits
    .filter((hit) => hit.status === "hit" || hit.status === "candidate")
    .map((hit) => {
      const metadataProvenance = readMetadataRecord(hit.metadata?.provenance);
      const provenance = normalizeMemoryRetrievalProvenance(metadataProvenance);
      const latencyMs = readFiniteNumber(hit.metadata?.latencyMs);
      return {
        id: hit.id,
        source: hit.source,
        status: hit.status,
        ...(hit.score === undefined ? {} : { score: hit.score }),
        ...(latencyMs === undefined ? {} : { latencyMs }),
        ...(provenance === undefined ? {} : { provenance }),
        ...(hit.metadata === undefined ? {} : { metadata: hit.metadata }),
      };
    });
}

async function recallFromMemoryRetrievalProviders(
  providers: readonly RegisteredMemoryRetrievalProvider[],
  request: ConversationRuntimeMemoryRetrievalRequest,
): Promise<ConversationRuntimeMemoryRetrievalResult> {
  const normalizedRequest = normalizeMemoryRetrievalRequest(request);
  const allHits: ConversationRuntimeMemorySignal[] = [];
  const traces: ConversationRuntimeMemoryRetrievalProviderTrace[] = [];
  const degradedReasons: string[] = [];

  for (const entry of providers) {
    const startedAt = Date.now();
    const preparedRequest = prepareMemoryRetrievalProviderRequest(entry, normalizedRequest);
    if (preparedRequest.status === "blocked") {
      const reason = preparedRequest.plan.degraded?.reason ?? "mempalace-layer-retrieval-blocked";
      degradedReasons.push(`${entry.plan.providerId}: ${reason}`);
      traces.push({
        providerId: entry.plan.providerId,
        kind: entry.plan.kind,
        ...(entry.provider.manifest.label === undefined
          ? {}
          : { label: entry.provider.manifest.label }),
        status: "blocked",
        hitCount: 0,
        latencyMs: Math.max(0, Date.now() - startedAt),
        summary: reason,
        metadata: {
          mempalaceLayerPlan: preparedRequest.plan,
        },
      });
      continue;
    }
    const providerRequest = preparedRequest.request;
    try {
      const providerResult = await entry.provider.recall(providerRequest);
      const latencyMs =
        readFiniteNumber(providerResult.latencyMs) ?? Math.max(0, Date.now() - startedAt);
      const mappedHits = providerResult.hits.map((hit) =>
        mapMemoryRetrievalHitToSignal(hit, entry, providerRequest, latencyMs),
      );
      allHits.push(...mappedHits);
      const status = providerResult.status ?? (mappedHits.length > 0 ? "hit" : "miss");
      if (status === "degraded" || providerResult.degradedReason !== undefined) {
        const reason = providerResult.degradedReason ?? `${entry.plan.providerId}: degraded`;
        degradedReasons.push(`${entry.plan.providerId}: ${reason}`);
      }
      traces.push({
        providerId: entry.plan.providerId,
        kind: entry.plan.kind,
        ...(entry.provider.manifest.label === undefined
          ? {}
          : { label: entry.provider.manifest.label }),
        status,
        hitCount: mappedHits.length,
        latencyMs,
        ...(providerResult.degradedReason === undefined
          ? {}
          : { summary: providerResult.degradedReason }),
        ...(providerResult.metadata === undefined ? {} : { metadata: providerResult.metadata }),
      });
    } catch (error) {
      const message = toErrorMessage(error);
      degradedReasons.push(`${entry.plan.providerId}: ${message}`);
      traces.push({
        providerId: entry.plan.providerId,
        kind: entry.plan.kind,
        ...(entry.provider.manifest.label === undefined
          ? {}
          : { label: entry.provider.manifest.label }),
        status: "failed",
        hitCount: 0,
        latencyMs: Math.max(0, Date.now() - startedAt),
        summary: message,
      });
    }
  }

  const hits = dedupeAndRankMemorySignals(allHits).slice(0, normalizedRequest.maxHits);
  const hasDegraded = degradedReasons.length > 0;
  return {
    schemaVersion: "conversation-runtime.memory-retrieval-result.v1",
    query: normalizedRequest.query,
    status:
      hits.length > 0 ? (hasDegraded ? "degraded" : "hit") : hasDegraded ? "degraded" : "miss",
    hits,
    providerTraces: traces,
    ...(hasDegraded ? { degradedReason: degradedReasons.join("; ") } : {}),
    metadata: {
      domains: [...(normalizedRequest.domains ?? [])],
      scope: { ...(normalizedRequest.scope ?? {}) },
    },
  };
}

type PreparedMemoryRetrievalProviderRequest =
  | {
      readonly status: "allowed";
      readonly request: ConversationRuntimeMemoryRetrievalRequest;
    }
  | {
      readonly status: "blocked";
      readonly plan: ConversationRuntimeMempalaceLayerRetrievalPlan;
    };

function prepareMemoryRetrievalProviderRequest(
  entry: RegisteredMemoryRetrievalProvider,
  request: ConversationRuntimeMemoryRetrievalRequest,
): PreparedMemoryRetrievalProviderRequest {
  if (entry.plan.kind !== "mempalace") {
    return { status: "allowed", request };
  }
  const requestedLayers = readMempalaceRequestedLayers(request);
  const wing = readMempalaceScopeValue(request, "wing");
  const room = readMempalaceScopeValue(request, "room");
  const deepSearchAuthorized = readMempalaceDeepSearchAuthorized(request);
  const layerPlan = planConversationRuntimeMempalaceLayerRetrieval({
    query: request.query,
    ...(requestedLayers === undefined ? {} : { requestedLayers }),
    ...(wing === undefined ? {} : { wing }),
    ...(room === undefined ? {} : { room }),
    ...(deepSearchAuthorized === undefined ? {} : { deepSearchAuthorized }),
  });
  if (layerPlan.mode === "blocked") {
    return { status: "blocked", plan: layerPlan };
  }
  return {
    status: "allowed",
    request: {
      ...request,
      maxHits: layerPlan.maxHits,
      maxChars: layerPlan.maxChars,
      scope: {
        ...(request.scope ?? {}),
        ...(layerPlan.scope ?? {}),
      },
      metadata: {
        ...(request.metadata ?? {}),
        mempalaceLayerPlan: layerPlan,
      },
    },
  };
}

function mapMemoryRetrievalHitToSignal(
  hit: ConversationRuntimeMemoryRetrievalHit,
  entry: RegisteredMemoryRetrievalProvider,
  request: ConversationRuntimeMemoryRetrievalRequest,
  providerLatencyMs: number,
): ConversationRuntimeMemorySignal {
  const status = hit.status ?? "hit";
  const provenance = normalizeMemoryRetrievalProvenance(hit.provenance, request);
  const verbatim = normalizeVerbatimExcerptText(readMemoryRetrievalVerbatim(hit.metadata));
  const summary = truncateSummary(
    verbatim ?? hit.content ?? hit.summary ?? "",
    request.maxChars ?? 500,
  );
  const mempalaceLayerPlan = readPlainMetadataRecord(request.metadata?.mempalaceLayerPlan);
  const verbatimExcerpt =
    verbatim === undefined ? undefined : truncateSummary(verbatim, request.maxChars ?? 500);
  const verbatimSource =
    verbatim === undefined
      ? undefined
      : buildMemoryRetrievalVerbatimSource(hit.metadata, provenance);
  return {
    id: hit.id,
    source: hit.source,
    status,
    ...(hit.title === undefined ? {} : { title: hit.title }),
    ...(summary.length === 0 ? {} : { summary }),
    ...(hit.score === undefined ? {} : { score: hit.score }),
    metadata: {
      ...(hit.metadata ?? {}),
      providerId: entry.plan.providerId,
      providerKind: entry.plan.kind,
      directStoreAccessAllowed: entry.plan.directStoreAccessAllowed,
      ...(verbatimExcerpt === undefined
        ? {}
        : {
            retrievalMode: "verbatim-first",
            verbatimExcerpt,
          }),
      ...(verbatimSource === undefined ? {} : { verbatimSource }),
      query: request.query,
      ...(request.domains === undefined ? {} : { domains: [...request.domains] }),
      ...(request.scope === undefined ? {} : { scope: { ...request.scope } }),
      ...(mempalaceLayerPlan === undefined ? {} : { mempalaceLayerPlan }),
      latencyMs: hit.latencyMs ?? providerLatencyMs,
      ...(provenance === undefined ? {} : { provenance }),
    },
  };
}

function readMemoryRetrievalVerbatim(
  metadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const excerpt = readMetadataString(metadata, "verbatimExcerpt");
  if (excerpt !== undefined) {
    return excerpt;
  }
  return readMetadataString(metadata, "verbatim");
}

function normalizeVerbatimExcerptText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? undefined : normalized;
}

function buildMemoryRetrievalVerbatimSource(
  metadata: Readonly<Record<string, unknown>> | undefined,
  provenance: ConversationRuntimeMemoryRecallBenchmarkProvenance | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const source: Record<string, unknown> = {};
  for (const key of ["sourceFile", "wing", "room"]) {
    const value = readMetadataString(metadata, key);
    if (value !== undefined) {
      source[key] = value;
    }
  }
  for (const key of ["drawerIndex", "totalDrawers"]) {
    const value = readFiniteNumber(metadata?.[key]);
    if (value !== undefined) {
      source[key] = value;
    }
  }
  const sourceRefs = provenance?.sourceRefs ?? [];
  if (sourceRefs.length > 0) {
    source.sourceRefs = [...sourceRefs];
  }
  return Object.keys(source).length === 0 ? undefined : source;
}

function normalizeMemoryRetrievalRequest(
  request: ConversationRuntimeMemoryRetrievalRequest,
): ConversationRuntimeMemoryRetrievalRequest {
  const query = request.query.trim();
  return {
    ...request,
    query,
    maxHits: normalizePositiveInteger(request.maxHits, 5),
    maxChars: normalizePositiveInteger(request.maxChars, 500),
  };
}

function normalizeMemoryRetrievalProvenance(
  provenance: ConversationRuntimeMemoryRecallBenchmarkProvenance | undefined,
  request?: ConversationRuntimeMemoryRetrievalRequest,
): ConversationRuntimeMemoryRecallBenchmarkProvenance | undefined {
  const evidenceRefIds = dedupeStrings([
    ...(provenance?.evidenceRefIds ?? []),
    ...(request?.evidenceRefIds ?? []),
  ]);
  const sourceRefs = dedupeStrings([
    ...(provenance?.sourceRefs ?? []),
    ...(request?.sourceRefs ?? []),
  ]);
  const policyEnvelopeRefs = dedupeStrings([
    ...(provenance?.policyEnvelopeRefs ?? []),
    ...(request?.policyEnvelopeRefs ?? []),
  ]);
  const traceRefs = dedupeStrings(provenance?.traceRefs ?? []);
  if (
    evidenceRefIds.length === 0 &&
    sourceRefs.length === 0 &&
    policyEnvelopeRefs.length === 0 &&
    traceRefs.length === 0 &&
    provenance?.metadata === undefined
  ) {
    return undefined;
  }
  return {
    ...(evidenceRefIds.length === 0 ? {} : { evidenceRefIds }),
    ...(sourceRefs.length === 0 ? {} : { sourceRefs }),
    ...(policyEnvelopeRefs.length === 0 ? {} : { policyEnvelopeRefs }),
    ...(traceRefs.length === 0 ? {} : { traceRefs }),
    ...(provenance?.metadata === undefined ? {} : { metadata: provenance.metadata }),
  };
}

function dedupeAndRankMemorySignals(
  hits: readonly ConversationRuntimeMemorySignal[],
): readonly ConversationRuntimeMemorySignal[] {
  const byId = new Map<string, ConversationRuntimeMemorySignal>();
  for (const hit of hits) {
    const existing = byId.get(hit.id);
    if (existing === undefined || compareMemorySignals(hit, existing) < 0) {
      byId.set(hit.id, hit);
    }
  }
  return [...byId.values()].sort(compareMemorySignals);
}

function compareMemorySignals(
  left: ConversationRuntimeMemorySignal,
  right: ConversationRuntimeMemorySignal,
): number {
  const leftScore = readFiniteNumber(left.score) ?? 0;
  const rightScore = readFiniteNumber(right.score) ?? 0;
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }
  return left.id.localeCompare(right.id);
}

function normalizeMemoryProviderId(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeMempalaceMemoryLayers(
  values: readonly string[] | undefined,
): readonly ConversationRuntimeMempalaceMemoryLayer[] {
  const allowed = new Set<ConversationRuntimeMempalaceMemoryLayer>();
  for (const value of values ?? []) {
    const normalized = value
      .trim()
      .toUpperCase()
      .replace(/^LAYER/u, "L");
    if (normalized === "L0" || normalized === "L1" || normalized === "L2" || normalized === "L3") {
      allowed.add(normalized);
    }
  }
  return [...allowed];
}

function readMempalaceRequestedLayers(
  request: ConversationRuntimeMemoryRetrievalRequest,
): readonly string[] | undefined {
  const fromRequestedLayers = readStringArrayMetadata(request.metadata?.requestedLayers);
  if (fromRequestedLayers !== undefined) {
    return fromRequestedLayers;
  }
  return readStringArrayMetadata(request.metadata?.memoryLayers);
}

function readMempalaceScopeValue(
  request: ConversationRuntimeMemoryRetrievalRequest,
  key: "wing" | "room",
): string | undefined {
  return readMetadataString(request.metadata, key) ?? readMetadataString(request.scope, key);
}

function readMempalaceDeepSearchAuthorized(
  request: ConversationRuntimeMemoryRetrievalRequest,
): boolean | undefined {
  return request.metadata?.deepSearchAuthorized === true;
}

function buildMempalaceLayerScope(
  input: ConversationRuntimeMempalaceLayerRetrievalPlanInput,
): Readonly<Record<string, string>> | undefined {
  const scope: Record<string, string> = {};
  const wing = input.wing?.trim();
  const room = input.room?.trim();
  if (wing) {
    scope.wing = wing;
  }
  if (room) {
    scope.room = room;
  }
  return Object.keys(scope).length === 0 ? undefined : scope;
}

function resolveMempalaceLayerMaxHits(
  mode: ConversationRuntimeMempalaceLayerRetrievalPlan["mode"],
): number {
  if (mode === "wake_up") {
    return 4;
  }
  if (mode === "on_demand") {
    return 10;
  }
  if (mode === "deep_search") {
    return 5;
  }
  return 0;
}

function resolveMempalaceLayerMaxChars(
  mode: ConversationRuntimeMempalaceLayerRetrievalPlan["mode"],
): number {
  if (mode === "wake_up") {
    return 900;
  }
  if (mode === "on_demand") {
    return 500;
  }
  if (mode === "deep_search") {
    return 1200;
  }
  return 0;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}

function readMetadataRecord(
  value: unknown,
): ConversationRuntimeMemoryRecallBenchmarkProvenance | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as ConversationRuntimeMemoryRecallBenchmarkProvenance;
}

function readPlainMetadataRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArrayMetadata(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter((item): item is string => typeof item === "string");
  return values.length === 0 ? undefined : values;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function truncateSummary(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trim()}...`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
