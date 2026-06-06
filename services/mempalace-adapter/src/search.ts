import { runMempalaceCommandSync } from "./command-client.js";
import { loadMempalaceAdapterConfig } from "./config.js";
import { mapMempalaceSearchItems } from "./map-search-result.js";
import {
  MEMPALACE_MISCONFIGURED_REASON,
  MEMPALACE_RECALL_DEGRADE_REASON,
  type MempalaceRecallResult,
  type MempalaceSearchRawItem,
  type SearchMempalaceRecallOptions,
} from "./types.js";

function normalizeQuery(query: string): string {
  return query.trim();
}

function readRawItems(payload: unknown): readonly MempalaceSearchRawItem[] {
  if (Array.isArray(payload)) {
    return payload as readonly MempalaceSearchRawItem[];
  }
  if (payload && typeof payload === "object") {
    if ("results" in payload && Array.isArray(payload.results)) {
      return payload.results as readonly MempalaceSearchRawItem[];
    }
    if ("items" in payload && Array.isArray(payload.items)) {
      return payload.items as readonly MempalaceSearchRawItem[];
    }
  }
  return [];
}

export function searchMempalaceRecallSync(
  options: SearchMempalaceRecallOptions,
): MempalaceRecallResult {
  const config =
    options.config ??
    loadMempalaceAdapterConfig({
      ...(options.env ? { env: options.env } : {}),
    });
  const query = normalizeQuery(options.query);
  const now = options.now ?? Date.now;
  const nResults = options.nResults ?? config.nResults;

  if (config.mode === "disabled") {
    return {
      outcome: "disabled",
      items: [],
      details: {
        mode: config.mode,
        configured: false,
      },
    };
  }

  if (query.length === 0) {
    return {
      outcome: "disabled",
      items: [],
      details: {
        mode: config.mode,
        configured: config.configured,
        query: "",
      },
    };
  }

  if (!config.configured || !config.palacePath) {
    return {
      outcome: "degraded",
      items: [],
      degraded: {
        reason: MEMPALACE_MISCONFIGURED_REASON,
        message: config.issues.join(" "),
      },
      details: {
        mode: config.mode,
        configured: false,
        issues: config.issues,
      },
    };
  }

  const response = runMempalaceCommandSync(
    config,
    {
      action: "search",
      palacePath: config.palacePath,
      query,
      nResults,
      ...((options.wing ?? config.wing) ? { wing: options.wing ?? config.wing } : {}),
      ...((options.room ?? config.room) ? { room: options.room ?? config.room } : {}),
    },
    options.runCommand,
  );

  if (!response.ok) {
    return {
      outcome: "degraded",
      items: [],
      degraded: {
        reason: MEMPALACE_RECALL_DEGRADE_REASON,
        message: response.degraded?.message ?? "Mempalace recall command failed.",
      },
      details: {
        mode: config.mode,
        configured: true,
        ...response.diagnostics,
      },
    };
  }

  const mapped = [...mapMempalaceSearchItems(readRawItems(response.payload), now)]
    .sort((left, right) => right.score - left.score)
    .slice(0, nResults);

  return {
    outcome: "ok",
    items: mapped,
    details: {
      mode: config.mode,
      configured: true,
      returned: mapped.length,
      retrieval: {
        engine: "mempalace",
        mode: inferMempalaceRetrievalMode(mapped),
        query,
        requested: nResults,
        returned: mapped.length,
        ...((options.wing ?? config.wing) ? { wing: options.wing ?? config.wing } : {}),
        ...((options.room ?? config.room) ? { room: options.room ?? config.room } : {}),
      },
    },
  };
}

function inferMempalaceRetrievalMode(
  items: readonly { metadata?: Readonly<Record<string, unknown>> }[],
): string {
  if (items.some((item) => item.metadata?.matchMode === "drawer+closet")) {
    return "hybrid";
  }
  if (items.some((item) => typeof item.metadata?.bm25Score === "number")) {
    return "hybrid";
  }
  return "vector";
}
