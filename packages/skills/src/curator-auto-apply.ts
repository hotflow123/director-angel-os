import type {
  SkillCuratorWriteActionRequest,
  SkillCuratorWriteGuardResult,
  SkillCuratorWriteOperatorSurface,
} from "./curator.js";
import type { ApprovedSkillSnapshotDocument, SkillSnapshotFileStore } from "./file-store.js";
import { type SkillSnapshot, cloneSkillSnapshot } from "./repository.js";
import type { SkillUsageRecord, SkillUsageStore } from "./usage.js";

export const SKILL_CURATOR_AUTO_APPLY_SCHEMA_ID = "skills.curator-auto-apply.v1" as const;

export type SkillCuratorAutoApplyStatus = "applied" | "blocked" | "unsupported";
export type SkillCuratorAutoApplyReasonCode =
  | "patch_applied"
  | "guard_not_allowed"
  | "unsupported_action"
  | "skill_not_found"
  | "empty_patch";

export interface SkillCuratorPatchPayload {
  readonly title?: string;
  readonly description?: string;
  readonly content?: string;
  readonly version?: string;
  readonly tags?: readonly string[];
  readonly toolNames?: readonly string[];
  readonly priority?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SkillCuratorAutoApplyOperator {
  readonly actor?: string;
  readonly surface?: SkillCuratorWriteOperatorSurface | string;
  readonly note?: string;
}

export interface SkillCuratorAutoApplyInput {
  readonly action: SkillCuratorWriteActionRequest;
  readonly guard: SkillCuratorWriteGuardResult;
  readonly patch?: SkillCuratorPatchPayload;
  readonly operator?: SkillCuratorAutoApplyOperator | null;
  readonly nowMs?: number;
}

export interface SkillCuratorAutoApplyResult {
  readonly schemaId: typeof SKILL_CURATOR_AUTO_APPLY_SCHEMA_ID;
  readonly applied: boolean;
  readonly status: SkillCuratorAutoApplyStatus;
  readonly reasonCode: SkillCuratorAutoApplyReasonCode;
  readonly summary: string;
  readonly action: SkillCuratorWriteActionRequest;
  readonly guard: SkillCuratorWriteGuardResult;
  readonly skill: SkillSnapshot | null;
  readonly snapshot: ApprovedSkillSnapshotDocument | null;
  readonly usage: SkillUsageRecord | null;
  readonly evidenceRefs: readonly string[];
  readonly generatedAtMs: number;
}

export class SkillCuratorAutoApplyService {
  public constructor(
    private readonly snapshotStore: SkillSnapshotFileStore,
    private readonly usageStore: SkillUsageStore,
  ) {}

  public apply(input: SkillCuratorAutoApplyInput): SkillCuratorAutoApplyResult {
    const generatedAtMs = normalizeNowMs(input.nowMs);
    const action = normalizeAction(input.action);
    const baseEvidenceRefs = [
      ...input.guard.evidenceRefs,
      `skills.curator-auto-apply://${action.kind}/${action.skillId}`,
    ];

    if (!input.guard.allowed) {
      return {
        schemaId: SKILL_CURATOR_AUTO_APPLY_SCHEMA_ID,
        applied: false,
        status: "blocked",
        reasonCode: "guard_not_allowed",
        summary: "Skill curator auto apply was blocked by the write guard.",
        action,
        guard: input.guard,
        skill: null,
        snapshot: null,
        usage: null,
        evidenceRefs: baseEvidenceRefs,
        generatedAtMs,
      };
    }

    if (action.kind !== "patch") {
      return {
        schemaId: SKILL_CURATOR_AUTO_APPLY_SCHEMA_ID,
        applied: false,
        status: "unsupported",
        reasonCode: "unsupported_action",
        summary: "Skill curator auto apply currently supports concrete patch actions only.",
        action,
        guard: input.guard,
        skill: null,
        snapshot: null,
        usage: null,
        evidenceRefs: baseEvidenceRefs,
        generatedAtMs,
      };
    }

    const approvedSkills = this.snapshotStore.readApproved();
    const current = approvedSkills.find((skill) => skill.id === action.skillId);
    if (current === undefined) {
      return {
        schemaId: SKILL_CURATOR_AUTO_APPLY_SCHEMA_ID,
        applied: false,
        status: "blocked",
        reasonCode: "skill_not_found",
        summary: `Unknown approved Skill: ${action.skillId}.`,
        action,
        guard: input.guard,
        skill: null,
        snapshot: null,
        usage: null,
        evidenceRefs: baseEvidenceRefs,
        generatedAtMs,
      };
    }

    const nextSkill = createPatchedSkill(current, {
      patch: input.patch ?? {},
      action,
      guard: input.guard,
      ...(input.operator === undefined ? {} : { operator: input.operator }),
      nowMs: generatedAtMs,
    });
    if (areSkillSnapshotsEqual(current, nextSkill)) {
      return {
        schemaId: SKILL_CURATOR_AUTO_APPLY_SCHEMA_ID,
        applied: false,
        status: "blocked",
        reasonCode: "empty_patch",
        summary: `Patch for ${action.skillId} did not change any editable Skill fields.`,
        action,
        guard: input.guard,
        skill: cloneSkillSnapshot(current),
        snapshot: null,
        usage: null,
        evidenceRefs: baseEvidenceRefs,
        generatedAtMs,
      };
    }

    const snapshot = this.snapshotStore.writeApproved(
      approvedSkills.map((skill) => (skill.id === action.skillId ? nextSkill : skill)),
      { changeKind: "manual" },
    );
    const usage = this.usageStore.resetFailures(action.skillId, {
      actor: normalizeOptionalString(input.operator?.actor) ?? "skill-curator-auto-apply",
      reason: input.operator?.note ?? action.reason ?? "skill curator auto patch apply",
      nowMs: generatedAtMs,
    });

    return {
      schemaId: SKILL_CURATOR_AUTO_APPLY_SCHEMA_ID,
      applied: true,
      status: "applied",
      reasonCode: "patch_applied",
      summary: `Applied curator patch for ${action.skillId}.`,
      action,
      guard: input.guard,
      skill: cloneSkillSnapshot(nextSkill),
      snapshot,
      usage,
      evidenceRefs: baseEvidenceRefs,
      generatedAtMs,
    };
  }
}

function createPatchedSkill(
  current: SkillSnapshot,
  input: {
    readonly patch: SkillCuratorPatchPayload;
    readonly action: SkillCuratorWriteActionRequest;
    readonly guard: SkillCuratorWriteGuardResult;
    readonly operator?: SkillCuratorAutoApplyOperator | null;
    readonly nowMs: number;
  },
): SkillSnapshot {
  const title = normalizeOptionalString(input.patch.title);
  const description = normalizeOptionalString(input.patch.description);
  const content = normalizeOptionalString(input.patch.content);
  const version = normalizeOptionalString(input.patch.version);
  const tags = normalizeOptionalStringArray(input.patch.tags);
  const toolNames = normalizeOptionalStringArray(input.patch.toolNames);
  const priority = Number.isFinite(input.patch.priority) ? input.patch.priority : undefined;
  const actor = normalizeOptionalString(input.operator?.actor);
  const note = normalizeOptionalString(input.operator?.note);
  return {
    ...current,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(content === undefined ? {} : { content }),
    ...(version === undefined ? {} : { version }),
    ...(tags === undefined ? {} : { tags }),
    ...(toolNames === undefined ? {} : { toolNames }),
    ...(priority === undefined ? {} : { priority }),
    updatedAtMs: input.nowMs,
    metadata: {
      ...(current.metadata ?? {}),
      ...(input.patch.metadata ?? {}),
      curatorLastAction: "patch",
      curatorAutoAppliedAtMs: input.nowMs,
      ...(actor === undefined ? {} : { curatorAutoAppliedBy: actor }),
      ...(note === undefined ? {} : { curatorPatchNote: note }),
      curatorPatchReason: input.action.reason ?? "skill curator auto patch apply",
      curatorGuardEvidenceRefs: [...input.guard.evidenceRefs],
    },
  };
}

function normalizeAction(action: SkillCuratorWriteActionRequest): SkillCuratorWriteActionRequest {
  const reason = normalizeOptionalString(action.reason);
  const canonicalSkillId = normalizeOptionalString(action.canonicalSkillId);
  const duplicateSkillIds = normalizeOptionalStringArray(action.duplicateSkillIds);
  return {
    kind: action.kind === "archive" || action.kind === "merge" ? action.kind : "patch",
    skillId: normalizeOptionalString(action.skillId) ?? "unknown-skill",
    ...(reason === undefined ? {} : { reason }),
    ...(canonicalSkillId === undefined ? {} : { canonicalSkillId }),
    ...(duplicateSkillIds === undefined ? {} : { duplicateSkillIds }),
  };
}

function areSkillSnapshotsEqual(left: SkillSnapshot, right: SkillSnapshot): boolean {
  const omitMetadataOnly = (
    skill: SkillSnapshot,
  ): Omit<SkillSnapshot, "metadata" | "updatedAtMs"> => {
    const { metadata: _metadata, updatedAtMs: _updatedAtMs, ...rest } = skill;
    return rest;
  };
  return JSON.stringify(omitMetadataOnly(left)) === JSON.stringify(omitMetadataOnly(right));
}

function normalizeOptionalStringArray(
  values: readonly unknown[] | undefined,
): readonly string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  return [
    ...new Set(
      values
        .map((value) => normalizeOptionalString(value))
        .filter((value): value is string => value !== undefined),
    ),
  ];
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeNowMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : Date.now();
}
