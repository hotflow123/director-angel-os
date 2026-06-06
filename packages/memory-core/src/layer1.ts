import { combinedScore } from "./ranking.js";
import { matchesScope } from "./scope.js";
import type {
  MemoryEntry,
  MemoryHit,
  MemoryLayerStore,
  MemoryUpsertInput,
  RetrieveOptions,
} from "./types.js";

let layer1AutoId = 0;

function toLayer1Entry(input: MemoryUpsertInput, existing: MemoryEntry | undefined): MemoryEntry {
  const timestamp = input.timestamp ?? Date.now();
  return {
    id: input.id ?? existing?.id ?? `l1_${++layer1AutoId}`,
    layer: "layer1",
    content: input.content,
    scope: { ...input.scope },
    tags: [...(input.tags ?? existing?.tags ?? [])],
    metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

export class Layer1MemoryStore implements MemoryLayerStore {
  private readonly entries = new Map<string, MemoryEntry>();

  upsert(input: MemoryUpsertInput): MemoryEntry {
    const existing = input.id ? this.entries.get(input.id) : undefined;
    const entry = toLayer1Entry(input, existing);
    this.entries.set(entry.id, entry);
    return entry;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.get(id);
  }

  listByScope(scope: RetrieveOptions["scope"]): MemoryEntry[] {
    return [...this.entries.values()]
      .filter((entry) => matchesScope(entry.scope, scope))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  retrieve(options: RetrieveOptions): MemoryHit[] {
    const limit = Math.max(1, options.limit ?? 10);
    const now = Date.now();
    return this.listByScope(options.scope)
      .map((entry) => ({
        entry,
        score: combinedScore(entry.content, options.query, entry.updatedAt, now),
      }))
      .sort(
        (left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt,
      )
      .slice(0, limit);
  }
}
