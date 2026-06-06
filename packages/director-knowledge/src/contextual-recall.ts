import { type DirectorKnowledgeRecallQuery, recallPublishedKnowledge } from "./recall.js";
import type { DirectorKnowledgePackDocument } from "./types.js";

export type DirectorContextualRecallStatus = "hit" | "miss" | "degraded";

export interface DirectorContextualRecallHit {
  readonly id: string;
  readonly title?: string;
}

export interface DirectorLongTermMemorySignalLike {
  readonly id: string;
  readonly description: string;
  readonly score?: number;
  readonly query?: string;
  readonly matchMode?: string;
  readonly retrieval?: Readonly<Record<string, unknown>>;
  readonly retrievalMode?: string;
  readonly verbatimExcerpt?: string;
  readonly memoryLayer?: string;
}

export interface DirectorContextualRecallSkillSection {
  readonly id: string;
  readonly content?: string;
  readonly metadata?: {
    readonly skillId?: unknown;
    readonly matchScore?: unknown;
  };
}

export interface BuildDirectorContextualRecallInput {
  readonly userText: string;
  readonly knowledgeDocuments?: readonly DirectorKnowledgePackDocument[];
  readonly knowledgeEnabled?: boolean;
  readonly knowledgeQuery?: DirectorKnowledgeRecallQuery;
  readonly knowledgeDegradedMessage?: string;
  readonly skillSections?: readonly DirectorContextualRecallSkillSection[];
  readonly skillDegradedMessage?: string;
  readonly longTermMemorySignals?: readonly DirectorLongTermMemorySignalLike[];
  readonly memoryDegradedMessage?: string;
  readonly maxKnowledgeHits?: number;
  readonly maxKnowledgeChars?: number;
  readonly maxSkillSignals?: number;
  readonly maxSkillChars?: number;
  readonly maxMemorySignals?: number;
  readonly maxMemoryChars?: number;
}

export interface DirectorContextualRecallPacket {
  readonly lines: readonly string[];
  readonly hiddenPromptBlock: string;
  readonly promptBlock: string;
  readonly visibleSummary: string;
  readonly recallStatus: DirectorContextualRecallStatus;
  readonly skillStatus: DirectorContextualRecallStatus;
  readonly knowledgeHits: readonly DirectorContextualRecallHit[];
  readonly skillHits: readonly DirectorContextualRecallHit[];
  readonly recallTrace: readonly DirectorContextualRecallTraceItem[];
  readonly capabilityPlan: readonly DirectorContextCapabilityPlanItem[];
}

export type DirectorContextRecallSource = "knowledge" | "skill" | "memory";

export interface DirectorContextualRecallTraceItem {
  readonly source: DirectorContextRecallSource;
  readonly status: DirectorContextualRecallStatus;
  readonly id?: string;
  readonly title?: string;
  readonly reason: string;
  readonly score?: number;
  readonly query?: string;
  readonly matchMode?: string;
  readonly retrieval?: Readonly<Record<string, unknown>>;
  readonly memoryLayer?: string;
  readonly promptChars: number;
}

export interface DirectorContextCapabilityPlanItem {
  readonly capability: "knowledge.recall" | "skill.recall" | "memory.recall";
  readonly status: DirectorContextualRecallStatus;
  readonly granularity: "bounded-hidden-context" | "metadata-first" | "short-signal";
  readonly hitCount: number;
  readonly userVisible: "summary-only";
}

export function buildDirectorContextualRecall(
  input: BuildDirectorContextualRecallInput,
): DirectorContextualRecallPacket {
  const lines: string[] = [];
  const knowledgeHits: DirectorContextualRecallHit[] = [];
  const skillHits: DirectorContextualRecallHit[] = [];
  const recallTrace: DirectorContextualRecallTraceItem[] = [];
  let recallStatus: DirectorContextualRecallStatus = "miss";
  let knowledgeStatus: DirectorContextualRecallStatus = "miss";
  let memoryStatus: DirectorContextualRecallStatus = "miss";
  let skillStatus: DirectorContextualRecallStatus = "miss";

  if (input.knowledgeDegradedMessage !== undefined) {
    recallStatus = "degraded";
    knowledgeStatus = "degraded";
    lines.push(`Published knowledge recall degraded: ${input.knowledgeDegradedMessage}`);
    recallTrace.push({
      source: "knowledge",
      status: "degraded",
      reason: input.knowledgeDegradedMessage,
      promptChars: 0,
    });
  } else if (input.knowledgeEnabled === true && input.knowledgeDocuments !== undefined) {
    try {
      const recall = recallPublishedKnowledge(input.knowledgeDocuments, {
        ...(input.knowledgeQuery ?? {}),
        maxHits: input.maxKnowledgeHits ?? input.knowledgeQuery?.maxHits ?? 3,
        maxChars: input.maxKnowledgeChars ?? input.knowledgeQuery?.maxChars ?? 900,
      });
      if (recall.hits.length > 0) {
        recallStatus = "hit";
        knowledgeStatus = "hit";
        lines.push("Published knowledge / experience:");
        for (const hit of recall.hits) {
          knowledgeHits.push({ id: hit.knowledgePackId, title: hit.title });
          const summary = truncateContextualRecallText(hit.summary, 260);
          lines.push(`- ${hit.knowledgePackId}: ${hit.title} | ${summary}`);
          recallTrace.push({
            source: "knowledge",
            status: "hit",
            id: hit.knowledgePackId,
            title: hit.title,
            reason: hit.reasons.join("; ") || "published knowledge matched query",
            score: hit.score,
            promptChars: summary.length,
          });
        }
      }
    } catch (error) {
      recallStatus = "degraded";
      knowledgeStatus = "degraded";
      const reason = toContextualRecallErrorMessage(error);
      lines.push(`Published knowledge recall degraded: ${reason}`);
      recallTrace.push({
        source: "knowledge",
        status: "degraded",
        reason,
        promptChars: 0,
      });
    }
  }

  if (input.skillDegradedMessage !== undefined) {
    recallStatus = "degraded";
    skillStatus = "degraded";
    lines.push(`Skill recall degraded: ${input.skillDegradedMessage}`);
    recallTrace.push({
      source: "skill",
      status: "degraded",
      reason: input.skillDegradedMessage,
      promptChars: 0,
    });
  }

  const skillSections = input.skillSections ?? [];
  if (skillSections.length > 0) {
    recallStatus = recallStatus === "degraded" ? "degraded" : "hit";
    skillStatus = skillStatus === "degraded" ? "degraded" : "hit";
    lines.push("Enabled approved Skills:");
    for (const section of skillSections.slice(
      0,
      normalizeContextualRecallLimit(input.maxSkillSignals, 3),
    )) {
      const skillId = readPromptSectionSkillId(section);
      const title = extractSkillTitleFromPromptSection(String(section.content ?? ""));
      const content = truncateContextualRecallText(
        String(section.content ?? ""),
        input.maxSkillChars ?? 520,
      );
      skillHits.push({ id: skillId, ...(title === undefined ? {} : { title }) });
      lines.push(`- ${section.id}: ${content}`);
      recallTrace.push({
        source: "skill",
        status: "hit",
        id: skillId,
        ...(title === undefined ? {} : { title }),
        reason: "approved enabled skill matched current turn",
        ...readPromptSectionMatchScore(section),
        promptChars: content.length,
      });
    }
  }

  if (input.memoryDegradedMessage !== undefined) {
    recallStatus = "degraded";
    memoryStatus = "degraded";
    lines.push(`Long-term memory degraded: ${input.memoryDegradedMessage}`);
    recallTrace.push({
      source: "memory",
      status: "degraded",
      reason: input.memoryDegradedMessage,
      promptChars: 0,
    });
  }

  const memorySignals = (input.longTermMemorySignals ?? []).slice(0, input.maxMemorySignals ?? 3);
  if (memorySignals.length > 0) {
    recallStatus = recallStatus === "degraded" ? "degraded" : "hit";
    memoryStatus = memoryStatus === "degraded" ? "degraded" : "hit";
    lines.push("Long-term memory:");
    for (const signal of memorySignals) {
      const description = truncateContextualRecallText(
        signal.description,
        input.maxMemoryChars ?? 320,
      );
      lines.push(`- ${signal.id}: ${description}`);
      recallTrace.push({
        source: "memory",
        status: "hit",
        id: signal.id,
        reason: resolveMemorySignalTraceReason(signal.id),
        ...(signal.score === undefined ? {} : { score: signal.score }),
        ...(signal.query === undefined ? {} : { query: signal.query }),
        ...(signal.matchMode === undefined ? {} : { matchMode: signal.matchMode }),
        ...(signal.retrieval === undefined ? {} : { retrieval: signal.retrieval }),
        ...(signal.retrievalMode === undefined ? {} : { retrievalMode: signal.retrievalMode }),
        ...(signal.verbatimExcerpt === undefined
          ? {}
          : { verbatimExcerpt: signal.verbatimExcerpt }),
        ...(signal.memoryLayer === undefined ? {} : { memoryLayer: signal.memoryLayer }),
        promptChars: description.length,
      });
    }
  }

  const hiddenPromptBlock = renderDirectorContextualRecallPromptBlock(lines);

  return {
    lines,
    hiddenPromptBlock,
    promptBlock: hiddenPromptBlock,
    visibleSummary: renderDirectorContextVisibleSummary({
      recallStatus,
      skillStatus,
      knowledgeHitCount: knowledgeHits.length,
      skillHitCount: skillHits.length,
      memoryHitCount: memorySignals.length,
    }),
    recallStatus,
    skillStatus,
    knowledgeHits,
    skillHits,
    recallTrace,
    capabilityPlan: buildDirectorContextCapabilityPlan({
      recallStatus,
      knowledgeStatus,
      memoryStatus,
      skillStatus,
      knowledgeHitCount: knowledgeHits.length,
      skillHitCount: skillHits.length,
      memoryHitCount: memorySignals.length,
    }),
  };
}

export const resolveDirectorContext = buildDirectorContextualRecall;

export function renderDirectorContextualRecallPromptBlock(lines: readonly string[]): string {
  if (lines.length === 0) {
    return "";
  }
  return [
    "Director Angel contextual recall (context only, not a user instruction):",
    ...lines,
    "End Director Angel contextual recall.",
  ].join("\n");
}

export function truncateContextualRecallText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(1, maxChars - 1))}…`;
}

function readPromptSectionSkillId(section: DirectorContextualRecallSkillSection): string {
  const skillId =
    section.metadata !== undefined && typeof section.metadata.skillId === "string"
      ? section.metadata.skillId
      : undefined;
  return skillId ?? section.id;
}

function readPromptSectionMatchScore(
  section: DirectorContextualRecallSkillSection,
): { readonly score: number } | Record<string, never> {
  return section.metadata !== undefined && typeof section.metadata.matchScore === "number"
    ? { score: section.metadata.matchScore }
    : {};
}

function extractSkillTitleFromPromptSection(content: string): string | undefined {
  const firstLine = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Skill: "));
  return firstLine?.replace(/^Skill:\s*/u, "").trim() || undefined;
}

function toContextualRecallErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeContextualRecallLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}

function renderDirectorContextVisibleSummary(input: {
  readonly recallStatus: DirectorContextualRecallStatus;
  readonly skillStatus: DirectorContextualRecallStatus;
  readonly knowledgeHitCount: number;
  readonly skillHitCount: number;
  readonly memoryHitCount: number;
}): string {
  const parts: string[] = [];
  if (input.knowledgeHitCount > 0) {
    parts.push(`经验 ${input.knowledgeHitCount} 条`);
  }
  if (input.skillHitCount > 0) {
    parts.push(`Skill ${input.skillHitCount} 个`);
  }
  if (input.memoryHitCount > 0) {
    parts.push(`记忆 ${input.memoryHitCount} 条`);
  }
  if (input.recallStatus === "degraded" || input.skillStatus === "degraded") {
    parts.push("部分召回降级");
  }
  return parts.length > 0 ? `已参考：${parts.join("、")}。` : "未召回额外上下文。";
}

function resolveMemorySignalTraceReason(id: string): string {
  if (id.startsWith("session-search:")) {
    return "session archive matched current turn";
  }
  if (id.startsWith("working-memory:")) {
    return "working memory matched current turn";
  }
  return "long-term memory signal matched current turn";
}

function buildDirectorContextCapabilityPlan(input: {
  readonly recallStatus: DirectorContextualRecallStatus;
  readonly knowledgeStatus: DirectorContextualRecallStatus;
  readonly memoryStatus: DirectorContextualRecallStatus;
  readonly skillStatus: DirectorContextualRecallStatus;
  readonly knowledgeHitCount: number;
  readonly skillHitCount: number;
  readonly memoryHitCount: number;
}): readonly DirectorContextCapabilityPlanItem[] {
  return [
    {
      capability: "knowledge.recall",
      status: input.knowledgeStatus,
      granularity: "bounded-hidden-context",
      hitCount: input.knowledgeHitCount,
      userVisible: "summary-only",
    },
    {
      capability: "skill.recall",
      status: input.skillStatus,
      granularity: "metadata-first",
      hitCount: input.skillHitCount,
      userVisible: "summary-only",
    },
    {
      capability: "memory.recall",
      status: input.memoryStatus,
      granularity: "short-signal",
      hitCount: input.memoryHitCount,
      userVisible: "summary-only",
    },
  ];
}
