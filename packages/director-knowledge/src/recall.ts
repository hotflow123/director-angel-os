import type { DirectorKnowledgePackDocument } from "./types.js";

export const DIRECTOR_KNOWLEDGE_RECALL_PACKET_SCHEMA_VERSION =
  "director.knowledge.recall.packet.v1" as const;
export const DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS = 3;
export const DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS = 900;

export type DirectorKnowledgeRecallStatus = "miss" | "hit" | "degraded";

export interface DirectorKnowledgeRecallQuery {
  readonly queryId?: string;
  readonly projectId?: string;
  readonly groupId?: string;
  readonly anchorIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly preferredAdapters?: readonly string[];
  readonly generationType?: string;
  readonly generationStyle?: string;
  readonly includeGlobalExperience?: boolean;
  readonly maxHits?: number;
  readonly maxChars?: number;
}

export interface DirectorKnowledgeRecallProvenance {
  readonly knowledgePackId: string;
  readonly sourceProposalId: string;
  readonly sourceRecordId: string;
  readonly sourceDigestId: string;
  readonly publishedAt: string;
}

export interface DirectorKnowledgeRecallMethodHint {
  readonly trigger: string;
  readonly explanation: string;
  readonly roles: readonly string[];
  readonly preferredAdapters: readonly string[];
  readonly anchorIds: readonly string[];
}

export interface DirectorKnowledgeRecallHit {
  readonly knowledgePackId: string;
  readonly title: string;
  readonly version: number;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly tags: readonly string[];
  readonly summary: string;
  readonly method: DirectorKnowledgeRecallMethodHint;
  readonly provenance: DirectorKnowledgeRecallProvenance;
}

export interface DirectorKnowledgeRecallPacket {
  readonly schemaVersion: typeof DIRECTOR_KNOWLEDGE_RECALL_PACKET_SCHEMA_VERSION;
  readonly queryId: string;
  readonly status: DirectorKnowledgeRecallStatus;
  readonly recordedAt: string;
  readonly truncated: boolean;
  readonly notes: readonly string[];
  readonly query: Required<Pick<DirectorKnowledgeRecallQuery, "maxHits" | "maxChars">> &
    Omit<DirectorKnowledgeRecallQuery, "maxHits" | "maxChars" | "queryId">;
  readonly hits: readonly DirectorKnowledgeRecallHit[];
}

interface RankedKnowledgeDocument {
  readonly document: DirectorKnowledgePackDocument;
  readonly score: number;
  readonly reasons: readonly string[];
}

const MAX_SUMMARY_CHARS_PER_HIT = 280;

export function recallPublishedKnowledge(
  documents: readonly DirectorKnowledgePackDocument[],
  query: DirectorKnowledgeRecallQuery,
  options: { readonly now?: string } = {},
): DirectorKnowledgeRecallPacket {
  const normalizedQuery = normalizeQuery(query);
  const ranked = rankPublishedKnowledgeDocuments(documents, normalizedQuery);

  let totalChars = 0;
  let truncated = false;
  const hits: DirectorKnowledgeRecallHit[] = [];

  for (const item of ranked) {
    if (hits.length >= normalizedQuery.maxHits) {
      truncated = true;
      break;
    }

    const hit = toRecallHit(item);
    const nextTotal = totalChars + hit.summary.length;
    if (hits.length > 0 && nextTotal > normalizedQuery.maxChars) {
      truncated = true;
      break;
    }
    if (hits.length === 0 && hit.summary.length > normalizedQuery.maxChars) {
      hits.push({
        ...hit,
        summary: truncateText(hit.summary, normalizedQuery.maxChars),
      });
      truncated = true;
      totalChars = normalizedQuery.maxChars;
      break;
    }

    hits.push(hit);
    totalChars = nextTotal;
  }

  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_RECALL_PACKET_SCHEMA_VERSION,
    queryId: query.queryId ?? buildQueryId(normalizedQuery),
    status: hits.length > 0 ? "hit" : "miss",
    recordedAt: options.now ?? new Date().toISOString(),
    truncated,
    notes:
      hits.length > 0
        ? [
            `Matched ${hits.length} published Director knowledge pack(s).`,
            ...(truncated
              ? ["Results were truncated by maxHits/maxChars boundaries."]
              : ["Results fit within recall boundaries."]),
          ]
        : ["No published Director knowledge pack matched the current query boundary."],
    query: normalizedQuery,
    hits,
  };
}

export function rankPublishedKnowledgeDocuments(
  documents: readonly DirectorKnowledgePackDocument[],
  query: DirectorKnowledgeRecallPacket["query"],
): readonly RankedKnowledgeDocument[] {
  return documents
    .map((document) => {
      const reasons: string[] = [];
      let score = 0;

      if (query.projectId && document.method.projectId === query.projectId) {
        score += 80;
        reasons.push(`project match: ${query.projectId}`);
      }
      if (query.groupId && document.method.groupId === query.groupId) {
        score += 50;
        reasons.push(`group match: ${query.groupId}`);
      }

      const anchorMatches = intersect(document.method.anchorIds, query.anchorIds ?? []);
      if (anchorMatches.length > 0) {
        score += Math.min(anchorMatches.length * 18, 54);
        reasons.push(`anchor match: ${anchorMatches.join(", ")}`);
      }

      const tagMatches = intersect(document.metadata.tags ?? [], query.tags ?? []);
      if (tagMatches.length > 0) {
        score += Math.min(tagMatches.length * 10, 30);
        reasons.push(`tag match: ${tagMatches.join(", ")}`);
      }

      const adapterMatches = intersect(
        document.method.preferredAdapters,
        query.preferredAdapters ?? [],
      );
      if (adapterMatches.length > 0) {
        score += Math.min(adapterMatches.length * 12, 24);
        reasons.push(`adapter match: ${adapterMatches.join(", ")}`);
      }

      if (query.generationType && document.method.generationType === query.generationType) {
        score += 16;
        reasons.push(`generation type: ${query.generationType}`);
      }
      if (query.generationStyle && document.method.generationStyle === query.generationStyle) {
        score += 12;
        reasons.push(`generation style: ${query.generationStyle}`);
      }
      if (query.includeGlobalExperience && isGlobalSelfLearningExperience(document)) {
        score += 8;
        reasons.push("global self-learning experience");
      }

      return {
        document,
        score,
        reasons,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      return (
        right.score - left.score ||
        right.document.metadata.version - left.document.metadata.version ||
        right.document.audit.publishedAt.localeCompare(left.document.audit.publishedAt) ||
        left.document.metadata.id.localeCompare(right.document.metadata.id)
      );
    });
}

function normalizeQuery(
  query: DirectorKnowledgeRecallQuery,
): DirectorKnowledgeRecallPacket["query"] {
  return {
    ...(query.projectId === undefined ? {} : { projectId: query.projectId }),
    ...(query.groupId === undefined ? {} : { groupId: query.groupId }),
    ...(query.anchorIds === undefined ? {} : { anchorIds: dedupe(query.anchorIds) }),
    ...(query.tags === undefined ? {} : { tags: dedupe(query.tags) }),
    ...(query.preferredAdapters === undefined
      ? {}
      : { preferredAdapters: dedupe(query.preferredAdapters) }),
    ...(query.generationType === undefined ? {} : { generationType: query.generationType }),
    ...(query.generationStyle === undefined ? {} : { generationStyle: query.generationStyle }),
    ...(query.includeGlobalExperience === undefined
      ? {}
      : { includeGlobalExperience: query.includeGlobalExperience }),
    maxHits: normalizePositiveInteger(query.maxHits, DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_HITS),
    maxChars: normalizePositiveInteger(query.maxChars, DIRECTOR_KNOWLEDGE_RECALL_DEFAULT_MAX_CHARS),
  };
}

function toRecallHit(item: RankedKnowledgeDocument): DirectorKnowledgeRecallHit {
  const { document, score, reasons } = item;
  return {
    knowledgePackId: document.metadata.id,
    title: document.metadata.title,
    version: document.metadata.version,
    score,
    reasons,
    tags: [...(document.metadata.tags ?? [])],
    summary: buildSummary(document),
    method: {
      trigger: document.method.trigger,
      explanation: document.method.explanation,
      roles: [...document.method.roles],
      preferredAdapters: [...document.method.preferredAdapters],
      anchorIds: [...document.method.anchorIds],
    },
    provenance: {
      knowledgePackId: document.metadata.id,
      sourceProposalId: document.method.sourceProposalId,
      sourceRecordId: document.method.sourceRecordId,
      sourceDigestId: document.method.sourceDigestId,
      publishedAt: document.audit.publishedAt,
    },
  };
}

function buildSummary(document: DirectorKnowledgePackDocument): string {
  const parts = [
    document.metadata.title,
    `Trigger: ${document.method.trigger}`,
    `Method: ${document.method.explanation}`,
    `Roles: ${document.method.roles.join(", ") || "(none)"}`,
    `Adapters: ${document.method.preferredAdapters.join(", ") || "(none)"}`,
  ];
  return truncateText(parts.join(" | "), MAX_SUMMARY_CHARS_PER_HIT);
}

function buildQueryId(query: DirectorKnowledgeRecallPacket["query"]): string {
  const tokens = [
    query.projectId ?? "any-project",
    query.groupId ?? "any-group",
    (query.anchorIds ?? []).join("_") || "no-anchors",
    (query.tags ?? []).join("_") || "no-tags",
    query.includeGlobalExperience ? "global-experience" : "explicit-only",
  ];
  return `knowledge-recall-${slugify(tokens.join("-"))}`;
}

function isGlobalSelfLearningExperience(document: DirectorKnowledgePackDocument): boolean {
  const tags = new Set((document.metadata.tags ?? []).map((tag) => tag.trim()));
  return (
    document.method.projectId === "experience-learning" &&
    tags.has("experience") &&
    tags.has("self-learning")
  );
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function intersect(left: readonly string[], right: readonly string[]): string[] {
  if (left.length === 0 || right.length === 0) {
    return [];
  }
  const rightSet = new Set(right.map((value) => value.trim()).filter((value) => value.length > 0));
  return dedupe(left).filter((value) => rightSet.has(value));
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const limit = Math.max(1, maxChars - 1);
  return `${value.slice(0, limit)}…`;
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  return normalized.length > 0 ? normalized : "query";
}
