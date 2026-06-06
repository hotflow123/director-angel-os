import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDirectorContextualRecall } from "../src/contextual-recall.js";
import { recallPublishedKnowledge } from "../src/recall.js";
import { FileKnowledgeStore } from "../src/store.js";
import { materializeDirectorKnowledgePackFromProposal } from "../src/types.js";

describe("published knowledge recall", () => {
  const root = join(tmpdir(), "director-knowledge-recall-test");

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("ranks published packs by project/group/anchor/tag/adapter fit", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    await store.publish(
      materializeDirectorKnowledgePackFromProposal(
        createProposalFixture({
          proposalId: "proposal-1",
          dedupeKey: "project-1__group-1__hero-teaser",
          projectId: "project-1",
          groupId: "group-1",
          anchorIds: ["anchor-a", "anchor-b"],
          tags: ["continuity", "hero"],
          selectedAdapters: ["scripted", "seedance"],
          generationType: "new",
          generationStyle: "immersive",
        }),
        { now: "2026-04-13T01:00:00.000Z" },
      ),
    );
    await store.publish(
      materializeDirectorKnowledgePackFromProposal(
        createProposalFixture({
          proposalId: "proposal-2",
          dedupeKey: "project-1__group-2__fallback",
          projectId: "project-1",
          groupId: "group-2",
          anchorIds: ["anchor-z"],
          tags: ["experimental"],
          selectedAdapters: ["fallback"],
          generationType: "extend",
          generationStyle: "standard",
        }),
        { now: "2026-04-13T01:10:00.000Z" },
      ),
    );

    const packet = recallPublishedKnowledge(await store.listPublishedDocuments(), {
      projectId: "project-1",
      groupId: "group-1",
      anchorIds: ["anchor-b"],
      tags: ["continuity"],
      preferredAdapters: ["seedance"],
      generationType: "new",
      generationStyle: "immersive",
      maxHits: 2,
      maxChars: 900,
    });

    expect(packet.status).toBe("hit");
    expect(packet.hits).toHaveLength(2);
    expect(packet.hits[0]?.provenance.sourceProposalId).toBe("proposal-1");
    expect(packet.hits[0]?.reasons).toEqual(
      expect.arrayContaining([
        "project match: project-1",
        "group match: group-1",
        "anchor match: anchor-b",
        "tag match: continuity",
        "adapter match: seedance",
        "generation type: new",
        "generation style: immersive",
      ]),
    );
    const firstHit = packet.hits[0];
    const secondHit = packet.hits[1];
    expect(firstHit).toBeDefined();
    expect(secondHit).toBeDefined();
    expect(firstHit?.score).toBeGreaterThan(secondHit?.score ?? 0);
  });

  it("respects maxHits and maxChars truncation boundaries", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    await store.publish(
      materializeDirectorKnowledgePackFromProposal(
        createProposalFixture({
          proposalId: "proposal-3",
          dedupeKey: "project-2__group-1__long-a",
          projectId: "project-2",
          groupId: "group-1",
          explanation:
            "This method intentionally uses a very long explanation so the recall packet has to truncate total text before it can include too many recalled packs in a single planning call.",
        }),
        { now: "2026-04-13T02:00:00.000Z" },
      ),
    );
    await store.publish(
      materializeDirectorKnowledgePackFromProposal(
        createProposalFixture({
          proposalId: "proposal-4",
          dedupeKey: "project-2__group-1__long-b",
          projectId: "project-2",
          groupId: "group-1",
          explanation:
            "Another long explanation exists here so the result set crosses the configured character budget and the packet has to stop early instead of dumping every pack into the prompt path.",
        }),
        { now: "2026-04-13T02:10:00.000Z" },
      ),
    );

    const packet = recallPublishedKnowledge(await store.listPublishedDocuments(), {
      projectId: "project-2",
      groupId: "group-1",
      maxHits: 5,
      maxChars: 180,
    });

    expect(packet.status).toBe("hit");
    expect(packet.hits.length).toBe(1);
    expect(packet.truncated).toBe(true);
    expect(packet.notes.join(" ")).toContain("truncated");
    expect(packet.hits[0]?.summary.length).toBeLessThanOrEqual(180);
  });

  it("builds a shared contextual recall packet for prompts, skills, and memory", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    await store.publish(
      materializeDirectorKnowledgePackFromProposal(
        createProposalFixture({
          proposalId: "proposal-shared-context",
          dedupeKey: "experience__shared__comfyui",
          projectId: "experience-learning",
          groupId: "shared-context",
          tags: ["experience", "self-learning", "comfyui", "script"],
          trigger: "Use for ComfyUI script workflow planning.",
          summary: "Keep scene prompts independent before tool handoff.",
          explanation: "Angel should recall published scene-splitting lessons.",
        }),
        { now: "2026-05-03T01:00:00.000Z" },
      ),
    );

    const packet = await buildDirectorContextualRecall({
      userText: "创建 ComfyUI 脚本工作流：小猪学习游泳",
      knowledgeDocuments: await store.listPublishedDocuments(),
      knowledgeEnabled: true,
      knowledgeQuery: {
        tags: ["comfyui", "script"],
        includeGlobalExperience: true,
      },
      skillSections: [
        {
          id: "skill.skill-comfyui",
          cacheBucket: "dynamic",
          owner: "skill",
          content: "Skill: ComfyUI Skill\nSplit each scene before mapping nodes.",
          metadata: { skillId: "skill-comfyui" },
        },
      ],
      longTermMemorySignals: [
        {
          id: "long-term-memory:memory",
          description: "Keep each scene separated.",
        },
      ],
    });

    expect(packet.recallStatus).toBe("hit");
    expect(packet.skillStatus).toBe("hit");
    expect(packet.knowledgeHits).toEqual([
      expect.objectContaining({
        id: "director-method-experience-shared-comfyui",
        title: "Director method proposal-shared-context",
      }),
    ]);
    expect(packet.skillHits).toEqual([{ id: "skill-comfyui", title: "ComfyUI Skill" }]);
    expect(packet.lines.join("\n")).toContain("Published knowledge / experience");
    expect(packet.lines.join("\n")).toContain("ComfyUI Skill");
    expect(packet.lines.join("\n")).toContain("Keep each scene separated");
    expect(packet.promptBlock).toContain("Director Angel contextual recall");
    expect(packet.hiddenPromptBlock).toBe(packet.promptBlock);
    expect(packet.visibleSummary).toBe("已参考：经验 1 条、Skill 1 个、记忆 1 条。");
    expect(packet.recallTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "knowledge",
          status: "hit",
          id: "director-method-experience-shared-comfyui",
        }),
        expect.objectContaining({
          source: "skill",
          status: "hit",
          id: "skill-comfyui",
        }),
        expect.objectContaining({
          source: "memory",
          status: "hit",
          id: "long-term-memory:memory",
        }),
      ]),
    );
    expect(packet.capabilityPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "knowledge.recall",
          granularity: "bounded-hidden-context",
          hitCount: 1,
          userVisible: "summary-only",
        }),
        expect.objectContaining({
          capability: "skill.recall",
          granularity: "metadata-first",
          hitCount: 1,
          userVisible: "summary-only",
        }),
        expect.objectContaining({
          capability: "memory.recall",
          granularity: "short-signal",
          hitCount: 1,
          userVisible: "summary-only",
        }),
      ]),
    );
  });

  it("returns miss with explanatory notes when nothing matches", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    await store.publish(
      materializeDirectorKnowledgePackFromProposal(
        createProposalFixture({
          proposalId: "proposal-5",
          dedupeKey: "project-3__group-a__continuity",
          projectId: "project-3",
          groupId: "group-a",
        }),
        { now: "2026-04-13T03:00:00.000Z" },
      ),
    );

    const packet = recallPublishedKnowledge(await store.listPublishedDocuments(), {
      projectId: "unmatched-project",
      groupId: "unmatched-group",
    });

    expect(packet.status).toBe("miss");
    expect(packet.hits).toHaveLength(0);
    expect(packet.notes[0]).toContain("No published Director knowledge pack matched");
  });

  it("can opt into globally applicable self-learning experience packs", async () => {
    const store = new FileKnowledgeStore({ knowledgeDir: root });
    await store.publish(createSelfLearningExperiencePack());

    const defaultPacket = recallPublishedKnowledge(await store.listPublishedDocuments(), {
      projectId: "project-without-local-lessons",
      groupId: "group-without-local-lessons",
    });
    const globalExperiencePacket = recallPublishedKnowledge(await store.listPublishedDocuments(), {
      projectId: "project-without-local-lessons",
      groupId: "group-without-local-lessons",
      includeGlobalExperience: true,
    });

    expect(defaultPacket.status).toBe("miss");
    expect(globalExperiencePacket.status).toBe("hit");
    expect(globalExperiencePacket.hits[0]?.knowledgePackId).toBe(
      "director-experience-local-constraints",
    );
    expect(globalExperiencePacket.hits[0]?.reasons).toEqual(
      expect.arrayContaining(["global self-learning experience"]),
    );
  });
});

function createSelfLearningExperiencePack() {
  return {
    schemaVersion: "director.knowledge.pack.v1" as const,
    metadata: {
      id: "director-experience-local-constraints",
      title: "Ask for constraints before production",
      description: "Use for user-provided desktop lessons.",
      tags: ["experience", "self-learning", "source:local-directory", "constraint-clarity"],
      createdAt: "2026-04-25T09:00:00.000Z",
      version: 1,
    },
    stage: "published" as const,
    method: {
      sourceProposalId: "experience:experience_local_constraints",
      sourceRecordId: "adapter_desktop_lessons",
      sourceDigestId: "sha256:desktop-lessons",
      projectId: "experience-learning",
      groupId: "local-directory",
      goal: "Use learned operating lessons from local files.",
      trigger: "Use learned operating lessons from local files.",
      summary: "Ask for missing constraints before generating production assets.",
      explanation:
        "Ask for missing constraints before generating production assets.\nRuntime injection: disabled until reviewed and published.",
      evidenceSummary: "evidence_1: desktop lesson",
      roles: ["researcher"],
      preferredAdapters: [],
      anchorIds: ["evidence_1"],
      generationType: "self-learning",
      generationStyle: "local-directory",
    },
    audit: {
      publishedAt: "2026-04-25T09:01:00.000Z",
    },
  };
}

function createProposalFixture(overrides: {
  proposalId: string;
  dedupeKey: string;
  projectId: string;
  groupId: string;
  anchorIds?: readonly string[];
  tags?: readonly string[];
  selectedAdapters?: readonly string[];
  generationType?: string;
  generationStyle?: string;
  explanation?: string;
}) {
  return {
    proposalId: overrides.proposalId,
    status: "accepted" as const,
    recordId: `record-${overrides.proposalId}`,
    digestId: `digest-${overrides.proposalId}`,
    projectId: overrides.projectId,
    groupId: overrides.groupId,
    title: `Director method ${overrides.proposalId}`,
    summary: "Use the approved method to keep quality high.",
    trigger: "When the project needs a continuity-safe output.",
    evidenceSummary: "completed run with stable review outcome",
    explanation:
      overrides.explanation ??
      "Use continuity-safe planning, preserve anchors, and keep the approved visual tone.",
    dedupeKey: overrides.dedupeKey,
    tags: [...(overrides.tags ?? ["continuity"])],
    roles: ["researcher", "script-planner"],
    selectedAdapters: [...(overrides.selectedAdapters ?? ["scripted"])],
    latestDecision: {
      decidedAt: "2026-04-13T00:55:00.000Z",
      note: "approved_for_publish",
    },
    sourceRecord: {
      anchorIds: [...(overrides.anchorIds ?? ["anchor-a"])],
      tags: [...(overrides.tags ?? ["continuity"])],
      digest: {
        goal: "Create a continuity-safe teaser.",
        generationType: overrides.generationType ?? "new",
        generationStyle: overrides.generationStyle ?? "immersive",
        knowledgeSignalTags: [...(overrides.tags ?? ["continuity"])],
      },
    },
  };
}
