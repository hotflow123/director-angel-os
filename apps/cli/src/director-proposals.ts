import { join } from "node:path";

import {
  ExecutionRunService,
  FileSystemRunStore,
  createDeterministicMockExecutor,
} from "@hotflow/director-execution";
import {
  type DirectorProposalDecisionStatus,
  type DirectorProposalStatus,
  type DirectorTraceProposal,
  type DirectorTraceProposalDecision,
  FileSystemDirectorProposalStore,
  materializeDirectorTraceProposalReplay,
  reviewDirectorTraceProposal,
} from "@hotflow/director-proposals";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

export interface DirectorTraceProposalListQuery {
  readonly status?: DirectorProposalStatus;
  readonly projectId?: string;
  readonly groupId?: string;
  readonly limit?: number;
}

export interface DirectorTraceProposalDecisionInput {
  readonly proposalId: string;
  readonly note?: string;
}

export interface DirectorTraceProposalReplayInput {
  readonly proposalId: string;
  readonly workerId?: string;
}

export async function describeDirectorTraceProposalStatus(workspaceRoot: string): Promise<string> {
  const store = createProposalStore(workspaceRoot);
  const status = await store.getStatus();
  const lines = [
    "Director trace proposals:",
    `  workspace root: ${workspaceRoot}`,
    `  status: ${status.status}`,
    `  proposal count: ${status.proposalCount}`,
  ];

  if (status.lastUpdatedAt) {
    lines.push(`  last updated at: ${status.lastUpdatedAt}`);
  }
  if (status.notes.length > 0) {
    lines.push(`  notes: ${status.notes.join(" | ")}`);
  }

  return lines.join("\n");
}

export async function listDirectorTraceProposals(
  workspaceRoot: string,
  query: DirectorTraceProposalListQuery = {},
): Promise<string> {
  const store = createProposalStore(workspaceRoot);
  const proposals = await store.listProposals();
  const filtered = applyQuery(proposals, query);
  const lines = ["Director trace proposal list:", `  total: ${filtered.length}`];

  if (filtered.length === 0) {
    lines.push("  proposals: (none)");
    return lines.join("\n");
  }

  lines.push("  proposals:");
  for (const proposal of filtered) {
    lines.push(
      `  - ${proposal.proposalId} status=${proposal.status} risk=${proposal.riskLevel} confidence=${proposal.confidence.toFixed(
        2,
      )}`,
    );
    lines.push(`    title: ${proposal.title}`);
    lines.push(`    project/group: ${proposal.projectId}/${proposal.groupId}`);
    lines.push(`    record/run: ${proposal.recordId}/${proposal.runId}`);
  }

  return lines.join("\n");
}

export async function explainDirectorTraceProposal(
  workspaceRoot: string,
  proposalId: string,
): Promise<string> {
  const store = createProposalStore(workspaceRoot);
  const proposal = await store.getProposal(proposalId);
  if (!proposal) {
    throw new Error(`Unknown Director trace proposal: ${proposalId}`);
  }

  const lines = [
    "Director trace proposal:",
    `  proposal id: ${proposal.proposalId}`,
    `  status: ${proposal.status}`,
    `  kind: ${proposal.kind}`,
    `  risk: ${proposal.riskLevel}`,
    `  confidence: ${proposal.confidence.toFixed(2)}`,
    `  project/group: ${proposal.projectId}/${proposal.groupId}`,
    `  record id: ${proposal.recordId}`,
    `  digest id: ${proposal.digestId}`,
    `  run/report: ${proposal.runId}/${proposal.reportId}`,
    `  provenance: ${proposal.provenance}`,
    `  tags: ${proposal.tags.join(", ") || "(none)"}`,
    `  roles: ${proposal.roles.join(", ") || "(none)"}`,
    `  adapters: ${proposal.selectedAdapters.join(", ") || "(none)"}`,
    `  trigger: ${proposal.trigger}`,
    `  evidence: ${proposal.evidenceSummary}`,
    `  explanation: ${proposal.explanation}`,
    `  dedupe key: ${proposal.dedupeKey}`,
    `  created at: ${proposal.createdAt}`,
    `  updated at: ${proposal.updatedAt}`,
  ];

  if (proposal.latestDecision) {
    lines.push(...renderLatestDecision(proposal.latestDecision));
  }

  return lines.join("\n");
}

export async function reviewDirectorTraceProposalForOperator(
  workspaceRoot: string,
  proposalId: string,
): Promise<string> {
  const store = createProposalStore(workspaceRoot);
  const proposal = await store.getProposal(proposalId);
  if (!proposal) {
    throw new Error(`Unknown Director trace proposal: ${proposalId}`);
  }

  const review = reviewDirectorTraceProposal(proposal);
  const lines = [
    "Director trace proposal review:",
    `  proposal id: ${review.proposalId}`,
    `  current status: ${review.currentStatus}`,
    `  recommendation: ${review.recommendation}`,
    `  risk: ${review.riskLevel}`,
    `  confidence: ${review.confidence.toFixed(2)}`,
    `  reasons: ${review.reasons.join(" | ")}`,
  ];

  return lines.join("\n");
}

export async function previewDirectorTraceProposal(
  workspaceRoot: string,
  proposalId: string,
): Promise<string> {
  const store = createProposalStore(workspaceRoot);
  const proposal = await requireAcceptedProposal(store, proposalId);
  const materialized = materializeDirectorTraceProposalReplay(proposal);
  await ensureAuditRecorded(
    await store.appendAuditEvent({
      proposalId,
      action: "previewed",
      previewId: materialized.previewId,
      note: materialized.summary,
    }),
  );

  const lines = [
    "Director trace proposal preview:",
    `  proposal id: ${proposal.proposalId}`,
    `  status: ${proposal.status}`,
    "  mode: mock-only synthetic replay",
    `  preview id: ${materialized.previewId}`,
    `  summary: ${materialized.summary}`,
    `  goal: ${materialized.blueprint.actionGraph.goal}`,
    `  warnings: ${materialized.warnings.join(" | ")}`,
    `  adapters: ${proposal.selectedAdapters.join(", ") || "(none)"}`,
    `  anchors: ${proposal.sourceRecord.anchorIds.join(", ") || "(none)"}`,
    "  assignments:",
  ];

  for (const node of materialized.blueprint.actionGraph.nodes) {
    lines.push(
      `  - ${node.assignmentId} role=${node.role} action=${node.actionClass} dependsOn=${node.dependsOn.join(", ") || "(none)"} adapters=${node.allowedAdapters.join(", ") || "(none)"}`,
    );
  }

  return lines.join("\n");
}

export async function replayDirectorTraceProposal(
  workspaceRoot: string,
  input: DirectorTraceProposalReplayInput,
): Promise<string> {
  const store = createProposalStore(workspaceRoot);
  const proposal = await requireAcceptedProposal(store, input.proposalId);
  const materialized = materializeDirectorTraceProposalReplay(proposal);
  const workerId = input.workerId ?? "director-trace-proposal-replay";
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const executionService = new ExecutionRunService({
    store: new FileSystemRunStore({
      rootPath: join(workspace.runtime, "execution"),
    }),
  });
  const executor = createDeterministicMockExecutor({
    defaultAdapterId: proposal.selectedAdapters[0] ?? "mock-execution",
  });

  const createdRun = await executionService.createRunFromBlueprint(materialized.blueprint);
  let currentRun = await executionService.startRun(createdRun.runId);
  let executedAssignments = 0;

  while (currentRun.status === "running") {
    const claimed = await executionService.claimNextReadyAssignment(createdRun.runId, workerId);
    if (!claimed) {
      break;
    }
    executedAssignments += 1;
    const result = await executor.execute(claimed.assignment, {
      workerId,
    });
    currentRun = await executionService.completeAssignment(
      createdRun.runId,
      claimed.assignment.assignmentId,
      result,
    );
  }

  const report = await executionService.collectRunReport(createdRun.runId);
  await ensureAuditRecorded(
    await store.appendAuditEvent({
      proposalId: input.proposalId,
      action: "replayed",
      runId: report.runId,
      reportId: report.reportId,
      note: `Mock replay finished with status ${report.run.status}.`,
    }),
  );

  return [
    "Director trace proposal replay:",
    `  proposal id: ${proposal.proposalId}`,
    `  status: ${proposal.status}`,
    `  worker id: ${workerId}`,
    `  run id: ${report.runId}`,
    `  report id: ${report.reportId}`,
    `  run status: ${report.run.status}`,
    `  executed assignments: ${executedAssignments}`,
    `  summary: ${report.summary.join(" | ")}`,
    `  flags: ${report.flags.join(", ") || "(none)"}`,
  ].join("\n");
}

export async function acceptDirectorTraceProposal(
  workspaceRoot: string,
  input: DirectorTraceProposalDecisionInput,
): Promise<string> {
  return decideDirectorTraceProposal(workspaceRoot, {
    ...input,
    nextStatus: "accepted",
  });
}

export async function rejectDirectorTraceProposal(
  workspaceRoot: string,
  input: DirectorTraceProposalDecisionInput,
): Promise<string> {
  return decideDirectorTraceProposal(workspaceRoot, {
    ...input,
    nextStatus: "rejected",
  });
}

function createProposalStore(workspaceRoot: string): FileSystemDirectorProposalStore {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  return new FileSystemDirectorProposalStore({
    rootPath: join(workspace.runtime, "proposals"),
  });
}

function applyQuery(
  proposals: readonly DirectorTraceProposal[],
  query: DirectorTraceProposalListQuery,
): readonly DirectorTraceProposal[] {
  const filtered = proposals.filter((proposal) => {
    if (query.status !== undefined && proposal.status !== query.status) {
      return false;
    }
    if (query.projectId !== undefined && proposal.projectId !== query.projectId) {
      return false;
    }
    if (query.groupId !== undefined && proposal.groupId !== query.groupId) {
      return false;
    }
    return true;
  });

  if (query.limit === undefined) {
    return filtered;
  }
  return filtered.slice(0, query.limit);
}

async function decideDirectorTraceProposal(
  workspaceRoot: string,
  input: DirectorTraceProposalDecisionInput & {
    readonly nextStatus: DirectorProposalDecisionStatus;
  },
): Promise<string> {
  const store = createProposalStore(workspaceRoot);
  const result = await store.transitionProposal({
    proposalId: input.proposalId,
    nextStatus: input.nextStatus,
    ...(input.note === undefined ? {} : { note: input.note }),
  });

  if (result.status !== "ok") {
    throw new Error(result.notes.join(" | "));
  }

  const lines = [
    "Director trace proposal decision:",
    `  proposal id: ${result.proposalId}`,
    `  previous status: ${result.previousStatus ?? "(unknown)"}`,
    `  next status: ${result.nextStatus}`,
  ];
  if (result.recordedAt) {
    lines.push(`  recorded at: ${result.recordedAt}`);
  }
  if (input.note) {
    lines.push(`  note: ${input.note}`);
  }
  if (result.notes.length > 0) {
    lines.push(`  notes: ${result.notes.join(" | ")}`);
  }

  return lines.join("\n");
}

async function requireAcceptedProposal(
  store: FileSystemDirectorProposalStore,
  proposalId: string,
): Promise<DirectorTraceProposal> {
  const proposal = await store.getProposal(proposalId);
  if (!proposal) {
    throw new Error(`Unknown Director trace proposal: ${proposalId}`);
  }
  if (proposal.status !== "accepted") {
    throw new Error(
      `Director trace proposal ${proposalId} must be accepted before preview or replay.`,
    );
  }
  return proposal;
}

async function ensureAuditRecorded(input: {
  readonly status: "ok" | "degraded";
  readonly notes: readonly string[];
}): Promise<void> {
  if (input.status === "ok") {
    return;
  }
  throw new Error(input.notes.join(" | "));
}

function renderLatestDecision(decision: DirectorTraceProposalDecision): readonly string[] {
  const lines = [
    `  latest decision: ${decision.decidedStatus}`,
    `  latest decided at: ${decision.decidedAt}`,
  ];
  if (decision.note) {
    lines.push(`  latest decision note: ${decision.note}`);
  }
  return lines;
}
