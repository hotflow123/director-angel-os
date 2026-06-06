import { createHash } from "node:crypto";

import {
  type CanonicalJsonValue,
  type ExperienceExtractionReport,
  type ExperiencePrivacyClassification,
  type ExperienceQualityAssessment,
  type ExperienceQuarantineRecord,
  type ExperienceSourceArtifact,
  type ExperienceSourceKind,
  createExperienceQuarantineRecord,
  createExperienceSourceArtifact,
} from "@hotflow/contracts";

export type ExperienceAdmissionProfile = "local-text" | "web-text" | "fetch-failure";

export interface ExperienceAdmissionRuleInput {
  readonly profile: ExperienceAdmissionProfile;
  readonly sourceKind: ExperienceSourceKind;
  readonly sourceRef: string;
  readonly readableContent: string;
  readonly rawContent: string;
  readonly contentType?: string;
}

export interface ExperienceAdmissionRuleResult {
  readonly reason: string;
  readonly scoreDelta: number;
  readonly metrics?: { readonly [key: string]: CanonicalJsonValue | undefined };
}

export interface ExperienceAdmissionRule {
  readonly ruleId: string;
  evaluate(input: ExperienceAdmissionRuleInput): ExperienceAdmissionRuleResult | null;
}

export interface ExperienceSourceAccessAssessmentInput {
  readonly sourceRef: string;
  readonly content?: string;
  readonly rawContent?: string;
  readonly qualityReasons?: readonly string[];
  readonly notes?: readonly string[];
  readonly quarantineReason?: string;
}

export interface ExperienceSourceAccessAssessment {
  readonly status: "available" | "source_access_limited";
  readonly reason?: string;
  readonly metrics: { readonly [key: string]: CanonicalJsonValue | undefined };
}

export interface ExperienceAdmissionInput {
  readonly profile: ExperienceAdmissionProfile;
  readonly sourceId: string;
  readonly sourceKind: ExperienceSourceKind;
  readonly sourceRef: string;
  readonly title?: string;
  readonly path?: string;
  readonly contentType?: string;
  readonly rawContent: string;
  readonly structuredContent?: CanonicalJsonValue;
  readonly fetchErrorMessage?: string;
  readonly privacy: ExperiencePrivacyClassification;
  readonly provenance: string;
  readonly capturedAtMs: number;
  readonly quarantineNotes: readonly string[];
}

export type ExperienceAdmissionDecision =
  | {
      readonly status: "accepted";
      readonly artifact: ExperienceSourceArtifact;
      readonly readableContent: string;
      readonly notes: readonly string[];
    }
  | {
      readonly status: "quarantined";
      readonly artifact: ExperienceSourceArtifact;
      readonly readableContent: string;
      readonly quarantine: ExperienceQuarantineRecord;
      readonly notes: readonly string[];
    };

export interface ExperienceAdmissionAdapter {
  readonly adapterId: string;
  readonly declaredTransformations: readonly string[];
  admit(input: ExperienceAdmissionInput): ExperienceAdmissionDecision;
}

export interface HeuristicExperienceAdmissionAdapterOptions {
  readonly extraRules?: readonly ExperienceAdmissionRule[];
  readonly minimumUsableScore?: number;
}

const DEFAULT_MIN_TEXT_CHARS = 40;
const DEFAULT_ARTIFACT_PREVIEW_CHARS = 1_200;
const DEFAULT_MINIMUM_USABLE_SCORE = 55;

export class HeuristicExperienceAdmissionAdapter implements ExperienceAdmissionAdapter {
  public readonly adapterId = "heuristic-experience-admission";

  public readonly declaredTransformations = [
    "html_readability_extract",
    "whitespace_normalize",
    "quality_gate",
    "quarantine_low_quality",
  ];

  private readonly extraRules: readonly ExperienceAdmissionRule[];
  private readonly minimumUsableScore: number;

  public constructor(options: HeuristicExperienceAdmissionAdapterOptions = {}) {
    this.extraRules = options.extraRules ?? [];
    this.minimumUsableScore = options.minimumUsableScore ?? DEFAULT_MINIMUM_USABLE_SCORE;
  }

  public admit(input: ExperienceAdmissionInput): ExperienceAdmissionDecision {
    const readableContent =
      input.profile === "web-text"
        ? extractExperienceReadableText(input.rawContent, input.contentType)
        : normalizeExperienceReadablePlainText(input.rawContent);
    const quality = this.assess({
      profile: input.profile,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      readableContent,
      rawContent: input.rawContent,
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      ...(input.fetchErrorMessage === undefined
        ? {}
        : {
            fetchErrorMessage: input.fetchErrorMessage,
          }),
    });
    const digest = buildExperienceSourceDigest(readableContent);
    const artifact = createExperienceSourceArtifact({
      artifactId: buildExperienceArtifactId(input.sourceId, input.sourceRef, digest),
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      digest,
      bytes: Buffer.byteLength(readableContent, "utf8"),
      textPreview: previewExperienceText(readableContent, DEFAULT_ARTIFACT_PREVIEW_CHARS),
      rawContent: input.rawContent,
      readableContent,
      ...(input.structuredContent === undefined
        ? {}
        : { structuredContent: input.structuredContent }),
      extractionReport: createExtractionReport(input, readableContent, quality),
      quality,
      privacy: input.privacy,
      provenance: input.provenance,
      capturedAtMs: input.capturedAtMs,
    });

    if (quality.verdict === "usable") {
      return {
        status: "accepted",
        artifact,
        readableContent,
        notes: [],
      };
    }

    const reason = quality.reasons[0] ?? "source did not pass experience admission gates";
    const quarantine = createExperienceQuarantineRecord({
      quarantineId: buildExperienceQuarantineId(artifact.artifactId, reason),
      artifact,
      reason,
      notes: input.quarantineNotes,
      createdAtMs: input.capturedAtMs,
    });
    return {
      status: "quarantined",
      artifact,
      readableContent,
      quarantine,
      notes: [formatAdmissionSkipNote(input, reason)],
    };
  }

  private assess(
    input: ExperienceAdmissionRuleInput & { readonly fetchErrorMessage?: string },
  ): ExperienceQualityAssessment {
    if (input.profile === "fetch-failure") {
      return {
        score: 0,
        verdict: "quarantine",
        reasons: ["source fetch failed before readable source content"],
        metrics: {
          error: input.fetchErrorMessage ?? input.readableContent,
        },
      };
    }

    const reasons: string[] = [];
    const metrics: Record<string, CanonicalJsonValue | undefined> = {};
    const ruleIds: string[] = [];
    let score = input.profile === "web-text" ? 100 : 90;
    const normalized = input.readableContent;

    if (normalized.length < DEFAULT_MIN_TEXT_CHARS) {
      reasons.push(
        input.profile === "web-text"
          ? "not enough readable text"
          : "not enough reusable local text",
      );
      score -= input.profile === "web-text" ? 70 : 50;
    }

    const webSourceBlocker =
      input.profile === "web-text"
        ? detectWebSourceAccessBlocker(input.sourceRef, normalized)
        : null;
    if (webSourceBlocker !== null) {
      reasons.push(webSourceBlocker.reason);
      score -= 100;
      Object.assign(metrics, webSourceBlocker.metrics);
    }

    if (input.profile === "web-text" && isLikelyLoginSource(input.sourceRef, normalized)) {
      reasons.push("authentication page rather than source content");
      score -= 90;
    }

    const noiseHits = countCodeOrStyleNoiseMarkers(normalized);
    if (noiseHits >= 2) {
      reasons.push("script or CSS noise rather than reusable guidance");
      score -= Math.min(noiseHits * 25, 80);
    }

    const readableRatio =
      input.rawContent.length === 0 ? 1 : normalized.length / input.rawContent.length;
    if (input.profile === "web-text" && input.rawContent.length > 4_000 && readableRatio < 0.04) {
      reasons.push("readable text ratio is too low");
      score -= 35;
    }

    const uniqueTerms = countUniqueTerms(normalized);
    if (isConversationNoiseSource(normalized)) {
      reasons.push("conversation noise rather than reusable guidance");
      score -= 80;
    }

    if (normalized.length >= DEFAULT_MIN_TEXT_CHARS && uniqueTerms < 8) {
      reasons.push(
        input.profile === "web-text"
          ? "readable text is too repetitive"
          : "local text is too repetitive",
      );
      score -= 25;
    }

    for (const rule of this.extraRules) {
      const result = rule.evaluate(input);
      if (result === null) {
        continue;
      }
      ruleIds.push(rule.ruleId);
      score += result.scoreDelta;
      if (result.reason.length > 0) {
        reasons.push(result.reason);
      }
      Object.assign(metrics, result.metrics ?? {});
    }

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const verdict =
      reasons.length === 0 || normalizedScore >= this.minimumUsableScore ? "usable" : "quarantine";
    return {
      score: normalizedScore,
      verdict,
      reasons:
        reasons.length === 0
          ? [
              input.profile === "web-text"
                ? "readable source content captured"
                : "local text artifact captured for review-gated learning",
            ]
          : reasons,
      metrics: {
        readableChars: normalized.length,
        rawBytes: Buffer.byteLength(input.rawContent, "utf8"),
        readableRatio: Number(readableRatio.toFixed(4)),
        noiseMarkerHits: noiseHits,
        uniqueTerms,
        ...(ruleIds.length === 0 ? {} : { ruleIds }),
        ...metrics,
      },
    };
  }
}

export function buildExperienceSourceDigest(value: string): string {
  return `sha256:${sha256(value)}`;
}

export function buildExperienceCursor(parts: readonly string[]): string {
  return `sha256:${sha256(parts.join("\n"))}`;
}

export function buildExperienceArtifactId(
  sourceId: string,
  sourceRef: string,
  digest: string,
): string {
  return `artifact_${slugify(sourceId)}_${shortHash(`${sourceRef}:${digest}`)}`;
}

export function buildExperienceQuarantineId(artifactId: string, reason: string): string {
  return `quarantine_${slugify(artifactId)}_${shortHash(reason)}`;
}

export function summarizeExperienceContent(content: string): string {
  const normalized = normalizeExperienceWhitespace(content);
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

export function previewExperienceText(content: string, maxChars: number): string {
  const normalized = normalizeExperienceReadablePlainText(content);
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

export function limitExperienceTextByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  return value.slice(0, maxBytes);
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+/u, "")
    .replace(/_+$/u, "");
  return slug.length === 0 ? "source" : slug;
}

export function shortHash(value: string): string {
  return sha256(value).slice(0, 12);
}

function formatAdmissionSkipNote(input: ExperienceAdmissionInput, reason: string): string {
  if (input.sourceKind === "web-search") {
    return `Skipped ${input.sourceRef}: ${reason}.`;
  }
  if (input.sourceKind === "web-page") {
    return `Quarantined ${input.sourceRef}: ${reason}.`;
  }
  return `Skipped ${input.path ?? input.sourceRef}: ${reason}.`;
}

function createExtractionReport(
  input: ExperienceAdmissionInput,
  readableContent: string,
  quality: ExperienceQualityAssessment,
): ExperienceExtractionReport {
  const failed = input.profile === "fetch-failure";
  return {
    status: failed ? "failed" : quality.verdict === "usable" ? "ok" : "partial",
    readableChars: readableContent.length,
    rawChars: input.rawContent.length,
    transformations: createExtractionTransformations(input.profile, quality),
    notes: quality.reasons,
    ...(failed
      ? { unavailable: ["readable source content", "candidate extraction"] }
      : quality.verdict === "quarantine"
        ? { unavailable: ["candidate extraction"] }
        : {}),
  };
}

function createExtractionTransformations(
  profile: ExperienceAdmissionProfile,
  quality: ExperienceQualityAssessment,
): string[] {
  const transformations =
    profile === "web-text"
      ? ["html_readability_extract", "whitespace_normalize", "quality_gate"]
      : profile === "fetch-failure"
        ? ["fetch_failure_record", "quality_gate"]
        : ["whitespace_normalize", "quality_gate"];
  return quality.verdict === "quarantine"
    ? [...transformations, "quarantine_low_quality"]
    : transformations;
}

function extractExperienceReadableText(body: string, contentType: string | undefined): string {
  if (contentType?.includes("html") === false && !looksLikeHtml(body)) {
    return normalizeExperienceReadablePlainText(body);
  }

  return normalizeExperienceWhitespace(
    body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  );
}

function normalizeExperienceReadablePlainText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/gu, " "))
    .join("\n")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

function normalizeExperienceWhitespace(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isLikelyLoginSource(sourceRef: string, content: string): boolean {
  let loginUrl = false;
  try {
    const url = new URL(sourceRef);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    loginUrl =
      host.startsWith("accounts.") ||
      host.includes(".accounts.") ||
      path.includes("login") ||
      path.includes("signin") ||
      path.includes("auth");
  } catch {
    loginUrl = false;
  }

  return (
    loginUrl ||
    /扫码登录|登录后继续|login_redirect|login required|sign in to continue/iu.test(content)
  );
}

function detectWebSourceAccessBlocker(
  sourceRef: string,
  content: string,
): ExperienceAdmissionRuleResult | null {
  const assessment = assessExperienceSourceAccess({
    sourceRef,
    content,
    rawContent: content,
  });
  if (assessment.status === "source_access_limited") {
    return {
      reason: assessment.reason ?? "source access limited",
      scoreDelta: -100,
      metrics: assessment.metrics,
    };
  }
  return null;
}

export function assessExperienceSourceAccess(
  input: ExperienceSourceAccessAssessmentInput,
): ExperienceSourceAccessAssessment {
  const content = [
    input.quarantineReason,
    ...(input.qualityReasons ?? []),
    input.content,
    input.rawContent,
    ...(input.notes ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
  const dynamicShellMarkerHits = countDynamicApplicationShellMarkers(input.sourceRef, content);
  if (dynamicShellMarkerHits >= 2) {
    return {
      status: "source_access_limited",
      reason: "dynamic application shell rather than source content",
      metrics: {
        dynamicShellMarkerHits,
        sourceAccessStatus: "source_access_limited",
      },
    };
  }
  const challengeMarkerHits = countSourceAccessChallengeMarkers(content);
  if (challengeMarkerHits >= 1) {
    return {
      status: "source_access_limited",
      reason: "source access challenge rather than source content",
      metrics: {
        sourceAccessChallengeMarkerHits: challengeMarkerHits,
        sourceAccessStatus: "source_access_limited",
      },
    };
  }
  return {
    status: "available",
    metrics: {},
  };
}

function countDynamicApplicationShellMarkers(sourceRef: string, content: string): number {
  const host = readHostname(sourceRef);
  const markers = [
    /JavaScript is not available/iu,
    /enable JavaScript(?: or switch to a supported browser)?/iu,
    /Something went wrong,\s*but don[’']t fret/iu,
    /privacy related extensions may cause issues/iu,
    /__SCRIPTS_LOADED__/u,
    /_sentryDebugIds|_sentryDebugIdIdentifier|sentry-dbid/iu,
    /SENTRY_RELEASE/u,
    /webpackChunk|__webpack|webpackJsonp/u,
    /unsupported browser/iu,
    /\bwindow\.[A-Z0-9_]+\s*=/u,
    /Use ESM export syntax/iu,
    /function\s+_typeof\s*\(/iu,
    /Object\.prototype\.hasOwnProperty\.call/iu,
    /\bf\.o=\(e,\s*a\)=>/u,
    /\bf\.l=\(e,\s*a,\s*r,\s*n\)=>/u,
  ];
  const markerHits = markers.filter((marker) => marker.test(content)).length;
  const hostBonus = host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" ? 1 : 0;
  return markerHits + hostBonus;
}

function countSourceAccessChallengeMarkers(content: string): number {
  const markers = [
    /当前环境异常/u,
    /环境异常.*完成验证后即可继续访问/u,
    /完成验证后即可继续访问/u,
    /weixin\.sogou\.com\/antispider/iu,
    /请输入验证码|验证后继续|访问过于频繁/u,
    /captcha|anti[- ]?bot|bot detection/iu,
    /登录后(?:继续|查看)|扫码登录/u,
  ];
  return markers.filter((marker) => marker.test(content)).length;
}

function readHostname(sourceRef: string): string {
  try {
    return new URL(sourceRef).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function countCodeOrStyleNoiseMarkers(content: string): number {
  const markers = [
    /@babel\/helpers/iu,
    /function\s+_typeof\s*\(/iu,
    /Symbol\.iterator/iu,
    /__webpack|webpackJsonp|webpackChunk/iu,
    /data-elem-id/iu,
    /@media\s+screen/iu,
    /justify-content\s*:/iu,
    /align-items\s*:/iu,
    /display\s*:\s*flex/iu,
    /padding\s*:\s*\d/iu,
  ];
  return markers.filter((marker) => marker.test(content)).length;
}

function countUniqueTerms(content: string): number {
  const terms = normalizeExperienceWhitespace(content.toLowerCase()).match(/[\p{L}\p{N}_-]{2,}/gu);
  return new Set(terms ?? []).size;
}

function isConversationNoiseSource(value: string): boolean {
  const hasReusableGuidance =
    /(?:步骤|规则|流程|适用|避免|必须|应该|建议|经验|方法|标准|检查|审核|证据|提炼|复用|review|gate|use when|pattern|must|should)/iu.test(
      value,
    );
  if (hasReusableGuidance) {
    return false;
  }
  return /(?:今天天气|天气不错|随便聊聊|随便说说|闲聊|没事|挺开心|心情|喝咖啡|吃饭|朋友聊天|日常|流水账|我今天|我刚刚|我喜欢|我不喜欢)/iu.test(
    value,
  );
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/iu.test(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
