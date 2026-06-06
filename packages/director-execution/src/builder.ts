import { randomUUID } from "node:crypto";

import type { AssignmentRun, ExecutionRun } from "@hotflow/director-execution-contracts";
import { DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION as EXECUTION_RUN_SCHEMA_VERSION } from "@hotflow/director-execution-contracts";
import type {
  CapabilityMatchResult,
  DirectorActionNode,
  DirectorBlueprintResponse,
} from "@hotflow/director-host-contracts";

import type { ExecutionRunBuilderOptions, ExecutionRunSource } from "./types.js";

const mapNodeStatus = (node: DirectorActionNode): AssignmentRun["status"] => {
  if (node.status === "blocked") {
    return "blocked";
  }
  if (node.dependsOn.length > 0 || node.status === "awaiting_approval") {
    return "pending";
  }
  return "ready";
};

export class ExecutionRunBuilder {
  private readonly idProvider: () => string;
  private readonly clock: () => string;

  public constructor(private readonly options: ExecutionRunBuilderOptions = {}) {
    this.idProvider = options.idProvider ?? (() => randomUUID());
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public buildFromBlueprint(source: ExecutionRunSource): ExecutionRun {
    const runId = this.idProvider();
    const now = this.clock();
    const capabilityMatchByAssignmentId = new Map(
      source.handoff.capabilityMatches.map((match) => [match.assignmentId, match]),
    );
    this.assertConsistentBlueprint(source);
    this.assertValidDependencyGraph(source.actionGraph.nodes);

    const assignments: AssignmentRun[] = source.actionGraph.nodes.map((node) => {
      const capabilityMatch = capabilityMatchByAssignmentId.get(node.assignmentId);
      return {
        runId,
        assignmentId: node.assignmentId,
        role: node.role,
        objective: node.objective,
        deliverable: node.deliverable,
        inputs: [...node.inputs],
        outputs: [...node.outputs],
        acceptanceCriteria: [...node.acceptanceCriteria],
        constraints: node.constraints.map((constraint) => ({ ...constraint })),
        actionClass: node.actionClass,
        approvalMode: node.approvalMode,
        dependsOn: [...node.dependsOn],
        status: this.resolveAssignmentStatus(node, capabilityMatch),
        selectedAdapter: node.selectedAdapter ?? capabilityMatch?.chosenAdapterId ?? null,
        allowedAdapters: [...node.allowedAdapters],
        ...(node.blockingReason === undefined ? {} : { blockingReason: node.blockingReason }),
        ...(node.timeoutMs === undefined ? {} : { timeoutMs: node.timeoutMs }),
        createdAt: now,
        notes: this.buildAssignmentNotes(node, capabilityMatch),
      };
    });

    return {
      schemaVersion: EXECUTION_RUN_SCHEMA_VERSION,
      runId,
      snapshotId: source.snapshotId,
      runtimeId: source.runtimeId,
      blueprintId: source.blueprintId,
      handoffId: source.handoff.handoffId,
      actionGraphId: source.actionGraph.graphId,
      goal: source.actionGraph.goal,
      previewSummary: source.preview.summary,
      sideEffectsAllowed: source.handoff.sideEffectsAllowed,
      createdAt: now,
      updatedAt: now,
      status: "created",
      assignments,
      events: [],
      notes: [...(source.handoff.notes ?? [])],
    };
  }

  private resolveAssignmentStatus(
    node: DirectorActionNode,
    capabilityMatch: CapabilityMatchResult | undefined,
  ): AssignmentRun["status"] {
    if (node.status === "blocked" || capabilityMatch?.status === "blocked") {
      return "blocked";
    }
    return mapNodeStatus(node);
  }

  private buildAssignmentNotes(
    node: DirectorActionNode,
    capabilityMatch: CapabilityMatchResult | undefined,
  ): string[] {
    const notes: string[] = [];
    if (node.status === "awaiting_approval") {
      notes.push("Assignment requires operator approval before execution can start.");
    }
    if (
      node.allowedAdapters.length > 0 &&
      (capabilityMatch?.status === "no_match" || capabilityMatch?.status === "partial")
    ) {
      notes.push(...capabilityMatch.reasons);
    }
    if (capabilityMatch?.status === "blocked") {
      notes.push(...capabilityMatch.reasons);
    }
    if (node.blockingReason) {
      notes.push(node.blockingReason);
    }
    return [...new Set(notes)];
  }

  private assertConsistentBlueprint(source: DirectorBlueprintResponse): void {
    if (source.handoff.blueprintId !== source.blueprintId) {
      throw new Error("Execution run creation requires handoff.blueprintId to match blueprintId.");
    }
    if (source.handoff.actionGraphId !== source.actionGraph.graphId) {
      throw new Error(
        "Execution run creation requires handoff.actionGraphId to match actionGraph.graphId.",
      );
    }
    if (source.actionGraph.blueprintId !== source.blueprintId) {
      throw new Error(
        "Execution run creation requires actionGraph.blueprintId to match blueprintId.",
      );
    }
  }

  private assertValidDependencyGraph(nodes: readonly DirectorActionNode[]): void {
    const nodeIds = new Set(nodes.map((node) => node.assignmentId));
    for (const node of nodes) {
      for (const dependencyId of node.dependsOn) {
        if (!nodeIds.has(dependencyId)) {
          throw new Error(
            `Execution run creation found unknown dependency "${dependencyId}" for assignment "${node.assignmentId}".`,
          );
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const nodeByAssignmentId = new Map(nodes.map((node) => [node.assignmentId, node]));

    const visit = (assignmentId: string): void => {
      if (visited.has(assignmentId)) {
        return;
      }
      if (visiting.has(assignmentId)) {
        throw new Error(
          `Execution run creation rejected a cyclic dependency at "${assignmentId}".`,
        );
      }
      visiting.add(assignmentId);
      const node = nodeByAssignmentId.get(assignmentId);
      if (!node) {
        throw new Error(`Execution run creation cannot locate assignment "${assignmentId}".`);
      }
      for (const dependencyId of node.dependsOn) {
        visit(dependencyId);
      }
      visiting.delete(assignmentId);
      visited.add(assignmentId);
    };

    for (const node of nodes) {
      visit(node.assignmentId);
    }
  }
}
