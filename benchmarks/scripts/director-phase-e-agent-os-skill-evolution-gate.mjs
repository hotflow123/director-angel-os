import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CONTRACTS_SCHEMA_VERSION,
  createExperienceCandidate,
  createExperienceSourceAdapterDeclaration,
} from "../../packages/contracts/dist/index.js";
import {
  InMemorySkillRepository,
  SkillCuratorAutoApplyService,
  SkillPromptIndex,
  SkillProposalReviewer,
  SkillSafeApplyService,
  SkillSnapshotFileStore,
  SkillUsageStore,
  analyzeSkillEvolution,
  generateSkillProposalFromExperienceCandidate,
  guardSkillCuratorWriteRequest,
  resolveApprovedSkillSnapshotPath,
  resolveSkillRuntimeContract,
  resolveSkillUsagePath,
} from "../../packages/skills/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const suiteId = "director-phase-e-agent-os-skill-evolution-gate";
const activeEntryFiles = [
  "apps/cli/src/director-skills.ts",
  "apps/director-host-api/src/server.ts",
  "apps/director-desktop/src/desktop-system-handlers.js",
];
const forbiddenInlineMarkers = [
  "Accepted Director experience",
  "证据来源：",
  'skillLifecycle: "proposed"',
  "modelInvocationGate",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createProposalRecord(proposal, createdAtMs) {
  return createProposalRecordWithStatus(proposal, "pending", createdAtMs);
}

function createProposalRecordWithStatus(proposal, status, createdAtMs) {
  return {
    id: proposal.id,
    kind: proposal.kind,
    payload: proposal.payload,
    status,
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    sourceSessionId: proposal.sourceSessionId,
    sourceTurnId: proposal.sourceTurnId,
    provenance: proposal.provenance,
    createdAtMs,
    updatedAtMs: createdAtMs,
    ...(proposal.expiresAtMs === undefined ? {} : { expiresAtMs: proposal.expiresAtMs }),
  };
}

function createCandidate(overrides) {
  return createExperienceCandidate({
    candidateId: overrides.candidateId,
    sourceAdapter: createExperienceSourceAdapterDeclaration({
      adapterId: overrides.adapterId,
      sourceKind: overrides.sourceKind ?? "local-directory",
      sourceRef: overrides.sourceRef,
      privacy: overrides.privacy,
      transformations: [
        {
          transformId: "extract-production-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable Director Angel production lessons.",
        },
      ],
    }),
    title: overrides.title,
    summary: overrides.summary,
    applicability: overrides.applicability,
    risks: overrides.risks ?? [],
    tags: overrides.tags ?? [],
    evidence: overrides.evidence ?? [],
    ...(overrides.sourceDigest === undefined ? {} : { sourceDigest: overrides.sourceDigest }),
    ...(overrides.evidencePreview === undefined
      ? {}
      : { evidencePreview: overrides.evidencePreview }),
    privacy: overrides.privacy,
    provenance: overrides.provenance ?? "director-knowledge/local-directory",
    createdAtMs: overrides.createdAtMs ?? 1777103940000,
  });
}

function runConfidentialExperienceCase() {
  const candidate = createCandidate({
    candidateId: "experience_desktop_lessons",
    adapterId: "adapter_desktop_lessons",
    sourceRef: "file:///Desktop/AngelLessons",
    privacy: "confidential",
    title: "Ask for constraints before production",
    summary: "Ask for missing constraints before generating production assets.",
    applicability: "Use when Director Angel is preparing production work from desktop lessons.",
    risks: ["Local files may contain private details."],
    tags: ["constraint-clarity", "operator-learning"],
    evidence: [
      {
        evidenceId: "evidence_desktop_lessons",
        sourceRef: "file:///Desktop/AngelLessons/lesson.md",
        path: "lesson.md",
        summary: "Lesson says to ask for missing constraints first.",
      },
    ],
    sourceDigest: "sha256:desktop-lessons",
    evidencePreview: "Lesson says to ask for missing constraints first.",
  });
  const generated = generateSkillProposalFromExperienceCandidate({
    candidate,
    sourceSessionId: "director-angel-desktop",
    author: "bench-operator",
    nowMs: 1777104000000,
  });
  const payload = generated.proposal.payload;
  const snapshot = payload.snapshot;
  const review = new SkillProposalReviewer().reviewProposal(
    createProposalRecord(generated.proposal, 1777104000000),
  );

  assert(
    generated.proposal.kind === "skills.snapshot_upsert",
    "proposal kind must be Skill upsert",
  );
  assert(
    generated.proposal.provenance === "skills/director-experience",
    "experience proposal provenance must remain shared bridge provenance",
  );
  assert(
    generated.skillId === "skill.director.ask-for-constraints-before-production",
    "skill id must preserve shared slug behavior",
  );
  assert(snapshot.id === generated.skillId, "snapshot id must match generated skill id");
  assert(
    snapshot.disableModelInvocation === true,
    "confidential experience must disable model use",
  );
  assert(
    snapshot.metadata?.sourceExperienceRef === "experience://experience_desktop_lessons",
    "metadata must preserve source experience ref",
  );
  assert(snapshot.metadata?.skillLifecycle === "proposed", "metadata must keep proposed lifecycle");
  assert(snapshot.metadata?.auditStatus === "accepted", "metadata must keep accepted audit status");
  assert(snapshot.metadata?.trustStatus === "trusted", "metadata must keep trusted status");
  assert(snapshot.metadata?.privacy === "confidential", "metadata must keep privacy class");
  assert(
    snapshot.metadata?.modelInvocationGate === "operator-review-required",
    "confidential experience must carry operator review model gate metadata",
  );
  assert(payload.riskLevel === "medium", "confidential experience risk should be medium");
  assert(payload.confidence === 0.72, "confidential experience confidence should stay stable");
  assert(
    payload.evidenceSummary === "Lesson says to ask for missing constraints first.",
    "evidence preview should become proposal evidence summary",
  );
  assert(
    review.verdict === "accepted",
    `confidential medium-risk proposal should remain reviewer-accepted, got ${review.verdict}`,
  );

  return {
    id: "confidential_experience_skill_proposal",
    ok: true,
    actual: {
      proposalKind: generated.proposal.kind,
      provenance: generated.proposal.provenance,
      skillId: generated.skillId,
      riskLevel: payload.riskLevel,
      confidence: payload.confidence,
      disableModelInvocation: snapshot.disableModelInvocation === true,
      modelInvocationGate: snapshot.metadata?.modelInvocationGate,
      reviewVerdict: review.verdict,
    },
  };
}

function runRestrictedExperienceCase() {
  const candidate = createCandidate({
    candidateId: "experience_secret_lessons",
    adapterId: "adapter_secret_lessons",
    sourceKind: "manual",
    sourceRef: "manual://restricted",
    privacy: "restricted",
    title: "Handle launch secrets",
    summary: "Never expose launch secrets.",
    applicability: "Use when lessons contain restricted launch information.",
    risks: ["Restricted content must remain operator gated."],
    tags: ["secrets"],
    evidence: [],
    provenance: "director-knowledge/manual",
    createdAtMs: 10,
  });
  const generated = generateSkillProposalFromExperienceCandidate({
    candidate,
    sourceSessionId: "director-angel-desktop",
    nowMs: 20,
  });
  const payload = generated.proposal.payload;
  const snapshot = payload.snapshot;
  const review = new SkillProposalReviewer().reviewProposal(
    createProposalRecord(generated.proposal, 20),
  );

  assert(payload.riskLevel === "high", "restricted/no-evidence experience must be high risk");
  assert(payload.confidence === 0.42, "restricted/no-evidence confidence must stay low");
  assert(snapshot.disableModelInvocation === true, "restricted experience must disable model use");
  assert(
    snapshot.metadata?.modelInvocationGate === "restricted-experience",
    "restricted experience must carry restricted model gate metadata",
  );
  assert(snapshot.metadata?.evidenceCount === 0, "restricted no-evidence count must be preserved");
  assert(
    review.verdict === "operator_review",
    `restricted high-risk proposal must require operator review, got ${review.verdict}`,
  );

  return {
    id: "restricted_experience_skill_proposal",
    ok: true,
    actual: {
      proposalKind: generated.proposal.kind,
      riskLevel: payload.riskLevel,
      confidence: payload.confidence,
      disableModelInvocation: snapshot.disableModelInvocation === true,
      modelInvocationGate: snapshot.metadata?.modelInvocationGate,
      evidenceCount: snapshot.metadata?.evidenceCount,
      reviewVerdict: review.verdict,
    },
  };
}

function runPublicExperienceCase() {
  const candidate = createCandidate({
    candidateId: "experience_public_lessons",
    adapterId: "adapter_public_lessons",
    sourceKind: "web-search",
    sourceRef: "https://example.test/director-lessons",
    privacy: "public",
    title: "Reuse public storyboard checklist",
    summary: "Apply the public storyboard checklist before shot generation.",
    applicability: "Use for public production references.",
    risks: [],
    tags: ["storyboard"],
    evidence: [
      {
        evidenceId: "evidence_public_1",
        sourceRef: "https://example.test/director-lessons",
        summary: "Public lesson includes storyboard checklist.",
      },
      {
        evidenceId: "evidence_public_2",
        sourceRef: "https://example.test/director-lessons#review",
        summary: "Public review confirms the checklist.",
      },
    ],
    sourceDigest: "sha256:public-lessons",
  });
  const generated = generateSkillProposalFromExperienceCandidate({
    candidate,
    sourceSessionId: "director-angel-web",
    nowMs: 30,
  });
  const payload = generated.proposal.payload;
  const snapshot = payload.snapshot;

  assert(
    payload.riskLevel === "medium",
    "public enough-evidence experience should remain review-visible medium risk",
  );
  assert(payload.confidence === 0.78, "public enough-evidence confidence should stay stable");
  assert(
    snapshot.disableModelInvocation !== true,
    "public enough-evidence experience should stay model-invocable",
  );
  assert(
    snapshot.metadata?.modelInvocationGate === "none",
    "public enough-evidence experience should carry no model gate",
  );

  return {
    id: "public_experience_skill_proposal",
    ok: true,
    actual: {
      riskLevel: payload.riskLevel,
      confidence: payload.confidence,
      disableModelInvocation: snapshot.disableModelInvocation === true,
      modelInvocationGate: snapshot.metadata?.modelInvocationGate,
    },
  };
}

function runEntryDelegationScan(repoRoot) {
  const issues = [];

  for (const relPath of activeEntryFiles) {
    const content = readFileSync(resolve(repoRoot, relPath), "utf8");
    if (!content.includes("generateSkillProposalFromExperienceCandidate")) {
      issues.push(`${relPath} does not delegate to generateSkillProposalFromExperienceCandidate.`);
    }
    for (const marker of forbiddenInlineMarkers) {
      if (content.includes(marker)) {
        issues.push(`${relPath} still contains old inline proposal marker: ${marker}`);
      }
    }
  }

  assert(issues.length === 0, issues.join("\n"));
  return {
    id: "entry_surfaces_delegate_to_shared_bridge",
    ok: true,
    actual: {
      scannedFiles: activeEntryFiles.length,
      forbiddenMarkers: forbiddenInlineMarkers,
    },
  };
}

function runReviewApplyUseFailureTelemetryCase() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-evolution-gate-"));
  try {
    const dataDir = join(workspaceRoot, ".hotflow");
    const candidate = createCandidate({
      candidateId: "experience_public_storyboard_loop",
      adapterId: "adapter_public_storyboard_loop",
      sourceKind: "web-search",
      sourceRef: "https://example.test/storyboard-loop",
      privacy: "public",
      title: "Review storyboard before shot generation",
      summary: "Review storyboard constraints before generating shots.",
      applicability: "Use before Director Angel generates shot plans.",
      risks: [],
      tags: ["storyboard", "shot-generation"],
      evidence: [
        {
          evidenceId: "evidence_storyboard_loop_1",
          sourceRef: "https://example.test/storyboard-loop",
          summary: "Public lesson says to review storyboard constraints.",
        },
        {
          evidenceId: "evidence_storyboard_loop_2",
          sourceRef: "https://example.test/storyboard-loop#shot",
          summary: "Public lesson connects storyboard constraints to shot generation.",
        },
      ],
      sourceDigest: "sha256:storyboard-loop",
    });
    const generated = generateSkillProposalFromExperienceCandidate({
      candidate,
      sourceSessionId: "director-angel-web",
      nowMs: 100,
    });
    const pendingRecord = createProposalRecord(generated.proposal, 100);
    const review = new SkillProposalReviewer().reviewProposal(pendingRecord);
    assert(review.verdict === "accepted", `expected accepted review, got ${review.verdict}`);

    const acceptedRecord = createProposalRecordWithStatus(generated.proposal, "accepted", 110);
    const snapshotStore = new SkillSnapshotFileStore(
      resolveApprovedSkillSnapshotPath({ dataDir }),
      {
        now: () => 120,
      },
    );
    const apply = new SkillSafeApplyService(snapshotStore).applyAcceptedProposal(acceptedRecord);
    assert(apply.approvedSkillCount === 1, "safe apply must publish one approved skill");
    assert(apply.skillId === generated.skillId, "applied skill id must match generated skill id");

    const approved = snapshotStore.readApproved();
    const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
      now: () => 130,
    });
    const sections = new SkillPromptIndex(new InMemorySkillRepository(approved), {
      usageStore,
      usageActor: "bench-runtime",
    }).buildSections({
      limit: 1,
      userText: "storyboard shot generation constraints",
    });
    assert(sections.length === 1, "approved skill must become visible to prompt index");
    assert(
      sections[0]?.metadata?.skillId === generated.skillId,
      "prompt index must inject the newly approved skill",
    );

    const failed = usageStore.recordFailure(generated.skillId, {
      actor: "bench-runtime",
      reason: "simulated missing downstream tool after skill use",
      nowMs: 140,
    });
    const curator = analyzeSkillEvolution({
      nowMs: 200,
      failurePatchThreshold: 1,
      staleAfterMs: 10_000,
      approvedSkills: [
        ...approved,
        {
          id: "skill.canonical.storyboard",
          version: "1.0.0",
          title: "Canonical storyboard skill",
          content: "Canonical public storyboard guidance.",
          updatedAtMs: 150,
          metadata: {
            dedupeKey: "storyboard-duplicate-bench",
          },
        },
        {
          id: "skill.duplicate.storyboard",
          version: "1.0.0",
          title: "Duplicate storyboard skill",
          content: "Duplicate public storyboard guidance.",
          updatedAtMs: 150,
          metadata: {
            dedupeKey: "storyboard-duplicate-bench",
          },
        },
      ],
      usageDocument: usageStore.readDocument(),
    });
    const patchAction = curator.actions.find((action) => action.kind === "patch");
    const mergeAction = curator.actions.find((action) => action.kind === "merge");
    assert(failed.useCount === 1, "prompt injection must record one skill use");
    assert(failed.failureCount === 1, "failure telemetry must record one failure");
    assert(failed.lastFailedAtMs === 140, "failure telemetry must keep last failure timestamp");
    assert(
      failed.events.map((event) => event.action).join(",") === "use,failure",
      "usage sidecar must preserve use -> failure event order",
    );
    assert(
      patchAction?.skillId === generated.skillId,
      "curator must propose patch for failed Skill",
    );
    assert(
      mergeAction?.duplicateSkillIds?.includes("skill.duplicate.storyboard") === true,
      "curator must propose merge for duplicate Skill dedupe keys",
    );

    return {
      id: "review_apply_use_failure_curator",
      ok: true,
      actual: {
        reviewVerdict: review.verdict,
        proposalStatusBeforeApply: acceptedRecord.status,
        approvedSkillCount: apply.approvedSkillCount,
        promptSections: sections.length,
        useCount: failed.useCount,
        failureCount: failed.failureCount,
        lastFailedAtMs: failed.lastFailedAtMs,
        curatorPatchCount: curator.summary.patchCount,
        curatorMergeCount: curator.summary.mergeCount,
      },
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function runCuratorOperatorLifecycleCase() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-curator-ops-gate-"));
  try {
    const dataDir = join(workspaceRoot, ".hotflow");
    const snapshotStore = new SkillSnapshotFileStore(
      resolveApprovedSkillSnapshotPath({ dataDir }),
      {
        now: () => 300,
      },
    );
    snapshotStore.writeApproved([
      {
        id: "skill.failed.operator",
        version: "1.0.0",
        title: "Failed operator Skill",
        content: "Use a flaky downstream tool.",
        updatedAtMs: 100,
      },
      {
        id: "skill.stale.operator",
        version: "1.0.0",
        title: "Stale operator Skill",
        content: "Old guidance.",
        updatedAtMs: 100,
      },
    ]);
    const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }));
    usageStore.recordUse("skill.failed.operator", { actor: "runtime", nowMs: 110 });
    usageStore.recordFailure("skill.failed.operator", {
      actor: "runtime",
      nowMs: 120,
      reason: "flaky downstream tool",
    });
    usageStore.recordUse("skill.stale.operator", { actor: "runtime", nowMs: 10 });

    const before = analyzeSkillEvolution({
      nowMs: 1_000,
      failurePatchThreshold: 1,
      staleAfterMs: 500,
      approvedSkills: snapshotStore.readApproved(),
      usageDocument: usageStore.readDocument(),
    });
    assert(before.summary.patchCount === 1, "curator must flag failed Skill before patch");
    assert(before.summary.archiveCount === 1, "curator must flag stale Skill before archive");

    const patched = usageStore.resetFailures("skill.failed.operator", {
      actor: "desktop-operator",
      nowMs: 1_010,
      reason: "operator patched from Review/Ops",
    });
    const archived = usageStore.archive("skill.stale.operator", {
      actor: "desktop-operator",
      nowMs: 1_020,
      reason: "operator archived from Review/Ops",
    });
    const after = analyzeSkillEvolution({
      nowMs: 1_030,
      failurePatchThreshold: 1,
      staleAfterMs: 500,
      approvedSkills: snapshotStore
        .readApproved()
        .filter((skill) => skill.id !== "skill.stale.operator"),
      usageDocument: usageStore.readDocument(),
    });

    assert(patched.failureCount === 0, "operator patch acknowledgement must clear failure count");
    assert(
      patched.lastFailedAtMs === null,
      "operator patch acknowledgement must clear lastFailedAtMs",
    );
    assert(archived.state === "archived", "operator archive must preserve archived state");
    assert(archived.archivedAtMs === 1_020, "operator archive must preserve archived timestamp");
    assert(after.summary.patchCount === 0, "patched Skill must leave the patch queue");
    assert(after.summary.archiveCount === 0, "archived Skill must leave the active archive queue");

    return {
      id: "curator_operator_lifecycle",
      ok: true,
      actual: {
        beforePatchCount: before.summary.patchCount,
        beforeArchiveCount: before.summary.archiveCount,
        patchedFailureCount: patched.failureCount,
        patchedLastFailedAtMs: patched.lastFailedAtMs,
        archivedState: archived.state,
        afterPatchCount: after.summary.patchCount,
        afterArchiveCount: after.summary.archiveCount,
      },
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function runDesktopCuratorReviewOpsSurfaceScan(repoRoot) {
  const files = {
    contract: readFileSync(
      resolve(repoRoot, "apps/director-desktop/src/desktop-contract.js"),
      "utf8",
    ),
    facade: readFileSync(
      resolve(repoRoot, "apps/director-desktop/src/desktop-bridge-facade.js"),
      "utf8",
    ),
    handlers: readFileSync(
      resolve(repoRoot, "apps/director-desktop/src/desktop-system-handlers.js"),
      "utf8",
    ),
    app: readFileSync(resolve(repoRoot, "apps/director-desktop/src/app.js"), "utf8"),
    test: readFileSync(
      resolve(repoRoot, "apps/director-desktop/src/desktop-system-handlers.test.js"),
      "utf8",
    ),
  };
  const requiredMarkers = [
    [
      files.contract,
      "SKILL_CURATOR_REFRESH",
      "desktop contract must expose curator refresh action",
    ],
    [
      files.contract,
      "SKILL_CURATOR_MARK_PATCHED",
      "desktop contract must expose curator patch acknowledgement action",
    ],
    [
      files.contract,
      "SKILL_CURATOR_ARCHIVE",
      "desktop contract must expose curator archive action",
    ],
    [files.contract, "SKILL_CURATOR_MERGE", "desktop contract must expose curator merge action"],
    [
      files.facade,
      "handlers.skills?.curatorRefresh",
      "bridge facade must dispatch curator refresh",
    ],
    [
      files.facade,
      "handlers.skills?.curatorMarkPatched",
      "bridge facade must dispatch curator patch acknowledgement",
    ],
    [
      files.facade,
      "handlers.skills?.curatorArchive",
      "bridge facade must dispatch curator archive",
    ],
    [files.facade, "handlers.skills?.curatorMerge", "bridge facade must dispatch curator merge"],
    [
      files.handlers,
      "analyzeSkillEvolution",
      "desktop snapshot must delegate curator analysis to @hotflow/skills",
    ],
    [files.handlers, "createSkillCuratorSnapshot", "desktop snapshot must include curator summary"],
    [
      files.handlers,
      "curatorMarkPatched",
      "desktop handlers must expose operator patch acknowledgement",
    ],
    [
      files.handlers,
      "archiveDesktopSkillFromCurator",
      "desktop handlers must expose curator archive execution",
    ],
    [
      files.handlers,
      "mergeDesktopSkillsFromCurator",
      "desktop handlers must expose curator merge execution",
    ],
    [files.app, "createSkillCuratorPanel", "desktop Skills page must render curator panel"],
    [files.app, "createSkillCuratorDirectActions", "desktop UI must expose curator direct actions"],
    [files.app, "skill-curator", "desktop Review queue must include Skill curator lane"],
    [
      files.test,
      "surfaces Skill curator actions",
      "desktop tests must cover curator action execution",
    ],
  ];
  const missing = requiredMarkers.filter(([content, marker]) => !content.includes(marker));
  assert(
    missing.length === 0,
    missing.map(([, marker, message]) => `${message}: missing ${marker}`).join("\n"),
  );
  return {
    id: "desktop_curator_review_ops_surface",
    ok: true,
    actual: {
      checkedMarkers: requiredMarkers.length,
      checkedFiles: Object.keys(files),
    },
  };
}

function runSkillCuratorHeartbeatMaintenanceScan(repoRoot) {
  const files = {
    heartbeat: readFileSync(
      resolve(repoRoot, "packages/director-knowledge/src/heartbeat.ts"),
      "utf8",
    ),
    test: readFileSync(
      resolve(repoRoot, "packages/director-knowledge/test/heartbeat.test.ts"),
      "utf8",
    ),
  };
  const requiredMarkers = [
    [
      files.heartbeat,
      "collectSkillCuratorHeartbeatEvents",
      "heartbeat must collect Skill curator maintenance events",
    ],
    [
      files.heartbeat,
      "analyzeSkillEvolution",
      "heartbeat must delegate Skill curator analysis to @hotflow/skills",
    ],
    [
      files.heartbeat,
      "resolveSkillUsagePath",
      "heartbeat must read Skill failure telemetry usage evidence",
    ],
    [
      files.heartbeat,
      "Skill curator found",
      "heartbeat maintenance summary must surface curator action counts",
    ],
    [
      files.heartbeat,
      "skill-curator://",
      "heartbeat maintenance evidence must include curator action refs",
    ],
    [
      files.test,
      "surfaces Skill curator actions as heartbeat maintenance without applying them",
      "director-knowledge tests must cover read-only curator heartbeat maintenance",
    ],
    [
      files.test,
      "failureCount).toBe(2)",
      "heartbeat test must prove curator maintenance does not clear failures",
    ],
  ];
  const missing = requiredMarkers.filter(([content, marker]) => !content.includes(marker));
  assert(
    missing.length === 0,
    missing.map(([, marker, message]) => `${message}: missing ${marker}`).join("\n"),
  );
  return {
    id: "skill_curator_heartbeat_maintenance_surface",
    ok: true,
    actual: {
      checkedMarkers: requiredMarkers.length,
      checkedFiles: Object.keys(files),
    },
  };
}

function runSkillExplanationSurfaceScan(repoRoot) {
  const files = {
    skillsIndex: readFileSync(resolve(repoRoot, "packages/skills/src/index.ts"), "utf8"),
    skillsExplanation: readFileSync(
      resolve(repoRoot, "packages/skills/src/explanation.ts"),
      "utf8",
    ),
    skillsTest: readFileSync(
      resolve(repoRoot, "packages/skills/tests/explanation.test.ts"),
      "utf8",
    ),
    desktopHandlers: readFileSync(
      resolve(repoRoot, "apps/director-desktop/src/desktop-system-handlers.js"),
      "utf8",
    ),
    desktopApp: readFileSync(resolve(repoRoot, "apps/director-desktop/src/app.js"), "utf8"),
    desktopStructureTest: readFileSync(
      resolve(repoRoot, "apps/director-desktop/src/app-structure.test.js"),
      "utf8",
    ),
    hostApi: readFileSync(resolve(repoRoot, "apps/director-host-api/src/server.ts"), "utf8"),
    hostApiTest: readFileSync(
      resolve(repoRoot, "apps/director-host-api/tests/server.test.ts"),
      "utf8",
    ),
    weixinAdapter: readFileSync(resolve(repoRoot, "apps/weixin-gateway/src/adapter.ts"), "utf8"),
    weixinTest: readFileSync(
      resolve(repoRoot, "apps/weixin-gateway/tests/adapter.test.ts"),
      "utf8",
    ),
  };
  const requiredMarkers = [
    [
      files.skillsIndex,
      "createSkillExplanationSurface",
      "@hotflow/skills must export shared Skill explanation surface helper",
    ],
    [
      files.skillsExplanation,
      "skills.explanation-surface.v1",
      "shared Skill explanation surface must carry a stable schema id",
    ],
    [
      files.skillsExplanation,
      "createSkillCuratorExplanationSurface",
      "shared Skill explanation surface must cover curator actions",
    ],
    [
      files.skillsExplanation,
      "formatSkillExplanationSurfaceForToolObservation",
      "shared Skill explanation surface must render tool observations",
    ],
    [
      files.skillsTest,
      "explains needs-setup Skills",
      "@hotflow/skills tests must cover needs-setup explanation",
    ],
    [
      files.skillsTest,
      "explains missing Skills",
      "@hotflow/skills tests must cover missing-skill explanation",
    ],
    [
      files.skillsTest,
      "explains operator-review model gates",
      "@hotflow/skills tests must cover operator-review explanation",
    ],
    [
      files.skillsTest,
      "explains curator actions",
      "@hotflow/skills tests must cover curator action explanation",
    ],
    [
      files.desktopHandlers,
      "explanationSurface",
      "desktop snapshot and SkillTool observations must carry explanation surfaces",
    ],
    [
      files.desktopApp,
      "createSkillExplanationSurfaceBlock",
      "desktop Skills UI must render explanation surfaces",
    ],
    [
      files.desktopStructureTest,
      "renders Skill curator explanation surfaces",
      "desktop app structure tests must assert curator explanation UI",
    ],
    [
      files.hostApi,
      "createSkillExplanationSurface",
      "Host API Skill view/use/list must attach explanation surfaces",
    ],
    [
      files.hostApiTest,
      "explanationSurface",
      "Host API tests must assert Skill explanation surface payloads",
    ],
    [
      files.weixinAdapter,
      "formatSkillExplanationSurfaceForToolObservation",
      "Weixin ordinary chat Skill observations must render explanation lines",
    ],
    [
      files.weixinTest,
      "explanation_status",
      "Weixin tests must assert Skill explanation observation lines",
    ],
  ];
  const missing = requiredMarkers.filter(([content, marker]) => !content.includes(marker));
  assert(
    missing.length === 0,
    missing.map(([, marker, message]) => `${message}: missing ${marker}`).join("\n"),
  );
  return {
    id: "skill_explanation_surface",
    ok: true,
    actual: {
      checkedMarkers: requiredMarkers.length,
      checkedFiles: Object.keys(files),
    },
  };
}

function runSkillCuratorWriteGuardCase() {
  const remote = guardSkillCuratorWriteRequest({
    action: {
      kind: "patch",
      skillId: "skill.failed.guard",
      reason: "remote channel attempted curator patch",
    },
    operator: {
      actor: "weixin-conversation-runtime",
      surface: "weixin",
      scopes: ["skills.curator.write"],
    },
    nowMs: 1777105000000,
  });
  const missingScope = guardSkillCuratorWriteRequest({
    action: {
      kind: "archive",
      skillId: "skill.stale.guard",
      reason: "local operator missing scope",
    },
    operator: {
      actor: "desktop-operator",
      surface: "desktop-local",
      scopes: ["skills.read"],
    },
    nowMs: 1777105000100,
  });
  const localAllowed = guardSkillCuratorWriteRequest({
    action: {
      kind: "merge",
      skillId: "skill.dup.guard.a",
      canonicalSkillId: "skill.dup.guard.a",
      duplicateSkillIds: ["skill.dup.guard.b"],
      reason: "local scoped operator merge",
    },
    operator: {
      actor: "desktop-operator",
      surface: "desktop-local",
      scopes: ["skills.curator.write"],
    },
    nowMs: 1777105000200,
  });

  assert(remote.allowed === false, "remote curator writes must stay blocked");
  assert(
    remote.reasonCode === "remote_surface_blocked",
    `remote curator write reason must be remote_surface_blocked, got ${remote.reasonCode}`,
  );
  assert(
    missingScope.status === "operator_scope_required",
    `local operator without scope must require scope, got ${missingScope.status}`,
  );
  assert(localAllowed.allowed === true, "local desktop operator with scope must be admitted");
  assert(
    localAllowed.evidenceRefs.includes("skill-curator://duplicate/skill.dup.guard.b"),
    "merge guard evidence must preserve duplicate Skill refs",
  );
  return {
    id: "skill_curator_write_contract_guard",
    ok: true,
    actual: {
      schemaId: remote.schemaId,
      remoteReasonCode: remote.reasonCode,
      missingScopeStatus: missingScope.status,
      localAllowed: localAllowed.allowed,
    },
  };
}

function runSkillCuratorWriteGuardSurfaceScan(repoRoot) {
  const files = {
    skillsIndex: readFileSync(resolve(repoRoot, "packages/skills/src/index.ts"), "utf8"),
    skillsCurator: readFileSync(resolve(repoRoot, "packages/skills/src/curator.ts"), "utf8"),
    skillsTest: readFileSync(resolve(repoRoot, "packages/skills/tests/curator.test.ts"), "utf8"),
    conversationTools: readFileSync(
      resolve(repoRoot, "packages/conversation-runtime/src/director-tools.ts"),
      "utf8",
    ),
    conversationTest: readFileSync(
      resolve(repoRoot, "packages/conversation-runtime/tests/skills.test.ts"),
      "utf8",
    ),
    hostApi: readFileSync(resolve(repoRoot, "apps/director-host-api/src/server.ts"), "utf8"),
    hostApiTest: readFileSync(
      resolve(repoRoot, "apps/director-host-api/tests/server.test.ts"),
      "utf8",
    ),
    weixinClient: readFileSync(
      resolve(repoRoot, "apps/weixin-gateway/src/director-client.ts"),
      "utf8",
    ),
    weixinAdapter: readFileSync(resolve(repoRoot, "apps/weixin-gateway/src/adapter.ts"), "utf8"),
    weixinTest: readFileSync(
      resolve(repoRoot, "apps/weixin-gateway/tests/adapter.test.ts"),
      "utf8",
    ),
    hostApiVitest: readFileSync(
      resolve(repoRoot, "apps/director-host-api/vitest.config.ts"),
      "utf8",
    ),
    weixinVitest: readFileSync(resolve(repoRoot, "apps/weixin-gateway/vitest.config.ts"), "utf8"),
  };
  const requiredMarkers = [
    [
      files.skillsIndex,
      "guardSkillCuratorWriteRequest",
      "@hotflow/skills must export curator write guard",
    ],
    [
      files.skillsCurator,
      "skills.curator-write-guard.v1",
      "curator write guard must carry a stable schema id",
    ],
    [
      files.skillsCurator,
      "remote_surface_blocked",
      "curator write guard must block remote surfaces",
    ],
    [
      files.skillsCurator,
      "skills.curator.write",
      "curator write guard must require dedicated operator scope",
    ],
    [
      files.skillsTest,
      "blocks remote curator writes before any Skill mutation path",
      "@hotflow/skills tests must cover remote fail-closed guard",
    ],
    [
      files.conversationTools,
      "director.skills.curator.guard",
      "conversation runtime must expose only the curator guard tool",
    ],
    [files.conversationTools, "guardOnly", "curator guard model tool must be marked guard-only"],
    [
      files.conversationTest,
      "not a write tool",
      "conversation runtime tests must assert curator guard is not a write tool",
    ],
    [
      files.hostApi,
      "/v1/skills/curator/actions/guard",
      "Host API must expose curator write guard check endpoint",
    ],
    [
      files.hostApi,
      'surface: "host-api"',
      "Host API curator guard must force host-api remote surface",
    ],
    [
      files.hostApiTest,
      "without mutating Skill state",
      "Host API test must prove guard check has no mutation side effects",
    ],
    [
      files.weixinClient,
      "checkDirectorSkillCuratorWriteGuard",
      "Weixin client must call curator guard endpoint",
    ],
    [
      files.weixinAdapter,
      "formatWeixinSkillCuratorGuardToolContent",
      "Weixin adapter must render curator guard observation lines",
    ],
    [
      files.weixinAdapter,
      "applied: false",
      "Weixin curator guard observation must state no write was applied",
    ],
    [
      files.weixinTest,
      "without executing remote write actions",
      "Weixin tests must cover curator guard fail-closed observation",
    ],
    [
      files.hostApiVitest,
      "packages/skills/src/index.ts",
      "Host API tests must alias @hotflow/skills to source so guard regressions are visible",
    ],
    [
      files.weixinVitest,
      "packages/skills/src/index.ts",
      "Weixin tests must alias @hotflow/skills to source so guard regressions are visible",
    ],
  ];
  const forbiddenMarkers = [
    [files.hostApi, "curatorMarkPatched", "Host API must not wire remote curator patch execution"],
    [files.hostApi, "curatorArchive", "Host API must not wire remote curator archive execution"],
    [files.hostApi, "curatorMerge", "Host API must not wire remote curator merge execution"],
    [
      files.weixinAdapter,
      "curatorMarkPatched",
      "Weixin must not wire remote curator patch execution",
    ],
    [
      files.weixinAdapter,
      "curatorArchive",
      "Weixin must not wire remote curator archive execution",
    ],
    [files.weixinAdapter, "curatorMerge", "Weixin must not wire remote curator merge execution"],
  ];
  const missing = requiredMarkers.filter(([content, marker]) => !content.includes(marker));
  const forbidden = forbiddenMarkers.filter(([content, marker]) => content.includes(marker));
  assert(
    missing.length === 0 && forbidden.length === 0,
    [
      ...missing.map(([, marker, message]) => `${message}: missing ${marker}`),
      ...forbidden.map(([, marker, message]) => `${message}: forbidden ${marker}`),
    ].join("\n"),
  );
  return {
    id: "skill_curator_write_guard_surface",
    ok: true,
    actual: {
      checkedMarkers: requiredMarkers.length,
      forbiddenMarkers: forbiddenMarkers.length,
      checkedFiles: Object.keys(files),
    },
  };
}

function runSkillRuntimeContractCase() {
  const needsSetup = resolveSkillRuntimeContract({
    skill: {
      id: "skill.twitter-research",
      version: "1.0.0",
      title: "Twitter Research",
      content: "Use live X/Twitter search.",
      toolNames: ["x_search"],
      updatedAtMs: 100,
      metadata: {
        hermes: {
          requires_tools: ["x_search"],
          fallback_skill_ids: ["skill.public-web-research"],
          setup_on_load: {
            summary: "Configure X/Twitter search before live use.",
            next_actions: ["Configure X/Twitter or use fallback."],
          },
        },
      },
    },
    availableTools: ["web_search"],
    operator: {
      surface: "desktop-local",
      scopes: ["skills.use"],
    },
    nowMs: 1777105000300,
  });
  const blocked = resolveSkillRuntimeContract({
    skill: {
      id: "skill.operator-local",
      version: "1.0.0",
      title: "Operator Local",
      content: "Local-only operator workflow.",
      updatedAtMs: 100,
      metadata: {
        guard: {
          allowed_surfaces: ["desktop-local"],
          required_scopes: ["skills.operator.local"],
        },
      },
    },
    operator: {
      surface: "weixin",
      scopes: ["skills.use"],
    },
    nowMs: 1777105000400,
  });
  assert(
    needsSetup.schemaId === "skills.runtime-contract.v1",
    "runtime contract schema id must be stable",
  );
  assert(needsSetup.loadable === false, "missing required tools must block Skill loading");
  assert(
    needsSetup.setupOnLoad.required === true,
    "missing required tools must surface setup-on-load requirements",
  );
  assert(
    needsSetup.fallback.recommended === true &&
      needsSetup.fallback.skillIds.includes("skill.public-web-research"),
    "missing required tools must surface fallback Skill ids",
  );
  assert(blocked.guard.allowed === false, "Skill guard must block disallowed surfaces");
  assert(
    blocked.evidenceRefs.includes("skill-runtime://skill.operator-local/guard/surface-not-allowed"),
    "Skill guard evidence must include surface block ref",
  );
  return {
    id: "skill_runtime_contract_conditional_setup_fallback_guard",
    ok: true,
    actual: {
      needsSetupStatus: needsSetup.status,
      fallbackRecommended: needsSetup.fallback.recommended,
      blockedReason: blocked.guard.reasonCode,
    },
  };
}

function runSkillCuratorAutoApplyCase() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-skill-curator-auto-apply-gate-"));
  try {
    const dataDir = join(workspaceRoot, ".director-angel", "data");
    const snapshotStore = new SkillSnapshotFileStore(resolveApprovedSkillSnapshotPath({ dataDir }));
    snapshotStore.writeApproved([
      {
        id: "skill.failed.auto",
        version: "1.0.0",
        title: "Failed Auto Skill",
        content: "Old brittle guidance.",
        updatedAtMs: 100,
      },
    ]);
    const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }));
    usageStore.recordFailure("skill.failed.auto", { actor: "runtime", nowMs: 200 });
    usageStore.recordFailure("skill.failed.auto", { actor: "runtime", nowMs: 250 });
    const remoteGuard = guardSkillCuratorWriteRequest({
      action: { kind: "patch", skillId: "skill.failed.auto" },
      operator: {
        surface: "weixin",
        scopes: ["skills.curator.write"],
      },
      nowMs: 300,
    });
    const service = new SkillCuratorAutoApplyService(snapshotStore, usageStore);
    const blocked = service.apply({
      action: { kind: "patch", skillId: "skill.failed.auto" },
      guard: remoteGuard,
      patch: { content: "Remote patch should not apply.", version: "1.0.1" },
      operator: { actor: "weixin-runtime", surface: "weixin" },
      nowMs: 350,
    });
    assert(blocked.applied === false, "remote curator auto apply must be blocked by guard");
    assert(
      snapshotStore.readApproved()[0]?.content === "Old brittle guidance.",
      "blocked auto apply must not mutate approved snapshot",
    );
    const localGuard = guardSkillCuratorWriteRequest({
      action: { kind: "patch", skillId: "skill.failed.auto" },
      operator: {
        actor: "desktop-operator",
        surface: "desktop-local",
        scopes: ["skills.curator.write"],
      },
      nowMs: 400,
    });
    const applied = service.apply({
      action: { kind: "patch", skillId: "skill.failed.auto" },
      guard: localGuard,
      patch: {
        content: "Updated robust guidance with fallback and verification.",
        version: "1.0.1",
      },
      operator: {
        actor: "desktop-operator",
        surface: "desktop-local",
        note: "reviewed E.8 auto apply patch",
      },
      nowMs: 450,
    });
    assert(applied.applied === true, "local guarded curator auto apply must apply patch");
    assert(
      snapshotStore.readApproved()[0]?.version === "1.0.1",
      "local guarded auto apply must update approved snapshot",
    );
    assert(
      usageStore.readRecord("skill.failed.auto")?.failureCount === 0,
      "local guarded auto apply must clear failure evidence",
    );
    return {
      id: "skill_curator_auto_patch_apply_guarded_local_only",
      ok: true,
      actual: {
        blockedReason: blocked.reasonCode,
        appliedReason: applied.reasonCode,
        snapshotVersion: snapshotStore.readApproved()[0]?.version,
      },
    };
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function runSkillRuntimeContractSurfaceScan(repoRoot) {
  const files = {
    skillsIndex: readFileSync(resolve(repoRoot, "packages/skills/src/index.ts"), "utf8"),
    runtimeContract: readFileSync(
      resolve(repoRoot, "packages/skills/src/runtime-contract.ts"),
      "utf8",
    ),
    autoApply: readFileSync(resolve(repoRoot, "packages/skills/src/curator-auto-apply.ts"), "utf8"),
    runtimeContractTest: readFileSync(
      resolve(repoRoot, "packages/skills/tests/runtime-contract.test.ts"),
      "utf8",
    ),
    autoApplyTest: readFileSync(
      resolve(repoRoot, "packages/skills/tests/curator-auto-apply.test.ts"),
      "utf8",
    ),
    promptIndex: readFileSync(resolve(repoRoot, "packages/skills/src/prompt-index.ts"), "utf8"),
    conversationTools: readFileSync(
      resolve(repoRoot, "packages/conversation-runtime/src/director-tools.ts"),
      "utf8",
    ),
    conversationSkills: readFileSync(
      resolve(repoRoot, "packages/conversation-runtime/src/skills.ts"),
      "utf8",
    ),
    hostApi: readFileSync(resolve(repoRoot, "apps/director-host-api/src/server.ts"), "utf8"),
    weixinAdapter: readFileSync(resolve(repoRoot, "apps/weixin-gateway/src/adapter.ts"), "utf8"),
  };
  const requiredMarkers = [
    [
      files.skillsIndex,
      "resolveSkillRuntimeContract",
      "@hotflow/skills must export runtime contract resolver",
    ],
    [
      files.runtimeContract,
      "skills.runtime-contract.v1",
      "runtime contract must carry a stable schema id",
    ],
    [files.runtimeContract, "setup_on_load", "runtime contract must parse setup-on-load metadata"],
    [
      files.runtimeContract,
      "fallback_skill_ids",
      "runtime contract must parse fallback Skill metadata",
    ],
    [
      files.runtimeContract,
      "allowed_surfaces",
      "runtime contract must enforce Skill guard surfaces",
    ],
    [
      files.autoApply,
      "skills.curator-auto-apply.v1",
      "curator auto apply must carry a stable schema id",
    ],
    [files.autoApply, "guard_not_allowed", "curator auto apply must fail closed when guard denies"],
    [
      files.runtimeContractTest,
      "setup-on-load and fallback evidence",
      "runtime contract tests must cover setup/fallback evidence",
    ],
    [
      files.autoApplyTest,
      "refuses remote curator patch apply",
      "auto apply tests must prove remote write remains blocked",
    ],
    [
      files.promptIndex,
      "resolveSkillRuntimeContract",
      "prompt index must consume runtime contract guard",
    ],
    [
      files.conversationSkills,
      "runtimeContract",
      "conversation runtime Skill payload types must expose runtime contract metadata",
    ],
    [
      files.conversationTools,
      "setupOnLoad",
      "conversation runtime Skill tools must describe setup-on-load/fallback/guard surfaces",
    ],
    [
      files.hostApi,
      "resolveSkillRuntimeContract",
      "Host API Skill payloads must attach runtime contract metadata",
    ],
    [
      files.weixinAdapter,
      'status === "blocked"',
      "Weixin Skill observation must handle guard-blocked runtime status",
    ],
  ];
  const missing = requiredMarkers.filter(([content, marker]) => !content.includes(marker));
  assert(
    missing.length === 0,
    missing.map(([, marker, message]) => `${message}: missing ${marker}`).join("\n"),
  );
  return {
    id: "skill_runtime_contract_surface",
    ok: true,
    actual: {
      checkedMarkers: requiredMarkers.length,
      checkedFiles: Object.keys(files),
    },
  };
}

function runCase(id, execute) {
  const started = process.hrtime.bigint();
  try {
    const result = execute();
    return {
      ...result,
      durationMs: Number((Number(process.hrtime.bigint() - started) / 1_000_000).toFixed(2)),
      failures: [],
    };
  } catch (error) {
    return {
      id,
      ok: false,
      durationMs: Number((Number(process.hrtime.bigint() - started) / 1_000_000).toFixed(2)),
      failures: [error instanceof Error ? error.message : String(error)],
      actual: null,
    };
  }
}

const { repoRoot, resultsDir } = getBenchmarksPaths();
const runs = [
  runCase("confidential_experience_skill_proposal", runConfidentialExperienceCase),
  runCase("restricted_experience_skill_proposal", runRestrictedExperienceCase),
  runCase("public_experience_skill_proposal", runPublicExperienceCase),
  runCase("entry_surfaces_delegate_to_shared_bridge", () => runEntryDelegationScan(repoRoot)),
  runCase("review_apply_use_failure_curator", runReviewApplyUseFailureTelemetryCase),
  runCase("curator_operator_lifecycle", runCuratorOperatorLifecycleCase),
  runCase("desktop_curator_review_ops_surface", () =>
    runDesktopCuratorReviewOpsSurfaceScan(repoRoot),
  ),
  runCase("skill_curator_heartbeat_maintenance_surface", () =>
    runSkillCuratorHeartbeatMaintenanceScan(repoRoot),
  ),
  runCase("skill_explanation_surface", () => runSkillExplanationSurfaceScan(repoRoot)),
  runCase("skill_curator_write_contract_guard", runSkillCuratorWriteGuardCase),
  runCase("skill_curator_write_guard_surface", () =>
    runSkillCuratorWriteGuardSurfaceScan(repoRoot),
  ),
  runCase("skill_runtime_contract_conditional_setup_fallback_guard", runSkillRuntimeContractCase),
  runCase("skill_curator_auto_patch_apply_guarded_local_only", runSkillCuratorAutoApplyCase),
  runCase("skill_runtime_contract_surface", () => runSkillRuntimeContractSurfaceScan(repoRoot)),
];
const failedRuns = runs.filter((run) => !run.ok);

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, `${suiteId}-latest.json`);
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      summary: {
        suiteId,
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        failedRuns: failedRuns.length,
        passedRuns: runs.length - failedRuns.length,
      },
      runs,
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(
  `Director Agent OS skill evolution gate completed: ${runs.length} checks, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  for (const failedRun of failedRuns) {
    process.stderr.write(`${failedRun.id}: ${failedRun.failures.join(" | ")}\n`);
  }
  process.exitCode = 1;
}
