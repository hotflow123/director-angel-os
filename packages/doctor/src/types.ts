import type { HotflowConfig } from "@hotflow/config";
import type { SessionStore } from "@hotflow/sessions";

export type DoctorStatus = "pass" | "warn" | "fail";

export type DoctorCheckId =
  | "config.load"
  | "session.db_path"
  | "provider.registry"
  | "provider.default"
  | "session.store"
  | "memory.mempalace"
  | "director.memory.switch"
  | "director.memory.store"
  | "director.memory.recall"
  | "director.memory.ingest"
  | "director.knowledge.switch"
  | "director.knowledge.store"
  | "director.knowledge.recall"
  | "learning.proposal_store"
  | "learning.approved_snapshot"
  | "learning.reload_visibility"
  | "control_plane.bootstrap";

export interface DoctorCheckError {
  readonly code: string;
  readonly message: string;
}

export interface DoctorCheckResult {
  readonly id: DoctorCheckId;
  readonly status: DoctorStatus;
  readonly summary: string;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly durationMs: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly error?: DoctorCheckError;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly status: DoctorStatus;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly durationMs: number;
  readonly effective?: Readonly<Record<string, unknown>>;
  readonly checks: readonly DoctorCheckResult[];
}

export interface DoctorLoadConfigInput {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface DoctorResolveSessionDbPathInput {
  readonly config: HotflowConfig;
  readonly sessionDbPathOverride?: string;
}

export interface DoctorProviderDescriptor {
  readonly id: string;
  readonly source: "builtin" | "env" | "custom";
  readonly available: boolean;
  readonly reason?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface DoctorRegisterProvidersInput {
  readonly config: HotflowConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

export interface DoctorProviderRegistryResult {
  readonly providerIds: readonly string[];
  readonly providers?: readonly DoctorProviderDescriptor[];
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface DoctorOpenSessionStoreInput {
  readonly config: HotflowConfig;
  readonly sessionDbPath: string;
}

export interface DoctorBootstrapControlPlaneInput {
  readonly config: HotflowConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionStore: SessionStore;
  readonly providers: DoctorProviderRegistryResult;
}

export interface DoctorMempalaceProbeResult {
  readonly status: "pass" | "warn";
  readonly summary: string;
  readonly mode: "disabled" | "optional" | "primary";
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface DoctorLearningLaneProbeDetail {
  readonly status: DoctorStatus;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface DoctorLearningLaneProbeResult {
  readonly proposalStore: DoctorLearningLaneProbeDetail;
  readonly approvedSnapshot: DoctorLearningLaneProbeDetail;
  readonly reloadVisibility: DoctorLearningLaneProbeDetail;
}

export interface DoctorDirectorMemoryLaneProbeResult {
  readonly switchState: DoctorLearningLaneProbeDetail;
  readonly storeReadable: DoctorLearningLaneProbeDetail;
  readonly recallPreview: DoctorLearningLaneProbeDetail;
  readonly ingestClosure: DoctorLearningLaneProbeDetail;
}

export interface DoctorDirectorKnowledgeLaneProbeResult {
  readonly switchState: DoctorLearningLaneProbeDetail;
  readonly storeReadable: DoctorLearningLaneProbeDetail;
  readonly recallPreview: DoctorLearningLaneProbeDetail;
}

export type MaybePromise<T> = Promise<T> | T;

export interface RunDoctorOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sessionDbPathOverride?: string;
  readonly loadConfig?: (input: DoctorLoadConfigInput) => MaybePromise<HotflowConfig>;
  readonly resolveSessionDbPath?: (input: DoctorResolveSessionDbPathInput) => MaybePromise<string>;
  readonly registerProviders?: (
    input: DoctorRegisterProvidersInput,
  ) => MaybePromise<DoctorProviderRegistryResult>;
  readonly openSessionStore?: (input: DoctorOpenSessionStoreInput) => MaybePromise<SessionStore>;
  readonly probeMempalace?: () => MaybePromise<DoctorMempalaceProbeResult>;
  readonly bootstrapControlPlane?: (
    input: DoctorBootstrapControlPlaneInput,
  ) => MaybePromise<unknown>;
  readonly probeDirectorMemoryLane?: () => MaybePromise<DoctorDirectorMemoryLaneProbeResult>;
  readonly probeDirectorKnowledgeLane?: () => MaybePromise<DoctorDirectorKnowledgeLaneProbeResult>;
  readonly probeLearningLane?: () => MaybePromise<DoctorLearningLaneProbeResult>;
}
