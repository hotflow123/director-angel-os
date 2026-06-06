import type { ProposalRecord } from "@hotflow/contracts";

import type { ApprovedSkillSnapshotDocument } from "./file-store.js";
import type { SkillSnapshotFileStore } from "./file-store.js";
import { decodeSkillProposal } from "./proposal.js";
import { type SkillSnapshot, cloneSkillSnapshot } from "./repository.js";
import { SkillValidator } from "./validator.js";

export interface SkillApplyPreviewChange {
  readonly field: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface SkillApplyPreview {
  readonly proposalId: string;
  readonly proposalStatus: "accepted" | "applied";
  readonly skillId: string;
  readonly operation: "create" | "update";
  readonly currentHeadVersion: number;
  readonly nextHeadVersion: number;
  readonly changedFields: readonly SkillApplyPreviewChange[];
  readonly currentSkill: SkillSnapshot | null;
  readonly nextSkill: SkillSnapshot;
  readonly summary: string;
}

export interface SkillSafeApplyResult extends SkillApplyPreview {
  readonly snapshotVersion: number;
  readonly previousSnapshotVersion: number | null;
  readonly appliedAtMs: number;
  readonly appliedFromProposalId: string | null;
  readonly approvedSkillCount: number;
}

export interface SkillRollbackResult {
  readonly currentVersionBefore: number;
  readonly restoredFromVersion: number;
  readonly currentVersionAfter: number;
  readonly previousSnapshotVersion: number | null;
  readonly approvedSkillCount: number;
  readonly restoredSkillIds: readonly string[];
}

export class SkillSafeApplyService {
  public constructor(
    private readonly store: SkillSnapshotFileStore,
    private readonly validator: SkillValidator = new SkillValidator(),
  ) {}

  public previewAcceptedProposal(proposalRecord: ProposalRecord): SkillApplyPreview {
    const proposalStatus = toSafeApplyProposalStatus(proposalRecord.status);
    const validatedSnapshot = this.validateProposalSnapshot(proposalRecord);
    const head = this.store.readHead();
    const currentSkill =
      head?.skills.find((snapshot) => snapshot.id === validatedSnapshot.id) ?? null;
    const operation = currentSkill === null ? "create" : "update";
    const changedFields = diffSkillSnapshots(currentSkill, validatedSnapshot);
    const currentHeadVersion = head?.version ?? 0;

    return {
      proposalId: proposalRecord.id,
      proposalStatus,
      skillId: validatedSnapshot.id,
      operation,
      currentHeadVersion,
      nextHeadVersion: currentHeadVersion + 1,
      changedFields,
      currentSkill: currentSkill === null ? null : cloneSkillSnapshot(currentSkill),
      nextSkill: cloneSkillSnapshot(validatedSnapshot),
      summary: buildPreviewSummary(validatedSnapshot.id, operation, changedFields),
    };
  }

  public applyAcceptedProposal(proposalRecord: ProposalRecord): SkillSafeApplyResult {
    const preview = this.previewAcceptedProposal(proposalRecord);
    const approvedSkills = new Map(
      this.store.readApproved().map((snapshot) => [snapshot.id, snapshot] as const),
    );
    approvedSkills.set(preview.nextSkill.id, cloneSkillSnapshot(preview.nextSkill));

    const written = this.store.writeApproved([...approvedSkills.values()], {
      appliedFromProposalId: proposalRecord.id,
      changeKind: "apply",
    });

    return {
      ...preview,
      snapshotVersion: written.version,
      previousSnapshotVersion: written.previousVersion,
      appliedAtMs: written.appliedAtMs,
      appliedFromProposalId: written.appliedFromProposalId,
      approvedSkillCount: written.skills.length,
    };
  }

  public rollbackToVersion(version?: number): SkillRollbackResult {
    const head = this.store.readHead();
    if (head === null) {
      throw new Error("Cannot rollback approved skills before the first snapshot is written.");
    }

    const targetVersion = version ?? head.previousVersion;
    if (targetVersion === null || targetVersion === undefined) {
      throw new Error("No previous approved skill snapshot version is available.");
    }

    const restored = this.store.restoreApprovedVersion(targetVersion, {});

    return {
      currentVersionBefore: head.version,
      restoredFromVersion: targetVersion,
      currentVersionAfter: restored.version,
      previousSnapshotVersion: restored.previousVersion,
      approvedSkillCount: restored.skills.length,
      restoredSkillIds: restored.skills.map((snapshot) => snapshot.id),
    };
  }

  public revertAppliedProposal(
    result: Pick<SkillSafeApplyResult, "snapshotVersion" | "previousSnapshotVersion">,
  ): void {
    const previousHead =
      result.previousSnapshotVersion === null
        ? null
        : this.store.readVersion(result.previousSnapshotVersion);

    if (result.previousSnapshotVersion !== null && previousHead === null) {
      throw new Error(
        `Cannot recover approved skill snapshot version ${result.previousSnapshotVersion}.`,
      );
    }

    this.store.recoverHead(previousHead, result.snapshotVersion);
  }

  public readHead(): ApprovedSkillSnapshotDocument | null {
    return this.store.readHead();
  }

  private validateProposalSnapshot(proposalRecord: ProposalRecord): SkillSnapshot {
    if (proposalRecord.status !== "accepted" && proposalRecord.status !== "applied") {
      throw new Error(`Skill proposal ${proposalRecord.id} must be accepted before safe apply.`);
    }

    const decoded = decodeSkillProposal(proposalRecord);
    if (decoded === null) {
      throw new Error(`Proposal ${proposalRecord.id} is not a valid skill proposal.`);
    }

    const validated = this.validator.validateProposal(decoded);
    if (!validated.ok) {
      throw new Error(
        `Skill proposal ${proposalRecord.id} failed validation: ${validated.issues
          .map((issue) => `${issue.field}: ${issue.message}`)
          .join("; ")}`,
      );
    }

    if (validated.value === undefined) {
      throw new Error(`Skill proposal ${proposalRecord.id} produced no validated snapshot.`);
    }

    return cloneSkillSnapshot(validated.value.snapshot);
  }
}

function diffSkillSnapshots(
  current: SkillSnapshot | null,
  next: SkillSnapshot,
): readonly SkillApplyPreviewChange[] {
  const fields = [
    "version",
    "title",
    "description",
    "content",
    "updatedAtMs",
    "tags",
    "toolNames",
    "priority",
    "metadata",
  ] as const;

  const changes: SkillApplyPreviewChange[] = [];

  for (const field of fields) {
    const before = current === null ? undefined : current[field];
    const after = next[field];
    if (areValuesEqual(before, after)) {
      continue;
    }
    changes.push({
      field,
      ...(before === undefined ? {} : { before: cloneUnknown(before) }),
      ...(after === undefined ? {} : { after: cloneUnknown(after) }),
    });
  }

  return changes;
}

function buildPreviewSummary(
  skillId: string,
  operation: SkillApplyPreview["operation"],
  changes: readonly SkillApplyPreviewChange[],
): string {
  if (changes.length === 0) {
    return `${operation} ${skillId} with no field changes`;
  }
  return `${operation} ${skillId} with ${changes.length} changed field(s): ${changes
    .map((entry) => entry.field)
    .join(", ")}`;
}

function toSafeApplyProposalStatus(
  status: ProposalRecord["status"],
): SkillApplyPreview["proposalStatus"] {
  if (status !== "accepted" && status !== "applied") {
    throw new Error(`Skill proposal must be accepted before safe apply: ${status}`);
  }
  return status;
}

function areValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(cloneUnknown(left)) === JSON.stringify(cloneUnknown(right));
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneUnknown(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        cloneUnknown(entry),
      ]),
    );
  }
  return value;
}
