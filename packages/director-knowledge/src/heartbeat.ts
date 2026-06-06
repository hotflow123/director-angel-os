import { createHash } from "node:crypto";
import { type Dirent, existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  ExperienceCandidate,
  ExperiencePromotionRecord,
  ExperienceReviewDecision,
  ProposalRecord,
} from "@hotflow/contracts";
import {
  type DirectorSwitchState,
  loadDirectorAdapterRegistry,
  loadDirectorSwitchState,
} from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";
import { SessionStore } from "@hotflow/sessions";
import {
  SKILL_SNAPSHOT_UPSERT_KIND,
  analyzeSkillEvolution,
  decodeSkillProposal,
  parseSkillSnapshot,
  resolveSkillUsagePath,
} from "@hotflow/skills";
import type { SkillSnapshot, SkillUsageDocument } from "@hotflow/skills";
import { SessionStoreTaskPlanePort } from "@hotflow/tasks-core";

import type {
  DirectorKnowledgeCandidateDocument,
  DirectorKnowledgeReviewDecision,
} from "./evolution.js";
import { FileExperienceStore } from "./experience-store.js";
import {
  type DirectorLearningGovernanceAction,
  inspectDirectorMaintenance,
} from "./maintenance.js";
import { type DirectorSoulCandidate, isDirectorSoulCandidate } from "./soul.js";
import { FileKnowledgeStore } from "./store.js";

export type DirectorHeartbeatEventKind =
  | "stale-review"
  | "failed-run"
  | "knowledge-ready"
  | "adapter-degraded"
  | "adapter-risk"
  | "reflection-due"
  | "soul-candidate"
  | "care"
  | "cost-budget-warn"
  | "skill-untrusted"
  | "skill-proposal-due"
  | "skill-proposal-review"
  | "skill-apply-ready"
  | "maintenance-due";

export type DirectorHeartbeatSeverity = "info" | "warn" | "blocked";

export interface DirectorHeartbeatEvent {
  readonly schemaVersion: "director.heartbeat.event.v1";
  readonly eventId: string;
  readonly kind: DirectorHeartbeatEventKind;
  readonly severity: DirectorHeartbeatSeverity;
  readonly summary: string;
  readonly actionRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly createdAt: string;
}

export interface DirectorHeartbeatSnapshot {
  readonly schemaVersion: "director.heartbeat.snapshot.v1";
  readonly snapshotId: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly eventCount: number;
  readonly highestSeverity: DirectorHeartbeatSeverity | "none";
  readonly events: readonly DirectorHeartbeatEvent[];
  readonly notes: readonly string[];
}

export interface MaterializeDirectorHeartbeatEventInput {
  readonly kind: DirectorHeartbeatEventKind;
  readonly severity: DirectorHeartbeatSeverity;
  readonly summary: string;
  readonly actionRefs?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly nowMs?: number;
}

export interface MaterializeDirectorHeartbeatSnapshotInput {
  readonly events: readonly DirectorHeartbeatEvent[];
  readonly enabled: boolean;
  readonly notes?: readonly string[];
  readonly nowMs?: number;
}

export interface RunDirectorHeartbeatInput {
  readonly now?: string;
  readonly dataDir?: string;
}

export interface RunDirectorHeartbeatStructuredResult {
  readonly snapshot: DirectorHeartbeatSnapshot;
  readonly eventPaths: readonly string[];
  readonly latestPath: string;
}

interface DirectorHeartbeatRunReport {
  readonly runId: string;
  readonly reportId: string;
  readonly run?: Readonly<Record<string, unknown>>;
}

type DirectorExperienceCandidateStatus = "pending" | "accepted" | "rejected";

interface DirectorExperienceCandidateInspection {
  readonly candidate: ExperienceCandidate;
  readonly status: DirectorExperienceCandidateStatus;
  readonly latestReview: ExperienceReviewDecision | null;
  readonly promotions: readonly ExperiencePromotionRecord[];
  readonly latestPromotion: ExperiencePromotionRecord | null;
  readonly promoted: boolean;
}

interface DirectorExperienceCandidatesInspection {
  readonly total: number;
  readonly artifactTotal: number;
  readonly quarantineTotal: number;
  readonly candidates: readonly DirectorExperienceCandidateInspection[];
}

type DirectorKnowledgeCandidateStatus = "pending" | "accepted" | "rejected" | "stale";

interface DirectorKnowledgeCandidateInspection {
  readonly candidate: DirectorKnowledgeCandidateDocument;
  readonly status: DirectorKnowledgeCandidateStatus;
  readonly latestReview: DirectorKnowledgeReviewDecision | null;
}

interface DirectorKnowledgeCandidatesInspection {
  readonly total: number;
  readonly candidates: readonly DirectorKnowledgeCandidateInspection[];
}

interface HeartbeatScanOptions {
  readonly dataDir: string;
  readonly nowMs: number;
  readonly switchState: DirectorSwitchState;
}

interface HeartbeatSkillStoragePaths {
  readonly sessionDbPaths: readonly string[];
  readonly approvedSnapshotPaths: readonly string[];
  readonly usagePaths: readonly string[];
}

const DIRECTOR_SKILL_SESSION_ID = "director-angel-desktop";
const SKILL_PROPOSAL_STATUSES = ["pending", "accepted", "rejected", "applied", "expired"] as const;

export function materializeDirectorHeartbeatEvent(
  input: MaterializeDirectorHeartbeatEventInput,
): DirectorHeartbeatEvent {
  const createdAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const actionRefs = uniqueStrings(input.actionRefs ?? []);
  const evidenceRefs = uniqueStrings(input.evidenceRefs ?? []);
  const fingerprint = [
    input.kind,
    input.severity,
    input.summary,
    actionRefs.join("\n"),
    evidenceRefs.join("\n"),
    createdAt,
  ].join("\n");

  return {
    schemaVersion: "director.heartbeat.event.v1",
    eventId: `heartbeat_${input.kind}_${shortHash(fingerprint)}`,
    kind: input.kind,
    severity: input.severity,
    summary: input.summary.trim(),
    actionRefs,
    evidenceRefs,
    createdAt,
  };
}

export function materializeDirectorHeartbeatSnapshot(
  input: MaterializeDirectorHeartbeatSnapshotInput,
): DirectorHeartbeatSnapshot {
  const createdAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const events = [...input.events];
  const fingerprint = [
    createdAt,
    input.enabled ? "enabled" : "disabled",
    ...events.map((event) => event.eventId),
  ].join("\n");

  return {
    schemaVersion: "director.heartbeat.snapshot.v1",
    snapshotId: `heartbeat_snapshot_${shortHash(fingerprint)}`,
    enabled: input.enabled,
    createdAt,
    eventCount: events.length,
    highestSeverity: resolveHighestSeverity(events),
    events,
    notes: [...(input.notes ?? [])],
  };
}

export async function runDirectorHeartbeat(
  workspaceRoot: string,
  input: RunDirectorHeartbeatInput = {},
): Promise<string> {
  const result = await runDirectorHeartbeatStructured(workspaceRoot, input);
  return formatDirectorHeartbeatSnapshot(result);
}

export async function runDirectorHeartbeatStructured(
  workspaceRoot: string,
  input: RunDirectorHeartbeatInput = {},
): Promise<RunDirectorHeartbeatStructuredResult> {
  const nowMs = toEpochMs(input.now);
  const switchState = loadHeartbeatSwitchState(workspaceRoot);
  const events = await collectDirectorHeartbeatEvents(workspaceRoot, {
    nowMs,
    switchState,
    dataDir: input.dataDir ?? workspaceRoot,
  });
  const snapshot = materializeDirectorHeartbeatSnapshot({
    enabled: switchState.features["heartbeat.enabled"],
    events,
    nowMs,
    notes: [
      "Manual heartbeat scan is read-only: it writes heartbeat artifacts but does not accept, publish, delete, or call external production tools.",
      switchState.features["heartbeat.enabled"]
        ? "heartbeat.enabled is on; future scheduler loops may use the same safe scan."
        : "heartbeat.enabled is off; this status command still performs a manual safe scan.",
    ],
  });
  const write = await writeDirectorHeartbeatSnapshot(workspaceRoot, snapshot);
  return {
    snapshot,
    eventPaths: write.eventPaths,
    latestPath: write.latestPath,
  };
}

export async function describeDirectorHeartbeatStatus(workspaceRoot: string): Promise<string> {
  const latest = await readDirectorHeartbeatLatest(workspaceRoot);
  if (latest === null) {
    return "Director heartbeat:\n  status: empty\n  latest: (not created)";
  }
  return [
    "Director heartbeat:",
    `  latest: ${heartbeatLatestPath(workspaceRoot)}`,
    `  heartbeat enabled: ${latest.enabled ? "yes" : "no"}`,
    `  latest event count: ${latest.eventCount}`,
    `  highest severity: ${latest.highestSeverity}`,
    ...latest.events.map(
      (event) =>
        `  - ${event.eventId} kind=${event.kind} severity=${event.severity} summary=${event.summary}`,
    ),
  ].join("\n");
}

export function formatDirectorHeartbeatSnapshot(
  result: RunDirectorHeartbeatStructuredResult,
): string {
  const lines = [
    "Director heartbeat:",
    `  heartbeat enabled: ${result.snapshot.enabled ? "yes" : "no"}`,
    `  event count: ${result.snapshot.eventCount}`,
    `  highest severity: ${result.snapshot.highestSeverity}`,
    `  latest: ${result.latestPath}`,
    `  event files: ${result.eventPaths.length}`,
  ];
  for (const event of result.snapshot.events) {
    lines.push(`  - ${event.eventId} kind=${event.kind} severity=${event.severity}`);
    lines.push(`    summary: ${event.summary}`);
    lines.push(`    actions: ${event.actionRefs.join(" | ") || "(none)"}`);
    lines.push(`    evidence: ${event.evidenceRefs.join(" | ") || "(none)"}`);
  }
  return lines.join("\n");
}

async function collectDirectorHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  const events: DirectorHeartbeatEvent[] = [];
  events.push(...(await collectReviewHeartbeatEvents(workspaceRoot, options)));
  events.push(...(await collectRunHeartbeatEvents(workspaceRoot, options)));
  events.push(...(await collectMemoryHeartbeatEvents(workspaceRoot, options)));
  events.push(...collectAdapterHeartbeatEvents(workspaceRoot, options));
  events.push(...(await collectCareHeartbeatEvents(workspaceRoot, options)));
  events.push(...(await collectCostHeartbeatEvents(workspaceRoot, options)));
  events.push(...(await collectSkillHeartbeatEvents(workspaceRoot, options)));
  events.push(...(await collectMaintenanceHeartbeatEvents(workspaceRoot, options)));
  return dedupeHeartbeatEvents(events);
}

async function collectMaintenanceHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const report = await inspectDirectorMaintenance({
    runtimeRoot: workspace.runtime,
    experienceDir: join(workspace.knowledge, "experience"),
    knowledgeDir: workspace.knowledge,
    nowMs: options.nowMs,
  });
  const logArchiveFiles = report.logMaintenance.summary.archiveFiles;
  const experienceArchiveItems =
    report.experienceMaintenance.summary.archiveCandidates +
    report.experienceMaintenance.summary.archiveQuarantines +
    report.experienceMaintenance.summary.archiveArtifacts;
  const governanceActionCount = report.learningGovernance.summary.recommendedActions;

  if (logArchiveFiles === 0 && experienceArchiveItems === 0 && governanceActionCount === 0) {
    return [];
  }
  const governanceSummary = report.learningGovernance.summary;
  const governanceEvidence = report.learningGovernance.actions.flatMap(formatGovernanceEvidenceRef);

  return [
    heartbeatEvent({
      kind: "maintenance-due",
      severity:
        experienceArchiveItems > 0 ||
        report.learningGovernance.actions.some((action) => action.severity === "warn")
          ? "warn"
          : "info",
      summary: `Maintenance preview found ${logArchiveFiles} old log file(s), ${experienceArchiveItems} low-signal or stale learning item(s) ready to archive, and ${governanceActionCount} learning governance action(s): accepted backlog ${governanceSummary.acceptedExperienceBacklog}, pending backlog ${governanceSummary.pendingExperienceBacklog}, missing recall eval ${governanceSummary.publishedKnowledgeWithoutRecallEval}.`,
      actionRefs: ["/维护", "/维护 执行"],
      evidenceRefs: [
        `path://${workspace.runtime}`,
        `path://${join(workspace.knowledge, "experience")}`,
        `path://${workspace.knowledge}`,
        `maintenance-preview://${report.generatedAt}`,
        ...governanceEvidence,
      ],
      nowMs: options.nowMs,
    }),
  ];
}

function formatGovernanceEvidenceRef(action: DirectorLearningGovernanceAction): readonly string[] {
  return [
    `learning-governance://${action.reason}/count/${action.count}`,
    ...action.sampleIds.map((id) => `learning-governance://${action.reason}/${id}`),
  ];
}

async function collectCareHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  if (!options.switchState.features["care.enabled"]) {
    return [];
  }

  const [experience, knowledge] = await Promise.all([
    inspectDirectorExperienceCandidates(workspaceRoot),
    inspectDirectorKnowledgeCandidates(workspaceRoot),
  ]);
  const events: DirectorHeartbeatEvent[] = [];

  for (const entry of experience.candidates.filter(
    (candidate) => candidate.status === "accepted" && !candidate.promoted,
  )) {
    events.push(
      heartbeatEvent({
        kind: "care",
        severity: "info",
        summary: `Accepted experience candidate ${entry.candidate.candidateId} is not promoted yet, so production recall cannot use it.`,
        actionRefs: [
          `hotflow director knowledge experience-promote --candidate-id ${entry.candidate.candidateId}`,
        ],
        evidenceRefs: [`experience://${entry.candidate.candidateId}`],
        nowMs: options.nowMs,
      }),
    );
  }

  const skillPaths = resolveHeartbeatSkillStoragePaths(workspaceRoot, options.dataDir);
  const skillSourceExperienceIds = new Set([
    ...(await listSkillProposalSourceExperienceIds(skillPaths)),
    ...(await listApprovedSkillSourceExperienceIds(skillPaths)),
  ]);
  for (const entry of experience.candidates.filter(
    (candidate) => candidate.status === "accepted",
  )) {
    const candidateId = entry.candidate.candidateId;
    if (skillSourceExperienceIds.has(candidateId)) {
      continue;
    }
    events.push(
      heartbeatEvent({
        kind: "skill-proposal-due",
        severity: "info",
        summary: `Accepted experience candidate ${candidateId} has not been turned into a review-gated Skill proposal yet.`,
        actionRefs: [`/技能 从经验 ${candidateId}`],
        evidenceRefs: [`experience://${candidateId}`],
        nowMs: options.nowMs,
      }),
    );
  }

  for (const entry of knowledge.candidates.filter((candidate) => candidate.status === "accepted")) {
    events.push(
      heartbeatEvent({
        kind: "care",
        severity: "info",
        summary: `Accepted knowledge candidate ${entry.candidate.metadata.id} is not published yet, so Angel cannot recall it during production.`,
        actionRefs: [`hotflow director knowledge publish --pack-id ${entry.candidate.metadata.id}`],
        evidenceRefs: [`knowledge-candidate://${entry.candidate.metadata.id}`],
        nowMs: options.nowMs,
      }),
    );
  }

  return events;
}

async function collectReviewHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  const [experience, knowledge, soulCandidates] = await Promise.all([
    inspectDirectorExperienceCandidates(workspaceRoot),
    inspectDirectorKnowledgeCandidates(workspaceRoot),
    listSoulCandidates(workspaceRoot),
  ]);
  const events: DirectorHeartbeatEvent[] = [];
  for (const entry of experience.candidates.filter((candidate) => candidate.status === "pending")) {
    events.push(
      heartbeatEvent({
        kind: "stale-review",
        severity: "warn",
        summary: `Experience candidate ${entry.candidate.candidateId} is pending review.`,
        actionRefs: [
          "hotflow director knowledge experience-list",
          `hotflow director knowledge experience-explain --candidate-id ${entry.candidate.candidateId}`,
        ],
        evidenceRefs: [`experience://${entry.candidate.candidateId}`],
        nowMs: options.nowMs,
      }),
    );
  }
  for (const entry of knowledge.candidates.filter((candidate) => candidate.status === "pending")) {
    events.push(
      heartbeatEvent({
        kind: "knowledge-ready",
        severity: "warn",
        summary: `Knowledge candidate ${entry.candidate.metadata.id} is pending review before publish.`,
        actionRefs: [
          "hotflow director knowledge candidate-list",
          `hotflow director knowledge candidate-explain --pack-id ${entry.candidate.metadata.id}`,
        ],
        evidenceRefs: [`knowledge-candidate://${entry.candidate.metadata.id}`],
        nowMs: options.nowMs,
      }),
    );
  }
  for (const candidate of soulCandidates.filter((candidate) => candidate.status === "pending")) {
    events.push(
      heartbeatEvent({
        kind: "soul-candidate",
        severity: candidate.riskLevel === "high" ? "blocked" : "info",
        summary: `Soul candidate ${candidate.candidateId} is pending operator review.`,
        actionRefs: [
          "hotflow director knowledge soul-list",
          `hotflow director knowledge soul-explain --candidate-id ${candidate.candidateId}`,
        ],
        evidenceRefs: [`soul-candidate://${candidate.candidateId}`],
        nowMs: options.nowMs,
      }),
    );
  }
  return events;
}

async function collectRunHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  const reports = await listDirectorRunReports(workspaceRoot);
  const reflectedRunIds = await listReflectedRunIds(workspaceRoot);
  const events: DirectorHeartbeatEvent[] = [];
  for (const report of reports) {
    const status = report.run?.status;
    if (status === "failed" || status === "aborted" || status === "blocked") {
      events.push(
        heartbeatEvent({
          kind: "failed-run",
          severity: status === "blocked" ? "blocked" : "warn",
          summary: `Run ${report.runId} is ${status}; operator review is required before retry or reuse.`,
          actionRefs: [
            `hotflow director run report --run-id ${report.runId}`,
            `hotflow director run explain --run-id ${report.runId}`,
          ],
          evidenceRefs: [`director-run://${report.runId}/report/${report.reportId}`],
          nowMs: options.nowMs,
        }),
      );
    }
    if (isReflectableRunStatus(status) && !reflectedRunIds.has(report.runId)) {
      events.push(
        heartbeatEvent({
          kind: "reflection-due",
          severity: status === "completed" ? "info" : "warn",
          summary:
            status === "completed"
              ? `Completed run ${report.runId} has no reflection report yet; review it before turning the output into reusable experience.`
              : `Run ${report.runId} has no reflection report yet.`,
          actionRefs: [`hotflow director reflect --run-id ${report.runId}`],
          evidenceRefs: [`director-run://${report.runId}/report/${report.reportId}`],
          nowMs: options.nowMs,
        }),
      );
    }
  }
  return events;
}

function isReflectableRunStatus(status: unknown): boolean {
  return (
    status === "completed" || status === "failed" || status === "aborted" || status === "blocked"
  );
}

async function collectMemoryHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  if (!options.switchState.features["memory.enabled"]) {
    return [];
  }

  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const reports = await listDirectorRunReports(workspaceRoot);
  const events: DirectorHeartbeatEvent[] = [];

  for (const report of reports) {
    const status = report.run?.status;
    if (status !== "completed" && status !== "failed" && status !== "aborted") {
      continue;
    }

    const auditPath = join(workspace.runtime, "memory", "ingest", `${report.runId}.json`);
    const audit = await readJsonDocument(auditPath);
    const evidenceRefs = [
      `director-run://${report.runId}/report/${report.reportId}`,
      `path://${auditPath}`,
    ];
    if (audit === null) {
      events.push(
        heartbeatEvent({
          kind: "care",
          severity: "warn",
          summary: `Terminal run ${report.runId} has no memory ingest audit yet, so future production cannot recall it as long-term experience.`,
          actionRefs: [
            "hotflow director memory status",
            `hotflow director reflect --run-id ${report.runId}`,
          ],
          evidenceRefs,
          nowMs: options.nowMs,
        }),
      );
      continue;
    }
    if (!isRecord(audit) || audit.status !== "ok") {
      const auditStatus =
        isRecord(audit) && typeof audit.status === "string" ? audit.status : "invalid";
      events.push(
        heartbeatEvent({
          kind: "care",
          severity: "warn",
          summary: `Terminal run ${report.runId} memory ingest is ${auditStatus}; future production recall may miss this result.`,
          actionRefs: [
            "hotflow director memory status",
            `hotflow director reflect --run-id ${report.runId}`,
          ],
          evidenceRefs,
          nowMs: options.nowMs,
        }),
      );
    }
  }

  return events;
}

function collectAdapterHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): DirectorHeartbeatEvent[] {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const registryLoad = loadDirectorAdapterRegistry(workspace.adaptersRegistry);
  const events = registryLoad.documents
    .filter((manifest) => manifest.healthStatus !== "ready")
    .map((manifest) =>
      heartbeatEvent({
        kind: "adapter-degraded",
        severity: manifest.healthStatus === "offline" ? "blocked" : "warn",
        summary: `Adapter ${manifest.adapterId} health is ${manifest.healthStatus}.`,
        actionRefs: [`hotflow director adapters explain --adapter-id ${manifest.adapterId}`],
        evidenceRefs: [`adapter://${manifest.adapterId}`],
        nowMs: options.nowMs,
      }),
    );
  for (const manifest of registryLoad.documents) {
    const highRiskActions = collectHighRiskAdapterActions(manifest);
    if (highRiskActions.length === 0) {
      continue;
    }
    events.push(
      heartbeatEvent({
        kind: "adapter-risk",
        severity: "warn",
        summary: `Adapter ${manifest.adapterId} exposes high-risk action(s) ${highRiskActions.join(", ")}; heartbeat will not trigger them automatically and operator approval is required.`,
        actionRefs: [
          `hotflow director adapters explain --adapter-id ${manifest.adapterId}`,
          "hotflow director switches show",
        ],
        evidenceRefs: [`adapter://${manifest.adapterId}`],
        nowMs: options.nowMs,
      }),
    );
  }
  for (const issue of registryLoad.issues) {
    events.push(
      heartbeatEvent({
        kind: "adapter-degraded",
        severity: "warn",
        summary: `Adapter registry issue: ${issue}`,
        actionRefs: ["hotflow director adapters list"],
        evidenceRefs: [`path://${workspace.adaptersRegistry}`],
        nowMs: options.nowMs,
      }),
    );
  }
  return events;
}

function collectHighRiskAdapterActions(manifest: {
  readonly mockOnly?: boolean;
  readonly bridge?: unknown;
  readonly supportedActionClasses?: readonly string[];
}): string[] {
  if (manifest.mockOnly === true || manifest.bridge === undefined) {
    return [];
  }
  return Array.from(
    new Set(
      (manifest.supportedActionClasses ?? []).filter((actionClass) =>
        ["generate", "write", "publish"].includes(actionClass),
      ),
    ),
  );
}

async function collectCostHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const costBudgetPath = join(workspace.runtime, "cost-budget.json");
  const budget = await readJsonDocument(costBudgetPath);
  if (budget === null) {
    return [
      heartbeatEvent({
        kind: "cost-budget-warn",
        severity: "warn",
        summary:
          "Cost budget file is missing; long-running heartbeat loops should stay manual until a budget is configured.",
        actionRefs: ["hotflow director switches show"],
        evidenceRefs: [`path://${costBudgetPath}`],
        nowMs: options.nowMs,
      }),
    ];
  }
  if (!isRecord(budget)) {
    return [
      heartbeatEvent({
        kind: "cost-budget-warn",
        severity: "warn",
        summary: "Cost budget file is not a valid object.",
        actionRefs: "hotflow director switches show".split("\n"),
        evidenceRefs: [`path://${costBudgetPath}`],
        nowMs: options.nowMs,
      }),
    ];
  }
  const limit = readFirstNumber(budget, ["limitUsd", "dailyLimitUsd", "monthlyLimitUsd", "limit"]);
  const spent = readFirstNumber(budget, ["spentUsd", "dailySpentUsd", "monthlySpentUsd", "spent"]);
  const remaining = readFirstNumber(budget, [
    "remainingUsd",
    "dailyRemainingUsd",
    "monthlyRemainingUsd",
    "remaining",
  ]);
  if (
    budget.blocked === true ||
    remaining === 0 ||
    (limit !== null && spent !== null && spent >= limit)
  ) {
    return [
      heartbeatEvent({
        kind: "cost-budget-warn",
        severity: "blocked",
        summary: "Cost budget is exhausted or blocked.",
        actionRefs: ["hotflow director switches show"],
        evidenceRefs: [`path://${costBudgetPath}`],
        nowMs: options.nowMs,
      }),
    ];
  }
  if (remaining !== null && remaining <= 1) {
    return [
      heartbeatEvent({
        kind: "cost-budget-warn",
        severity: "warn",
        summary: `Cost budget remaining is low (${remaining}).`,
        actionRefs: ["hotflow director switches show"],
        evidenceRefs: [`path://${costBudgetPath}`],
        nowMs: options.nowMs,
      }),
    ];
  }
  return [];
}

async function collectSkillHeartbeatEvents(
  workspaceRoot: string,
  options: HeartbeatScanOptions,
): Promise<DirectorHeartbeatEvent[]> {
  const skillPaths = resolveHeartbeatSkillStoragePaths(workspaceRoot, options.dataDir);
  const proposalEvents = await collectSkillProposalHeartbeatEvents(skillPaths, options.nowMs);
  const approvedTrustEvents = await collectApprovedSkillTrustHeartbeatEvents(
    skillPaths,
    options.nowMs,
  );
  const curatorEvents = await collectSkillCuratorHeartbeatEvents(skillPaths, options.nowMs);
  return [...proposalEvents, ...approvedTrustEvents, ...curatorEvents];
}

async function collectSkillCuratorHeartbeatEvents(
  skillPaths: HeartbeatSkillStoragePaths,
  nowMs: number,
): Promise<DirectorHeartbeatEvent[]> {
  const document = await readFirstApprovedSkillsDocument(skillPaths);
  if (!isRecord(document) || !Array.isArray(document.skills)) {
    return [];
  }
  const approvedSkills = document.skills
    .map((skill) => parseSkillSnapshot(skill))
    .filter((skill): skill is SkillSnapshot => skill !== null);
  if (approvedSkills.length === 0) {
    return [];
  }
  const usageDocument = await readFirstSkillUsageDocument(skillPaths);
  const analysis = analyzeSkillEvolution({
    approvedSkills,
    usageDocument,
    nowMs,
  });
  const actionable = analysis.actions.filter((action) => action.kind !== "keep");
  if (actionable.length === 0) {
    return [];
  }
  const severity =
    analysis.summary.patchCount > 0 || actionable.some((action) => action.severity === "risky")
      ? "warn"
      : "info";

  return [
    heartbeatEvent({
      kind: "maintenance-due",
      severity,
      summary: `Skill curator found ${analysis.summary.patchCount} patch, ${analysis.summary.archiveCount} archive, and ${analysis.summary.mergeCount} merge action(s) requiring operator review.`,
      actionRefs: ["/技能", "/审查 skill-curator"],
      evidenceRefs: [
        ...skillPaths.approvedSnapshotPaths.map((path) => `path://${path}`),
        ...skillPaths.usagePaths.map((path) => `path://${path}`),
        ...actionable.flatMap((action) => [
          `skill-curator://${action.kind}/${action.skillId}`,
          ...(action.duplicateSkillIds ?? []).map(
            (duplicateSkillId) => `skill-curator://duplicate/${duplicateSkillId}`,
          ),
        ]),
      ],
      nowMs,
    }),
  ];
}

async function collectApprovedSkillTrustHeartbeatEvents(
  skillPaths: HeartbeatSkillStoragePaths,
  nowMs: number,
): Promise<DirectorHeartbeatEvent[]> {
  const document = await readFirstApprovedSkillsDocument(skillPaths);
  if (!isRecord(document) || !Array.isArray(document.skills)) {
    return [];
  }
  return document.skills
    .filter((skill) => isRecord(skill) && !isSelfEvolvedSkill(skill))
    .map((skill) => {
      const skillId = readStringProperty(skill, "id") ?? "unknown-skill";
      return heartbeatEvent({
        kind: "skill-untrusted",
        severity: "warn",
        summary: `Approved Skill ${skillId} has no self-evolved or trusted provenance marker.`,
        actionRefs: ["hotflow director knowledge status"],
        evidenceRefs: [`skill://${skillId}`],
        nowMs,
      });
    });
}

async function collectSkillProposalHeartbeatEvents(
  skillPaths: HeartbeatSkillStoragePaths,
  nowMs: number,
): Promise<DirectorHeartbeatEvent[]> {
  const proposals = await listDirectorSkillProposals(skillPaths);
  const events: DirectorHeartbeatEvent[] = [];
  for (const proposal of proposals) {
    const decoded = decodeSkillProposal(proposal);
    const skillTitle = decoded?.snapshot.title ?? proposal.id;
    const sourceExperienceId = readSkillProposalSourceExperienceId(proposal);
    const evidenceRefs = [
      `skill-proposal://${proposal.id}`,
      sourceExperienceId === null ? null : `experience://${sourceExperienceId}`,
    ].filter((value): value is string => value !== null);

    if (proposal.status === "pending") {
      events.push(
        heartbeatEvent({
          kind: "skill-proposal-review",
          severity: "warn",
          summary: `Skill proposal ${proposal.id} (${skillTitle}) is pending operator review.`,
          actionRefs: [`/技能 接受 ${proposal.id}`, `/技能 拒绝 ${proposal.id}`],
          evidenceRefs,
          nowMs,
        }),
      );
    }
    if (proposal.status === "accepted") {
      events.push(
        heartbeatEvent({
          kind: "skill-apply-ready",
          severity: "info",
          summary: `Accepted Skill proposal ${proposal.id} (${skillTitle}) is ready for safe apply.`,
          actionRefs: [`/技能 应用 ${proposal.id}`],
          evidenceRefs,
          nowMs,
        }),
      );
    }
  }
  return events;
}

async function listSkillProposalSourceExperienceIds(
  skillPaths: HeartbeatSkillStoragePaths,
): Promise<readonly string[]> {
  const proposals = await listDirectorSkillProposals(skillPaths);
  return Array.from(
    new Set(
      proposals
        .map(readSkillProposalSourceExperienceId)
        .filter((candidateId): candidateId is string => candidateId !== null),
    ),
  );
}

async function listDirectorSkillProposals(
  skillPaths: HeartbeatSkillStoragePaths,
): Promise<readonly ProposalRecord[]> {
  const dbPath = skillPaths.sessionDbPaths.find((path) => existsSync(path));
  if (dbPath === undefined) {
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

function resolveHeartbeatSkillStoragePaths(
  workspaceRoot: string,
  dataDir: string,
): HeartbeatSkillStoragePaths {
  const workspaceHotflow = join(workspaceRoot, ".hotflow");
  return {
    sessionDbPaths: uniqueStrings([
      resolveDirectorSkillSessionDbPath(dataDir),
      resolveDirectorSkillSessionDbPath(workspaceHotflow),
    ]),
    approvedSnapshotPaths: uniqueStrings([
      join(dataDir, "skills", "approved-skills.json"),
      join(workspaceHotflow, "skills", "approved-skills.json"),
    ]),
    usagePaths: uniqueStrings([
      resolveSkillUsagePath({ dataDir }),
      resolveSkillUsagePath({ dataDir: workspaceHotflow }),
    ]),
  };
}

function resolveDirectorSkillSessionDbPath(dataDir: string): string {
  const override = process.env.HOTFLOW_CLI_SESSION_DB_PATH?.trim();
  return override || join(dataDir, "sessions", "cli.sqlite");
}

async function listApprovedSkillSourceExperienceIds(
  skillPaths: HeartbeatSkillStoragePaths,
): Promise<readonly string[]> {
  const document = await readFirstApprovedSkillsDocument(skillPaths);
  if (!isRecord(document) || !Array.isArray(document.skills)) {
    return [];
  }
  return Array.from(
    new Set(
      document.skills
        .map(readApprovedSkillSourceExperienceId)
        .filter((candidateId): candidateId is string => candidateId !== null),
    ),
  );
}

async function readFirstApprovedSkillsDocument(
  skillPaths: HeartbeatSkillStoragePaths,
): Promise<unknown | null> {
  for (const path of skillPaths.approvedSnapshotPaths) {
    const document = await readJsonDocument(path);
    if (document !== null) {
      return document;
    }
  }
  return null;
}

async function readFirstSkillUsageDocument(
  skillPaths: HeartbeatSkillStoragePaths,
): Promise<SkillUsageDocument | null> {
  for (const path of skillPaths.usagePaths) {
    const document = await readJsonDocument(path);
    if (isRecord(document) && document.schemaVersion === "skills.usage.v1") {
      return document as unknown as SkillUsageDocument;
    }
  }
  return null;
}

function readSkillProposalSourceExperienceId(proposal: ProposalRecord): string | null {
  const decoded = decodeSkillProposal(proposal);
  const metadata = decoded?.snapshot.metadata;
  return readSourceExperienceIdFromMetadata(metadata);
}

function readApprovedSkillSourceExperienceId(skill: unknown): string | null {
  const metadata = isRecord(skill) ? skill.metadata : undefined;
  return readSourceExperienceIdFromMetadata(metadata);
}

function readSourceExperienceIdFromMetadata(metadata: unknown): string | null {
  const direct =
    readStringProperty(metadata, "sourceExperienceId") ??
    readStringProperty(metadata, "candidateId");
  if (direct !== null) {
    return direct;
  }
  const sourceRef =
    readStringProperty(metadata, "sourceExperienceRef") ??
    readStringProperty(metadata, "evidenceRef");
  const match = /^experience:\/\/(.+)$/u.exec(sourceRef ?? "");
  return match?.[1] ?? null;
}

function heartbeatEvent(input: {
  readonly kind: DirectorHeartbeatEventKind;
  readonly severity: DirectorHeartbeatSeverity;
  readonly summary: string;
  readonly actionRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly nowMs: number;
}): DirectorHeartbeatEvent {
  return materializeDirectorHeartbeatEvent(input);
}

async function listDirectorRunReports(
  workspaceRoot: string,
): Promise<DirectorHeartbeatRunReport[]> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const runsRoot = join(workspace.runtime, "execution", "runs");
  let entries: Dirent[];
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const reports: DirectorHeartbeatRunReport[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const report = await readJsonDocument(join(runsRoot, entry.name, "report.json"));
    if (isDirectorHeartbeatRunReport(report)) {
      reports.push(report);
    }
  }
  return reports;
}

async function listReflectedRunIds(workspaceRoot: string): Promise<Set<string>> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const reflectionRoot = join(workspace.knowledge, "reflection", "report");
  let entries: Dirent[];
  try {
    entries = await readdir(reflectionRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
  const reflected = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const report = await readJsonDocument(join(reflectionRoot, entry.name));
    if (
      isRecord(report) &&
      typeof report.sourceKind === "string" &&
      typeof report.sourceId === "string" &&
      report.sourceKind === "run"
    ) {
      reflected.add(report.sourceId);
    }
  }
  return reflected;
}

function isDirectorHeartbeatRunReport(value: unknown): value is DirectorHeartbeatRunReport {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.reportId === "string" &&
    (value.run === undefined || isRecord(value.run))
  );
}

async function inspectDirectorExperienceCandidates(
  workspaceRoot: string,
): Promise<DirectorExperienceCandidatesInspection> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const store = new FileExperienceStore({
    experienceDir: join(workspace.knowledge, "experience"),
  });
  const [candidates, reviews, promotions, artifacts, quarantined] = await Promise.all([
    store.listCandidates(),
    store.listReviewDecisions(),
    store.listPromotions(),
    store.listSourceArtifacts(),
    store.listQuarantineRecords(),
  ]);

  return {
    total: candidates.length,
    artifactTotal: artifacts.length,
    quarantineTotal: quarantined.length,
    candidates: candidates.map((candidate) =>
      inspectExperienceCandidateFromLists(candidate, reviews, promotions),
    ),
  };
}

function inspectExperienceCandidateFromLists(
  candidate: ExperienceCandidate,
  reviews: readonly ExperienceReviewDecision[],
  promotions: readonly ExperiencePromotionRecord[],
): DirectorExperienceCandidateInspection {
  const latestReview = selectLatestExperienceReview(candidate.candidateId, reviews);
  const candidatePromotions = promotions.filter(
    (promotion) => promotion.candidateId === candidate.candidateId,
  );
  const latestPromotion = selectLatestExperiencePromotion(candidatePromotions);
  return {
    candidate,
    status: latestReview?.decision ?? "pending",
    latestReview,
    promotions: candidatePromotions,
    latestPromotion,
    promoted: latestPromotion !== null,
  };
}

function selectLatestExperienceReview(
  candidateId: string,
  decisions: readonly ExperienceReviewDecision[],
): ExperienceReviewDecision | null {
  const matching = decisions.filter((decision) => decision.candidateId === candidateId);
  if (matching.length === 0) {
    return null;
  }
  return (
    [...matching].sort((left, right) => {
      return (
        right.decidedAtMs - left.decidedAtMs || right.decisionId.localeCompare(left.decisionId)
      );
    })[0] ?? null
  );
}

function selectLatestExperiencePromotion(
  promotions: readonly ExperiencePromotionRecord[],
): ExperiencePromotionRecord | null {
  if (promotions.length === 0) {
    return null;
  }
  return (
    [...promotions].sort((left, right) => {
      return (
        right.promotedAtMs - left.promotedAtMs || right.promotionId.localeCompare(left.promotionId)
      );
    })[0] ?? null
  );
}

async function inspectDirectorKnowledgeCandidates(
  workspaceRoot: string,
): Promise<DirectorKnowledgeCandidatesInspection> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const store = new FileKnowledgeStore({ knowledgeDir: workspace.knowledge });
  const [candidates, decisions] = await Promise.all([
    store.listCandidateDocuments(),
    store.listReviewDecisions(),
  ]);
  const decisionMap = new Map(decisions.map((decision) => [decision.packId, decision]));
  return {
    total: candidates.length,
    candidates: candidates.map((candidate) => ({
      candidate,
      latestReview: decisionMap.get(candidate.metadata.id) ?? null,
      status: resolveCandidateReviewStatus(candidate, decisionMap.get(candidate.metadata.id)),
    })),
  };
}

function resolveCandidateReviewStatus(
  candidate: DirectorKnowledgeCandidateDocument,
  review: DirectorKnowledgeReviewDecision | null | undefined,
): DirectorKnowledgeCandidateStatus {
  if (!review) {
    return "pending";
  }
  if (review.candidateVersion !== candidate.metadata.version) {
    return "stale";
  }
  return review.decision;
}

async function listSoulCandidates(workspaceRoot: string): Promise<DirectorSoulCandidate[]> {
  const candidateRoot = soulCandidateRoot(workspaceRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(candidateRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const candidates: DirectorSoulCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    candidates.push(await readSoulCandidateFile(join(candidateRoot, entry.name)));
  }
  return candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function readSoulCandidateFile(path: string): Promise<DirectorSoulCandidate> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isDirectorSoulCandidate(parsed)) {
      throw new Error(`Invalid Director Soul candidate document: ${path}`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Unknown Director Soul candidate: ${basename(path, ".json")}`);
    }
    throw error;
  }
}

function soulCandidateRoot(workspaceRoot: string): string {
  return join(soulRoot(workspaceRoot), "candidates");
}

function soulRoot(workspaceRoot: string): string {
  return join(resolveDirectorWorkspace({ root: workspaceRoot }).root, "soul");
}

async function writeDirectorHeartbeatSnapshot(
  workspaceRoot: string,
  snapshot: DirectorHeartbeatSnapshot,
): Promise<{ readonly eventPaths: readonly string[]; readonly latestPath: string }> {
  const root = heartbeatRoot(workspaceRoot);
  const eventsRoot = join(root, "events");
  await mkdir(eventsRoot, { recursive: true });
  const eventPaths: string[] = [];
  for (const event of snapshot.events) {
    const path = join(eventsRoot, `${event.eventId}.json`);
    await writeFile(path, `${JSON.stringify(event, null, 2)}\n`, "utf8");
    eventPaths.push(path);
  }
  const latestPath = heartbeatLatestPath(workspaceRoot);
  await writeFile(latestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { eventPaths, latestPath };
}

async function readDirectorHeartbeatLatest(
  workspaceRoot: string,
): Promise<DirectorHeartbeatSnapshot | null> {
  const value = await readJsonDocument(heartbeatLatestPath(workspaceRoot));
  return isRecord(value) && value.schemaVersion === "director.heartbeat.snapshot.v1"
    ? (value as unknown as DirectorHeartbeatSnapshot)
    : null;
}

function heartbeatRoot(workspaceRoot: string): string {
  return join(resolveDirectorWorkspace({ root: workspaceRoot }).root, "heartbeat");
}

function heartbeatLatestPath(workspaceRoot: string): string {
  return join(heartbeatRoot(workspaceRoot), "latest.json");
}

function dedupeHeartbeatEvents(
  events: readonly DirectorHeartbeatEvent[],
): DirectorHeartbeatEvent[] {
  const byKey = new Map<string, DirectorHeartbeatEvent>();
  for (const event of events) {
    byKey.set([event.kind, event.summary, event.evidenceRefs.join("|")].join("\n"), event);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      left.kind.localeCompare(right.kind) ||
      left.eventId.localeCompare(right.eventId),
  );
}

function resolveHighestSeverity(
  events: readonly DirectorHeartbeatEvent[],
): DirectorHeartbeatSeverity | "none" {
  if (events.some((event) => event.severity === "blocked")) {
    return "blocked";
  }
  if (events.some((event) => event.severity === "warn")) {
    return "warn";
  }
  if (events.some((event) => event.severity === "info")) {
    return "info";
  }
  return "none";
}

function severityRank(severity: DirectorHeartbeatSeverity): number {
  return severity === "blocked" ? 2 : severity === "warn" ? 1 : 0;
}

async function readJsonDocument(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readFirstNumber(record: unknown, keys: readonly string[]): number | null {
  if (!isRecord(record)) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function isSelfEvolvedSkill(skill: Record<string, unknown>): boolean {
  const tags = Array.isArray(skill.tags) ? skill.tags.filter((tag) => typeof tag === "string") : [];
  const metadata = isRecord(skill.metadata) ? skill.metadata : {};
  return (
    tags.includes("worker-generated") ||
    readStringProperty(skill, "source") === "self" ||
    readStringProperty(skill, "trustStatus") === "trusted" ||
    readStringProperty(metadata, "sourceTurnId") !== null
  );
}

function loadHeartbeatSwitchState(workspaceRoot: string): DirectorSwitchState {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return loadDirectorSwitchState(join(workspace.runtime, "switches.json"));
}

function toEpochMs(value: string | undefined): number {
  if (value === undefined) {
    return Date.now();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
