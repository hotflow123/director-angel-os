import type { MempalaceRecallItem, MempalaceSearchRawItem } from "./types.js";

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toContent(item: MempalaceSearchRawItem): string | undefined {
  return (
    toOptionalString(item.text) ??
    toOptionalString(item.content) ??
    toOptionalString(item.memory) ??
    toOptionalString(item.verbatim)
  );
}

function toVerbatim(item: MempalaceSearchRawItem, content: string): string {
  return (
    toOptionalString(item.verbatim) ??
    toOptionalString(item.text) ??
    toOptionalString(item.memory) ??
    content
  );
}

function toId(item: MempalaceSearchRawItem, index: number): string {
  return toOptionalString(item.id) ?? toOptionalString(item.memory_id) ?? `mempalace-${index + 1}`;
}

function toScore(item: MempalaceSearchRawItem): number {
  const rawScore =
    typeof item.score === "number"
      ? item.score
      : typeof item.similarity === "number"
        ? item.similarity
        : 0;
  if (!Number.isFinite(rawScore)) {
    return 0;
  }
  return Math.max(0, Math.min(1, rawScore));
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function toUpdatedAt(item: MempalaceSearchRawItem, now: () => number): number {
  const raw = typeof item.updatedAt === "number" ? item.updatedAt : item.timestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.trunc(raw);
  }
  return now();
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

export function mapMempalaceSearchItems(
  items: readonly MempalaceSearchRawItem[],
  now: () => number,
): readonly MempalaceRecallItem[] {
  return items
    .map((item, index): MempalaceRecallItem | undefined => {
      const content = toContent(item);
      if (!content) {
        return undefined;
      }

      const verbatim = toVerbatim(item, content);
      const wing = toOptionalString(item.wing);
      const room = toOptionalString(item.room);
      const rawMetadata =
        item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
          ? (item.metadata as Readonly<Record<string, unknown>>)
          : undefined;
      const sourceFile = toOptionalString(item.source_file);
      const matchMode = toOptionalString(item.matched_via);
      const bm25Score = toOptionalNumber(item.bm25_score);
      const distance = toOptionalNumber(item.distance);
      const effectiveDistance = toOptionalNumber(item.effective_distance);
      const closetBoost = toOptionalNumber(item.closet_boost);
      const drawerIndex = toOptionalInteger(item.drawer_index);
      const totalDrawers = toOptionalInteger(item.total_drawers);
      const rawMetadataLayer =
        rawMetadata?.memoryLayer ?? rawMetadata?.memory_layer ?? rawMetadata?.layer;
      const memoryLayer = toMempalaceMemoryLayer(
        item.memory_layer ?? item.layer ?? rawMetadataLayer,
      );
      const score = toScore(item);
      const metadata = {
        ...(sourceFile ? { sourceFile } : {}),
        ...(memoryLayer === undefined
          ? {}
          : { memoryLayer, layerLabel: toMempalaceLayerLabel(memoryLayer) }),
        verbatim,
        retrievalEngine: "mempalace",
        matchMode: matchMode ?? "vector",
        vectorSimilarity: score,
        ...(bm25Score === undefined ? {} : { bm25Score }),
        ...(distance === undefined ? {} : { distance }),
        ...(effectiveDistance === undefined ? {} : { effectiveDistance }),
        ...(closetBoost === undefined ? {} : { closetBoost }),
        ...(drawerIndex === undefined ? {} : { drawerIndex }),
        ...(totalDrawers === undefined ? {} : { totalDrawers }),
        ...(rawMetadata === undefined ? {} : { rawMetadata }),
        provenance: {
          engine: "mempalace",
          ...(sourceFile ? { sourceFile } : {}),
          ...(wing ? { wing } : {}),
          ...(room ? { room } : {}),
          ...(drawerIndex === undefined ? {} : { drawerIndex }),
          ...(totalDrawers === undefined ? {} : { totalDrawers }),
          ...(memoryLayer === undefined ? {} : { memoryLayer }),
        },
      };

      return {
        id: toId(item, index),
        content,
        score,
        updatedAt: toUpdatedAt(item, now),
        ...(wing ? { wing } : {}),
        ...(room ? { room } : {}),
        metadata,
      };
    })
    .filter((item): item is MempalaceRecallItem => Boolean(item));
}
