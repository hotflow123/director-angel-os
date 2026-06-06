import { recallMemory } from "./recall.js";
import type { ScopedRetrieverDeps } from "./scoped-retrieval.js";
import type {
  MemoryHit,
  WorkingMemoryRecallBlock,
  WorkingMemoryRecallBlockItem,
  WorkingMemoryRecallOptions,
} from "./types.js";

export const WORKING_MEMORY_RECALL_BLOCK_ID = "working-memory-recall";
export const WORKING_MEMORY_RECALL_FAILURE_REASON = "working-memory-recall-failed";

function toRecallBlockItem(hit: MemoryHit): WorkingMemoryRecallBlockItem {
  return {
    id: hit.entry.id,
    layer: hit.entry.layer,
    content: hit.entry.content,
    score: hit.score,
    updatedAt: hit.entry.updatedAt,
    metadata: {
      ...hit.entry.metadata,
      source: "working-memory",
      matchMode: "lexical",
      ...(hit.score === undefined ? {} : { lexicalScore: hit.score }),
    },
  };
}

export function toWorkingMemoryRecallBlock(
  hits: readonly MemoryHit[],
  options: WorkingMemoryRecallOptions,
): WorkingMemoryRecallBlock {
  const query = options.query?.trim();
  return {
    blockId: options.blockId?.trim() || WORKING_MEMORY_RECALL_BLOCK_ID,
    source: "working-memory",
    scope: { ...options.scope },
    ...(query ? { query } : {}),
    items: hits.map((hit) => {
      const item = toRecallBlockItem(hit);
      return {
        ...item,
        metadata: {
          ...(item.metadata ?? {}),
          ...(query ? { query } : {}),
        },
      };
    }),
  };
}

export function recallWorkingMemory(
  deps: ScopedRetrieverDeps,
  options: WorkingMemoryRecallOptions,
): WorkingMemoryRecallBlock {
  try {
    const hits = recallMemory(deps, options);
    return toWorkingMemoryRecallBlock(hits, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown recall error";
    return {
      blockId: options.blockId?.trim() || WORKING_MEMORY_RECALL_BLOCK_ID,
      source: "working-memory",
      scope: { ...options.scope },
      ...(options.query?.trim() ? { query: options.query.trim() } : {}),
      items: [],
      degraded: {
        reason: WORKING_MEMORY_RECALL_FAILURE_REASON,
        message,
      },
    };
  }
}
