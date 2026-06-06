import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createExperienceCandidate,
  createExperienceQualityAssessment,
  createExperienceReviewDecision,
  createExperienceSourceAdapterDeclaration,
} from "@hotflow/contracts";
import {
  SkillSnapshotFileStore,
  SkillUsageStore,
  resolveApprovedSkillSnapshotPath,
  resolveSkillUsagePath,
} from "@hotflow/skills";
import { describe, expect, it } from "vitest";

import { FileExperienceStore } from "../src/experience-store.ts";
import {
  materializeDirectorHeartbeatEvent,
  materializeDirectorHeartbeatSnapshot,
  runDirectorHeartbeatStructured,
} from "../src/heartbeat.ts";
import { FileKnowledgeStore } from "../src/store.ts";
import { materializeDirectorKnowledgePackFromProposal } from "../src/types.ts";

describe("director heartbeat", () => {
  it("materializes deterministic review-gated heartbeat events", () => {
    const event = materializeDirectorHeartbeatEvent({
      kind: "reflection-due",
      severity: "warn",
      summary: "Run run-1 failed and needs reflection.",
      actionRefs: ["hotflow director reflect --run-id run-1"],
      evidenceRefs: ["director-run://run-1/report/report-1"],
      nowMs: Date.parse("2026-04-28T06:00:00.000Z"),
    });

    expect(event).toMatchObject({
      schemaVersion: "director.heartbeat.event.v1",
      kind: "reflection-due",
      severity: "warn",
      summary: "Run run-1 failed and needs reflection.",
      actionRefs: ["hotflow director reflect --run-id run-1"],
      evidenceRefs: ["director-run://run-1/report/report-1"],
      createdAt: "2026-04-28T06:00:00.000Z",
    });
    expect(event.eventId).toMatch(/^heartbeat_reflection-due_/u);
  });

  it("summarizes highest heartbeat severity without executing actions", () => {
    const first = materializeDirectorHeartbeatEvent({
      kind: "stale-review",
      severity: "info",
      summary: "Pending experience candidate.",
      actionRefs: ["hotflow director knowledge experience-list"],
      evidenceRefs: ["experience://candidate-1"],
      nowMs: Date.parse("2026-04-28T06:00:00.000Z"),
    });
    const second = materializeDirectorHeartbeatEvent({
      kind: "adapter-degraded",
      severity: "blocked",
      summary: "Adapter is offline.",
      actionRefs: ["hotflow director adapters explain --adapter-id external-cli"],
      evidenceRefs: ["adapter://external-cli"],
      nowMs: Date.parse("2026-04-28T06:00:00.000Z"),
    });

    const snapshot = materializeDirectorHeartbeatSnapshot({
      events: [first, second],
      enabled: true,
      nowMs: Date.parse("2026-04-28T06:00:01.000Z"),
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "director.heartbeat.snapshot.v1",
      enabled: true,
      eventCount: 2,
      highestSeverity: "blocked",
      createdAt: "2026-04-28T06:00:01.000Z",
    });
    expect(snapshot.events.map((event) => event.eventId)).toEqual([first.eventId, second.eventId]);
  });

  it("surfaces maintenance due without archiving files during heartbeat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-heartbeat-maintenance-"));
    try {
      const oldLog = join(workspaceRoot, ".director-angel", "runtime", "logs", "old.log");
      mkdirSync(join(workspaceRoot, ".director-angel", "runtime", "logs"), { recursive: true });
      writeFileSync(oldLog, "old log\n", "utf8");
      const oldDate = new Date("2026-04-01T00:00:00.000Z");
      utimesSync(oldLog, oldDate, oldDate);

      const result = await runDirectorHeartbeatStructured(workspaceRoot, {
        now: "2026-05-03T00:00:00.000Z",
      });

      const maintenance = result.snapshot.events.find((event) => event.kind === "maintenance-due");
      expect(maintenance).toMatchObject({
        severity: "info",
        actionRefs: ["/维护", "/维护 执行"],
      });
      expect(maintenance?.summary).toContain("1 old log file");
      expect(existsSync(oldLog)).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("surfaces learning governance backlogs as maintenance due during heartbeat", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-heartbeat-governance-"));
    try {
      const workspace = join(workspaceRoot, ".director-angel");
      const experienceDir = join(workspace, "knowledge", "experience");
      const knowledgeDir = join(workspace, "knowledge");
      const experienceStore = new FileExperienceStore({ experienceDir });
      const knowledgeStore = new FileKnowledgeStore({ knowledgeDir });

      for (let index = 1; index <= 9; index += 1) {
        const candidateId = `accepted_governance_${index}`;
        await experienceStore.writeCandidate(
          createExperienceCandidateFixture(candidateId, {
            createdAtMs: Date.parse(`2026-05-0${Math.min(index, 8)}T00:00:00.000Z`),
            sourceDigest: `digest:accepted:${index}`,
          }),
        );
        await experienceStore.writeReviewDecision(
          createExperienceReviewDecision({
            decisionId: `review_${candidateId}`,
            candidateId,
            gate: "human",
            decision: "accepted",
            decidedAtMs: Date.parse("2026-05-08T00:00:00.000Z"),
          }),
        );
      }
      for (let index = 1; index <= 21; index += 1) {
        await experienceStore.writeCandidate(
          createExperienceCandidateFixture(`pending_governance_${index}`, {
            createdAtMs: Date.parse("2026-05-08T00:00:00.000Z"),
            sourceDigest: `digest:pending:${index}`,
          }),
        );
      }
      await knowledgeStore.publish(
        materializeDirectorKnowledgePackFromProposal(
          createAcceptedProposalFixture("proposal-governance-unevaluated"),
          { now: "2026-05-08T00:00:00.000Z" },
        ),
      );

      const result = await runDirectorHeartbeatStructured(workspaceRoot, {
        now: "2026-05-08T06:00:00.000Z",
      });

      const maintenance = result.snapshot.events.find((event) => event.kind === "maintenance-due");
      expect(maintenance).toMatchObject({
        severity: "warn",
        actionRefs: ["/维护", "/维护 执行"],
      });
      expect(maintenance?.summary).toContain("3 learning governance action");
      expect(maintenance?.summary).toContain("accepted backlog 9");
      expect(maintenance?.summary).toContain("pending backlog 21");
      expect(maintenance?.summary).toContain("missing recall eval 1");
      expect(maintenance?.evidenceRefs).toEqual(
        expect.arrayContaining([
          "learning-governance://accepted-experience-backlog/count/9",
          "learning-governance://pending-experience-backlog/count/21",
          "learning-governance://published-knowledge-missing-recall-eval/count/1",
          "learning-governance://published-knowledge-missing-recall-eval/director-method-project-governance-group-unevaluated",
        ]),
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("surfaces Skill curator actions as heartbeat maintenance without applying them", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-heartbeat-skill-curator-"));
    try {
      const dataDir = join(workspaceRoot, ".hotflow");
      const snapshotStore = new SkillSnapshotFileStore(
        resolveApprovedSkillSnapshotPath({ dataDir }),
      );
      const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
        now: () => Date.parse("2026-05-08T01:00:00.000Z"),
      });

      snapshotStore.writeApproved(
        [
          {
            id: "skill.failed-heartbeat",
            version: "1.0.0",
            title: "Failed heartbeat Skill",
            content: "Use when a Skill repeatedly fails during runtime.",
            updatedAtMs: Date.parse("2026-05-08T00:00:00.000Z"),
            metadata: { sourceTurnId: "turn-heartbeat-skill" },
          },
          {
            id: "skill.keep-heartbeat",
            version: "1.0.0",
            title: "Healthy heartbeat Skill",
            content: "Use when Skill telemetry is healthy.",
            updatedAtMs: Date.parse("2026-05-08T00:00:00.000Z"),
            metadata: { sourceTurnId: "turn-heartbeat-healthy" },
          },
        ],
        { changeKind: "manual" },
      );
      usageStore.recordFailure("skill.failed-heartbeat", {
        actor: "heartbeat-test",
        nowMs: Date.parse("2026-05-08T01:00:00.000Z"),
        reason: "first runtime failure",
      });
      usageStore.recordFailure("skill.failed-heartbeat", {
        actor: "heartbeat-test",
        nowMs: Date.parse("2026-05-08T02:00:00.000Z"),
        reason: "second runtime failure",
      });

      const result = await runDirectorHeartbeatStructured(workspaceRoot, {
        dataDir,
        now: "2026-05-08T06:00:00.000Z",
      });

      const maintenance = result.snapshot.events.find(
        (event) =>
          event.kind === "maintenance-due" && event.summary.includes("Skill curator found 1 patch"),
      );
      expect(maintenance).toMatchObject({
        severity: "warn",
        actionRefs: ["/技能", "/审查 skill-curator"],
      });
      expect(maintenance?.evidenceRefs).toEqual(
        expect.arrayContaining([
          "skill-curator://patch/skill.failed-heartbeat",
          `path://${resolveApprovedSkillSnapshotPath({ dataDir })}`,
          `path://${resolveSkillUsagePath({ dataDir })}`,
        ]),
      );
      expect(usageStore.readRecord("skill.failed-heartbeat")?.failureCount).toBe(2);
      expect(snapshotStore.readApproved().map((skill) => skill.id)).toEqual([
        "skill.failed-heartbeat",
        "skill.keep-heartbeat",
      ]);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function createExperienceCandidateFixture(
  candidateId: string,
  input: {
    readonly createdAtMs: number;
    readonly sourceDigest: string;
  },
) {
  return createExperienceCandidate({
    candidateId,
    sourceAdapter: createExperienceSourceAdapterDeclaration({
      adapterId: "adapter_heartbeat_governance",
      sourceKind: "local-repository",
      sourceRef: "repo://heartbeat-governance",
      privacy: "internal",
      transformations: [
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable learning patterns.",
        },
      ],
    }),
    title: `Heartbeat governance ${candidateId}`,
    summary: `Reusable governance summary for ${candidateId}.`,
    applicability: "Use when heartbeat monitors daily learning backlogs.",
    risks: ["Fixture evidence is review-gated."],
    tags: ["heartbeat", "governance"],
    evidence: [
      {
        evidenceId: `evidence_${candidateId}`,
        sourceRef: "repo://heartbeat-governance#lesson.md",
        summary: `Evidence for ${candidateId}.`,
      },
    ],
    sourceDigest: input.sourceDigest,
    quality: createExperienceQualityAssessment({
      verdict: "usable",
      score: 82,
      reasons: ["heartbeat governance fixture"],
    }),
    privacy: "internal",
    provenance: "director-knowledge/heartbeat-test",
    createdAtMs: input.createdAtMs,
  });
}

function createAcceptedProposalFixture(proposalId: string) {
  return {
    proposalId,
    status: "accepted" as const,
    recordId: `record-${proposalId}`,
    digestId: `digest-${proposalId}`,
    projectId: "project-governance",
    groupId: "group-unevaluated",
    title: `Director method ${proposalId}`,
    summary: "Reusable method summary.",
    trigger: "When planning a repeatable production workflow.",
    evidenceSummary: "reviewed source material",
    explanation: "Keep knowledge compact, reviewed, and recallable.",
    dedupeKey: "project-governance__group-unevaluated",
    tags: ["heartbeat", "governance"],
    roles: ["script-planner"],
    selectedAdapters: ["scripted"],
    latestDecision: {
      decidedAt: "2026-05-08T00:00:00.000Z",
      note: "accepted",
    },
    sourceRecord: {
      anchorIds: ["anchor-heartbeat-governance"],
      tags: ["heartbeat", "governance"],
      digest: {
        goal: "Keep Director learning governed.",
        generationType: "self-learning",
        generationStyle: "heartbeat-governance",
        knowledgeSignalTags: ["governance"],
      },
    },
  };
}
