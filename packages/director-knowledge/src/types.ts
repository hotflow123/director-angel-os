export const DIRECTOR_KNOWLEDGE_PACK_SCHEMA_VERSION = "director.knowledge.pack.v1" as const;

export type KnowledgeState = "candidate" | "review" | "published" | "rollback" | "history";

export interface KnowledgePackMetadata {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  createdAt: string;
  author?: string;
  version: number;
}

export interface DirectorKnowledgePackMethod {
  sourceProposalId: string;
  sourceRecordId: string;
  sourceDigestId: string;
  projectId: string;
  groupId: string;
  goal: string;
  trigger: string;
  summary: string;
  explanation: string;
  evidenceSummary: string;
  roles: readonly string[];
  preferredAdapters: readonly string[];
  anchorIds: readonly string[];
  generationType?: string;
  generationStyle?: string;
}

export interface DirectorKnowledgePackAudit {
  publishedAt: string;
  author?: string;
  note?: string;
  sourceDecisionAt?: string;
  sourceDecisionNote?: string;
}

export interface DirectorKnowledgePackDocument {
  schemaVersion: typeof DIRECTOR_KNOWLEDGE_PACK_SCHEMA_VERSION;
  metadata: KnowledgePackMetadata;
  stage: "published";
  method: DirectorKnowledgePackMethod;
  audit: DirectorKnowledgePackAudit;
}

export interface KnowledgePackRecord {
  metadata: KnowledgePackMetadata;
  state: KnowledgeState;
  file: string;
  createdAt: string;
  method?: DirectorKnowledgePackMethod;
  reviewedBy?: string;
  reviewNotes?: string;
}

export interface MaterializeDirectorKnowledgePackOptions {
  author?: string;
  note?: string;
  now?: string;
}

export interface DirectorKnowledgeSourceProposal {
  readonly proposalId: string;
  readonly status: "pending" | "accepted" | "rejected";
  readonly recordId: string;
  readonly digestId: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly title: string;
  readonly summary: string;
  readonly trigger: string;
  readonly evidenceSummary: string;
  readonly explanation: string;
  readonly dedupeKey: string;
  readonly tags: readonly string[];
  readonly roles: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly latestDecision?: {
    readonly decidedAt: string;
    readonly note?: string;
  };
  readonly sourceRecord: {
    readonly anchorIds: readonly string[];
    readonly tags?: readonly string[];
    readonly digest: {
      readonly goal: string;
      readonly generationType?: string;
      readonly generationStyle?: string;
      readonly knowledgeSignalTags?: readonly string[];
    };
  };
}

export function materializeDirectorKnowledgePackFromProposal(
  proposal: DirectorKnowledgeSourceProposal,
  options: MaterializeDirectorKnowledgePackOptions = {},
): DirectorKnowledgePackDocument {
  if (proposal.status !== "accepted") {
    throw new Error("Director knowledge materialization requires an accepted trace proposal.");
  }

  const publishedAt = options.now ?? new Date().toISOString();
  const digest = proposal.sourceRecord.digest;

  return {
    schemaVersion: DIRECTOR_KNOWLEDGE_PACK_SCHEMA_VERSION,
    metadata: {
      id: createDirectorKnowledgePackId(proposal),
      title: proposal.title,
      description: proposal.explanation,
      tags: dedupeStrings([
        ...proposal.tags,
        ...(proposal.sourceRecord.tags ?? []),
        ...(digest.knowledgeSignalTags ?? []),
      ]),
      createdAt: publishedAt,
      ...(options.author === undefined ? {} : { author: options.author }),
      version: 1,
    },
    stage: "published",
    method: {
      sourceProposalId: proposal.proposalId,
      sourceRecordId: proposal.recordId,
      sourceDigestId: proposal.digestId,
      projectId: proposal.projectId,
      groupId: proposal.groupId,
      goal: digest.goal,
      trigger: proposal.trigger,
      summary: proposal.summary,
      explanation: proposal.explanation,
      evidenceSummary: proposal.evidenceSummary,
      roles: [...proposal.roles],
      preferredAdapters: [...proposal.selectedAdapters],
      anchorIds: [...proposal.sourceRecord.anchorIds],
      ...(digest.generationType === undefined ? {} : { generationType: digest.generationType }),
      ...(digest.generationStyle === undefined ? {} : { generationStyle: digest.generationStyle }),
    },
    audit: {
      publishedAt,
      ...(options.author === undefined ? {} : { author: options.author }),
      ...(options.note === undefined ? {} : { note: options.note }),
      ...(proposal.latestDecision?.decidedAt === undefined
        ? {}
        : { sourceDecisionAt: proposal.latestDecision.decidedAt }),
      ...(proposal.latestDecision?.note === undefined
        ? {}
        : { sourceDecisionNote: proposal.latestDecision.note }),
    },
  };
}

export function isDirectorKnowledgePackDocument(
  value: unknown,
): value is DirectorKnowledgePackDocument {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.schemaVersion === DIRECTOR_KNOWLEDGE_PACK_SCHEMA_VERSION &&
    value.stage === "published" &&
    isKnowledgePackMetadata(value.metadata) &&
    isDirectorKnowledgePackMethod(value.method) &&
    isDirectorKnowledgePackAudit(value.audit)
  );
}

export function isKnowledgePackMetadata(value: unknown): value is KnowledgePackMetadata {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isString(value.createdAt) &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version >= 1 &&
    (value.description === undefined || isString(value.description)) &&
    (value.author === undefined || isString(value.author)) &&
    (value.tags === undefined || isStringArray(value.tags))
  );
}

function isDirectorKnowledgePackMethod(value: unknown): value is DirectorKnowledgePackMethod {
  return (
    isObject(value) &&
    isString(value.sourceProposalId) &&
    isString(value.sourceRecordId) &&
    isString(value.sourceDigestId) &&
    isString(value.projectId) &&
    isString(value.groupId) &&
    isString(value.goal) &&
    isString(value.trigger) &&
    isString(value.summary) &&
    isString(value.explanation) &&
    isString(value.evidenceSummary) &&
    isStringArray(value.roles) &&
    isStringArray(value.preferredAdapters) &&
    isStringArray(value.anchorIds) &&
    (value.generationType === undefined || isString(value.generationType)) &&
    (value.generationStyle === undefined || isString(value.generationStyle))
  );
}

function isDirectorKnowledgePackAudit(value: unknown): value is DirectorKnowledgePackAudit {
  return (
    isObject(value) &&
    isString(value.publishedAt) &&
    (value.author === undefined || isString(value.author)) &&
    (value.note === undefined || isString(value.note)) &&
    (value.sourceDecisionAt === undefined || isString(value.sourceDecisionAt)) &&
    (value.sourceDecisionNote === undefined || isString(value.sourceDecisionNote))
  );
}

function createDirectorKnowledgePackId(proposal: DirectorKnowledgeSourceProposal): string {
  return `director-method-${slugify(proposal.dedupeKey || proposal.proposalId)}`;
}

function dedupeStrings(values: readonly string[]): string[] {
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

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  return normalized.length > 0 ? normalized : "pack";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}
