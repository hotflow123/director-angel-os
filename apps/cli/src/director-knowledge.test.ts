import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileSystemRunStore } from "@hotflow/director-execution";
import { updateDirectorApiProviderSetting } from "@hotflow/director-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptDirectorExperienceCandidate,
  acceptDirectorKnowledgeCandidate,
  acceptDirectorSoulCandidate,
  createDirectorReflectionFromRunReportStructured,
  describeDirectorHeartbeatStatus,
  describeDirectorKnowledgeStatus,
  diffDirectorKnowledgeCandidate,
  explainDirectorExperienceCandidate,
  explainDirectorKnowledgeCandidate,
  explainDirectorKnowledgePack,
  explainDirectorSoulCandidate,
  inspectDirectorExperienceCandidate,
  inspectDirectorExperienceCandidates,
  learnDirectorExperience,
  listDirectorExperienceCandidates,
  listDirectorKnowledgeCandidates,
  listDirectorKnowledgePacks,
  listDirectorSoulCandidates,
  previewDirectorKnowledgeRecall,
  promoteDirectorExperienceCandidate,
  publishDirectorKnowledgeCandidate,
  publishDirectorKnowledgePackFromProposal,
  rejectDirectorKnowledgeCandidate,
  rejectDirectorSoulCandidate,
  reviewDirectorKnowledgeCandidate,
  rollbackDirectorKnowledgePack,
  runDirectorHeartbeat,
  syncDirectorKnowledgeCandidateFromProposal,
  updateDirectorExperienceCandidateStructured,
  viewDirectorSoul,
} from "./director-knowledge.js";

describe("director knowledge helpers", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks direct trace proposal publish so knowledge must pass candidate review", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-publish-"));
    tempRoots.push(workspaceRoot);
    writeAcceptedProposalFixture(workspaceRoot, "proposal-knowledge-1");

    await expect(
      publishDirectorKnowledgePackFromProposal(workspaceRoot, {
        proposalId: "proposal-knowledge-1",
        author: "operator-a",
        note: "publish_for_beta5",
      }),
    ).rejects.toThrow("no longer accepts trace proposal");

    const statusOutput = await describeDirectorKnowledgeStatus(workspaceRoot);

    expect(statusOutput).toContain("Director knowledge lane:");
    expect(statusOutput).toContain("published packs: 0");
    expect(statusOutput).toContain("knowledge evolution switches:");

    await publishAcceptedProposalThroughKnowledgeCandidate(workspaceRoot, "proposal-knowledge-1");
    const listOutput = await listDirectorKnowledgePacks(workspaceRoot);
    expect(listOutput).toContain("Director knowledge packs:");
    expect(listOutput).toContain("stage=published");
  });

  it("blocks direct publish for accepted proposals even when review metadata is missing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-raw-proposal-"));
    tempRoots.push(workspaceRoot);
    writeAcceptedProposalFixture(workspaceRoot, "proposal-knowledge-raw", {
      withReviewMetadata: false,
    });

    await expect(
      publishDirectorKnowledgePackFromProposal(workspaceRoot, {
        proposalId: "proposal-knowledge-raw",
        author: "operator-a",
        note: "raw_publish_attempt",
      }),
    ).rejects.toThrow("no longer accepts trace proposal");

    const statusOutput = await describeDirectorKnowledgeStatus(workspaceRoot);
    expect(statusOutput).toContain("published packs: 0");
  });

  it("explains a published knowledge pack in operator-readable form", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-explain-"));
    tempRoots.push(workspaceRoot);
    writeAcceptedProposalFixture(workspaceRoot, "proposal-knowledge-2");
    await publishAcceptedProposalThroughKnowledgeCandidate(workspaceRoot, "proposal-knowledge-2");

    const listOutput = await listDirectorKnowledgePacks(workspaceRoot);
    const packId = requireMatchGroup(/- (.+?) stage=published/u.exec(listOutput));

    const explainOutput = await explainDirectorKnowledgePack(workspaceRoot, packId);
    expect(explainOutput).toContain("Director knowledge pack:");
    expect(explainOutput).toContain(`pack id: ${packId}`);
    expect(explainOutput).toContain("source proposal: proposal-knowledge-2");
    expect(explainOutput).toContain("preferred adapters: scripted");
    expect(explainOutput).toContain("anchors: anchor-a");
  });

  it("previews published knowledge recall with operator-readable reasons", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-recall-"));
    tempRoots.push(workspaceRoot);
    writeAcceptedProposalFixture(workspaceRoot, "proposal-knowledge-3");
    writeKnowledgeRecallSwitchFixture(workspaceRoot, true);
    await publishAcceptedProposalThroughKnowledgeCandidate(workspaceRoot, "proposal-knowledge-3");

    const previewOutput = await previewDirectorKnowledgeRecall(workspaceRoot, {
      projectId: "project-knowledge",
      groupId: "group-knowledge",
      anchorIds: ["anchor-a"],
      preferredAdapters: ["scripted"],
      tags: ["continuity"],
      generationType: "new",
      generationStyle: "immersive",
      maxHits: 3,
      maxChars: 600,
    });

    expect(previewOutput).toContain("Director knowledge recall preview:");
    expect(previewOutput).toContain("enabled: yes");
    expect(previewOutput).toContain("status: hit");
    expect(previewOutput).toContain("why recalled:");
    expect(previewOutput).toContain("proposal=proposal-knowledge-3");
  });

  it("learns user-provided local directory files into experience candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-learn-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "Desktop", "AngelLessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "lesson.md"),
      "Ask for missing constraints before generating production assets.",
    );

    const output = await learnDirectorExperience(workspaceRoot, {
      directories: [lessonDir],
      privacy: "confidential",
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);
    const candidateId = inspection.candidates[0]?.candidate.candidateId ?? "";
    const candidate = await inspectDirectorExperienceCandidate(workspaceRoot, candidateId);

    expect(output).toContain("Director experience learn:");
    expect(output).toContain("new candidates: 1");
    expect(output).toContain("runtime injection: disabled");
    expect(inspection.total).toBe(1);
    expect(inspection.candidates[0]?.status).toBe("pending");
    expect(inspection.candidates[0]?.promoted).toBe(false);
    expect(candidate.candidate.candidateId).toBe(candidateId);
    expect(candidate.latestReview).toBeNull();
    expect(
      readdirSync(join(workspaceRoot, ".director-angel", "knowledge", "experience", "candidate")),
    ).toHaveLength(1);
  });

  it("recalls published self-learning experience as global production guidance when requested", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-global-experience-"));
    tempRoots.push(workspaceRoot);
    writeKnowledgeRecallSwitchFixture(workspaceRoot, true);
    const lessonDir = join(workspaceRoot, "Desktop", "AngelLessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "storyboard.md"),
      [
        "# 15秒短剧分镜经验",
        "Use learned experience before production: confirm shot size, camera angle, composition, and lighting before making a short drama storyboard.",
        "For a 15 second short drama, split the plan into three 5 second shots: establish character and scene, advance conflict or action, then reveal reaction or key information.",
        "Safety boundary: do not romanticize coercion, trafficking, forced marriage, or harm; keep critique, rescue, consequence, and victim agency visible.",
      ].join("\n"),
    );

    await learnDirectorExperience(workspaceRoot, {
      directories: [lessonDir],
      privacy: "internal",
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);
    const candidateId = inspection.candidates[0]?.candidate.candidateId;
    expect(candidateId).toBeTruthy();
    if (!candidateId) {
      throw new Error("Expected learned experience candidate.");
    }
    await acceptDirectorExperienceCandidate(workspaceRoot, {
      candidateId,
      author: "operator-test",
      note: "accept global production guidance",
    });
    await promoteDirectorExperienceCandidate(workspaceRoot, {
      candidateId,
      author: "operator-test",
      note: "promote global production guidance",
    });
    const candidateList = await listDirectorKnowledgeCandidates(workspaceRoot);
    const packId = requireMatchGroup(/- (.+?) status=/u.exec(candidateList));
    await acceptDirectorKnowledgeCandidate(workspaceRoot, {
      packId,
      author: "operator-test",
      note: "accept knowledge",
    });
    await publishDirectorKnowledgeCandidate(workspaceRoot, {
      packId,
      author: "operator-test",
      note: "publish knowledge",
    });

    const previewOutput = await previewDirectorKnowledgeRecall(workspaceRoot, {
      projectId: "director-desktop",
      groupId: "production",
      includeGlobalExperience: true,
      maxHits: 3,
      maxChars: 600,
    });

    expect(previewOutput).toContain("status: hit");
    expect(previewOutput).toContain(packId);
    expect(previewOutput).toContain("global self-learning experience");
  });

  it("learns searched web topics into experience candidates through an injected search provider", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-search-learn-"));
    tempRoots.push(workspaceRoot);

    const output = await learnDirectorExperience(workspaceRoot, {
      queries: ["director agent learning workflow"],
      maxResultsPerQuery: 1,
      search: async () => [
        {
          url: "https://example.com/director-learning",
          title: "Director learning workflow",
          snippet: "Compare sources and preserve evidence.",
        },
      ],
      fetchText: async (url) => ({
        url,
        contentType: "text/html",
        body: "<html><title>Director learning workflow</title><body>Keep learned guidance as candidates until reviewed.</body></html>",
      }),
    });

    expect(output).toContain("Director experience learn:");
    expect(output).toContain("kind=web-search");
    expect(output).toContain("new candidates: 1");
    expect(
      readdirSync(join(workspaceRoot, ".director-angel", "knowledge", "experience", "candidate")),
    ).toHaveLength(1);
  });

  it("skips low-signal casual web learning queries before search", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-search-noise-"));
    tempRoots.push(workspaceRoot);
    const search = vi.fn(async () => []);

    const output = await learnDirectorExperience(workspaceRoot, {
      queries: ["今天天气不错，随便聊聊"],
      search,
    });

    expect(search).not.toHaveBeenCalled();
    expect(output).toContain("new candidates: 0");
    expect(output).toContain("Skipped low-signal learning query");
  });

  it("learns pasted text into experience candidates without treating it as web search", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-pasted-learn-"));
    tempRoots.push(workspaceRoot);

    const output = await learnDirectorExperience(workspaceRoot, {
      texts: [
        {
          title: "AI短剧基础知识",
          content: [
            "AI短剧基础知识",
            "推荐流程：先确认画面目的，再选择景别、角度、构图、光影和运镜。",
            "审核时需要保留来源证据，不要把广告或登录页当成经验。",
          ].join("\n"),
        },
      ],
      privacy: "internal",
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);

    expect(output).toContain("kind=pasted-text");
    expect(output).toContain("new candidates: 1");
    expect(inspection.total).toBe(1);
    expect(inspection.candidates[0]?.candidate.sourceAdapter.sourceKind).toBe("pasted-text");
    expect(inspection.candidates[0]?.candidate.tags).toEqual(
      expect.arrayContaining(["source:pasted-text"]),
    );
  });

  it("edits a pending extracted experience candidate before review while preserving source evidence", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-edit-experience-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "Desktop", "AngelLessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "lesson.md"),
      "Before generating a short drama storyboard, choose shot size and camera angle from the story beat.",
    );
    await learnDirectorExperience(workspaceRoot, {
      directories: [lessonDir],
      privacy: "confidential",
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);
    const candidateId = inspection.candidates[0]?.candidate.candidateId ?? "";
    const before = await inspectDirectorExperienceCandidate(workspaceRoot, candidateId);

    const updated = await updateDirectorExperienceCandidateStructured(workspaceRoot, {
      candidateId,
      summary: "经验提炼：短剧分镜前先按剧情节拍选择景别和机位。",
      applicability: "用于生成短剧分镜、镜头蓝图和镜头提示词之前。",
      risks: ["不要脱离剧情目的机械套用景别。"],
      tags: ["director-shot", "manual-edit"],
      author: "operator-test",
    });
    const after = await inspectDirectorExperienceCandidate(workspaceRoot, candidateId);

    expect(updated.updated.summary).toBe("经验提炼：短剧分镜前先按剧情节拍选择景别和机位。");
    expect(after.status).toBe("pending");
    expect(after.candidate.summary).toBe("经验提炼：短剧分镜前先按剧情节拍选择景别和机位。");
    expect(after.candidate.applicability).toBe("用于生成短剧分镜、镜头蓝图和镜头提示词之前。");
    expect(after.candidate.risks).toEqual(["不要脱离剧情目的机械套用景别。"]);
    expect(after.candidate.tags).toEqual(expect.arrayContaining(["director-shot", "manual-edit"]));
    expect(after.candidate.sourceArtifactId).toBe(before.candidate.sourceArtifactId);
    expect(after.candidate.evidencePreview).toBe(before.candidate.evidencePreview);
  });

  it("routes query text containing a URL into URL learning instead of web search", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-query-url-learn-"));
    tempRoots.push(workspaceRoot);
    const search = async () => {
      throw new Error("search should not be called for URL-like learning text");
    };

    const output = await learnDirectorExperience(workspaceRoot, {
      queries: [
        "去学习这个https://bcn5ot9wwnew.feishu.cn/wiki/KttewP2WqiWF0Bk8P68cAjTUnFh?from=from_copylink",
      ],
      search,
      fetchText: async (url) => ({
        url,
        contentType: "text/plain; charset=utf-8",
        body: "Real Feishu document lesson from browser-authenticated URL learning.",
      }),
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);

    expect(output).toContain("kind=web-page");
    expect(output).not.toContain("kind=web-search");
    expect(inspection.total).toBe(1);
    expect(inspection.candidates[0]?.candidate.sourceAdapter.sourceKind).toBe("web-page");
    expect(inspection.candidates[0]?.candidate.summary).toContain("Real Feishu document lesson");
  });

  it("reflects a persisted failed run report into a review-gated failure lesson", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-reflection-"));
    tempRoots.push(workspaceRoot);
    await writeRunReportFixture(workspaceRoot, {
      runId: "run-reflect-1",
      status: "failed",
      flags: ["has-failures", "external-bridge-failed"],
      summary: ["run status=failed", "assignments total=2 completed=1 failed=1 blocked=0"],
    });

    const result = await createDirectorReflectionFromRunReportStructured(workspaceRoot, {
      runId: "run-reflect-1",
      now: "2026-04-28T06:00:00.000Z",
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);

    expect(result.reflection).toMatchObject({
      sourceId: "run-reflect-1",
      outcome: "failure",
      suggestedExperienceIntent: "failure-lesson",
      status: "candidate_generated",
    });
    expect(result.experience.recommended?.materialized.status).toBe("candidate");
    expect(result.experience.blockedPositive?.status).toBe("quarantined");
    expect(result.experienceWrite?.status).toBe("ok");
    expect(result.soulCandidate).toMatchObject({
      status: "pending",
      sourceReflectionId: result.reflection.reflectionId,
      sourceId: "run-reflect-1",
      riskLevel: "medium",
    });
    expect(result.soulWrite?.status).toBe("ok");
    expect(inspection.total).toBe(1);
    expect(inspection.candidates[0]?.candidate).toMatchObject({
      title: "Failure lesson: Make a production clip",
      tags: expect.arrayContaining(["failure-lesson", "negative-experience"]),
    });
    expect(
      readdirSync(join(workspaceRoot, ".director-angel", "knowledge", "reflection", "report")),
    ).toHaveLength(1);
    expect(readdirSync(join(workspaceRoot, ".director-angel", "soul", "candidates"))).toHaveLength(
      1,
    );
  });

  it("lists, explains, accepts, and rejects Soul candidates without polluting published Soul", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-soul-review-"));
    tempRoots.push(workspaceRoot);
    await writeRunReportFixture(workspaceRoot, {
      runId: "run-soul-accept",
      status: "completed",
      flags: [],
      summary: ["run status=completed", "assignments total=2 completed=2 failed=0 blocked=0"],
    });
    await writeRunReportFixture(workspaceRoot, {
      runId: "run-soul-reject",
      status: "failed",
      flags: ["has-failures"],
      summary: ["run status=failed", "assignments total=2 completed=1 failed=1 blocked=0"],
    });

    const acceptedReflection = await createDirectorReflectionFromRunReportStructured(
      workspaceRoot,
      {
        runId: "run-soul-accept",
        now: "2026-04-28T06:10:00.000Z",
      },
    );
    const rejectedReflection = await createDirectorReflectionFromRunReportStructured(
      workspaceRoot,
      {
        runId: "run-soul-reject",
        now: "2026-04-28T06:11:00.000Z",
      },
    );
    const acceptedId = acceptedReflection.soulCandidate?.candidateId ?? "";
    const rejectedId = rejectedReflection.soulCandidate?.candidateId ?? "";

    const listOutput = await listDirectorSoulCandidates(workspaceRoot);
    const explainOutput = await explainDirectorSoulCandidate(workspaceRoot, acceptedId);
    const rejectOutput = await rejectDirectorSoulCandidate(workspaceRoot, {
      candidateId: rejectedId,
      author: "operator",
      note: "reject noisy preference",
      now: "2026-04-28T06:12:00.000Z",
    });
    const acceptOutput = await acceptDirectorSoulCandidate(workspaceRoot, {
      candidateId: acceptedId,
      author: "operator",
      note: "accept useful preference",
      now: "2026-04-28T06:13:00.000Z",
    });
    const soulOutput = await viewDirectorSoul(workspaceRoot);
    const soulMarkdown = readFileSync(
      join(workspaceRoot, ".director-angel", "soul", "SOUL.md"),
      "utf8",
    );

    expect(listOutput).toContain("Director Soul candidates:");
    expect(listOutput).toContain(acceptedId);
    expect(listOutput).toContain(rejectedId);
    expect(explainOutput).toContain("Director Soul candidate:");
    expect(explainOutput).toContain("proposed sections:");
    expect(rejectOutput).toContain("decision: rejected");
    expect(acceptOutput).toContain("decision: accepted");
    expect(acceptOutput).toContain("SOUL.md");
    expect(soulOutput).toContain("# Director Angel Soul");
    expect(soulMarkdown).toContain("Source candidate:");
    expect(soulMarkdown).toContain(acceptedId);
    expect(soulMarkdown).not.toContain(rejectedId);
  });

  it("runs a safe heartbeat scan for pending reviews, failed runs, degraded adapters, cost, and Skill trust", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-heartbeat-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "Desktop", "AngelLessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "lesson.md"),
      [
        "Director Angel should keep every learned lesson review-gated.",
        "Useful production lessons must preserve evidence, source paths, quality checks, and a clear reason before promotion.",
        "A pending review should stay visible until the operator accepts, rejects, or promotes it into a knowledge candidate.",
      ].join("\n"),
      "utf8",
    );
    await learnDirectorExperience(workspaceRoot, {
      directories: [lessonDir],
      privacy: "confidential",
    });
    await writeRunReportFixture(workspaceRoot, {
      runId: "run-heartbeat-failed",
      status: "failed",
      flags: ["failed"],
      summary: ["External bridge failed and needs reflection."],
    });
    writeDegradedAdapterRegistryFixture(workspaceRoot);
    writeUntrustedSkillSnapshotFixture(workspaceRoot);

    const output = await runDirectorHeartbeat(workspaceRoot, {
      now: "2026-04-28T06:00:00.000Z",
    });
    const status = await describeDirectorHeartbeatStatus(workspaceRoot);
    const latest = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "heartbeat", "latest.json"), "utf8"),
    );
    const eventFiles = readdirSync(join(workspaceRoot, ".director-angel", "heartbeat", "events"));

    expect(output).toContain("Director heartbeat:");
    expect(output).toContain("heartbeat enabled: no");
    expect(output).toContain("kind=stale-review");
    expect(output).toContain("kind=failed-run");
    expect(output).toContain("kind=reflection-due");
    expect(output).toContain("kind=adapter-degraded");
    expect(output).toContain("kind=cost-budget-warn");
    expect(output).toContain("kind=skill-untrusted");
    expect(output).toContain("hotflow director reflect --run-id run-heartbeat-failed");
    expect(status).toContain("latest event count:");
    expect(latest).toMatchObject({
      schemaVersion: "director.heartbeat.snapshot.v1",
      eventCount: expect.any(Number),
      highestSeverity: expect.any(String),
    });
    expect(eventFiles.length).toBe(latest.eventCount);
  });

  it("emits operator care reminders for accepted learning that is not recallable yet", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-care-heartbeat-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "Desktop", "AngelLessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "lesson.md"),
      "Accepted lessons are still not useful to production until they are promoted, reviewed, published, and recallable.",
      "utf8",
    );
    writeRuntimeFeatureSwitchFixture(workspaceRoot, {
      "care.enabled": true,
    });

    await learnDirectorExperience(workspaceRoot, {
      directories: [lessonDir],
      privacy: "confidential",
    });
    const experienceList = await listDirectorExperienceCandidates(workspaceRoot);
    const candidateId = requireMatchGroup(/- (.+?) status=/u.exec(experienceList));
    await acceptDirectorExperienceCandidate(workspaceRoot, {
      candidateId,
      author: "operator-care",
      note: "accepted but not promoted",
      now: "2026-04-28T05:55:00.000Z",
    });

    const output = await runDirectorHeartbeat(workspaceRoot, {
      now: "2026-04-28T06:00:00.000Z",
    });
    const latest = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "heartbeat", "latest.json"), "utf8"),
    );

    expect(output).toContain("kind=care");
    expect(output).toContain(
      `hotflow director knowledge experience-promote --candidate-id ${candidateId}`,
    );
    expect(latest.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "care",
          severity: "info",
          evidenceRefs: [`experience://${candidateId}`],
        }),
      ]),
    );
  });

  it("emits a memory care reminder when a terminal run has not entered the memory lane", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-memory-heartbeat-"));
    tempRoots.push(workspaceRoot);
    writeRuntimeFeatureSwitchFixture(workspaceRoot, {
      "memory.enabled": true,
    });
    await writeRunReportFixture(workspaceRoot, {
      runId: "run-heartbeat-memory-missing",
      status: "completed",
      flags: [],
      summary: ["Production run completed and should be available for future recall."],
    });

    const output = await runDirectorHeartbeat(workspaceRoot, {
      now: "2026-04-28T06:00:00.000Z",
    });
    const latest = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "heartbeat", "latest.json"), "utf8"),
    );

    expect(output).toContain("kind=care");
    expect(output).toContain("run-heartbeat-memory-missing");
    expect(output).toContain("hotflow director memory status");
    expect(latest.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "care",
          severity: "warn",
          evidenceRefs: expect.arrayContaining([
            "director-run://run-heartbeat-memory-missing/report/report-run-heartbeat-memory-missing",
          ]),
          actionRefs: expect.arrayContaining(["hotflow director memory status"]),
        }),
      ]),
    );
  });

  it("emits an info reflection reminder for a completed run before it is reflected", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-completed-reflection-"));
    tempRoots.push(workspaceRoot);
    await writeRunReportFixture(workspaceRoot, {
      runId: "run-heartbeat-completed",
      status: "completed",
      flags: [],
      summary: ["Production run completed and should be reflected before reuse."],
    });

    const output = await runDirectorHeartbeat(workspaceRoot, {
      now: "2026-04-28T06:00:00.000Z",
    });
    const latest = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "heartbeat", "latest.json"), "utf8"),
    );

    expect(output).toContain("kind=reflection-due");
    expect(output).toContain("severity=info");
    expect(output).toContain("hotflow director reflect --run-id run-heartbeat-completed");
    expect(output).not.toContain("kind=failed-run");
    expect(latest.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reflection-due",
          severity: "info",
          evidenceRefs: [
            "director-run://run-heartbeat-completed/report/report-run-heartbeat-completed",
          ],
        }),
      ]),
    );
  });

  it("emits a skill proposal reminder for reviewed experience that has not become a Skill yet", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-skill-heartbeat-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "Desktop", "AngelLessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "storyboard.md"),
      "When planning a short drama, choose shot size by story beat before drafting image prompts.",
      "utf8",
    );
    writeRuntimeFeatureSwitchFixture(workspaceRoot, {
      "care.enabled": true,
    });

    await learnDirectorExperience(workspaceRoot, {
      directories: [lessonDir],
      privacy: "confidential",
    });
    const experienceList = await listDirectorExperienceCandidates(workspaceRoot);
    const candidateId = requireMatchGroup(/- (.+?) status=/u.exec(experienceList));
    await acceptDirectorExperienceCandidate(workspaceRoot, {
      candidateId,
      author: "operator-care",
      note: "accepted for skill proposal",
      now: "2026-04-28T05:55:00.000Z",
    });

    const output = await runDirectorHeartbeat(workspaceRoot, {
      now: "2026-04-28T06:00:00.000Z",
    });
    const latest = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "heartbeat", "latest.json"), "utf8"),
    );

    expect(output).toContain("kind=skill-proposal-due");
    expect(output).toContain(`/技能 从经验 ${candidateId}`);
    expect(latest.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "skill-proposal-due",
          severity: "info",
          evidenceRefs: [`experience://${candidateId}`],
          actionRefs: [`/技能 从经验 ${candidateId}`],
        }),
      ]),
    );
  });

  it("uses the configured API text model to distill learned experience candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-model-learn-"));
    tempRoots.push(workspaceRoot);
    const providersRoot = join(workspaceRoot, ".director-angel", "providers");
    await updateDirectorApiProviderSetting(providersRoot, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-api-key",
    });

    const requests: unknown[] = [];
    const output = await learnDirectorExperience(workspaceRoot, {
      urls: ["https://example.com/model-distill"],
      fetchText: async (url) => ({
        url,
        contentType: "text/html",
        body: [
          "<html><title>Model Distill</title><body>",
          "<p>Raw opener should remain source evidence.</p>",
          "<p>推荐流程：先确认目标，再选择景别、角度、构图，并保留审核证据。</p>",
          "</body></html>",
        ].join(""),
      }),
      apiProviderFetch: async (_url, init) => {
        requests.push(JSON.parse(init.body ?? "{}"));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () =>
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: "模型提炼：制作前先确认目标，再选择镜头语言，并保留审核证据。",
                      applicability: "用于学习短剧制作资料并形成可审核经验候选。",
                      risks: ["模型提炼需人工复核后才能晋升知识。"],
                      tags: ["model-distilled", "shot-language"],
                      evidenceSummary: "来源要求先确认目标、选择镜头语言并保留审核证据。",
                      confidence: "high",
                      selectedClaims: ["先确认目标，再选择景别、角度、构图。"],
                    }),
                  },
                },
              ],
            }),
        };
      },
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);
    const candidate = inspection.candidates[0]?.candidate;

    expect(output).toContain("model distillation: enabled");
    expect(requests).toHaveLength(1);
    expect(candidate?.summary).toContain("模型提炼");
    expect(candidate?.summary).not.toContain("Raw opener");
    expect(candidate?.tags).toEqual(expect.arrayContaining(["distillation:model"]));
    expect(candidate?.evidencePreview).toContain("Raw opener");
  });

  it("accepts wrapped model distillation JSON before falling back to rules", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-model-wrapper-"));
    tempRoots.push(workspaceRoot);
    const providersRoot = join(workspaceRoot, ".director-angel", "providers");
    await updateDirectorApiProviderSetting(providersRoot, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-api-key",
    });

    await learnDirectorExperience(workspaceRoot, {
      urls: ["https://example.com/wrapped-distill"],
      fetchText: async (url) => ({
        url,
        contentType: "text/html",
        body: "<html><title>Wrapped Distill</title><body>Keep hot memory small and search long session history on demand.</body></html>",
      }),
      apiProviderFetch: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    result: {
                      summary: "模型提炼：热记忆保持小而稳定，长历史按需检索。",
                      applicability: "用于设计多层记忆和提示词缓存边界。",
                      risks: ["包装 JSON 仍需人工复核。"],
                      tags: ["wrapped-json", "memory-layering"],
                      evidenceSummary: "来源强调 hot memory 和 long session history 分层。",
                      confidence: "high",
                      selectedClaims: ["Keep hot memory small."],
                    },
                  }),
                },
              },
            ],
          }),
      }),
    });
    const inspection = await inspectDirectorExperienceCandidates(workspaceRoot);
    const candidate = inspection.candidates[0]?.candidate;

    expect(candidate?.summary).toContain("热记忆保持小而稳定");
    expect(candidate?.tags).toEqual(expect.arrayContaining(["distillation:model"]));
    expect(candidate?.tags).not.toEqual(expect.arrayContaining(["distillation:model-fallback"]));
  });

  it("promotes reviewed experience candidates into published recallable knowledge", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-experience-promote-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "Desktop", "AngelLessons");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "lesson.md"),
      "Compare outside examples, preserve evidence, and keep learned guidance review-gated.",
    );
    writeKnowledgeRecallSwitchFixture(workspaceRoot, true);

    await learnDirectorExperience(workspaceRoot, {
      directories: [lessonDir],
      privacy: "confidential",
    });
    const experienceList = await listDirectorExperienceCandidates(workspaceRoot);
    const candidateId = requireMatchGroup(/- (.+?) status=/u.exec(experienceList));
    const experienceExplain = await explainDirectorExperienceCandidate(workspaceRoot, candidateId);
    const experienceAccept = await acceptDirectorExperienceCandidate(workspaceRoot, {
      candidateId,
      author: "operator-experience",
      note: "promote to formal candidate",
      now: "2026-04-25T09:00:00.000Z",
    });
    const acceptedInspection = await inspectDirectorExperienceCandidate(workspaceRoot, candidateId);
    const experiencePromote = await promoteDirectorExperienceCandidate(workspaceRoot, {
      candidateId,
      author: "operator-experience",
      note: "queue for knowledge review",
      now: "2026-04-25T09:01:00.000Z",
    });
    const promotedInspection = await inspectDirectorExperienceCandidate(workspaceRoot, candidateId);
    const knowledgeCandidates = await listDirectorKnowledgeCandidates(workspaceRoot);
    const packId = requireMatchGroup(/- (.+?) status=/u.exec(knowledgeCandidates));

    await acceptDirectorKnowledgeCandidate(workspaceRoot, {
      packId,
      author: "operator-knowledge",
      note: "publish learned experience",
      now: "2026-04-25T09:02:00.000Z",
    });
    await publishDirectorKnowledgeCandidate(workspaceRoot, {
      packId,
      author: "operator-knowledge",
      note: "make learned experience recallable",
      now: "2026-04-25T09:03:00.000Z",
    });
    const recall = await previewDirectorKnowledgeRecall(workspaceRoot, {
      projectId: "experience-learning",
      groupId: "local-directory",
      tags: ["source:local-directory"],
    });

    expect(experienceList).toContain("Director experience candidates:");
    expect(experienceExplain).toContain("Director experience candidate:");
    expect(experienceAccept).toContain("Director experience candidate decision:");
    expect(acceptedInspection.status).toBe("accepted");
    expect(acceptedInspection.latestReview?.note).toBe("promote to formal candidate");
    expect(experiencePromote).toContain("Director experience promote:");
    expect(promotedInspection.promoted).toBe(true);
    expect(promotedInspection.latestPromotion?.promotedTo).toBe("director-knowledge-candidate");
    expect(knowledgeCandidates).toContain("Director knowledge candidates:");
    expect(recall).toContain("status: hit");
    expect(recall).toContain(`proposal=experience:${candidateId}`);
  });

  it("supports candidate sync, review, publish, and rollback flows", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-candidate-flow-"));
    tempRoots.push(workspaceRoot);
    writeAcceptedProposalFixture(workspaceRoot, "proposal-knowledge-4");

    const syncOutput = await syncDirectorKnowledgeCandidateFromProposal(workspaceRoot, {
      proposalId: "proposal-knowledge-4",
      author: "operator-sync",
      note: "queue_for_review",
      now: "2026-04-13T16:00:00.000Z",
    });
    const candidateList = await listDirectorKnowledgeCandidates(workspaceRoot);
    const packId = requireMatchGroup(/- (.+?) status=/u.exec(candidateList));

    const explainCandidate = await explainDirectorKnowledgeCandidate(workspaceRoot, packId);
    const reviewCandidate = await reviewDirectorKnowledgeCandidate(workspaceRoot, packId);
    const acceptOutput = await acceptDirectorKnowledgeCandidate(workspaceRoot, {
      packId,
      author: "operator-review",
      note: "accepted_for_publish",
      now: "2026-04-13T16:01:00.000Z",
    });
    const publishOutput = await publishDirectorKnowledgeCandidate(workspaceRoot, {
      packId,
      author: "operator-publish",
      note: "publish_v1",
      now: "2026-04-13T16:02:00.000Z",
    });
    const rollbackOutput = await rollbackDirectorKnowledgePack(workspaceRoot, {
      packId,
      version: 1,
      author: "operator-rollback",
      note: "restore_v1",
      now: "2026-04-13T16:03:00.000Z",
    });
    const statusOutput = await describeDirectorKnowledgeStatus(workspaceRoot);

    expect(syncOutput).toContain("Director knowledge candidate sync:");
    expect(syncOutput).toContain("operation: create");
    expect(candidateList).toContain("Director knowledge candidates:");
    expect(explainCandidate).toContain("Director knowledge candidate:");
    expect(reviewCandidate).toContain("Director knowledge candidate review:");
    expect(acceptOutput).toContain("Director knowledge candidate decision:");
    expect(acceptOutput).toContain("next status: accepted");
    expect(publishOutput).toContain("Director knowledge publish:");
    expect(publishOutput).toContain("published version: 1");
    expect(rollbackOutput).toContain("Director knowledge rollback:");
    expect(rollbackOutput).toContain("current version after: 2");
    expect(statusOutput).toContain("published packs: 1");
  });

  it("renders knowledge candidate diff output", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-diff-"));
    tempRoots.push(workspaceRoot);
    writeAcceptedProposalFixture(workspaceRoot, "proposal-knowledge-6");

    await syncDirectorKnowledgeCandidateFromProposal(workspaceRoot, {
      proposalId: "proposal-knowledge-6",
      author: "operator-sync",
      note: "diff_ready",
      now: "2026-04-13T16:05:00.000Z",
    });
    const candidateList = await listDirectorKnowledgeCandidates(workspaceRoot);
    const packId = requireMatchGroup(/- (.+?) status=/u.exec(candidateList));

    const diffOutput = await diffDirectorKnowledgeCandidate(workspaceRoot, packId);
    expect(diffOutput).toContain("Director knowledge candidate diff:");
    expect(diffOutput).toContain(`pack id: ${packId}`);
    expect(diffOutput).toContain("changed fields:");
    expect(diffOutput).toContain("summary:");
  });

  it("records reject decisions for knowledge candidates", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-knowledge-reject-flow-"));
    tempRoots.push(workspaceRoot);
    writeAcceptedProposalFixture(workspaceRoot, "proposal-knowledge-5");

    await syncDirectorKnowledgeCandidateFromProposal(workspaceRoot, {
      proposalId: "proposal-knowledge-5",
      now: "2026-04-13T16:10:00.000Z",
    });
    const candidateList = await listDirectorKnowledgeCandidates(workspaceRoot);
    const packId = requireMatchGroup(/- (.+?) status=/u.exec(candidateList));

    const rejectOutput = await rejectDirectorKnowledgeCandidate(workspaceRoot, {
      packId,
      author: "operator-reject",
      note: "not_good_enough",
      now: "2026-04-13T16:11:00.000Z",
    });
    const explainOutput = await explainDirectorKnowledgeCandidate(workspaceRoot, packId);

    expect(rejectOutput).toContain("Director knowledge candidate decision:");
    expect(rejectOutput).toContain("next status: rejected");
    expect(explainOutput).toContain("latest review: rejected");
  });
});

function requireMatchGroup(match: RegExpExecArray | null, groupIndex = 1): string {
  const value = match?.[groupIndex];
  expect(value).toBeTruthy();
  if (value === undefined || value.length === 0) {
    throw new Error("Expected regex match group to be present.");
  }
  return value;
}

async function publishAcceptedProposalThroughKnowledgeCandidate(
  workspaceRoot: string,
  proposalId: string,
): Promise<string> {
  await syncDirectorKnowledgeCandidateFromProposal(workspaceRoot, {
    proposalId,
    author: "operator-test",
    note: "sync_for_publish_review",
    now: "2026-04-13T16:00:00.000Z",
  });
  const candidateList = await listDirectorKnowledgeCandidates(workspaceRoot);
  const packId = requireMatchGroup(/- (.+?) status=/u.exec(candidateList));
  await acceptDirectorKnowledgeCandidate(workspaceRoot, {
    packId,
    author: "operator-test",
    note: "accepted_for_publish",
    now: "2026-04-13T16:01:00.000Z",
  });
  await publishDirectorKnowledgeCandidate(workspaceRoot, {
    packId,
    author: "operator-test",
    note: "publish_after_review",
    now: "2026-04-13T16:02:00.000Z",
  });
  return packId;
}

function writeAcceptedProposalFixture(
  workspaceRoot: string,
  proposalId: string,
  options: { readonly withReviewMetadata?: boolean } = {},
): void {
  const rootPath = join(workspaceRoot, ".director-angel", "runtime", "proposals");
  rmSync(rootPath, { recursive: true, force: true });
  mkdirSync(join(rootPath, "records"), { recursive: true });
  writeFileSync(
    join(rootPath, "index.json"),
    JSON.stringify({
      schemaVersion: "director.proposal.index.v1",
      updatedAt: "2026-04-12T22:20:00.000Z",
      entries: [
        {
          proposalId,
          kind: "director.trace_capture",
          status: "accepted",
          projectId: "project-knowledge",
          groupId: "group-knowledge",
          title: "Director method: Publishable teaser",
          riskLevel: "low",
          confidence: 0.93,
          updatedAt: "2026-04-12T22:20:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(rootPath, "records", `${proposalId}.json`),
    JSON.stringify({
      schemaVersion: "director.proposal.v1",
      proposalId,
      kind: "director.trace_capture",
      status: "accepted",
      provenance: "director-worker/proposal-ingest",
      recordId: `record-${proposalId}`,
      digestId: `digest-${proposalId}`,
      runId: `run-${proposalId}`,
      reportId: `report-${proposalId}`,
      projectId: "project-knowledge",
      groupId: "group-knowledge",
      title: "Director method: Publishable teaser",
      summary: "completed immersive new run",
      trigger: "When planning a publishable teaser.",
      evidenceSummary: "status=completed | roles=researcher, script-planner",
      explanation: "Completed run suggests a reusable director method.",
      confidence: 0.93,
      riskLevel: "low",
      dedupeKey: "project-knowledge__group-knowledge__publishable-teaser",
      tags: ["director-trace", "continuity"],
      roles: ["researcher", "script-planner"],
      selectedAdapters: ["scripted"],
      createdAt: "2026-04-12T22:10:00.000Z",
      updatedAt: "2026-04-12T22:20:00.000Z",
      latestDecision:
        options.withReviewMetadata === false
          ? undefined
          : {
              decidedAt: "2026-04-12T22:20:00.000Z",
              decidedStatus: "accepted",
              note: "approved_for_publish",
            },
      sourceRecord: {
        schemaVersion: "director.memory.record.v1",
        recordId: `record-${proposalId}`,
        digestId: `digest-${proposalId}`,
        projectId: "project-knowledge",
        groupId: "group-knowledge",
        anchorIds: ["anchor-a"],
        selectedAdapters: ["scripted"],
        tags: ["continuity"],
        status: "completed",
        recordedAt: "2026-04-12T22:10:00.000Z",
        digest: {
          schemaVersion: "director.memory.trace-digest.v1",
          digestId: `digest-${proposalId}`,
          runId: `run-${proposalId}`,
          reportId: `report-${proposalId}`,
          snapshotId: `snapshot-${proposalId}`,
          runtimeId: "runtime-1",
          blueprintId: `blueprint-${proposalId}`,
          handoffId: `handoff-${proposalId}`,
          actionGraphId: `graph-${proposalId}`,
          projectId: "project-knowledge",
          groupId: "group-knowledge",
          goal: "Create a publishable teaser.",
          previewSummary: "Preview-safe run completed successfully.",
          status: "completed",
          roles: ["researcher", "script-planner"],
          anchorIds: ["anchor-a"],
          selectedAdapters: ["scripted"],
          observationRefs: [
            {
              observationId: "observation-evaluation-1",
              source: "evaluation",
              recordedAt: "2026-04-12T22:10:00.000Z",
            },
          ],
          assignmentStats: {
            total: 2,
            completed: 2,
            failed: 0,
            aborted: 0,
            skipped: 0,
            blocked: 0,
          },
          flags: [],
          eventTypes: ["run-created", "assignment-status-changed"],
          createdAt: "2026-04-12T22:10:00.000Z",
          startedAt: "2026-04-12T22:10:00.000Z",
          completedAt: "2026-04-12T22:15:00.000Z",
          recordedAt: "2026-04-12T22:15:00.000Z",
          generationType: "new",
          generationStyle: "immersive",
          knowledgeSignalTags: ["continuity"],
        },
      },
    }),
    "utf8",
  );
}

function writeKnowledgeRecallSwitchFixture(workspaceRoot: string, enabled: boolean): void {
  writeRuntimeFeatureSwitchFixture(workspaceRoot, {
    "knowledgeRecall.enabled": enabled,
  });
}

function writeRuntimeFeatureSwitchFixture(
  workspaceRoot: string,
  features: Record<string, boolean>,
): void {
  const runtimeRoot = join(workspaceRoot, ".director-angel", "runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    join(runtimeRoot, "switches.json"),
    JSON.stringify({
      schemaId: "director.switches.v1",
      features,
    }),
    "utf8",
  );
}

function writeDegradedAdapterRegistryFixture(workspaceRoot: string): void {
  const registryDir = join(workspaceRoot, ".director-angel", "adapters", "registry");
  const manifestDir = join(registryDir, "manifests");
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, "external-cli.json");
  writeFileSync(
    join(registryDir, "index.json"),
    JSON.stringify({
      schemaVersion: "director.adapter.registry.index.v1",
      updatedAt: "2026-04-28T06:00:00.000Z",
      entries: [
        {
          adapterId: "external-cli",
          adapterKind: "execution",
          provider: "local-cli",
          enabled: true,
          healthStatus: "degraded",
          capturedAt: "2026-04-28T06:00:00.000Z",
          version: 1,
          manifestPath,
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: "director.adapter.manifest.v1",
      version: 1,
      capturedAt: "2026-04-28T06:00:00.000Z",
      source: "test",
      adapterId: "external-cli",
      adapterKind: "execution",
      provider: "local-cli",
      enabled: true,
      healthStatus: "degraded",
      dryRunSupported: true,
      mockOnly: false,
      supportedActionClasses: ["write"],
      notes: ["bridge health check failed"],
    }),
    "utf8",
  );
}

function writeUntrustedSkillSnapshotFixture(workspaceRoot: string): void {
  const skillsDir = join(workspaceRoot, ".hotflow", "skills");
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(
    join(skillsDir, "approved-skills.json"),
    JSON.stringify({
      schemaVersion: "skills.approved.v2",
      version: 1,
      updatedAtMs: 1,
      appliedAtMs: 1,
      appliedFromProposalId: null,
      changeKind: "manual",
      previousVersion: null,
      restoredFromVersion: null,
      skills: [
        {
          id: "skill.external-untrusted",
          version: "1.0.0",
          title: "External Untrusted Skill",
          content: "Imported external workflow.",
          updatedAtMs: 1,
        },
      ],
    }),
    "utf8",
  );
}

async function writeRunReportFixture(
  workspaceRoot: string,
  input: {
    readonly runId: string;
    readonly status: "completed" | "failed" | "aborted";
    readonly flags: readonly string[];
    readonly summary: readonly string[];
  },
): Promise<void> {
  const store = new FileSystemRunStore({
    rootPath: join(workspaceRoot, ".director-angel", "runtime", "execution"),
  });
  const reportId = `report-${input.runId}`;
  const run = {
    schemaVersion: "director.execution.run.v1",
    runId: input.runId,
    snapshotId: "snapshot-reflect-1",
    runtimeId: "runtime-reflect-1",
    blueprintId: "blueprint-reflect-1",
    handoffId: "handoff-reflect-1",
    actionGraphId: "graph-reflect-1",
    goal: "Make a production clip",
    previewSummary: "External bridge failed after one completed planning assignment.",
    sideEffectsAllowed: false,
    createdAt: "2026-04-28T05:50:00.000Z",
    startedAt: "2026-04-28T05:51:00.000Z",
    updatedAt: "2026-04-28T05:55:00.000Z",
    completedAt: "2026-04-28T05:55:00.000Z",
    status: input.status,
    assignments: [
      {
        runId: input.runId,
        assignmentId: "assignment-reflect-1",
        role: "script-planner",
        objective: "Plan a short production script.",
        deliverable: "Script plan",
        actionClass: "generate",
        approvalMode: "operator_approve",
        dependsOn: [],
        status: "completed",
        selectedAdapter: "api-provider:text",
        allowedAdapters: ["api-provider:text"],
        timeoutMs: 30000,
        createdAt: "2026-04-28T05:50:00.000Z",
        startedAt: "2026-04-28T05:51:00.000Z",
        completedAt: "2026-04-28T05:52:00.000Z",
        result: {
          runId: input.runId,
          assignmentId: "assignment-reflect-1",
          status: "completed",
          recordedAt: "2026-04-28T05:52:00.000Z",
          workerId: "worker-reflect-1",
          summary: "Script planning completed.",
          adapterId: "api-provider:text",
        },
      },
      {
        runId: input.runId,
        assignmentId: "assignment-reflect-2",
        role: "asset-router",
        objective: "Route production request to the external bridge.",
        deliverable: "External production request",
        actionClass: "generate",
        approvalMode: "operator_approve",
        dependsOn: ["assignment-reflect-1"],
        status: "failed",
        selectedAdapter: "external-cli",
        allowedAdapters: ["external-cli"],
        blockingReason: "Bridge timeout",
        timeoutMs: 30000,
        createdAt: "2026-04-28T05:50:00.000Z",
        startedAt: "2026-04-28T05:52:00.000Z",
        completedAt: "2026-04-28T05:55:00.000Z",
        result: {
          runId: input.runId,
          assignmentId: "assignment-reflect-2",
          status: "failed",
          recordedAt: "2026-04-28T05:55:00.000Z",
          workerId: "worker-reflect-1",
          summary: "External bridge timed out before returning production output.",
          adapterId: "external-cli",
          notes: ["missing retry budget and platform credential check"],
        },
      },
    ],
    events: [],
  };

  await store.saveRun(run);
  await store.saveReport({
    schemaVersion: "director.execution.run.v1",
    reportId,
    runId: input.runId,
    run,
    recordedAt: "2026-04-28T05:56:00.000Z",
    summary: input.summary,
    flags: input.flags,
    operatorSurface: {
      directorGoal: "Make a production clip",
      operatorSummary: "External bridge failed after planning completed.",
      bridgeVerdict: "failed",
      bridgeFailureReason: "network_timeout",
      retryable: true,
      retryAllowed: true,
      nextAction: "review and record the failure lesson before retrying.",
    },
    events: [],
  });
}
