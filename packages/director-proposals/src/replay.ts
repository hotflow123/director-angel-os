import {
  DIRECTOR_HOST_API_VERSION,
  type DirectorActionClass,
  type DirectorBlueprintResponse,
  type DirectorCrewRole,
} from "@hotflow/director-host-contracts";

import type { DirectorTraceProposal } from "./types.js";

const FALLBACK_ROLE: DirectorCrewRole = "researcher";
const DEFAULT_ADAPTER_ID = "mock-execution";

const ACTION_CLASS_BY_ROLE: Record<DirectorCrewRole, DirectorActionClass> = {
  researcher: "read",
  "script-planner": "write",
  "shot-planner": "generate",
  "asset-router": "publish",
  "qc-reviewer": "read",
};

export interface DirectorTraceProposalReplayMaterialization {
  readonly proposalId: string;
  readonly previewId: string;
  readonly summary: string;
  readonly warnings: readonly string[];
  readonly blueprint: DirectorBlueprintResponse;
}

export interface DirectorTraceProposalReplayMaterializationOptions {
  readonly now?: string;
}

export function materializeDirectorTraceProposalReplay(
  proposal: DirectorTraceProposal,
  options: DirectorTraceProposalReplayMaterializationOptions = {},
): DirectorTraceProposalReplayMaterialization {
  if (proposal.status !== "accepted") {
    throw new Error(
      `Director trace proposal ${proposal.proposalId} must be accepted before replay preview is allowed.`,
    );
  }

  const recordedAt = options.now ?? proposal.updatedAt;
  const replayPrefix = `trace-proposal-replay-${proposal.proposalId}`;
  const previewId = `trace-proposal-preview-${proposal.proposalId}`;
  const warnings = [
    "Synthetic replay derived from a trace digest, not the original host blueprint.",
    "Mock-only execution keeps all external side effects disabled.",
  ];
  const roles = normalizeRoles(proposal);
  const adapters = normalizeAdapters(proposal);
  const nodes = roles.map((role, index) =>
    createReplayNode({
      replayPrefix,
      proposal,
      role,
      index,
      adapters,
    }),
  );
  const summary = `Replay-safe mock-only rehearsal for accepted trace proposal ${proposal.proposalId}.`;
  const blueprintId = replayPrefix;
  const actionGraphId = `${replayPrefix}-graph`;
  const previewSummary = [
    "mock-only rehearsal",
    proposal.sourceRecord.digest.goal,
    `project ${proposal.projectId}/${proposal.groupId}`,
  ].join(" | ");

  return {
    proposalId: proposal.proposalId,
    previewId,
    summary,
    warnings,
    blueprint: {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: proposal.sourceRecord.digest.snapshotId,
      runtimeId: proposal.sourceRecord.digest.runtimeId,
      blueprintId,
      review: {
        overallDecision: "pass",
        blockingReasons: [],
        requiredFixes: [],
        warnings: [...warnings],
      },
      capabilitySnapshot: {
        snapshotId: `${replayPrefix}-capability`,
        runtimeId: proposal.sourceRecord.digest.runtimeId,
        capturedAt: recordedAt,
        status: "ready",
        adapters: adapters.map((adapterId) => ({
          adapterId,
          adapterKind: "execution",
          provider: "director-trace-proposal",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: true,
          supportedActionClasses: [...new Set(nodes.map((node) => node.actionClass))],
          notes: ["mock-only", `derived from ${proposal.proposalId}`],
        })),
        notes: ["preview-only", "synthetic replay"],
      },
      actionGraph: {
        graphId: actionGraphId,
        blueprintId,
        goal: proposal.sourceRecord.digest.goal,
        nodes,
        edges: nodes.slice(1).map((node, index) => {
          const previousNode = nodes[index];
          if (previousNode === undefined) {
            throw new Error("Cannot build replay edge without a previous node.");
          }

          return {
            fromNodeId: previousNode.nodeId,
            toNodeId: node.nodeId,
            handoffContract: `replay-handoff-${index + 1}`,
            blocking: true,
          };
        }),
        stopConditions: [
          "mock-only replay must not invoke real external adapters",
          "stop immediately if proposal state drifts away from accepted",
        ],
      },
      preview: {
        previewId,
        summary: previewSummary,
        warnings: [...warnings],
        blockedReasons: [],
        requiredApprovals: [],
      },
      handoff: {
        handoffId: `${replayPrefix}-handoff`,
        blueprintId,
        createdAt: recordedAt,
        alignmentLockId: `${replayPrefix}-lock`,
        actionGraphId,
        previewSummary,
        capabilityMatches: nodes.map((node, index) => ({
          matchId: `${replayPrefix}-match-${index + 1}`,
          assignmentId: node.assignmentId,
          status: "matched",
          chosenAdapterId: node.selectedAdapter ?? undefined,
          reasons: [
            `Derived from accepted proposal ${proposal.proposalId}.`,
            "Replay is restricted to mock-only execution.",
          ],
        })),
        mediaRequests: [],
        expectedArtifacts: [],
        chosenAdapters: [...adapters],
        sideEffectsAllowed: false,
        notes: [
          "preview-only",
          "synthetic replay",
          `accepted decision at ${proposal.latestDecision?.decidedAt ?? proposal.updatedAt}`,
        ],
      },
    },
  };
}

function normalizeRoles(proposal: DirectorTraceProposal): readonly DirectorCrewRole[] {
  const roles = proposal.roles.length > 0 ? proposal.roles : proposal.sourceRecord.digest.roles;
  const filtered = roles.filter(isDirectorCrewRole);
  return filtered.length > 0 ? filtered : [FALLBACK_ROLE];
}

function normalizeAdapters(proposal: DirectorTraceProposal): readonly string[] {
  const adapters =
    proposal.selectedAdapters.length > 0
      ? proposal.selectedAdapters
      : proposal.sourceRecord.selectedAdapters;
  return adapters.length > 0 ? [...new Set(adapters)] : [DEFAULT_ADAPTER_ID];
}

function createReplayNode(input: {
  readonly replayPrefix: string;
  readonly proposal: DirectorTraceProposal;
  readonly role: DirectorCrewRole;
  readonly index: number;
  readonly adapters: readonly string[];
}) {
  const assignmentId = `${input.replayPrefix}-assignment-${input.index + 1}`;
  const nodeId = `${input.replayPrefix}-node-${input.index + 1}`;
  const previousAssignmentId =
    input.index === 0 ? undefined : `${input.replayPrefix}-assignment-${input.index}`;
  const adapterId = input.adapters[0] ?? DEFAULT_ADAPTER_ID;

  return {
    nodeId,
    assignmentId,
    role: input.role,
    objective: buildObjective(input.role, input.proposal),
    inputs:
      previousAssignmentId === undefined
        ? ["accepted-trace-proposal", "trace-digest"]
        : [`handoff:${previousAssignmentId}`],
    outputs: [`${input.role}-replay-output-${input.index + 1}`],
    deliverable: buildDeliverable(input.role, input.proposal),
    acceptanceCriteria: [
      "Stay inside the accepted proposal evidence and goal.",
      "Remain deterministic and preview-safe.",
      "Do not trigger any external side effects.",
    ],
    constraints: [],
    dependsOn: previousAssignmentId === undefined ? [] : [previousAssignmentId],
    allowedAdapters: [...input.adapters],
    actionClass: ACTION_CLASS_BY_ROLE[input.role],
    approvalMode: "auto_allow" as const,
    escalationToDirector: false,
    status: "ready" as const,
    selectedAdapter: adapterId,
  };
}

function buildObjective(role: DirectorCrewRole, proposal: DirectorTraceProposal): string {
  switch (role) {
    case "researcher":
      return `Reconstruct the accepted method context for "${proposal.sourceRecord.digest.goal}".`;
    case "script-planner":
      return `Turn the accepted method into a deterministic script plan for ${proposal.projectId}.`;
    case "shot-planner":
      return `Expand the accepted method into a shot sequence for ${proposal.groupId}.`;
    case "asset-router":
      return "Route the accepted method through the allowed mock adapters only.";
    case "qc-reviewer":
      return "Review the replay outputs for continuity, safety, and completeness.";
  }
}

function buildDeliverable(role: DirectorCrewRole, proposal: DirectorTraceProposal): string {
  switch (role) {
    case "researcher":
      return `Replay brief for ${proposal.proposalId}`;
    case "script-planner":
      return `Replay script plan for ${proposal.groupId}`;
    case "shot-planner":
      return `Replay shot list for ${proposal.groupId}`;
    case "asset-router":
      return `Mock adapter routing notes for ${proposal.projectId}`;
    case "qc-reviewer":
      return `Replay QA summary for ${proposal.proposalId}`;
  }
}

function isDirectorCrewRole(value: string): value is DirectorCrewRole {
  return (
    value === "researcher" ||
    value === "script-planner" ||
    value === "shot-planner" ||
    value === "asset-router" ||
    value === "qc-reviewer"
  );
}
