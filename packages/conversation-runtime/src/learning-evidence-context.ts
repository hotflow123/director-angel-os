export const LEARNING_EVIDENCE_CONTEXT_TAG = "learning-evidence-context";
export const DEFAULT_LEARNING_EVIDENCE_CONTEXT_MAX_CHARS = 32_000;
export const DEFAULT_LEARNING_EVIDENCE_DOCUMENT_MAX_CHARS = 8_000;
export const DEFAULT_LEARNING_EVIDENCE_DISCLOSURE_MAX_CHARS = 6_000;
export const DEFAULT_LEARNING_EVIDENCE_CONTEXT_MAX_TOKENS = 4_000;
const LEARNING_EVIDENCE_CONTEXT_TOKEN_BUFFER_RATIO = 0.8;

export interface LearningEvidenceContextBuildInput {
  readonly toolContent: string;
  readonly candidates: readonly Readonly<Record<string, unknown>>[];
  readonly evidenceDisclosure?: unknown;
  readonly maxChars?: number;
  readonly documentMaxChars?: number;
  readonly disclosureMaxChars?: number;
  readonly maxEstimatedTokens?: number;
  readonly activeCandidateIds?: readonly string[];
  readonly activeSourceUrls?: readonly string[];
}

export interface LearningEvidenceContextBuildResult {
  readonly content: string;
  readonly wasTruncated: boolean;
  readonly originalChars: number;
  readonly maxChars: number;
  readonly candidateCount: number;
  readonly estimatedTokens: number;
  readonly maxEstimatedTokens: number;
  readonly effectiveTokenBudget: number;
  readonly selectedCandidateIds: readonly string[];
  readonly omittedCandidateCount: number;
}

export function buildLearningEvidenceContext(
  input: LearningEvidenceContextBuildInput,
): LearningEvidenceContextBuildResult | undefined {
  if (input.candidates.length === 0) {
    return undefined;
  }
  const maxChars = input.maxChars ?? DEFAULT_LEARNING_EVIDENCE_CONTEXT_MAX_CHARS;
  const documentMaxChars = input.documentMaxChars ?? DEFAULT_LEARNING_EVIDENCE_DOCUMENT_MAX_CHARS;
  const disclosureMaxChars =
    input.disclosureMaxChars ?? DEFAULT_LEARNING_EVIDENCE_DISCLOSURE_MAX_CHARS;
  const maxEstimatedTokens =
    input.maxEstimatedTokens ?? DEFAULT_LEARNING_EVIDENCE_CONTEXT_MAX_TOKENS;
  const effectiveTokenBudget = Math.max(
    1,
    Math.floor(maxEstimatedTokens * LEARNING_EVIDENCE_CONTEXT_TOKEN_BUFFER_RATIO),
  );
  const evidenceDisclosure =
    input.evidenceDisclosure === undefined
      ? undefined
      : truncateLearningEvidenceText(JSON.stringify(input.evidenceDisclosure, null, 2), {
          maxChars: disclosureMaxChars,
          label: "evidence disclosure",
        });
  const rankedCandidateEntries = rankLearningEvidenceCandidateEntries(input.candidates, {
    activeCandidateIds: input.activeCandidateIds ?? [],
    activeSourceUrls: input.activeSourceUrls ?? [],
  });
  const rankedCandidates = rankedCandidateEntries.map((entry) => entry.candidate);
  const prefix = [
    input.toolContent,
    "",
    `<${LEARNING_EVIDENCE_CONTEXT_TAG}>`,
    "[System note: These are local pending experience candidates and source evidence returned by the tool. Treat them as reference data for answering the user. Do not present this XML fence to the user.]",
    ...(evidenceDisclosure === undefined
      ? []
      : ["", "evidence_disclosure:", evidenceDisclosure.text]),
    "",
  ].join("\n");
  const contextOverheadTokens = estimateLearningEvidenceTokens(
    [prefix, `</${LEARNING_EVIDENCE_CONTEXT_TAG}>`].join("\n"),
  );
  const compressibleCandidateCount = Math.max(
    1,
    Math.min(
      4,
      rankedCandidateEntries.filter((entry) => shouldCompressCandidateByScore(entry.score)).length,
    ),
  );
  const candidateTokenBudget = Math.max(
    64,
    Math.floor(
      Math.max(1, effectiveTokenBudget - contextOverheadTokens - 16) / compressibleCandidateCount,
    ),
  );
  const renderedCandidates = rankedCandidateEntries.map((entry, index) => {
    const rendered = renderLearningEvidenceCandidate(entry.candidate, index + 1, documentMaxChars);
    return shouldCompressCandidateByScore(entry.score)
      ? compressRenderedLearningEvidenceCandidate(rendered, candidateTokenBudget)
      : rendered;
  });
  const selectedCandidates: Array<{
    readonly candidate: Readonly<Record<string, unknown>>;
    readonly content: string;
    readonly wasTruncated: boolean;
  }> = [];
  let omittedCandidateCount = 0;
  for (const rendered of renderedCandidates) {
    const nextBody = [...selectedCandidates.map((candidate) => candidate.content), rendered.content]
      .filter((item) => item.length > 0)
      .join("\n\n");
    const nextContent = [prefix, nextBody, `</${LEARNING_EVIDENCE_CONTEXT_TAG}>`].join("\n");
    if (
      selectedCandidates.length > 0 &&
      estimateLearningEvidenceTokens(nextContent) > effectiveTokenBudget
    ) {
      omittedCandidateCount += 1;
      continue;
    }
    selectedCandidates.push(rendered);
  }
  const omittedLine =
    omittedCandidateCount === 0
      ? ""
      : `[... ${omittedCandidateCount} lower-priority candidate(s) omitted by evidence budget.]`;
  const body = [
    ...(omittedLine.length === 0 ? [] : [omittedLine]),
    ...selectedCandidates.map((candidate) => candidate.content),
  ].join("\n\n");
  const rawContent = [prefix, body, `</${LEARNING_EVIDENCE_CONTEXT_TAG}>`].join("\n");
  const truncated = truncateLearningEvidenceContext(rawContent, {
    maxChars,
    effectiveTokenBudget,
    label: "learning evidence context",
  });
  return {
    content: truncated.text,
    wasTruncated:
      truncated.wasTruncated ||
      evidenceDisclosure?.wasTruncated === true ||
      selectedCandidates.some((candidate) => candidate.wasTruncated) ||
      omittedCandidateCount > 0,
    originalChars: rawContent.length,
    maxChars,
    candidateCount: input.candidates.length,
    estimatedTokens: estimateLearningEvidenceTokens(truncated.text),
    maxEstimatedTokens,
    effectiveTokenBudget,
    selectedCandidateIds: selectedCandidates
      .map((candidate) => readLearningEvidenceCandidateId(candidate.candidate))
      .filter((candidateId): candidateId is string => candidateId !== undefined),
    omittedCandidateCount,
  };
}

export function estimateLearningEvidenceTokens(text: string): number {
  const urls = text.match(/https?:\/\/[^\s]+/giu) ?? [];
  const withoutUrls = urls.reduce((value, url) => value.replace(url, " "), text);
  const cjkCount = withoutUrls.match(/[\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const wordCount =
    withoutUrls.match(/[A-Za-z0-9][A-Za-z0-9_-]*(?:'[A-Za-z0-9_-]+)?/gu)?.length ?? 0;
  const jsonPunctuationCount = withoutUrls.match(/[{}[\]":,]/gu)?.length ?? 0;
  return cjkCount + wordCount + urls.length * 10 + Math.ceil(jsonPunctuationCount / 4);
}

function renderLearningEvidenceCandidate(
  candidate: Readonly<Record<string, unknown>>,
  ordinal: number,
  documentMaxChars: number,
): {
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly content: string;
  readonly wasTruncated: boolean;
} {
  const sourceDocument = isRecord(candidate.sourceDocument) ? candidate.sourceDocument : undefined;
  const risks = readStringList(candidate.risks);
  const sourceDocumentContent = truncateLearningEvidenceText(
    (sourceDocument === undefined
      ? undefined
      : (readRecordString(sourceDocument, "content") ??
        readRecordString(sourceDocument, "rawContent"))) ?? "",
    {
      maxChars: documentMaxChars,
      label: "source document",
    },
  );
  const fields = [
    `candidate ${ordinal}:`,
    ...renderLearningEvidenceField(
      "id",
      readRecordString(candidate, "id") ?? readRecordString(candidate, "candidateId"),
    ),
    ...renderLearningEvidenceField("title", readRecordString(candidate, "title")),
    ...renderLearningEvidenceField("summary", readRecordString(candidate, "summary")),
    ...renderLearningEvidenceField(
      "applicability",
      filterInternalLearningEvidenceApplicability(
        readRecordString(candidate, "applicability") ??
          readRecordString(candidate, "reusable_method"),
      ),
    ),
    ...renderLearningEvidenceField(
      "content_quality",
      readRecordString(candidate, "contentQuality"),
    ),
    ...(risks.length === 0 ? [] : ["risks:", ...risks.map((risk) => `- ${risk}`)]),
    ...renderLearningEvidenceField(
      "media_understanding",
      readRecordString(candidate, "mediaUnderstanding"),
    ),
    ...renderLearningEvidenceField(
      "evidence_preview",
      readRecordString(candidate, "evidencePreview"),
    ),
    ...renderLearningEvidenceField(
      "source_ref",
      readRecordString(candidate, "sourceRef") ?? readRecordString(candidate, "rawSourceRef"),
    ),
    ...renderLearningEvidenceField(
      "source_document_title",
      sourceDocument === undefined ? undefined : readRecordString(sourceDocument, "title"),
    ),
    ...renderLearningEvidenceField(
      "source_document_ref",
      sourceDocument === undefined ? undefined : readRecordString(sourceDocument, "sourceRef"),
    ),
    ...renderLearningEvidenceField("source_document_content", sourceDocumentContent.text),
  ];
  return {
    candidate,
    content: fields.join("\n"),
    wasTruncated: sourceDocumentContent.wasTruncated,
  };
}

function filterInternalLearningEvidenceApplicability(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    /Use when Director Angel|user-pasted material|distilled claims|preserved source evidence|Privacy classification|raw source remains evidence|must not bypass review/iu.test(
      value,
    )
  ) {
    return undefined;
  }
  return value;
}

function rankLearningEvidenceCandidateEntries(
  candidates: readonly Readonly<Record<string, unknown>>[],
  input: {
    readonly activeCandidateIds: readonly string[];
    readonly activeSourceUrls: readonly string[];
  },
): readonly {
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly index: number;
  readonly score: number;
}[] {
  const activeCandidateIds = new Set(input.activeCandidateIds.map((item) => item.trim()));
  const activeSourceUrls = new Set(input.activeSourceUrls.map(normalizeLearningEvidenceUrl));
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreLearningEvidenceCandidate(candidate, activeCandidateIds, activeSourceUrls),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

function scoreLearningEvidenceCandidate(
  candidate: Readonly<Record<string, unknown>>,
  activeCandidateIds: ReadonlySet<string>,
  activeSourceUrls: ReadonlySet<string>,
): number {
  const candidateId = readLearningEvidenceCandidateId(candidate);
  const sourceUrl = readLearningEvidenceCandidateSourceUrl(candidate);
  const sourceDocument = isRecord(candidate.sourceDocument) ? candidate.sourceDocument : undefined;
  const sourceDocumentContent =
    sourceDocument === undefined
      ? undefined
      : (readRecordString(sourceDocument, "content") ??
        readRecordString(sourceDocument, "rawContent"));
  const text = [
    readRecordString(candidate, "title"),
    readRecordString(candidate, "summary"),
    readRecordString(candidate, "contentQuality"),
    readRecordString(candidate, "evidencePreview"),
    sourceDocumentContent,
  ]
    .filter((item): item is string => item !== undefined)
    .join("\n");
  let score = 0;
  if (candidateId !== undefined && activeCandidateIds.has(candidateId)) {
    score += 1_000;
  }
  if (sourceUrl !== undefined && activeSourceUrls.has(normalizeLearningEvidenceUrl(sourceUrl))) {
    score += 900;
  }
  const status = readRecordString(candidate, "status")?.toLocaleLowerCase();
  if (status === "accepted" || status === "pending") {
    score += 120;
  } else if (status === "rejected") {
    score -= 200;
  }
  if (/(正文可用|可读正文|readable|available)/iu.test(text)) {
    score += 120;
  }
  if (sourceDocumentContent !== undefined && sourceDocumentContent.trim().length > 80) {
    score += 80;
  }
  if (/主要是.*(登录|注册|侧栏)|不能算成功学习正文|登录\/注册/iu.test(text)) {
    score -= 240;
  }
  return score;
}

function shouldCompressCandidateByScore(score: number): boolean {
  return score >= 200;
}

function compressRenderedLearningEvidenceCandidate(
  rendered: {
    readonly candidate: Readonly<Record<string, unknown>>;
    readonly content: string;
    readonly wasTruncated: boolean;
  },
  tokenBudget: number,
): {
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly content: string;
  readonly wasTruncated: boolean;
} {
  if (estimateLearningEvidenceTokens(rendered.content) <= tokenBudget) {
    return rendered;
  }
  const contentLabel = "source_document_content: ";
  const contentIndex = rendered.content.indexOf(contentLabel);
  if (contentIndex === -1) {
    return rendered;
  }
  const prefix = rendered.content.slice(0, contentIndex + contentLabel.length);
  const sourceDocumentContent = rendered.content.slice(contentIndex + contentLabel.length);
  const marker =
    "\n[... source document truncated; full evidence is preserved in source/tool records.]";
  const minimumContent = `${prefix}${marker.trimStart()}`;
  if (estimateLearningEvidenceTokens(minimumContent) > tokenBudget) {
    return {
      ...rendered,
      content: minimumContent,
      wasTruncated: true,
    };
  }
  let low = 0;
  let high = sourceDocumentContent.length;
  let best = "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateContent = `${prefix}${sourceDocumentContent.slice(0, mid).trimEnd()}${marker}`;
    if (estimateLearningEvidenceTokens(candidateContent) <= tokenBudget) {
      best = candidateContent;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return {
    ...rendered,
    content: best.length > 0 ? best : minimumContent,
    wasTruncated: true,
  };
}

function readLearningEvidenceCandidateId(
  candidate: Readonly<Record<string, unknown>>,
): string | undefined {
  return readRecordString(candidate, "id") ?? readRecordString(candidate, "candidateId");
}

function readLearningEvidenceCandidateSourceUrl(
  candidate: Readonly<Record<string, unknown>>,
): string | undefined {
  const sourceDocument = isRecord(candidate.sourceDocument) ? candidate.sourceDocument : undefined;
  return (
    readRecordString(candidate, "sourceRef") ??
    readRecordString(candidate, "rawSourceRef") ??
    (sourceDocument === undefined ? undefined : readRecordString(sourceDocument, "sourceRef"))
  );
}

function normalizeLearningEvidenceUrl(value: string): string {
  return value
    .trim()
    .replace(/[）)\]】,，。；;\s]+$/gu, "")
    .replace(/^https?:\/\//iu, "");
}

function truncateLearningEvidenceText(
  content: string,
  input: {
    readonly maxChars: number;
    readonly label: string;
  },
): { readonly text: string; readonly wasTruncated: boolean } {
  if (content.length <= input.maxChars) {
    return { text: content, wasTruncated: false };
  }
  if (input.maxChars <= 32) {
    return {
      text: content.slice(0, input.maxChars),
      wasTruncated: true,
    };
  }
  const marker = `\n[... ${input.label} truncated; full evidence is preserved in source/tool records.]`;
  const sliceLength = Math.max(0, input.maxChars - marker.length);
  return {
    text: `${content.slice(0, sliceLength).trimEnd()}${marker}`,
    wasTruncated: true,
  };
}

function truncateLearningEvidenceContext(
  content: string,
  input: {
    readonly maxChars: number;
    readonly effectiveTokenBudget: number;
    readonly label: string;
  },
): { readonly text: string; readonly wasTruncated: boolean } {
  const estimatedTokens = estimateLearningEvidenceTokens(content);
  if (content.length <= input.maxChars && estimatedTokens <= input.effectiveTokenBudget) {
    return { text: content, wasTruncated: false };
  }
  const tokenRatio =
    estimatedTokens <= input.effectiveTokenBudget
      ? 1
      : input.effectiveTokenBudget / Math.max(1, estimatedTokens);
  const targetChars = Math.max(
    32,
    Math.min(input.maxChars, Math.floor(content.length * tokenRatio)),
  );
  const marker = `\n[... ${input.label} truncated; full evidence is preserved in source/tool records.]`;
  const closeTag = `</${LEARNING_EVIDENCE_CONTEXT_TAG}>`;
  const closeIndex = content.lastIndexOf(closeTag);
  if (closeIndex === -1) {
    return truncateLearningEvidenceText(content, {
      maxChars: targetChars,
      label: input.label,
    });
  }
  const prefixAndBody = content.slice(0, closeIndex).trimEnd();
  const suffix = content.slice(closeIndex);
  const sliceLength = Math.max(0, targetChars - marker.length - suffix.length - 1);
  return {
    text: `${prefixAndBody.slice(0, sliceLength).trimEnd()}${marker}\n${suffix}`,
    wasTruncated: true,
  };
}

function renderLearningEvidenceField(label: string, value: string | undefined): readonly string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }
  return [`${label}: ${value.trim()}`];
}

function readStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readRecordString(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const item = value?.[key];
  return typeof item === "string" && item.trim().length > 0 ? item : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
