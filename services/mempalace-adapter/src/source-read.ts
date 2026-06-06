import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { runMempalaceCommandSync } from "./command-client.js";
import { loadMempalaceAdapterConfig } from "./config.js";
import {
  type FindMempalaceDrawerPointerInIndexOptions,
  type IndexMempalaceDrawerPointersOptions,
  type LoadMempalaceDrawerPointerIndexOptions,
  MEMPALACE_DRAWER_INDEX_DEGRADE_REASON,
  MEMPALACE_DRAWER_POINTER_INDEX_SCHEMA_VERSION,
  MEMPALACE_MISCONFIGURED_REASON,
  MEMPALACE_SOURCE_READ_DEGRADE_REASON,
  MEMPALACE_SOURCE_READ_INVALID_INPUT_REASON,
  type MempalaceDrawerPointer,
  type MempalaceDrawerPointerFindResult,
  type MempalaceDrawerPointerIndexLoadResult,
  type MempalaceDrawerPointerIndexRefreshResult,
  type MempalaceDrawerPointerIndexResult,
  type MempalaceDrawerPointerIndexScanResult,
  type MempalaceDrawerPointerIndexSnapshot,
  type MempalaceDrawerSourceReadResult,
  type ReadMempalaceDrawerSourceOptions,
  type RefreshMempalaceDrawerPointerIndexOptions,
} from "./types.js";

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function readIntegerFromMetadata(
  record: Readonly<Record<string, unknown>> | undefined,
): number | undefined {
  return readInteger(record?.drawer_index) ?? readInteger(record?.chunk_index);
}

function toMempalaceMemoryLayer(value: unknown): "L0" | "L1" | "L2" | "L3" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/^LAYER/u, "L");
  return normalized === "L0" || normalized === "L1" || normalized === "L2" || normalized === "L3"
    ? normalized
    : undefined;
}

function toMempalaceLayerLabel(layer: "L0" | "L1" | "L2" | "L3"): string {
  switch (layer) {
    case "L0":
      return "L0 Identity";
    case "L1":
      return "L1 Essential Story";
    case "L2":
      return "L2 On-Demand";
    case "L3":
      return "L3 Deep Search";
  }
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readDrawerPayload(payload: unknown): Readonly<Record<string, unknown>> | undefined {
  const record = readRecord(payload);
  if (!record) {
    return undefined;
  }
  return readRecord(record.drawer) ?? record;
}

export function readMempalaceDrawerSourceSync(
  options: ReadMempalaceDrawerSourceOptions,
): MempalaceDrawerSourceReadResult {
  const config =
    options.config ??
    loadMempalaceAdapterConfig({
      ...(options.env ? { env: options.env } : {}),
    });
  const sourceFile = readNonEmptyString(options.sourceFile);
  const drawerIndex = readInteger(options.drawerIndex);
  const drawerId = readNonEmptyString(options.drawerId);

  if (config.mode === "disabled") {
    return {
      outcome: "disabled",
      details: {
        mode: config.mode,
        configured: false,
      },
    };
  }

  if (!drawerId && (!sourceFile || drawerIndex === undefined)) {
    return {
      outcome: "degraded",
      degraded: {
        reason: MEMPALACE_SOURCE_READ_INVALID_INPUT_REASON,
        message: "MemPalace source read requires drawerId or sourceFile and drawerIndex.",
      },
      details: {
        mode: config.mode,
        configured: config.configured,
      },
    };
  }

  if (!config.configured || !config.palacePath) {
    return {
      outcome: "degraded",
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
    drawerId
      ? {
          action: "getDrawer",
          palacePath: config.palacePath,
          drawerId,
          ...((options.wing ?? config.wing) ? { wing: options.wing ?? config.wing } : {}),
          ...((options.room ?? config.room) ? { room: options.room ?? config.room } : {}),
        }
      : {
          action: "readDrawer",
          palacePath: config.palacePath,
          sourceFile: sourceFile as string,
          drawerIndex: drawerIndex as number,
          ...((options.wing ?? config.wing) ? { wing: options.wing ?? config.wing } : {}),
          ...((options.room ?? config.room) ? { room: options.room ?? config.room } : {}),
        },
    options.runCommand,
  );

  if (!response.ok) {
    return {
      outcome: "degraded",
      degraded: {
        reason: MEMPALACE_SOURCE_READ_DEGRADE_REASON,
        message: response.degraded?.message ?? "Mempalace source read command failed.",
      },
      details: {
        mode: config.mode,
        configured: true,
        ...response.diagnostics,
      },
    };
  }

  const drawer = readDrawerPayload(response.payload);
  const metadata = readRecord(drawer?.metadata);
  const content =
    readNonEmptyString(drawer?.content) ??
    readNonEmptyString(drawer?.verbatim) ??
    readNonEmptyString(drawer?.text);

  if (!drawer || !content) {
    return {
      outcome: "degraded",
      degraded: {
        reason: MEMPALACE_SOURCE_READ_DEGRADE_REASON,
        message: "Mempalace source read returned no drawer content.",
      },
      details: {
        mode: config.mode,
        configured: true,
        ...response.diagnostics,
      },
    };
  }

  const resolvedDrawerId =
    readNonEmptyString(drawer.drawer_id) ?? readNonEmptyString(drawer.id) ?? drawerId;
  const resolvedSourceFile =
    readNonEmptyString(drawer.source_file) ??
    readNonEmptyString(metadata?.source_file) ??
    sourceFile ??
    resolvedDrawerId ??
    "unknown";
  const resolvedDrawerIndex =
    readInteger(drawer.drawer_index) ?? readIntegerFromMetadata(metadata) ?? drawerIndex ?? 0;
  const totalDrawers = readInteger(drawer.total_drawers) ?? readInteger(metadata?.total_drawers);
  const memoryLayer = toMempalaceMemoryLayer(
    drawer.memory_layer ?? drawer.layer ?? metadata?.memory_layer ?? metadata?.layer,
  );
  const wing = readNonEmptyString(drawer.wing) ?? options.wing ?? config.wing;
  const room = readNonEmptyString(drawer.room) ?? options.room ?? config.room;

  return {
    outcome: "ok",
    content,
    source: {
      ...(resolvedDrawerId === undefined ? {} : { drawerId: resolvedDrawerId }),
      sourceFile: resolvedSourceFile,
      drawerIndex: resolvedDrawerIndex,
      ...(totalDrawers === undefined ? {} : { totalDrawers }),
      ...(memoryLayer === undefined
        ? {}
        : { memoryLayer, layerLabel: toMempalaceLayerLabel(memoryLayer) }),
      ...(wing ? { wing } : {}),
      ...(room ? { room } : {}),
    },
    details: {
      mode: config.mode,
      configured: true,
      ...response.diagnostics,
    },
  };
}

export function indexMempalaceDrawerPointersSync(
  options: IndexMempalaceDrawerPointersOptions = {},
): MempalaceDrawerPointerIndexResult {
  const config =
    options.config ??
    loadMempalaceAdapterConfig({
      ...(options.env ? { env: options.env } : {}),
    });

  if (config.mode === "disabled") {
    return {
      outcome: "disabled",
      pointers: [],
      details: {
        mode: config.mode,
        configured: false,
      },
    };
  }

  if (!config.configured || !config.palacePath) {
    return {
      outcome: "degraded",
      pointers: [],
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
      action: "listDrawers",
      palacePath: config.palacePath,
      limit: normalizeMempalaceDrawerIndexLimit(options.limit),
      offset: Math.max(0, readInteger(options.offset) ?? 0),
      ...((options.wing ?? config.wing) ? { wing: options.wing ?? config.wing } : {}),
      ...((options.room ?? config.room) ? { room: options.room ?? config.room } : {}),
    },
    options.runCommand,
  );

  if (!response.ok) {
    return {
      outcome: "degraded",
      pointers: [],
      degraded: {
        reason: MEMPALACE_DRAWER_INDEX_DEGRADE_REASON,
        message: response.degraded?.message ?? "Mempalace drawer index command failed.",
      },
      details: {
        mode: config.mode,
        configured: true,
        ...response.diagnostics,
      },
    };
  }

  const payload = readRecord(response.payload);
  const rawDrawers = readDrawerListPayload(payload);
  const pointers = rawDrawers
    .map((drawer): MempalaceDrawerPointer | undefined => toMempalaceDrawerPointer(drawer))
    .filter((pointer): pointer is MempalaceDrawerPointer => pointer !== undefined);

  return {
    outcome: "ok",
    pointers,
    details: {
      mode: config.mode,
      configured: true,
      pointerCount: pointers.length,
      ...response.diagnostics,
    },
  };
}

export function scanMempalaceDrawerPointersSync(
  options: IndexMempalaceDrawerPointersOptions & { readonly maxPages?: number } = {},
): MempalaceDrawerPointerIndexScanResult {
  const pageSize = normalizeMempalaceDrawerIndexLimit(options.limit);
  const maxPages = normalizeMempalaceDrawerScanMaxPages(options.maxPages);
  const mergedPointers: MempalaceDrawerPointer[] = [];
  const seenDrawerIds = new Set<string>();
  let pagesScanned = 0;
  let offset = Math.max(0, readInteger(options.offset) ?? 0);
  let lastPage: MempalaceDrawerPointerIndexResult | null = null;

  while (pagesScanned < maxPages) {
    const page = indexMempalaceDrawerPointersSync({
      ...options,
      limit: pageSize,
      offset,
    });
    lastPage = page;
    if (page.outcome !== "ok") {
      return {
        ...page,
        pagesScanned,
        hasMore: false,
      };
    }

    pagesScanned += 1;
    for (const pointer of page.pointers) {
      if (seenDrawerIds.has(pointer.drawerId)) {
        continue;
      }
      seenDrawerIds.add(pointer.drawerId);
      mergedPointers.push(pointer);
    }

    if (page.pointers.length < pageSize) {
      return {
        ...page,
        pointers: mergedPointers,
        pagesScanned,
        hasMore: false,
      };
    }

    offset += pageSize;
  }

  if (!lastPage) {
    return {
      outcome: "ok",
      pointers: mergedPointers,
      pagesScanned,
      hasMore: false,
      details: {
        mode: options.config?.mode ?? "disabled",
        configured: options.config?.configured ?? false,
        scanPages: pagesScanned,
      },
    };
  }
  return {
    ...lastPage,
    pointers: mergedPointers,
    pagesScanned,
    hasMore: true,
  };
}

export function refreshMempalaceDrawerPointerIndexSync(
  options: RefreshMempalaceDrawerPointerIndexOptions,
): MempalaceDrawerPointerIndexRefreshResult {
  const result = scanMempalaceDrawerPointersSync(options);
  if (result.outcome !== "ok") {
    return result;
  }
  const refreshedAtMs = options.now?.() ?? Date.now();
  const snapshot: MempalaceDrawerPointerIndexSnapshot = {
    schemaVersion: MEMPALACE_DRAWER_POINTER_INDEX_SCHEMA_VERSION,
    refreshedAtMs,
    pointers: result.pointers,
    details: result.details,
  };
  writeMempalaceDrawerPointerIndexSnapshot(options.indexPath, snapshot);
  return {
    ...result,
    indexPath: options.indexPath,
    refreshedAtMs,
  };
}

export function loadMempalaceDrawerPointerIndexSync(
  options: LoadMempalaceDrawerPointerIndexOptions,
): MempalaceDrawerPointerIndexLoadResult {
  if (!existsSync(options.indexPath)) {
    return {
      outcome: "degraded",
      pointers: [],
      degraded: {
        reason: MEMPALACE_DRAWER_INDEX_DEGRADE_REASON,
        message: "Mempalace drawer pointer index snapshot does not exist.",
      },
      details: {
        indexPath: options.indexPath,
      },
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(options.indexPath, "utf8")) as unknown;
    const snapshot = readMempalaceDrawerPointerIndexSnapshot(parsed);
    if (!snapshot) {
      return {
        outcome: "degraded",
        pointers: [],
        degraded: {
          reason: MEMPALACE_DRAWER_INDEX_DEGRADE_REASON,
          message: "Mempalace drawer pointer index snapshot has an invalid schema.",
        },
        details: {
          indexPath: options.indexPath,
        },
      };
    }
    return {
      outcome: "ok",
      pointers: snapshot.pointers,
      refreshedAtMs: snapshot.refreshedAtMs,
      details: {
        indexPath: options.indexPath,
        pointerCount: snapshot.pointers.length,
        ...(snapshot.details ?? {}),
      },
    };
  } catch (error) {
    return {
      outcome: "degraded",
      pointers: [],
      degraded: {
        reason: MEMPALACE_DRAWER_INDEX_DEGRADE_REASON,
        message: error instanceof Error ? error.message : "Failed to read drawer pointer index.",
      },
      details: {
        indexPath: options.indexPath,
      },
    };
  }
}

export function findMempalaceDrawerPointerInIndexSync(
  options: FindMempalaceDrawerPointerInIndexOptions,
): MempalaceDrawerPointerFindResult {
  const loaded = loadMempalaceDrawerPointerIndexSync(options);
  if (loaded.outcome !== "ok") {
    return loaded;
  }
  const drawerId = readNonEmptyString(options.drawerId);
  const sourceFile = readNonEmptyString(options.sourceFile);
  const drawerIndex = readInteger(options.drawerIndex);
  const pointer = loaded.pointers.find((item) => {
    if (drawerId && item.drawerId === drawerId) {
      return true;
    }
    return (
      sourceFile !== undefined &&
      drawerIndex !== undefined &&
      item.sourceFile === sourceFile &&
      item.drawerIndex === drawerIndex
    );
  });
  if (!pointer) {
    return {
      ...loaded,
      outcome: "degraded",
      degraded: {
        reason: MEMPALACE_DRAWER_INDEX_DEGRADE_REASON,
        message: "Mempalace drawer pointer was not found in the local index snapshot.",
      },
    };
  }
  return {
    ...loaded,
    pointer,
  };
}

function normalizeMempalaceDrawerIndexLimit(value: unknown): number {
  const limit = readInteger(value) ?? 200;
  return Math.max(1, Math.min(limit, 1_000));
}

function normalizeMempalaceDrawerScanMaxPages(value: unknown): number {
  const maxPages = readInteger(value) ?? 16;
  return Math.max(1, Math.min(maxPages, 128));
}

function readDrawerListPayload(
  payload: Readonly<Record<string, unknown>> | undefined,
): readonly Readonly<Record<string, unknown>>[] {
  const raw = payload?.drawers ?? payload?.results ?? payload?.items;
  return Array.isArray(raw)
    ? raw
        .map(readRecord)
        .filter((item): item is Readonly<Record<string, unknown>> => item !== undefined)
    : [];
}

function toMempalaceDrawerPointer(
  drawer: Readonly<Record<string, unknown>>,
): MempalaceDrawerPointer | undefined {
  const metadata = readRecord(drawer.metadata);
  const drawerId =
    readNonEmptyString(drawer.drawer_id) ??
    readNonEmptyString(drawer.drawerId) ??
    readNonEmptyString(drawer.id);
  if (!drawerId) {
    return undefined;
  }
  const sourceFile =
    readNonEmptyString(drawer.source_file) ??
    readNonEmptyString(drawer.sourceFile) ??
    readNonEmptyString(metadata?.source_file) ??
    readNonEmptyString(metadata?.sourceFile);
  const drawerIndex =
    readInteger(drawer.drawer_index) ??
    readInteger(drawer.drawerIndex) ??
    readIntegerFromMetadata(metadata);
  const totalDrawers =
    readInteger(drawer.total_drawers) ??
    readInteger(drawer.totalDrawers) ??
    readInteger(metadata?.total_drawers) ??
    readInteger(metadata?.totalDrawers);
  const memoryLayer = toMempalaceMemoryLayer(
    drawer.memory_layer ??
      drawer.memoryLayer ??
      drawer.layer ??
      metadata?.memory_layer ??
      metadata?.memoryLayer ??
      metadata?.layer,
  );
  const wing = readNonEmptyString(drawer.wing) ?? readNonEmptyString(metadata?.wing);
  const room = readNonEmptyString(drawer.room) ?? readNonEmptyString(metadata?.room);
  return {
    drawerId,
    ...(sourceFile === undefined ? {} : { sourceFile }),
    ...(drawerIndex === undefined ? {} : { drawerIndex }),
    ...(totalDrawers === undefined ? {} : { totalDrawers }),
    ...(memoryLayer === undefined
      ? {}
      : { memoryLayer, layerLabel: toMempalaceLayerLabel(memoryLayer) }),
    ...(wing === undefined ? {} : { wing }),
    ...(room === undefined ? {} : { room }),
  };
}

function writeMempalaceDrawerPointerIndexSnapshot(
  indexPath: string,
  snapshot: MempalaceDrawerPointerIndexSnapshot,
): void {
  mkdirSync(dirname(indexPath), { recursive: true });
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(tmpPath, indexPath);
}

function readMempalaceDrawerPointerIndexSnapshot(
  value: unknown,
): MempalaceDrawerPointerIndexSnapshot | undefined {
  const record = readRecord(value);
  if (
    record?.schemaVersion !== MEMPALACE_DRAWER_POINTER_INDEX_SCHEMA_VERSION ||
    typeof record.refreshedAtMs !== "number" ||
    !Number.isFinite(record.refreshedAtMs) ||
    !Array.isArray(record.pointers)
  ) {
    return undefined;
  }
  const pointers = record.pointers
    .map(readRecord)
    .filter((item): item is Readonly<Record<string, unknown>> => item !== undefined)
    .map((item) => toMempalaceDrawerPointer(item))
    .filter((item): item is MempalaceDrawerPointer => item !== undefined);
  const details = readRecord(record.details);
  return {
    schemaVersion: MEMPALACE_DRAWER_POINTER_INDEX_SCHEMA_VERSION,
    refreshedAtMs: record.refreshedAtMs,
    pointers,
    ...(details === undefined ? {} : { details }),
  };
}
