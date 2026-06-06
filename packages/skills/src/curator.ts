import type { SkillSnapshot } from "./repository.js";
import type { SkillUsageDocument, SkillUsageRecord } from "./usage.js";

export type SkillEvolutionActionKind = "patch" | "archive" | "merge" | "keep";
export type SkillEvolutionActionSeverity = "info" | "warning" | "risky";
export type SkillCuratorWriteActionKind = Exclude<SkillEvolutionActionKind, "keep">;
export type SkillCuratorWriteOperatorSurface =
  | "desktop-local"
  | "host-api"
  | "weixin"
  | "cli"
  | "automation"
  | "unknown";
export type SkillCuratorWriteGuardStatus = "allowed" | "blocked" | "operator_scope_required";
export type SkillCuratorWriteGuardReasonCode =
  | "operator_scope_admitted"
  | "remote_surface_blocked"
  | "missing_operator_scope";

export const SKILL_CURATOR_WRITE_GUARD_SCHEMA_ID = "skills.curator-write-guard.v1";
export const SKILL_CURATOR_WRITE_SCOPE = "skills.curator.write";

export interface SkillEvolutionEvidence {
  readonly useCount: number;
  readonly failureCount: number;
  readonly patchCount: number;
  readonly lastActivityAtMs: number | null;
  readonly lastUsedAtMs: number | null;
  readonly lastFailedAtMs: number | null;
}

export interface SkillEvolutionAction {
  readonly kind: SkillEvolutionActionKind;
  readonly skillId: string;
  readonly severity: SkillEvolutionActionSeverity;
  readonly reason: string;
  readonly evidence: SkillEvolutionEvidence;
  readonly canonicalSkillId?: string;
  readonly duplicateSkillIds?: readonly string[];
}

export interface SkillEvolutionSummary {
  readonly totalSkills: number;
  readonly patchCount: number;
  readonly archiveCount: number;
  readonly mergeCount: number;
  readonly keepCount: number;
}

export interface SkillEvolutionAnalysis {
  readonly generatedAtMs: number;
  readonly summary: SkillEvolutionSummary;
  readonly actions: readonly SkillEvolutionAction[];
}

export interface AnalyzeSkillEvolutionInput {
  readonly approvedSkills: readonly SkillSnapshot[];
  readonly usageDocument?: SkillUsageDocument | null;
  readonly nowMs?: number;
  readonly failurePatchThreshold?: number;
  readonly staleAfterMs?: number;
}

export interface SkillCuratorWriteActionRequest {
  readonly kind: SkillCuratorWriteActionKind;
  readonly skillId: string;
  readonly reason?: string;
  readonly canonicalSkillId?: string;
  readonly duplicateSkillIds?: readonly string[];
}

export interface SkillCuratorWriteOperatorContext {
  readonly actor?: string;
  readonly surface?: SkillCuratorWriteOperatorSurface | string;
  readonly scopes?: readonly string[];
}

export interface GuardSkillCuratorWriteRequestInput {
  readonly action: SkillCuratorWriteActionRequest;
  readonly operator?: SkillCuratorWriteOperatorContext | null;
  readonly nowMs?: number;
}

export interface SkillCuratorWriteGuardResult {
  readonly schemaId: typeof SKILL_CURATOR_WRITE_GUARD_SCHEMA_ID;
  readonly allowed: boolean;
  readonly status: SkillCuratorWriteGuardStatus;
  readonly reasonCode: SkillCuratorWriteGuardReasonCode;
  readonly summary: string;
  readonly operatorSurface: SkillCuratorWriteOperatorSurface;
  readonly operatorActor: string | null;
  readonly requiredScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly missingScopes: readonly string[];
  readonly requestedAction: SkillCuratorWriteActionRequest;
  readonly nextActions: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly generatedAtMs: number;
}

const DEFAULT_FAILURE_PATCH_THRESHOLD = 2;
const DEFAULT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function analyzeSkillEvolution(input: AnalyzeSkillEvolutionInput): SkillEvolutionAnalysis {
  const nowMs = normalizeNowMs(input.nowMs);
  const failurePatchThreshold = Math.max(
    1,
    Math.trunc(input.failurePatchThreshold ?? DEFAULT_FAILURE_PATCH_THRESHOLD),
  );
  const staleAfterMs = Math.max(0, Math.trunc(input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS));
  const actions: SkillEvolutionAction[] = [];
  const duplicateGroups = groupDuplicateSkills(input.approvedSkills);
  const duplicateSkillIds = new Set<string>();

  for (const group of duplicateGroups) {
    const [canonical, ...duplicates] = group;
    if (canonical === undefined || duplicates.length === 0) {
      continue;
    }
    for (const duplicate of duplicates) {
      duplicateSkillIds.add(duplicate.id);
    }
    actions.push({
      kind: "merge",
      skillId: canonical.id,
      canonicalSkillId: canonical.id,
      duplicateSkillIds: duplicates.map((skill) => skill.id),
      severity: "warning",
      reason: `Duplicate Skill candidates share dedupeKey ${readDedupeKey(canonical) ?? ""}.`,
      evidence: createEvidence(readUsageRecord(input.usageDocument, canonical.id)),
    });
  }

  for (const skill of input.approvedSkills) {
    if (duplicateSkillIds.has(skill.id) || hasMergeAction(actions, skill.id)) {
      continue;
    }
    const usage = readUsageRecord(input.usageDocument, skill.id);
    const evidence = createEvidence(usage);
    if (evidence.failureCount >= failurePatchThreshold) {
      actions.push({
        kind: "patch",
        skillId: skill.id,
        severity: "risky",
        reason: `Skill has ${evidence.failureCount} recorded failure(s); patch before relying on it again.`,
        evidence,
      });
      continue;
    }

    if (isStale({ evidence, nowMs, staleAfterMs })) {
      actions.push({
        kind: "archive",
        skillId: skill.id,
        severity: "warning",
        reason: `Skill has no recent activity within ${staleAfterMs}ms.`,
        evidence,
      });
      continue;
    }

    actions.push({
      kind: "keep",
      skillId: skill.id,
      severity: "info",
      reason: "Skill has no immediate curator action.",
      evidence,
    });
  }

  const summary = summarizeActions(input.approvedSkills.length, actions);
  return {
    generatedAtMs: nowMs,
    summary,
    actions,
  };
}

export function guardSkillCuratorWriteRequest(
  input: GuardSkillCuratorWriteRequestInput,
): SkillCuratorWriteGuardResult {
  const generatedAtMs = normalizeNowMs(input.nowMs);
  const requestedAction = normalizeCuratorWriteAction(input.action);
  const operatorSurface = normalizeOperatorSurface(input.operator?.surface);
  const operatorActor = normalizeOptionalString(input.operator?.actor) ?? null;
  const grantedScopes = uniqueStrings(input.operator?.scopes ?? []);
  const requiredScopes = [SKILL_CURATOR_WRITE_SCOPE];
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  const evidenceRefs = createCuratorWriteGuardEvidenceRefs(requestedAction);

  if (operatorSurface !== "desktop-local") {
    return {
      schemaId: SKILL_CURATOR_WRITE_GUARD_SCHEMA_ID,
      allowed: false,
      status: "blocked",
      reasonCode: "remote_surface_blocked",
      summary:
        "Skill curator 写操作仅允许桌面本地 operator 入口；Host API、微信、自动化和未知远程入口保持 fail-closed。",
      operatorSurface,
      operatorActor,
      requiredScopes,
      grantedScopes,
      missingScopes,
      requestedAction,
      nextActions: [
        "请回到桌面本地 operator 的 Skills/Review/Ops 面板确认 curator 动作。",
        "远程入口只能读取 guard 结果，不能 patch、archive 或 merge Skill。",
      ],
      evidenceRefs: [...evidenceRefs, "skills.curator-write-guard://remote-surface-blocked"],
      generatedAtMs,
    };
  }

  if (missingScopes.length > 0) {
    return {
      schemaId: SKILL_CURATOR_WRITE_GUARD_SCHEMA_ID,
      allowed: false,
      status: "operator_scope_required",
      reasonCode: "missing_operator_scope",
      summary:
        "桌面本地 operator 仍需要显式 skills.curator.write scope 才能执行 Skill curator 写操作。",
      operatorSurface,
      operatorActor,
      requiredScopes,
      grantedScopes,
      missingScopes,
      requestedAction,
      nextActions: [
        "授予本地 operator skills.curator.write scope 后再执行。",
        "没有该 scope 时只能查看 curator 建议和 guard evidence。",
      ],
      evidenceRefs: [...evidenceRefs, "skills.curator-write-guard://missing-operator-scope"],
      generatedAtMs,
    };
  }

  return {
    schemaId: SKILL_CURATOR_WRITE_GUARD_SCHEMA_ID,
    allowed: true,
    status: "allowed",
    reasonCode: "operator_scope_admitted",
    summary: "本地 operator 已具备 skills.curator.write scope，可以执行本地 curator 写操作。",
    operatorSurface,
    operatorActor,
    requiredScopes,
    grantedScopes,
    missingScopes,
    requestedAction,
    nextActions: [
      "执行本地 curator 写操作前保留 action evidence 和 operator note。",
      "执行后重新运行 Skill curator 分析确认队列收敛。",
    ],
    evidenceRefs: [...evidenceRefs, "skills.curator-write-guard://operator-scope-admitted"],
    generatedAtMs,
  };
}

function groupDuplicateSkills(
  skills: readonly SkillSnapshot[],
): readonly (readonly SkillSnapshot[])[] {
  const groups = new Map<string, SkillSnapshot[]>();
  for (const skill of skills) {
    const dedupeKey = readDedupeKey(skill);
    if (dedupeKey === undefined) {
      continue;
    }
    const group = groups.get(dedupeKey) ?? [];
    group.push(skill);
    groups.set(dedupeKey, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((left, right) => left.id.localeCompare(right.id)));
}

function readDedupeKey(skill: SkillSnapshot): string | undefined {
  const metadata = skill.metadata;
  if (metadata === undefined) {
    return undefined;
  }
  const value = metadata.dedupeKey;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readUsageRecord(
  usageDocument: SkillUsageDocument | null | undefined,
  skillId: string,
): SkillUsageRecord | null {
  return usageDocument?.records[skillId] ?? null;
}

function createEvidence(record: SkillUsageRecord | null): SkillEvolutionEvidence {
  return {
    useCount: record?.useCount ?? 0,
    failureCount: record?.failureCount ?? 0,
    patchCount: record?.patchCount ?? 0,
    lastActivityAtMs: record?.lastActivityAtMs ?? null,
    lastUsedAtMs: record?.lastUsedAtMs ?? null,
    lastFailedAtMs: record?.lastFailedAtMs ?? null,
  };
}

function isStale(input: {
  readonly evidence: SkillEvolutionEvidence;
  readonly nowMs: number;
  readonly staleAfterMs: number;
}): boolean {
  if (input.staleAfterMs <= 0 || input.evidence.useCount === 0) {
    return false;
  }
  const lastActivityAtMs = input.evidence.lastActivityAtMs;
  return lastActivityAtMs !== null && input.nowMs - lastActivityAtMs >= input.staleAfterMs;
}

function hasMergeAction(actions: readonly SkillEvolutionAction[], skillId: string): boolean {
  return actions.some((action) => action.kind === "merge" && action.skillId === skillId);
}

function summarizeActions(
  totalSkills: number,
  actions: readonly SkillEvolutionAction[],
): SkillEvolutionSummary {
  return {
    totalSkills,
    patchCount: actions.filter((action) => action.kind === "patch").length,
    archiveCount: actions.filter((action) => action.kind === "archive").length,
    mergeCount: actions.filter((action) => action.kind === "merge").length,
    keepCount: actions.filter((action) => action.kind === "keep").length,
  };
}

function normalizeNowMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : Date.now();
}

function normalizeCuratorWriteAction(
  action: SkillCuratorWriteActionRequest,
): SkillCuratorWriteActionRequest {
  const skillId = normalizeOptionalString(action.skillId) ?? "unknown-skill";
  const reason = normalizeOptionalString(action.reason);
  const canonicalSkillId = normalizeOptionalString(action.canonicalSkillId);
  const duplicateSkillIds = uniqueStrings(action.duplicateSkillIds ?? []);
  return {
    kind: normalizeCuratorWriteKind(action.kind),
    skillId,
    ...(reason === undefined ? {} : { reason }),
    ...(canonicalSkillId === undefined ? {} : { canonicalSkillId }),
    ...(duplicateSkillIds.length === 0 ? {} : { duplicateSkillIds }),
  };
}

function normalizeCuratorWriteKind(kind: SkillCuratorWriteActionKind): SkillCuratorWriteActionKind {
  return kind === "archive" || kind === "merge" ? kind : "patch";
}

function normalizeOperatorSurface(
  surface: SkillCuratorWriteOperatorContext["surface"] | undefined,
): SkillCuratorWriteOperatorSurface {
  if (
    surface === "desktop-local" ||
    surface === "host-api" ||
    surface === "weixin" ||
    surface === "cli" ||
    surface === "automation"
  ) {
    return surface;
  }
  return "unknown";
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function uniqueStrings(values: readonly unknown[]): readonly string[] {
  return [
    ...new Set(
      values.flatMap((value) => (normalizeOptionalString(value) ? [String(value).trim()] : [])),
    ),
  ];
}

function createCuratorWriteGuardEvidenceRefs(
  action: SkillCuratorWriteActionRequest,
): readonly string[] {
  return [
    `skill-curator://${action.kind}/${action.skillId}`,
    ...(action.duplicateSkillIds ?? []).map(
      (duplicateSkillId) => `skill-curator://duplicate/${duplicateSkillId}`,
    ),
  ];
}
