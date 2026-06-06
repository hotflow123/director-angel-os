export type MemoryLayerName = "layer0" | "layer1";

export interface MemoryScope {
  agentId?: string;
  sessionId?: string;
  threadId?: string;
  namespace?: string;
}

export interface MemoryUpsertInput {
  id?: string;
  content: string;
  scope: MemoryScope;
  tags?: string[];
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

export interface MemoryEntry {
  id: string;
  layer: MemoryLayerName;
  content: string;
  scope: MemoryScope;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryHit {
  entry: MemoryEntry;
  score: number;
}

export interface RetrieveOptions {
  scope: MemoryScope;
  query?: string;
  limit?: number;
}

export interface MemoryLayerStore {
  upsert(input: MemoryUpsertInput): MemoryEntry;
  remove(id: string): boolean;
  get(id: string): MemoryEntry | undefined;
  listByScope(scope: MemoryScope): MemoryEntry[];
  retrieve(options: RetrieveOptions): MemoryHit[];
}

export interface ScopedRetrieveOptions extends RetrieveOptions {
  layers?: MemoryLayerName[];
}

export interface MemoryRecallOptions extends ScopedRetrieveOptions {
  minScore?: number;
}

export interface WorkingMemoryRecallBlockItem {
  id: string;
  layer: MemoryLayerName;
  content: string;
  score: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface RecallBlockDegrade {
  reason: string;
  message?: string;
}

export interface WorkingMemoryRecallBlock {
  blockId: string;
  source: "working-memory";
  scope: MemoryScope;
  query?: string;
  items: WorkingMemoryRecallBlockItem[];
  degraded?: RecallBlockDegrade;
}

export interface WorkingMemoryRecallOptions extends MemoryRecallOptions {
  blockId?: string;
}
