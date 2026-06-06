import type { ExperiencePrivacyClassification, ExperienceSourceKind } from "@hotflow/contracts";

export type ExperienceDistillationConfidence = "high" | "medium" | "low";

export interface DistillExperienceDraftInput {
  readonly sourceKind: ExperienceSourceKind;
  readonly sourceId: string;
  readonly title: string;
  readonly content: string;
  readonly privacy: ExperiencePrivacyClassification;
  readonly fallbackApplicability: string;
  readonly baseRisks: readonly string[];
  readonly baseTags: readonly string[];
}

export interface DistilledExperienceDraft {
  readonly summary: string;
  readonly applicability: string;
  readonly risks: readonly string[];
  readonly tags: readonly string[];
  readonly evidenceSummary: string;
  readonly confidence: ExperienceDistillationConfidence;
  readonly selectedClaims: readonly string[];
}

export interface ExperienceDistillerContext {
  readonly heuristicDraft: DistilledExperienceDraft;
}

export interface ExperienceDistiller {
  readonly distillerId: string;
  distill(
    input: DistillExperienceDraftInput,
    context: ExperienceDistillerContext,
  ): Promise<DistilledExperienceDraft> | DistilledExperienceDraft;
}

const MAX_SUMMARY_CHARS = 360;
const MAX_EVIDENCE_SUMMARY_CHARS = 220;
const MAX_CLAIMS = 3;

const ACTIONABLE_MARKERS = [
  /应该|必须|需要|推荐|适合|用于|先|再|避免|不要|保留|保存|审核|发布|召回|提炼|沉淀|接入|确认|选择|建立|控制|展示|强调|增强|降低|输出|输入|流程|步骤|风险|注意|证据|经验|知识|候选|运行时/iu,
  /\b(should|must|need|use|prefer|avoid|keep|preserve|review|promote|publish|recall|extract|distill|evidence|risk|when|before|after|ensure|compare|route|gate|candidate)\b/iu,
];

const CONDITION_MARKERS = [
  /适合|用于|当|如果|场景|目的|流程|步骤|when|if|before|after/iu,
  /Use when|Recommended for|Applies when/iu,
];

const EVIDENCE_MARKERS = [
  /证据|来源|审核|候选|发布|召回|review|evidence|source|candidate|publish|recall/iu,
];

const NOISE_MARKERS = [
  /^\[?image\]?$/iu,
  /^图片$/iu,
  /登录后继续|扫码登录|login required|sign in to continue|cookie policy|copyright/iu,
  /@babel\/helpers|__webpack|webpackJsonp|data-elem-id|justify-content|display\s*:\s*flex/iu,
];

export function distillExperienceDraft(
  input: DistillExperienceDraftInput,
): DistilledExperienceDraft {
  const title = normalizeWhitespace(input.title);
  const candidates = segmentExperienceContent(input.content)
    .map((segment, index) => scoreSegment(segment, index, title))
    .filter((segment) => segment.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selectedClaims = dedupeSegments(candidates.map((segment) => segment.text)).slice(
    0,
    MAX_CLAIMS,
  );
  const confidence = resolveConfidence(selectedClaims, candidates[0]?.score ?? 0);
  const summary = buildDistilledSummary(selectedClaims, confidence);
  const evidenceSummary = buildEvidenceSummary(input.title, selectedClaims, confidence);
  const tags = dedupeStrings([
    ...input.baseTags,
    "distilled-experience",
    `distillation:${confidence}`,
    ...(confidence === "low" ? ["needs-human-review"] : []),
  ]);
  const risks = dedupeStrings([
    ...input.baseRisks,
    "Experience candidate is distilled from source material; raw source remains evidence and must not bypass review.",
    ...(confidence === "low"
      ? [
          "Distillation confidence is low; reviewer should reject or manually rewrite before promotion.",
        ]
      : []),
  ]);

  return {
    summary,
    applicability: buildApplicability(input, selectedClaims, confidence),
    risks,
    tags,
    evidenceSummary,
    confidence,
    selectedClaims,
  };
}

export async function distillExperienceDraftWithAdapter(
  input: DistillExperienceDraftInput,
  distiller: ExperienceDistiller | undefined,
): Promise<DistilledExperienceDraft> {
  const heuristicDraft = distillExperienceDraft(input);
  if (distiller === undefined) {
    return heuristicDraft;
  }

  try {
    const modelDraft = await distiller.distill(input, { heuristicDraft });
    return mergeModelDraft(input, heuristicDraft, modelDraft, distiller.distillerId);
  } catch (error) {
    return markModelFallback(heuristicDraft, distiller.distillerId, error);
  }
}

function buildDistilledSummary(
  selectedClaims: readonly string[],
  confidence: ExperienceDistillationConfidence,
): string {
  if (selectedClaims.length === 0) {
    return "经验提炼待审：该来源通过可读性门禁，但未发现足够明确的可复用操作规则；审核时只应保留可验证、可执行的部分。";
  }

  const prefix = confidence === "low" ? "低置信经验提炼：" : "经验提炼：";
  return limitText(`${prefix}${selectedClaims.join("；")}`, MAX_SUMMARY_CHARS);
}

function buildApplicability(
  input: DistillExperienceDraftInput,
  selectedClaims: readonly string[],
  confidence: ExperienceDistillationConfidence,
): string {
  if (selectedClaims.length === 0 || confidence === "low") {
    return `${input.fallbackApplicability} Reviewer must confirm the source contains reusable, evidence-backed operating guidance before promotion.`;
  }

  return `${input.fallbackApplicability} Apply only to situations matching the distilled claims and preserved source evidence.`;
}

function buildEvidenceSummary(
  title: string,
  selectedClaims: readonly string[],
  confidence: ExperienceDistillationConfidence,
): string {
  if (selectedClaims.length === 0) {
    return `Source "${title}" passed readability checks, but no strong reusable operating claim was extracted.`;
  }

  const prefix = confidence === "low" ? "Low-confidence distilled evidence" : "Distilled evidence";
  return limitText(`${prefix} from "${title}": ${selectedClaims[0]}`, MAX_EVIDENCE_SUMMARY_CHARS);
}

function segmentExperienceContent(content: string): readonly string[] {
  const withBreaks = normalizeWhitespace(content)
    .replace(/([。！？!?；;])\s*/gu, "$1\n")
    .replace(/\s+((?:\d+|[一二三四五六七八九十]+)[、.]\s*)/gu, "\n$1")
    .replace(
      /\s+(推荐流程|审核时|注意|风险|适合场景|核心作用|小白理解|When\b|Use\b|Avoid\b|Keep\b|Do not\b)/giu,
      "\n$1",
    );

  return withBreaks
    .split(/\n+/u)
    .flatMap((segment) => splitLongSegment(segment))
    .map((segment) => normalizeWhitespace(segment))
    .filter((segment) => segment.length > 0);
}

function splitLongSegment(segment: string): readonly string[] {
  if (segment.length <= MAX_SUMMARY_CHARS) {
    return [segment];
  }

  return segment
    .split(
      /(?=(?:推荐流程|审核时|注意|风险|适合场景|核心作用|小白理解|When\b|Use\b|Avoid\b|Keep\b|Do not\b))/giu,
    )
    .filter((entry) => entry.length > 0);
}

function scoreSegment(
  segment: string,
  index: number,
  title: string,
): {
  readonly index: number;
  readonly text: string;
  readonly score: number;
} {
  const text = limitText(cleanSegment(segment), MAX_SUMMARY_CHARS);
  if (!isUsefulCandidate(text, title)) {
    return { index, text, score: 0 };
  }

  let score = 0;
  for (const marker of ACTIONABLE_MARKERS) {
    if (marker.test(text)) {
      score += 3;
    }
  }
  for (const marker of CONDITION_MARKERS) {
    if (marker.test(text)) {
      score += 2;
    }
  }
  for (const marker of EVIDENCE_MARKERS) {
    if (marker.test(text)) {
      score += 1;
    }
  }
  if (/[：:]/u.test(text)) {
    score += 1;
  }
  if (text.length >= 30 && text.length <= 240) {
    score += 1;
  }

  return { index, text, score };
}

function isUsefulCandidate(text: string, title: string): boolean {
  if (text.length < 16) {
    return false;
  }
  if (title.length > 0 && text.toLowerCase() === title.toLowerCase()) {
    return false;
  }
  if (/^(?:第?[一二三四五六七八九十]+[、.．]|[0-9]+[.)、])\s*[\p{L}\p{N}\s-]{1,28}$/u.test(text)) {
    return false;
  }
  if (
    /^[\p{L}\p{N}\s-]{1,24}$/u.test(text) &&
    !ACTIONABLE_MARKERS.some((marker) => marker.test(text))
  ) {
    return false;
  }
  return !NOISE_MARKERS.some((marker) => marker.test(text));
}

function resolveConfidence(
  selectedClaims: readonly string[],
  topScore: number,
): ExperienceDistillationConfidence {
  if (selectedClaims.length === 0 || topScore < 4) {
    return "low";
  }
  if (selectedClaims.length >= 2 && topScore >= 6) {
    return "high";
  }
  return "medium";
}

function mergeModelDraft(
  input: DistillExperienceDraftInput,
  heuristicDraft: DistilledExperienceDraft,
  modelDraft: DistilledExperienceDraft,
  distillerId: string,
): DistilledExperienceDraft {
  const summary = chooseModelText(modelDraft.summary, input.title, heuristicDraft.summary);
  const applicability = chooseModelText(
    modelDraft.applicability,
    input.title,
    heuristicDraft.applicability,
  );
  const evidenceSummary = chooseModelText(
    modelDraft.evidenceSummary,
    input.title,
    heuristicDraft.evidenceSummary,
  );
  const selectedClaims = normalizeStringArray(
    modelDraft.selectedClaims,
    heuristicDraft.selectedClaims,
  ).slice(0, MAX_CLAIMS);
  return {
    summary,
    applicability,
    risks: dedupeStrings([
      ...heuristicDraft.risks,
      ...normalizeStringArray(modelDraft.risks, []),
      "Model distillation was used as the primary extraction path; human review is still required before promotion.",
    ]),
    tags: dedupeStrings([
      ...heuristicDraft.tags,
      ...normalizeStringArray(modelDraft.tags, []),
      "distillation:model",
      `distiller:${slugifyTag(distillerId)}`,
    ]),
    evidenceSummary,
    confidence: normalizeConfidence(modelDraft.confidence, heuristicDraft.confidence),
    selectedClaims,
  };
}

function markModelFallback(
  heuristicDraft: DistilledExperienceDraft,
  distillerId: string,
  error: unknown,
): DistilledExperienceDraft {
  return {
    ...heuristicDraft,
    risks: dedupeStrings([
      ...heuristicDraft.risks,
      `Model distillation failed for ${distillerId}; deterministic fallback was used: ${toErrorMessage(error)}.`,
    ]),
    tags: dedupeStrings([
      ...heuristicDraft.tags,
      "distillation:model-fallback",
      `distiller:${slugifyTag(distillerId)}`,
    ]),
  };
}

function chooseModelText(value: string, title: string, fallback: string): string {
  const normalized = limitText(value, MAX_SUMMARY_CHARS);
  if (!isUsefulCandidate(normalized, title)) {
    return fallback;
  }
  return normalized;
}

function normalizeStringArray(values: readonly string[], fallback: readonly string[]): string[] {
  if (!Array.isArray(values)) {
    return [...fallback];
  }
  const normalized = values
    .map((value) => (typeof value === "string" ? normalizeWhitespace(value) : ""))
    .filter((value) => value.length > 0);
  return normalized.length > 0 ? dedupeStrings(normalized) : [...fallback];
}

function normalizeConfidence(
  value: ExperienceDistillationConfidence,
  fallback: ExperienceDistillationConfidence,
): ExperienceDistillationConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

function cleanSegment(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/^[\-*•]\s*/u, "")
      .replace(/^\d+[.)、]\s*/u, "")
      .replace(/^[一二三四五六七八九十]+[、.．]\s*/u, ""),
  );
}

function dedupeSegments(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();
    if (normalized.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function limitText(value: string, maxChars: number): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

function normalizeWhitespace(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function slugifyTag(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+/u, "")
    .replace(/_+$/u, "");
  return normalized.length === 0 ? "model" : normalized;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
