import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExperienceCandidate, ProposalRecord, ProposalStatus } from "@hotflow/contracts";
import { SessionStore } from "@hotflow/sessions";
import {
  FileSkillTaxonomyStore,
  SKILL_SNAPSHOT_UPSERT_KIND,
  type SkillCategoryRecord,
  SkillSafeApplyService,
  type SkillSnapshot,
  SkillSnapshotFileStore,
  type SkillTagRecord,
  type SkillTaxonomySnapshot,
  decodeSkillProposal,
  generateSkillProposalFromExperienceCandidate,
  resolveApprovedSkillSnapshotPath,
} from "@hotflow/skills";
import { SessionStoreTaskPlanePort } from "@hotflow/tasks-core";

import { inspectDirectorExperienceCandidates } from "./director-knowledge.js";

const DIRECTOR_SKILL_SESSION_ID = "director-angel-desktop";
const SKILL_PROPOSAL_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "applied",
  "expired",
] as const satisfies readonly ProposalStatus[];

export interface ProposeDirectorSkillFromExperienceInput {
  readonly candidateId: string;
  readonly author?: string;
  readonly nowMs?: number;
}

export interface DecideDirectorSkillProposalInput {
  readonly proposalId: string;
  readonly note?: string;
}

export interface ClassifyDirectorSkillInput {
  readonly skillId: string;
  readonly categoryId: string;
  readonly tagIds?: readonly string[];
  readonly author?: string;
  readonly nowMs?: number;
}

export interface TagDirectorSkillInput {
  readonly skillId: string;
  readonly tagIds: readonly string[];
  readonly author?: string;
  readonly nowMs?: number;
}

export async function listDirectorSkills(dataDir: string): Promise<string> {
  const snapshotPath = resolveApprovedSkillSnapshotPath({ dataDir });
  const skillStore = new SkillSnapshotFileStore(snapshotPath);
  const taxonomyStore = createSkillTaxonomyStore(dataDir);
  const [head, taxonomy, proposals] = await Promise.all([
    readApprovedSkillHead(skillStore),
    taxonomyStore.inspectTaxonomy(),
    listDirectorSkillProposalRecords(dataDir),
  ]);
  const approved = head?.skills ?? [];
  const selfCount = approved.filter(isSelfEvolvedSkill).length;
  const externalCount = approved.length - selfCount;
  const proposalCounts = countSkillProposals(proposals);
  const lines = [
    "Director Skills:",
    `  approved: ${approved.length}`,
    `  self-evolved: ${selfCount}`,
    `  external: ${externalCount}`,
    `  proposals: ${proposals.length} pending=${proposalCounts.pending} accepted=${proposalCounts.accepted} applied=${proposalCounts.applied} rejected=${proposalCounts.rejected}`,
    `  snapshot: ${snapshotPath}`,
    `  proposal queue: ${resolveDirectorSkillSessionDbPath(dataDir)}`,
  ];

  if (approved.length > 0) {
    lines.push("  approved skills:");
    for (const skill of approved) {
      const binding = resolveSkillTaxonomyBinding(taxonomy, skill.id);
      lines.push(
        `  - ${skill.id} source=${isSelfEvolvedSkill(skill) ? "self" : "external"} category=${binding?.categoryId ?? "uncategorized"} tags=${binding?.tagIds.join(",") || "(none)"}`,
      );
      lines.push(`    title: ${skill.title}`);
    }
  }

  if (proposals.length > 0) {
    lines.push("  proposals:");
    for (const proposal of proposals) {
      const decoded = decodeSkillProposal(proposal);
      lines.push(
        `  - ${proposal.id} status=${proposal.status} skill=${decoded?.snapshot.id ?? "(invalid)"}`,
      );
      lines.push(`    title: ${decoded?.snapshot.title ?? proposal.id}`);
      if (decoded?.riskLevel !== undefined || decoded?.confidence !== undefined) {
        lines.push(
          `    review: risk=${decoded?.riskLevel ?? "(unknown)"} confidence=${decoded?.confidence ?? "(unknown)"}`,
        );
      }
    }
  }

  return lines.join("\n");
}

export async function proposeDirectorSkillFromExperience(
  workspaceRoot: string,
  dataDir: string,
  input: ProposeDirectorSkillFromExperienceInput,
): Promise<string> {
  const experience = await inspectDirectorExperienceCandidates(workspaceRoot);
  const entry = experience.candidates.find(
    (candidateEntry) => candidateEntry.candidate.candidateId === input.candidateId,
  );
  if (entry === undefined) {
    throw new Error(`Unknown experience candidate: ${input.candidateId}`);
  }
  if (entry.status !== "accepted" && !entry.promoted) {
    throw new Error(
      `Experience candidate ${input.candidateId} must be accepted before proposing a Skill.`,
    );
  }

  const nowMs = input.nowMs ?? Date.now();
  const { proposal, skillId } = createSkillProposalQueueInputFromExperience(entry.candidate, {
    ...(input.author === undefined ? {} : { author: input.author }),
    nowMs,
  });
  await withDirectorSkillTaskPlane(dataDir, { createIfMissing: true }, async (taskPlane) => {
    await taskPlane.enqueueProposal(proposal);
  });

  return [
    "Director Skill proposal created:",
    `  proposal: ${proposal.id}`,
    `  skill: ${skillId}`,
    `  source experience: ${input.candidateId}`,
    "  status: pending",
  ].join("\n");
}

export async function acceptDirectorSkillProposal(
  dataDir: string,
  input: DecideDirectorSkillProposalInput,
): Promise<string> {
  const proposal = await transitionDirectorSkillProposal(dataDir, {
    ...input,
    status: "accepted",
  });
  return [
    "Director Skill proposal accepted:",
    `  proposal: ${proposal.id}`,
    `  skill: ${decodeSkillProposal(proposal)?.snapshot.id ?? "(invalid)"}`,
    `  status: ${proposal.status}`,
  ].join("\n");
}

export async function rejectDirectorSkillProposal(
  dataDir: string,
  input: DecideDirectorSkillProposalInput,
): Promise<string> {
  const proposal = await transitionDirectorSkillProposal(dataDir, {
    ...input,
    status: "rejected",
  });
  return [
    "Director Skill proposal rejected:",
    `  proposal: ${proposal.id}`,
    `  skill: ${decodeSkillProposal(proposal)?.snapshot.id ?? "(invalid)"}`,
    `  status: ${proposal.status}`,
  ].join("\n");
}

export async function applyDirectorSkillProposal(
  dataDir: string,
  proposalId: string,
): Promise<string> {
  const result = await withDirectorSkillTaskPlane(
    dataDir,
    { createIfMissing: false },
    async (taskPlane) => {
      const proposal = await readDirectorSkillProposal(taskPlane, proposalId);
      if (proposal.status !== "accepted") {
        throw new Error(`Skill proposal ${proposalId} must be accepted before apply.`);
      }
      const applyService = new SkillSafeApplyService(
        new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir })),
      );
      const applyResult = applyService.applyAcceptedProposal(proposal);
      try {
        await taskPlane.transitionProposal({ proposalId, status: "applied" });
      } catch (error) {
        applyService.revertAppliedProposal(applyResult);
        throw error;
      }
      return applyResult;
    },
  );

  return [
    "Director Skill proposal applied:",
    `  proposal: ${proposalId}`,
    `  skill: ${result.skillId}`,
    `  operation: ${result.operation}`,
    `  snapshot version: ${result.snapshotVersion}`,
    `  approved skills: ${result.approvedSkillCount}`,
  ].join("\n");
}

export async function classifyDirectorSkill(
  dataDir: string,
  input: ClassifyDirectorSkillInput,
): Promise<string> {
  assertApprovedSkillExists(dataDir, input.skillId);
  const taxonomyStore = createSkillTaxonomyStore(dataDir);
  const taxonomy = await taxonomyStore.inspectTaxonomy();
  const category = await resolveOrCreateSkillCategory(taxonomyStore, taxonomy, input.categoryId);
  const current = await taxonomyStore.readSkillTaxonomy(input.skillId);
  const tagIds =
    input.tagIds === undefined
      ? (current?.tagIds ?? [])
      : await resolveOrCreateSkillTagIds(taxonomyStore, taxonomy, input.tagIds);
  const binding = await taxonomyStore.updateSkillTaxonomy({
    skillId: input.skillId,
    categoryId: category.categoryId,
    tagIds,
    ...(input.author === undefined ? {} : { updatedBy: input.author }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });

  return [
    "Director Skill classified:",
    `  skill: ${binding.skillId}`,
    `  category: ${binding.categoryId ?? "(none)"}`,
    `  tags: ${binding.tagIds.join(", ") || "(none)"}`,
  ].join("\n");
}

export async function tagDirectorSkill(
  dataDir: string,
  input: TagDirectorSkillInput,
): Promise<string> {
  assertApprovedSkillExists(dataDir, input.skillId);
  const taxonomyStore = createSkillTaxonomyStore(dataDir);
  const taxonomy = await taxonomyStore.inspectTaxonomy();
  const current = await taxonomyStore.readSkillTaxonomy(input.skillId);
  const tagIds = await resolveOrCreateSkillTagIds(taxonomyStore, taxonomy, input.tagIds);
  const binding = await taxonomyStore.updateSkillTaxonomy({
    skillId: input.skillId,
    ...(current?.categoryId === undefined ? {} : { categoryId: current.categoryId }),
    tagIds,
    ...(input.author === undefined ? {} : { updatedBy: input.author }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });

  return [
    "Director Skill tags updated:",
    `  skill: ${binding.skillId}`,
    `  category: ${binding.categoryId ?? "(none)"}`,
    `  tags: ${binding.tagIds.join(", ") || "(none)"}`,
  ].join("\n");
}

async function readApprovedSkillHead(store: SkillSnapshotFileStore) {
  return store.readHead();
}

async function listDirectorSkillProposalRecords(
  dataDir: string,
): Promise<readonly ProposalRecord[]> {
  const dbPath = resolveDirectorSkillSessionDbPath(dataDir);
  if (!existsSync(dbPath)) {
    return [];
  }
  const store = new SessionStore({ dbPath });
  try {
    if (store.getSession(DIRECTOR_SKILL_SESSION_ID) === null) {
      return [];
    }
    const taskPlane = new SessionStoreTaskPlanePort(store, DIRECTOR_SKILL_SESSION_ID, {
      createIfMissing: false,
    });
    return (await taskPlane.listProposals({ statuses: [...SKILL_PROPOSAL_STATUSES] })).filter(
      (proposal) => proposal.kind === SKILL_SNAPSHOT_UPSERT_KIND,
    );
  } finally {
    store.close();
  }
}

async function transitionDirectorSkillProposal(
  dataDir: string,
  input: DecideDirectorSkillProposalInput & { readonly status: "accepted" | "rejected" },
): Promise<ProposalRecord> {
  return withDirectorSkillTaskPlane(dataDir, { createIfMissing: false }, async (taskPlane) => {
    await readDirectorSkillProposal(taskPlane, input.proposalId);
    await taskPlane.transitionProposal({
      proposalId: input.proposalId,
      status: input.status,
      ...(input.note === undefined || input.note.trim().length === 0
        ? {}
        : { decisionNote: input.note }),
    });
    return readDirectorSkillProposal(taskPlane, input.proposalId);
  });
}

async function readDirectorSkillProposal(
  taskPlane: SessionStoreTaskPlanePort,
  proposalId: string,
): Promise<ProposalRecord> {
  const proposal = await taskPlane.getProposal(proposalId);
  if (proposal === null) {
    throw new Error(`Unknown skill proposal: ${proposalId}`);
  }
  if (proposal.kind !== SKILL_SNAPSHOT_UPSERT_KIND) {
    throw new Error(`Unsupported skill proposal kind: ${proposal.kind}`);
  }
  return proposal;
}

async function withDirectorSkillTaskPlane<T>(
  dataDir: string,
  options: { readonly createIfMissing: boolean },
  callback: (taskPlane: SessionStoreTaskPlanePort) => Promise<T>,
): Promise<T> {
  const dbPath = resolveDirectorSkillSessionDbPath(dataDir);
  const store = new SessionStore({ dbPath });
  try {
    if (store.getSession(DIRECTOR_SKILL_SESSION_ID) === null) {
      if (!options.createIfMissing) {
        throw new Error("Director Skill proposal queue is empty.");
      }
      store.createSession({
        sessionId: DIRECTOR_SKILL_SESSION_ID,
        metadata: {
          owner: "director-angel",
          purpose: "review-gated Skill proposal lifecycle",
        },
      });
    }
    return await callback(
      new SessionStoreTaskPlanePort(store, DIRECTOR_SKILL_SESSION_ID, {
        createIfMissing: options.createIfMissing,
      }),
    );
  } finally {
    store.close();
  }
}

function createSkillProposalQueueInputFromExperience(
  candidate: ExperienceCandidate,
  input: { readonly author?: string; readonly nowMs: number },
) {
  const generated = generateSkillProposalFromExperienceCandidate({
    candidate,
    sourceSessionId: DIRECTOR_SKILL_SESSION_ID,
    ...(input.author === undefined ? {} : { author: input.author }),
    nowMs: input.nowMs,
  });
  return {
    proposal: generated.proposal,
    skillId: generated.skillId,
  };
}

function assertApprovedSkillExists(dataDir: string, skillId: string): void {
  const approved = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }))
    .readApproved()
    .find((skill) => skill.id === skillId);
  if (approved === undefined) {
    throw new Error(`Unknown approved Skill: ${skillId}`);
  }
}

function createSkillTaxonomyStore(dataDir: string): FileSkillTaxonomyStore {
  return new FileSkillTaxonomyStore({ skillsDir: join(dataDir, "skills") });
}

function resolveDirectorSkillSessionDbPath(dataDir: string): string {
  const override = process.env.HOTFLOW_CLI_SESSION_DB_PATH?.trim();
  return override || join(dataDir, "sessions", "cli.sqlite");
}

function countSkillProposals(proposals: readonly ProposalRecord[]): Record<ProposalStatus, number> {
  const counts = {
    pending: 0,
    accepted: 0,
    rejected: 0,
    applied: 0,
    expired: 0,
  };
  for (const proposal of proposals) {
    counts[proposal.status] += 1;
  }
  return counts;
}

function resolveSkillTaxonomyBinding(taxonomy: SkillTaxonomySnapshot, skillId: string) {
  return taxonomy.skills.find((entry) => entry.skillId === skillId) ?? null;
}

async function resolveOrCreateSkillCategory(
  store: FileSkillTaxonomyStore,
  snapshot: SkillTaxonomySnapshot,
  value: string,
): Promise<SkillCategoryRecord> {
  const normalized = normalizeTaxonomyLookup(value);
  const existing = snapshot.categories.find(
    (category) =>
      normalizeTaxonomyLookup(category.categoryId) === normalized ||
      normalizeTaxonomyLookup(category.name) === normalized,
  );
  if (existing !== undefined) {
    return existing;
  }
  return store.upsertCategory({ name: value });
}

async function resolveOrCreateSkillTagIds(
  store: FileSkillTaxonomyStore,
  snapshot: SkillTaxonomySnapshot,
  values: readonly string[],
): Promise<readonly string[]> {
  const result: string[] = [];
  const knownTags = new Map<string, SkillTagRecord>();
  for (const tag of snapshot.tags) {
    knownTags.set(normalizeTaxonomyLookup(tag.tagId), tag);
    knownTags.set(normalizeTaxonomyLookup(tag.name), tag);
  }
  for (const value of values) {
    const normalized = normalizeTaxonomyLookup(value);
    const existing = knownTags.get(normalized);
    const tag = existing ?? (await store.upsertTag({ name: value }));
    knownTags.set(normalizeTaxonomyLookup(tag.tagId), tag);
    knownTags.set(normalizeTaxonomyLookup(tag.name), tag);
    if (!result.includes(tag.tagId)) {
      result.push(tag.tagId);
    }
  }
  return result;
}

function isSelfEvolvedSkill(skill: SkillSnapshot): boolean {
  const tags = skill.tags ?? [];
  const metadata = skill.metadata ?? {};
  return (
    tags.includes("self-evolved") ||
    tags.includes("worker-generated") ||
    tags.includes("experience-derived") ||
    tags.includes("trajectory-analysis") ||
    typeof metadata.sourceTurnId === "string" ||
    typeof metadata.sourceExperienceId === "string" ||
    metadata.trustStatus === "trusted"
  );
}

function normalizeTaxonomyLookup(value: string): string {
  return value.trim().toLowerCase();
}
