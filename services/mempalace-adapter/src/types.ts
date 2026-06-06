import type { AgentOsSandboxCommandExecutionEvidence } from "@hotflow/agent-os-sandbox";

export interface RecallBlockDegrade {
  readonly reason: string;
  readonly message?: string;
}

export const DEFAULT_MEMPALACE_MODE: MempalaceAdapterMode = "disabled";
export const DEFAULT_MEMPALACE_TIMEOUT_MS = 2_000;
export const DEFAULT_MEMPALACE_RESULTS_LIMIT = 3;
export const MEMPALACE_RECALL_DEGRADE_REASON = "mempalace-recall-degraded";
export const MEMPALACE_MISCONFIGURED_REASON = "mempalace-misconfigured";
export const MEMPALACE_UNREACHABLE_REASON = "mempalace-unreachable";
export const MEMPALACE_SOURCE_READ_DEGRADE_REASON = "mempalace-source-read-degraded";
export const MEMPALACE_SOURCE_READ_INVALID_INPUT_REASON = "mempalace-source-read-invalid-input";
export const MEMPALACE_DRAWER_INDEX_DEGRADE_REASON = "mempalace-drawer-index-degraded";
export const MEMPALACE_DRAWER_POINTER_INDEX_SCHEMA_VERSION =
  "hotflow.mempalace.drawer-pointer-index.v1";

export type MempalaceAdapterMode = "disabled" | "optional" | "primary";

export interface MempalaceAdapterUserConfig {
  readonly mode?: MempalaceAdapterMode;
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly workingDirectory?: string;
  readonly palacePath?: string;
  readonly wing?: string;
  readonly room?: string;
  readonly timeoutMs?: number;
  readonly nResults?: number;
}

export interface LoadMempalaceAdapterConfigInput {
  readonly env?: NodeJS.ProcessEnv;
  readonly overrides?: MempalaceAdapterUserConfig;
}

export interface MempalaceAdapterConfig {
  readonly mode: MempalaceAdapterMode;
  readonly command?: string;
  readonly commandArgs: readonly string[];
  readonly workingDirectory?: string;
  readonly palacePath?: string;
  readonly wing?: string;
  readonly room?: string;
  readonly timeoutMs: number;
  readonly nResults: number;
  readonly configured: boolean;
  readonly degradeOnFailure: true;
  readonly issues: readonly string[];
}

export type MempalaceCommandAction =
  | "health"
  | "search"
  | "readDrawer"
  | "getDrawer"
  | "listDrawers";

export interface MempalaceCommandRequestBase {
  readonly action: MempalaceCommandAction;
  readonly palacePath: string;
  readonly wing?: string;
  readonly room?: string;
}

export interface MempalaceHealthCommandRequest extends MempalaceCommandRequestBase {
  readonly action: "health";
}

export interface MempalaceSearchCommandRequest extends MempalaceCommandRequestBase {
  readonly action: "search";
  readonly query: string;
  readonly nResults: number;
}

export interface MempalaceReadDrawerCommandRequest extends MempalaceCommandRequestBase {
  readonly action: "readDrawer";
  readonly sourceFile: string;
  readonly drawerIndex: number;
}

export interface MempalaceGetDrawerCommandRequest extends MempalaceCommandRequestBase {
  readonly action: "getDrawer";
  readonly drawerId: string;
}

export interface MempalaceListDrawersCommandRequest extends MempalaceCommandRequestBase {
  readonly action: "listDrawers";
  readonly limit: number;
  readonly offset: number;
}

export type MempalaceCommandRequest =
  | MempalaceHealthCommandRequest
  | MempalaceSearchCommandRequest
  | MempalaceReadDrawerCommandRequest
  | MempalaceGetDrawerCommandRequest
  | MempalaceListDrawersCommandRequest;

export interface CommandExecutionResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly error?: Error;
  readonly agentOsSandboxCommandExecution?: AgentOsSandboxCommandExecutionEvidence;
}

export interface MempalaceCommandRunContext {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly inputJson: string;
}

export type MempalaceCommandExecutor = (
  context: MempalaceCommandRunContext,
) => CommandExecutionResult;

export interface MempalaceCommandResult {
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly degraded?: RecallBlockDegrade;
  readonly diagnostics: Readonly<Record<string, unknown>>;
}

export interface ProbeMempalaceHealthOptions {
  readonly config?: MempalaceAdapterConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: MempalaceCommandExecutor;
}

export interface MempalaceHealthProbeResult {
  readonly status: "pass" | "warn";
  readonly summary: string;
  readonly mode: MempalaceAdapterMode;
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  readonly degraded?: RecallBlockDegrade;
}

export interface MempalaceSearchRawItem {
  readonly id?: unknown;
  readonly memory_id?: unknown;
  readonly content?: unknown;
  readonly text?: unknown;
  readonly memory?: unknown;
  readonly verbatim?: unknown;
  readonly score?: unknown;
  readonly similarity?: unknown;
  readonly updatedAt?: unknown;
  readonly timestamp?: unknown;
  readonly wing?: unknown;
  readonly room?: unknown;
  readonly source_file?: unknown;
  readonly matched_via?: unknown;
  readonly bm25_score?: unknown;
  readonly distance?: unknown;
  readonly effective_distance?: unknown;
  readonly closet_boost?: unknown;
  readonly drawer_index?: unknown;
  readonly total_drawers?: unknown;
  readonly memory_layer?: unknown;
  readonly layer?: unknown;
  readonly metadata?: unknown;
}

export interface MempalaceRecallItem {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly updatedAt: number;
  readonly wing?: string;
  readonly room?: string;
  /**
   * Retrieval evidence from MemPalace. MemPalace drawer search is verbatim-first;
   * keep raw evidence in metadata so downstream prompt builders can still choose
   * a bounded summary without losing benchmark/provenance fields.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type MempalaceRecallOutcome = "disabled" | "ok" | "degraded";

export interface SearchMempalaceRecallOptions {
  readonly config?: MempalaceAdapterConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly query: string;
  readonly nResults?: number;
  readonly wing?: string;
  readonly room?: string;
  readonly runCommand?: MempalaceCommandExecutor;
  readonly now?: () => number;
}

export interface MempalaceRecallResult {
  readonly outcome: MempalaceRecallOutcome;
  readonly items: readonly MempalaceRecallItem[];
  readonly degraded?: RecallBlockDegrade;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ReadMempalaceDrawerSourceOptions {
  readonly config?: MempalaceAdapterConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly drawerId?: string | null;
  readonly sourceFile?: string | null;
  readonly drawerIndex?: number | null;
  readonly wing?: string;
  readonly room?: string;
  readonly runCommand?: MempalaceCommandExecutor;
}

export interface MempalaceDrawerSource {
  readonly drawerId?: string;
  readonly sourceFile: string;
  readonly drawerIndex: number;
  readonly totalDrawers?: number;
  readonly memoryLayer?: "L0" | "L1" | "L2" | "L3";
  readonly layerLabel?: string;
  readonly wing?: string;
  readonly room?: string;
}

export interface MempalaceDrawerSourceReadResult {
  readonly outcome: "ok" | "degraded" | "disabled";
  readonly content?: string;
  readonly source?: MempalaceDrawerSource;
  readonly degraded?: RecallBlockDegrade;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface MempalaceDrawerPointer {
  readonly drawerId: string;
  readonly sourceFile?: string;
  readonly drawerIndex?: number;
  readonly totalDrawers?: number;
  readonly memoryLayer?: "L0" | "L1" | "L2" | "L3";
  readonly layerLabel?: string;
  readonly wing?: string;
  readonly room?: string;
}

export interface IndexMempalaceDrawerPointersOptions {
  readonly config?: MempalaceAdapterConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly wing?: string;
  readonly room?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly runCommand?: MempalaceCommandExecutor;
}

export interface MempalaceDrawerPointerIndexResult {
  readonly outcome: "ok" | "degraded" | "disabled";
  readonly pointers: readonly MempalaceDrawerPointer[];
  readonly degraded?: RecallBlockDegrade;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface MempalaceDrawerPointerIndexScanResult extends MempalaceDrawerPointerIndexResult {
  readonly pagesScanned: number;
  readonly hasMore: boolean;
}

export interface MempalaceDrawerPointerIndexSnapshot {
  readonly schemaVersion: typeof MEMPALACE_DRAWER_POINTER_INDEX_SCHEMA_VERSION;
  readonly refreshedAtMs: number;
  readonly pointers: readonly MempalaceDrawerPointer[];
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RefreshMempalaceDrawerPointerIndexOptions
  extends IndexMempalaceDrawerPointersOptions {
  readonly indexPath: string;
  readonly now?: () => number;
}

export interface MempalaceDrawerPointerIndexRefreshResult
  extends MempalaceDrawerPointerIndexResult {
  readonly indexPath?: string;
  readonly refreshedAtMs?: number;
  readonly pagesScanned?: number;
  readonly hasMore?: boolean;
}

export interface LoadMempalaceDrawerPointerIndexOptions {
  readonly indexPath: string;
}

export interface MempalaceDrawerPointerIndexLoadResult {
  readonly outcome: "ok" | "degraded";
  readonly pointers: readonly MempalaceDrawerPointer[];
  readonly refreshedAtMs?: number;
  readonly degraded?: RecallBlockDegrade;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface FindMempalaceDrawerPointerInIndexOptions
  extends LoadMempalaceDrawerPointerIndexOptions {
  readonly drawerId?: string | null;
  readonly sourceFile?: string | null;
  readonly drawerIndex?: number | null;
}

export interface MempalaceDrawerPointerFindResult extends MempalaceDrawerPointerIndexLoadResult {
  readonly pointer?: MempalaceDrawerPointer;
}
