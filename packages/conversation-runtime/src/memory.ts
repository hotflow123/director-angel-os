export interface ConversationRuntimeMemoryProviderLifecycle {
  readonly name: string;
  readonly available: boolean;
  readonly supportsToolCalls?: boolean;
  readonly supportsPrefetch?: boolean;
  readonly supportsSyncTurn?: boolean;
  readonly supportsPreCompress?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemoryProviderHook {
  readonly hook:
    | "initialize"
    | "system-prompt-block"
    | "prefetch"
    | "queue-prefetch"
    | "sync-turn"
    | "tool-schemas"
    | "tool-call"
    | "turn-start"
    | "session-end"
    | "session-switch"
    | "pre-compress"
    | "memory-write"
    | "delegation"
    | "shutdown";
  readonly providerName: string;
  readonly status: "pending" | "completed" | "failed" | "skipped";
  readonly summary?: string;
  readonly occurredAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeMemorySignal {
  readonly id: string;
  readonly source:
    | "user-memory"
    | "project-memory"
    | "session-search"
    | "experience"
    | (string & {});
  readonly status: "hit" | "miss" | "degraded" | "candidate";
  readonly title?: string;
  readonly summary?: string;
  readonly score?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSessionSearchQuery {
  readonly query: string;
  readonly sessionKey?: string;
  readonly maxHits?: number;
  readonly maxChars?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSessionSearchResult {
  readonly query: ConversationRuntimeSessionSearchQuery;
  readonly hits: readonly ConversationRuntimeMemorySignal[];
  readonly degradedReason?: string;
}

export interface ConversationRuntimeWorkingMemoryRecallBlockLike {
  readonly blockId: string;
  readonly source: "working-memory" | (string & {});
  readonly scope: Readonly<Record<string, unknown>>;
  readonly query?: string;
  readonly items: readonly ConversationRuntimeWorkingMemoryRecallItemLike[];
  readonly degraded?: ConversationRuntimeWorkingMemoryRecallDegradeLike;
}

export interface ConversationRuntimeWorkingMemoryRecallItemLike {
  readonly id: string;
  readonly layer: "layer0" | "layer1" | (string & {});
  readonly content: string;
  readonly score: number;
  readonly updatedAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeWorkingMemoryRecallDegradeLike {
  readonly reason: string;
  readonly message?: string;
}

export interface ConversationRuntimeSessionArchiveSearchResultLike {
  readonly totalHits?: number;
  readonly hits: readonly ConversationRuntimeSessionArchiveSearchHitLike[];
}

export interface ConversationRuntimeSessionArchiveSearchHitLike {
  readonly session: {
    readonly sessionId: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly entry?: {
    readonly seq: number;
    readonly eventType: string;
    readonly turnId?: string | null;
    readonly createdAtMs?: number;
  } | null;
  readonly source: string;
  readonly score?: number;
  readonly matchedText?: string;
  readonly matchedTerms?: readonly string[];
}

export function mapSessionSearchResultToRuntimeMemoryResult(
  archiveResult: ConversationRuntimeSessionArchiveSearchResultLike,
  query: ConversationRuntimeSessionSearchQuery,
): ConversationRuntimeSessionSearchResult {
  if (archiveResult.hits.length === 0) {
    return {
      query,
      hits: [
        {
          id: "session-search:miss",
          source: "session-search",
          status: "miss",
          summary: "No prior session context matched the query.",
          metadata: {
            totalHits: archiveResult.totalHits ?? 0,
          },
        },
      ],
    };
  }

  const maxHits = query.maxHits ?? archiveResult.hits.length;
  const maxChars = query.maxChars ?? 500;
  return {
    query,
    hits: archiveResult.hits.slice(0, maxHits).map((hit, index) =>
      mapSessionArchiveSearchHitToMemorySignal(hit, {
        index,
        maxChars,
        totalHits: archiveResult.totalHits ?? archiveResult.hits.length,
      }),
    ),
  };
}

export function mapWorkingMemoryRecallBlockToRuntimeMemoryResult(
  recallBlock: ConversationRuntimeWorkingMemoryRecallBlockLike,
  query: ConversationRuntimeSessionSearchQuery,
): ConversationRuntimeSessionSearchResult {
  const maxHits = query.maxHits ?? recallBlock.items.length;
  const maxChars = query.maxChars ?? 500;
  const hits = recallBlock.items.slice(0, maxHits).map((item) =>
    mapWorkingMemoryRecallItemToMemorySignal(item, recallBlock, {
      maxChars,
    }),
  );

  if (hits.length > 0) {
    return {
      query,
      hits,
      ...(recallBlock.degraded === undefined
        ? {}
        : { degradedReason: renderWorkingMemoryDegradeReason(recallBlock.degraded) }),
    };
  }

  if (recallBlock.degraded !== undefined) {
    return {
      query,
      hits: [mapWorkingMemoryRecallDegradeToMemorySignal(recallBlock)],
      degradedReason: renderWorkingMemoryDegradeReason(recallBlock.degraded),
    };
  }

  return {
    query,
    hits: [
      {
        id: `working-memory:miss:${recallBlock.blockId}`,
        source: "working-memory",
        status: "miss",
        summary: "No working-memory context matched the query.",
        metadata: {
          blockId: recallBlock.blockId,
          scope: { ...recallBlock.scope },
          query: recallBlock.query ?? query.query,
        },
      },
    ],
  };
}

function mapSessionArchiveSearchHitToMemorySignal(
  hit: ConversationRuntimeSessionArchiveSearchHitLike,
  options: {
    readonly index: number;
    readonly maxChars: number;
    readonly totalHits: number;
  },
): ConversationRuntimeMemorySignal {
  const entrySeq = hit.entry?.seq;
  const idSuffix = entrySeq === undefined ? `session:${options.index}` : String(entrySeq);
  const title = readMetadataTitle(hit.session.metadata) ?? hit.session.sessionId;
  return {
    id: `session-search:${hit.session.sessionId}:${idSuffix}`,
    source: "session-search",
    status: "hit",
    title,
    summary: truncateSummary(hit.matchedText ?? "", options.maxChars),
    ...(hit.score === undefined ? {} : { score: hit.score }),
    metadata: {
      sessionId: hit.session.sessionId,
      source: hit.source,
      totalHits: options.totalHits,
      ...(hit.entry?.eventType === undefined ? {} : { eventType: hit.entry.eventType }),
      ...(hit.entry?.turnId === undefined || hit.entry.turnId === null
        ? {}
        : { turnId: hit.entry.turnId }),
      ...(entrySeq === undefined ? {} : { seq: entrySeq }),
      ...(hit.entry?.createdAtMs === undefined ? {} : { createdAtMs: hit.entry.createdAtMs }),
      matchedTerms: [...(hit.matchedTerms ?? [])],
    },
  };
}

function mapWorkingMemoryRecallItemToMemorySignal(
  item: ConversationRuntimeWorkingMemoryRecallItemLike,
  recallBlock: ConversationRuntimeWorkingMemoryRecallBlockLike,
  options: {
    readonly maxChars: number;
  },
): ConversationRuntimeMemorySignal {
  const source = item.id.startsWith("mempalace:") ? "mempalace" : "working-memory";
  const verbatim = normalizeMemoryVerbatimText(
    readMemoryMetadataString(item.metadata, "verbatimExcerpt") ??
      readMemoryMetadataString(item.metadata, "verbatim"),
  );
  const summarySource = verbatim ?? item.content;
  const verbatimExcerpt =
    verbatim === undefined ? undefined : truncateSummary(verbatim, options.maxChars);
  return {
    id: `working-memory:${item.id}`,
    source,
    status: "hit",
    title: item.id,
    summary: truncateSummary(summarySource, options.maxChars),
    score: item.score,
    metadata: {
      ...(item.metadata ?? {}),
      ...(verbatimExcerpt === undefined
        ? {}
        : {
            retrievalMode: "verbatim-first",
            verbatimExcerpt,
          }),
      blockId: recallBlock.blockId,
      layer: item.layer,
      updatedAt: item.updatedAt,
      query: recallBlock.query,
      scope: { ...recallBlock.scope },
    },
  };
}

function mapWorkingMemoryRecallDegradeToMemorySignal(
  recallBlock: ConversationRuntimeWorkingMemoryRecallBlockLike,
): ConversationRuntimeMemorySignal {
  const degraded = recallBlock.degraded;
  return {
    id: `working-memory:degraded:${recallBlock.blockId}`,
    source: "working-memory",
    status: "degraded",
    summary: degraded?.message ?? degraded?.reason ?? "Working-memory recall degraded.",
    metadata: {
      blockId: recallBlock.blockId,
      reason: degraded?.reason ?? "unknown",
      scope: { ...recallBlock.scope },
    },
  };
}

function renderWorkingMemoryDegradeReason(
  degraded: ConversationRuntimeWorkingMemoryRecallDegradeLike,
): string {
  return degraded.message === undefined
    ? degraded.reason
    : `${degraded.reason}: ${degraded.message}`;
}

function readMetadataTitle(metadata: Readonly<Record<string, unknown>> | undefined): string | null {
  const title = metadata?.title;
  return typeof title === "string" && title.trim().length > 0 ? title : null;
}

function readMemoryMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeMemoryVerbatimText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? undefined : normalized;
}

function truncateSummary(value: string, maxChars: number): string {
  const normalizedMaxChars = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 500;
  if (value.length <= normalizedMaxChars) {
    return value;
  }
  return `${value.slice(0, normalizedMaxChars).trim()}...`;
}
