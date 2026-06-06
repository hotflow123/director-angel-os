import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ActionClass, RuntimeHealthStatus } from "@hotflow/director-core";
import type {
  AdapterProfileRef,
  AdapterRiskLevel,
  ArtifactKind,
  CostClass,
  DirectorApprovalMode,
  LatencyClass,
  MediaCapabilityProfile,
  MediaExecutionMode,
  MediaOutputArtifactKind,
  SafetyTier,
} from "@hotflow/director-host-contracts";

import type { DirectorAdapterManifest } from "./types.js";

export const DIRECTOR_ADAPTER_MANIFEST_DOCUMENT_SCHEMA_VERSION =
  "director.adapter.manifest.v1" as const;
export const DIRECTOR_ADAPTER_REGISTRY_INDEX_SCHEMA_VERSION =
  "director.adapter.registry.index.v1" as const;

const DIRECTOR_ACTION_CLASSES = [
  "read",
  "generate",
  "route",
  "review",
  "write",
  "publish",
] as const satisfies readonly ActionClass[];
const DIRECTOR_SIDE_EFFECT_ACTION_CLASSES = [
  "generate",
  "write",
  "publish",
] as const satisfies readonly ActionClass[];
const DIRECTOR_SIDE_EFFECT_ACTION_CLASS_SET = new Set<ActionClass>(
  DIRECTOR_SIDE_EFFECT_ACTION_CLASSES,
);
const DIRECTOR_ADAPTER_KINDS = ["host", "media", "execution"] as const;
const DIRECTOR_ADAPTER_BRIDGE_KINDS = ["http-json"] as const;
const DIRECTOR_ADAPTER_RISK_LEVELS = ["low", "medium", "high"] as const;
const DIRECTOR_ADAPTER_APPROVAL_MODES = [
  "auto_allow",
  "operator_approve",
  "forbidden_in_beta1",
] as const;
const DIRECTOR_RUNTIME_HEALTH_STATUSES = ["ready", "degraded", "offline"] as const;
const DIRECTOR_MEDIA_EXECUTION_MODES = [
  "text_to_image",
  "text_to_video",
  "image_to_video",
] as const satisfies readonly MediaExecutionMode[];
const DIRECTOR_ARTIFACT_KINDS = [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "json",
] as const satisfies readonly ArtifactKind[];
const DIRECTOR_MEDIA_OUTPUT_ARTIFACT_KINDS = [
  "image",
  "video",
] as const satisfies readonly MediaOutputArtifactKind[];
const DIRECTOR_COST_CLASSES = [
  "low",
  "medium",
  "high",
  "premium",
] as const satisfies readonly CostClass[];
const DIRECTOR_LATENCY_CLASSES = [
  "interactive",
  "batch",
  "slow",
] as const satisfies readonly LatencyClass[];
const DIRECTOR_SAFETY_TIERS = [
  "standard",
  "restricted",
  "strict",
] as const satisfies readonly SafetyTier[];

export interface DirectorAdapterManifestDocument extends DirectorAdapterManifest {
  readonly schemaVersion: typeof DIRECTOR_ADAPTER_MANIFEST_DOCUMENT_SCHEMA_VERSION;
  readonly version: number;
  readonly capturedAt: string;
  readonly source: string;
  readonly bridge?: DirectorAdapterBridgeDocument;
}

export interface DirectorHttpJsonAdapterBridgeDocument {
  readonly kind: "http-json";
  readonly baseUrl: string;
  readonly submitPath: string;
  readonly timeoutMs?: number;
  readonly authEnvVar?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type DirectorAdapterBridgeDocument = DirectorHttpJsonAdapterBridgeDocument;

export interface DirectorAdapterRegistryIndexEntry {
  readonly adapterId: string;
  readonly adapterKind: DirectorAdapterManifest["adapterKind"];
  readonly provider: string;
  readonly bindingId?: string;
  readonly enabled?: boolean;
  readonly healthStatus: RuntimeHealthStatus;
  readonly capturedAt: string;
  readonly version: number;
  readonly manifestPath: string;
}

export interface DirectorAdapterRegistryIndexDocument {
  readonly schemaVersion: typeof DIRECTOR_ADAPTER_REGISTRY_INDEX_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly entries: readonly DirectorAdapterRegistryIndexEntry[];
}

export interface LoadDirectorAdapterRegistryResult {
  readonly documents: readonly DirectorAdapterManifestDocument[];
  readonly notes: readonly string[];
  readonly issues: readonly string[];
}

export interface FileSystemDirectorAdapterRegistryStoreOptions {
  readonly rootPath: string;
  readonly clock?: () => string;
}

export interface DirectorAdapterRegistryWriteResult {
  readonly status: "ok" | "degraded";
  readonly adapterId: string;
  readonly version: number;
  readonly notes: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActionClass(value: string): value is ActionClass {
  return DIRECTOR_ACTION_CLASSES.includes(value as ActionClass);
}

function isAdapterKind(value: string): value is DirectorAdapterManifest["adapterKind"] {
  return DIRECTOR_ADAPTER_KINDS.includes(value as DirectorAdapterManifest["adapterKind"]);
}

function isAdapterBridgeKind(value: string): value is DirectorAdapterBridgeDocument["kind"] {
  return DIRECTOR_ADAPTER_BRIDGE_KINDS.includes(value as DirectorAdapterBridgeDocument["kind"]);
}

function isAdapterRiskLevel(value: string): value is AdapterRiskLevel {
  return DIRECTOR_ADAPTER_RISK_LEVELS.includes(value as AdapterRiskLevel);
}

function isDirectorApprovalMode(value: string): value is DirectorApprovalMode {
  return DIRECTOR_ADAPTER_APPROVAL_MODES.includes(value as DirectorApprovalMode);
}

function isRuntimeHealthStatus(value: string): value is RuntimeHealthStatus {
  return DIRECTOR_RUNTIME_HEALTH_STATUSES.includes(value as RuntimeHealthStatus);
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toArtifactKindArray(value: unknown): ArtifactKind[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const kinds = value.filter(
    (entry): entry is ArtifactKind =>
      typeof entry === "string" && DIRECTOR_ARTIFACT_KINDS.includes(entry as ArtifactKind),
  );
  return kinds.length > 0 ? kinds : undefined;
}

function toMediaOutputArtifactKindArray(value: unknown): MediaOutputArtifactKind[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const kinds = value.filter(
    (entry): entry is MediaOutputArtifactKind =>
      typeof entry === "string" &&
      DIRECTOR_MEDIA_OUTPUT_ARTIFACT_KINDS.includes(entry as MediaOutputArtifactKind),
  );
  return kinds.length > 0 ? kinds : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toCostClass(value: unknown): CostClass | undefined {
  return typeof value === "string" && DIRECTOR_COST_CLASSES.includes(value as CostClass)
    ? (value as CostClass)
    : undefined;
}

function toLatencyClass(value: unknown): LatencyClass | undefined {
  return typeof value === "string" && DIRECTOR_LATENCY_CLASSES.includes(value as LatencyClass)
    ? (value as LatencyClass)
    : undefined;
}

function toSafetyTier(value: unknown): SafetyTier | undefined {
  return typeof value === "string" && DIRECTOR_SAFETY_TIERS.includes(value as SafetyTier)
    ? (value as SafetyTier)
    : undefined;
}

function toAdapterRiskLevel(value: unknown): AdapterRiskLevel | undefined {
  return typeof value === "string" && isAdapterRiskLevel(value) ? value : undefined;
}

function toDirectorApprovalMode(value: unknown): DirectorApprovalMode | undefined {
  return typeof value === "string" && isDirectorApprovalMode(value) ? value : undefined;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (entries.length !== Object.keys(value).length) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasSideEffectAction(actionClasses: readonly ActionClass[]): boolean {
  return actionClasses.some((actionClass) =>
    DIRECTOR_SIDE_EFFECT_ACTION_CLASS_SET.has(actionClass),
  );
}

function assertRealBridgePolicy(value: {
  readonly adapterId: string;
  readonly mockOnly: boolean;
  readonly riskLevel?: AdapterRiskLevel;
  readonly approvalMode?: DirectorApprovalMode;
  readonly permissionScopes?: readonly string[];
  readonly dataRetentionPolicy?: string;
  readonly rateLimitPolicy?: string;
  readonly budgetPolicy?: string;
  readonly supportedActionClasses: readonly ActionClass[];
  readonly bridge?: DirectorAdapterBridgeDocument;
}): void {
  if (value.bridge === undefined || value.mockOnly) {
    return;
  }

  if (value.riskLevel === undefined) {
    throw new Error("Real bridge adapter manifests must declare riskLevel.");
  }
  if (value.approvalMode === undefined) {
    throw new Error("Real bridge adapter manifests must declare approvalMode.");
  }
  if (value.permissionScopes === undefined || value.permissionScopes.length === 0) {
    throw new Error("Real bridge adapter manifests must declare permissionScopes.");
  }
  if (value.dataRetentionPolicy === undefined || value.dataRetentionPolicy.trim().length === 0) {
    throw new Error("Real bridge adapter manifests must declare dataRetentionPolicy.");
  }
  if (value.rateLimitPolicy === undefined || value.rateLimitPolicy.trim().length === 0) {
    throw new Error("Real bridge adapter manifests must declare rateLimitPolicy.");
  }
  if (value.budgetPolicy === undefined || value.budgetPolicy.trim().length === 0) {
    throw new Error("Real bridge adapter manifests must declare budgetPolicy.");
  }
  if (
    hasSideEffectAction(value.supportedActionClasses) &&
    value.approvalMode !== "operator_approve"
  ) {
    throw new Error(
      "Real bridge adapter manifests with generate, write, or publish actions must use approvalMode operator_approve.",
    );
  }
}

function toProfileRefArray(value: unknown): AdapterProfileRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const profiles = value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      if (typeof entry.adapterId !== "string" || typeof entry.profileId !== "string") {
        return null;
      }
      return {
        adapterId: entry.adapterId,
        profileId: entry.profileId,
        ...(typeof entry.displayName === "string" ? { displayName: entry.displayName } : {}),
      } satisfies AdapterProfileRef;
    })
    .filter((entry): entry is AdapterProfileRef => entry !== null);

  return profiles.length > 0 ? profiles : undefined;
}

function toMediaCapabilityProfile(value: unknown): MediaCapabilityProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.adapterKind !== "media" ||
    typeof value.adapterId !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.supportsAsync !== "boolean" ||
    typeof value.healthStatus !== "string" ||
    !isRuntimeHealthStatus(value.healthStatus)
  ) {
    return undefined;
  }

  const supportedModes = Array.isArray(value.supportedModes)
    ? value.supportedModes.filter(
        (entry): entry is MediaExecutionMode =>
          typeof entry === "string" &&
          DIRECTOR_MEDIA_EXECUTION_MODES.includes(entry as MediaExecutionMode),
      )
    : [];
  const inputModalities = toArtifactKindArray(value.inputModalities);
  const outputArtifactTypes = toMediaOutputArtifactKindArray(value.outputArtifactTypes);
  const supportedAspectRatios = toStringArray(value.supportedAspectRatios);
  const supportedResolutions = toStringArray(value.supportedResolutions);
  const costClass = toCostClass(value.costClass);
  const latencyClass = toLatencyClass(value.latencyClass);
  const safetyTier = toSafetyTier(value.safetyTier);

  if (
    supportedModes.length === 0 ||
    inputModalities === undefined ||
    outputArtifactTypes === undefined
  ) {
    return undefined;
  }

  return {
    adapterId: value.adapterId,
    adapterKind: "media",
    provider: value.provider,
    ...(typeof value.modelFamily === "string" ? { modelFamily: value.modelFamily } : {}),
    ...(typeof value.modelVersion === "string" ? { modelVersion: value.modelVersion } : {}),
    ...(typeof value.capabilityVersion === "string"
      ? { capabilityVersion: value.capabilityVersion }
      : {}),
    supportedModes,
    inputModalities,
    outputArtifactTypes,
    supportsAsync: value.supportsAsync,
    ...(typeof value.supportsWebhook === "boolean"
      ? { supportsWebhook: value.supportsWebhook }
      : {}),
    ...(typeof value.maxDurationSec === "number" ? { maxDurationSec: value.maxDurationSec } : {}),
    ...(supportedAspectRatios === undefined ? {} : { supportedAspectRatios }),
    ...(supportedResolutions === undefined ? {} : { supportedResolutions }),
    ...(typeof value.supportsReferenceImage === "boolean"
      ? { supportsReferenceImage: value.supportsReferenceImage }
      : {}),
    ...(typeof value.supportsMultiImage === "boolean"
      ? { supportsMultiImage: value.supportsMultiImage }
      : {}),
    ...(typeof value.supportsAudioConditioning === "boolean"
      ? { supportsAudioConditioning: value.supportsAudioConditioning }
      : {}),
    ...(costClass === undefined ? {} : { costClass }),
    ...(latencyClass === undefined ? {} : { latencyClass }),
    ...(safetyTier === undefined ? {} : { safetyTier }),
    ...(typeof value.regionOrDataPolicy === "string"
      ? { regionOrDataPolicy: value.regionOrDataPolicy }
      : {}),
    healthStatus: value.healthStatus,
  };
}

function parseBridge(value: unknown): DirectorAdapterBridgeDocument | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Adapter bridge must be an object.");
  }
  if (typeof value.kind !== "string" || !isAdapterBridgeKind(value.kind)) {
    throw new Error("Adapter bridge must include a supported kind.");
  }
  if (value.kind !== "http-json") {
    throw new Error(`Adapter bridge kind ${value.kind} is not supported.`);
  }
  if (typeof value.baseUrl !== "string" || value.baseUrl.trim().length === 0) {
    throw new Error("HTTP bridge must include baseUrl.");
  }
  try {
    new URL(value.baseUrl);
  } catch {
    throw new Error("HTTP bridge baseUrl must be a valid absolute URL.");
  }
  if (typeof value.submitPath !== "string" || value.submitPath.trim().length === 0) {
    throw new Error("HTTP bridge must include submitPath.");
  }

  const timeoutMs = toNumber(value.timeoutMs);
  if (timeoutMs !== undefined && timeoutMs <= 0) {
    throw new Error("HTTP bridge timeoutMs must be a positive number.");
  }
  const headers = toStringRecord(value.headers);
  if (value.headers !== undefined && headers === undefined) {
    throw new Error("HTTP bridge headers must be a string record.");
  }

  return {
    kind: "http-json",
    baseUrl: value.baseUrl,
    submitPath: value.submitPath,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(typeof value.authEnvVar === "string" ? { authEnvVar: value.authEnvVar } : {}),
    ...(headers === undefined ? {} : { headers }),
  };
}

function parseManifest(value: unknown): DirectorAdapterManifest & {
  readonly bridge?: DirectorAdapterBridgeDocument;
} {
  if (!isRecord(value)) {
    throw new Error("Adapter manifest must be an object.");
  }
  if (typeof value.adapterId !== "string" || value.adapterId.trim().length === 0) {
    throw new Error("Adapter manifest must include adapterId.");
  }
  if (typeof value.adapterKind !== "string" || !isAdapterKind(value.adapterKind)) {
    throw new Error("Adapter manifest must include a valid adapterKind.");
  }
  if (typeof value.provider !== "string" || value.provider.trim().length === 0) {
    throw new Error("Adapter manifest must include provider.");
  }
  if (typeof value.healthStatus !== "string" || !isRuntimeHealthStatus(value.healthStatus)) {
    throw new Error("Adapter manifest must include a valid healthStatus.");
  }
  if (typeof value.dryRunSupported !== "boolean") {
    throw new Error("Adapter manifest must include dryRunSupported.");
  }
  if (typeof value.mockOnly !== "boolean") {
    throw new Error("Adapter manifest must include mockOnly.");
  }
  if (!Array.isArray(value.supportedActionClasses)) {
    throw new Error("Adapter manifest must include supportedActionClasses.");
  }

  const supportedActionClasses = value.supportedActionClasses.filter(
    (entry): entry is ActionClass => typeof entry === "string" && isActionClass(entry),
  );
  if (supportedActionClasses.length !== value.supportedActionClasses.length) {
    throw new Error("Adapter manifest contains unsupported action classes.");
  }

  const enabled = toBoolean(value.enabled);
  const availableProfiles = toProfileRefArray(value.availableProfiles);
  const mediaCapability = toMediaCapabilityProfile(value.mediaCapability);
  const notes = toStringArray(value.notes);
  const priority = toNumber(value.priority);
  const bridge = parseBridge(value.bridge);
  const riskLevel = toAdapterRiskLevel(value.riskLevel);
  const approvalMode = toDirectorApprovalMode(value.approvalMode);
  const permissionScopes = toStringArray(value.permissionScopes);
  const dataRetentionPolicy =
    typeof value.dataRetentionPolicy === "string" ? value.dataRetentionPolicy : undefined;
  const rateLimitPolicy =
    typeof value.rateLimitPolicy === "string" ? value.rateLimitPolicy : undefined;
  const budgetPolicy = typeof value.budgetPolicy === "string" ? value.budgetPolicy : undefined;

  assertRealBridgePolicy({
    adapterId: value.adapterId,
    mockOnly: value.mockOnly,
    ...(riskLevel === undefined ? {} : { riskLevel }),
    ...(approvalMode === undefined ? {} : { approvalMode }),
    ...(permissionScopes === undefined ? {} : { permissionScopes }),
    ...(dataRetentionPolicy === undefined ? {} : { dataRetentionPolicy }),
    ...(rateLimitPolicy === undefined ? {} : { rateLimitPolicy }),
    ...(budgetPolicy === undefined ? {} : { budgetPolicy }),
    supportedActionClasses,
    ...(bridge === undefined ? {} : { bridge }),
  });

  return {
    adapterId: value.adapterId,
    adapterKind: value.adapterKind,
    provider: value.provider,
    ...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
    ...(typeof value.bindingId === "string" ? { bindingId: value.bindingId } : {}),
    ...(enabled === undefined ? {} : { enabled }),
    healthStatus: value.healthStatus,
    dryRunSupported: value.dryRunSupported,
    mockOnly: value.mockOnly,
    ...(riskLevel === undefined ? {} : { riskLevel }),
    ...(approvalMode === undefined ? {} : { approvalMode }),
    ...(permissionScopes === undefined ? {} : { permissionScopes }),
    ...(dataRetentionPolicy === undefined ? {} : { dataRetentionPolicy }),
    ...(rateLimitPolicy === undefined ? {} : { rateLimitPolicy }),
    ...(budgetPolicy === undefined ? {} : { budgetPolicy }),
    supportedActionClasses,
    ...(availableProfiles === undefined ? {} : { availableProfiles }),
    ...(mediaCapability === undefined ? {} : { mediaCapability }),
    ...(notes === undefined ? {} : { notes }),
    ...(priority === undefined ? {} : { priority }),
    ...(bridge === undefined ? {} : { bridge }),
  };
}

function isManifestDocument(value: unknown): value is DirectorAdapterManifestDocument {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === DIRECTOR_ADAPTER_MANIFEST_DOCUMENT_SCHEMA_VERSION &&
    typeof value.version === "number" &&
    typeof value.capturedAt === "string" &&
    typeof value.source === "string"
  );
}

function parseManifestDocument(
  value: unknown,
  options: {
    readonly now: string;
    readonly source: string;
    readonly previousVersion?: number;
  },
): DirectorAdapterManifestDocument {
  const manifest = parseManifest(value);

  if (isManifestDocument(value)) {
    return {
      ...manifest,
      schemaVersion: DIRECTOR_ADAPTER_MANIFEST_DOCUMENT_SCHEMA_VERSION,
      version:
        Number.isInteger(value.version) && value.version > 0
          ? value.version
          : (options.previousVersion ?? 0) + 1,
      capturedAt: value.capturedAt,
      source: value.source,
    };
  }

  return {
    ...manifest,
    schemaVersion: DIRECTOR_ADAPTER_MANIFEST_DOCUMENT_SCHEMA_VERSION,
    version: (options.previousVersion ?? 0) + 1,
    capturedAt: options.now,
    source: options.source,
  };
}

function toIndexEntry(
  rootPath: string,
  document: DirectorAdapterManifestDocument,
): DirectorAdapterRegistryIndexEntry {
  return {
    adapterId: document.adapterId,
    adapterKind: document.adapterKind,
    provider: document.provider,
    ...(document.bindingId === undefined ? {} : { bindingId: document.bindingId }),
    ...(document.enabled === undefined ? {} : { enabled: document.enabled }),
    healthStatus: document.healthStatus,
    capturedAt: document.capturedAt,
    version: document.version,
    manifestPath: manifestPath(rootPath, document.adapterId),
  };
}

function compareIndexEntries(
  left: DirectorAdapterRegistryIndexEntry,
  right: DirectorAdapterRegistryIndexEntry,
): number {
  return (
    right.capturedAt.localeCompare(left.capturedAt) || left.adapterId.localeCompare(right.adapterId)
  );
}

function parseIndexDocument(value: unknown): DirectorAdapterRegistryIndexDocument {
  if (!isRecord(value)) {
    throw new Error("Adapter registry index must be an object.");
  }
  if (value.schemaVersion !== DIRECTOR_ADAPTER_REGISTRY_INDEX_SCHEMA_VERSION) {
    throw new Error("Adapter registry index schema version is invalid.");
  }
  if (!Array.isArray(value.entries)) {
    throw new Error("Adapter registry index entries must be an array.");
  }

  const entries = value.entries
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      if (
        typeof entry.adapterId !== "string" ||
        typeof entry.adapterKind !== "string" ||
        !isAdapterKind(entry.adapterKind) ||
        typeof entry.provider !== "string" ||
        typeof entry.healthStatus !== "string" ||
        !isRuntimeHealthStatus(entry.healthStatus) ||
        typeof entry.capturedAt !== "string" ||
        typeof entry.version !== "number" ||
        typeof entry.manifestPath !== "string"
      ) {
        return null;
      }
      return {
        adapterId: entry.adapterId,
        adapterKind: entry.adapterKind,
        provider: entry.provider,
        ...(typeof entry.bindingId === "string" ? { bindingId: entry.bindingId } : {}),
        ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
        healthStatus: entry.healthStatus,
        capturedAt: entry.capturedAt,
        version: entry.version,
        manifestPath: entry.manifestPath,
      } satisfies DirectorAdapterRegistryIndexEntry;
    })
    .filter((entry): entry is DirectorAdapterRegistryIndexEntry => entry !== null);

  return {
    schemaVersion: DIRECTOR_ADAPTER_REGISTRY_INDEX_SCHEMA_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    entries,
  };
}

function sanitizeAdapterId(adapterId: string): string {
  return encodeURIComponent(adapterId);
}

function manifestsRoot(rootPath: string): string {
  return join(rootPath, "manifests");
}

function manifestPath(rootPath: string, adapterId: string): string {
  return join(manifestsRoot(rootPath), `${sanitizeAdapterId(adapterId)}.json`);
}

function indexPath(rootPath: string): string {
  return join(rootPath, "index.json");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export function loadDirectorAdapterRegistry(rootPath: string): LoadDirectorAdapterRegistryResult {
  if (!existsSync(indexPath(rootPath))) {
    return {
      documents: [],
      notes: ["Adapter registry index not found; using built-in adapters only."],
      issues: [],
    };
  }

  try {
    const index = parseIndexDocument(
      JSON.parse(readFileSync(indexPath(rootPath), "utf8")) as unknown,
    );
    const documents: DirectorAdapterManifestDocument[] = [];
    const issues: string[] = [];

    for (const entry of index.entries) {
      try {
        const parsed = parseManifestDocument(
          JSON.parse(readFileSync(entry.manifestPath, "utf8")) as unknown,
          {
            now: entry.capturedAt,
            source: "registry-load",
            previousVersion: entry.version - 1,
          },
        );
        documents.push(parsed);
      } catch (error) {
        issues.push(`Failed to load adapter ${entry.adapterId}: ${toErrorMessage(error)}.`);
      }
    }

    return {
      documents,
      notes:
        documents.length > 0
          ? [`Loaded ${documents.length} persisted adapter manifest(s).`]
          : ["Adapter registry index was present but no valid manifests were loaded."],
      issues,
    };
  } catch (error) {
    return {
      documents: [],
      notes: ["Adapter registry could not be parsed; falling back to built-in adapters."],
      issues: [toErrorMessage(error)],
    };
  }
}

export class FileSystemDirectorAdapterRegistryStore {
  private readonly clock;

  public constructor(private readonly options: FileSystemDirectorAdapterRegistryStoreOptions) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async upsertManifest(
    value: unknown,
    options: { readonly source?: string } = {},
  ): Promise<DirectorAdapterRegistryWriteResult> {
    try {
      const current =
        isRecord(value) && typeof value.adapterId === "string"
          ? await this.getManifest(value.adapterId)
          : null;
      const document = parseManifestDocument(value, {
        now: this.clock(),
        source: options.source ?? "cli.register",
        ...(current?.version === undefined ? {} : { previousVersion: current.version }),
      });

      await this.ensurePaths();
      await writeJson(manifestPath(this.options.rootPath, document.adapterId), document);

      const index = await this.loadIndex({ allowMissing: true });
      const nextEntries = new Map(index.entries.map((entry) => [entry.adapterId, entry]));
      nextEntries.set(document.adapterId, toIndexEntry(this.options.rootPath, document));
      await writeJson(indexPath(this.options.rootPath), {
        schemaVersion: DIRECTOR_ADAPTER_REGISTRY_INDEX_SCHEMA_VERSION,
        updatedAt: this.clock(),
        entries: [...nextEntries.values()].sort(compareIndexEntries),
      } satisfies DirectorAdapterRegistryIndexDocument);

      return {
        status: "ok",
        adapterId: document.adapterId,
        version: document.version,
        notes: [`Stored adapter manifest ${document.adapterId}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        adapterId:
          isRecord(value) && typeof value.adapterId === "string" ? value.adapterId : "unknown",
        version: 0,
        notes: [`Adapter registry write degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  public async getManifest(adapterId: string): Promise<DirectorAdapterManifestDocument | null> {
    try {
      const parsed = JSON.parse(
        await readFile(manifestPath(this.options.rootPath, adapterId), "utf8"),
      ) as unknown;
      return parseManifestDocument(parsed, {
        now: this.clock(),
        source: "registry-read",
      });
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  public async listManifests(): Promise<readonly DirectorAdapterManifestDocument[]> {
    const index = await this.loadIndex({ allowMissing: true });
    const documents = await Promise.all(
      index.entries.map((entry) => this.getManifest(entry.adapterId)),
    );
    return documents.filter(
      (document): document is DirectorAdapterManifestDocument => document !== null,
    );
  }

  public async getStatus(): Promise<{
    readonly status: "ok" | "degraded";
    readonly manifestCount: number;
    readonly lastCapturedAt?: string;
    readonly notes: readonly string[];
  }> {
    try {
      const index = await this.loadIndex({ allowMissing: true });
      return {
        status: "ok",
        manifestCount: index.entries.length,
        ...(index.entries[0] === undefined ? {} : { lastCapturedAt: index.entries[0].capturedAt }),
        notes:
          index.entries.length > 0
            ? [`${index.entries.length} adapter manifest(s) stored.`]
            : ["No adapter manifests stored yet."],
      };
    } catch (error) {
      return {
        status: "degraded",
        manifestCount: 0,
        notes: [`Adapter registry status degraded: ${toErrorMessage(error)}.`],
      };
    }
  }

  private async ensurePaths(): Promise<void> {
    await mkdir(manifestsRoot(this.options.rootPath), { recursive: true });
  }

  private async loadIndex(options: {
    readonly allowMissing: boolean;
  }): Promise<DirectorAdapterRegistryIndexDocument> {
    try {
      return parseIndexDocument(
        JSON.parse(await readFile(indexPath(this.options.rootPath), "utf8")) as unknown,
      );
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (options.allowMissing && errno.code === "ENOENT") {
        return {
          schemaVersion: DIRECTOR_ADAPTER_REGISTRY_INDEX_SCHEMA_VERSION,
          updatedAt: this.clock(),
          entries: [],
        };
      }
      throw error;
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
