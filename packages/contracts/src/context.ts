export type ContextSectionOwner =
  | "system"
  | "session"
  | "memory"
  | "tool"
  | "task"
  | "plugin"
  | "mcp"
  | "operator";

export type ContextCacheBucket = "static" | "session" | "dynamic";

export type ContextTrustLevel = "trusted" | "untrusted";

export interface ContextSection {
  readonly id: string;
  readonly owner: ContextSectionOwner;
  readonly cacheBucket: ContextCacheBucket;
  readonly content: string;
  readonly priority: number;
  readonly trustLevel: ContextTrustLevel;
  readonly source?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RecallItem {
  readonly id: string;
  readonly content: string;
  readonly score?: number;
  readonly source?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type RecallStrategy = "recency" | "lexical" | "semantic" | "hybrid";

export type RecallScope = "session" | "task" | "workspace" | "provider";

export interface RecallBlock {
  readonly blockId: string;
  readonly strategy: RecallStrategy;
  readonly scope: RecallScope;
  readonly query?: string;
  readonly items: readonly RecallItem[];
  readonly degraded?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ContextCacheAction = "clear" | "compact" | "resume" | "reset";

export interface ContextCacheInvalidation {
  readonly action: ContextCacheAction;
  readonly reason: string;
  readonly sectionIds?: readonly string[];
}
