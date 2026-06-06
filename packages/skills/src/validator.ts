import type { SkillProposal } from "./proposal.js";
import type { SkillSnapshot } from "./repository.js";

export interface SkillValidationIssue {
  readonly field: string;
  readonly message: string;
}

export interface SkillValidationResult<TValue> {
  readonly ok: boolean;
  readonly value?: TValue;
  readonly issues: readonly SkillValidationIssue[];
}

function normalizeText(value: string): string {
  return value.trim();
}

function pushIssue(issues: SkillValidationIssue[], field: string, message: string): void {
  issues.push({ field, message });
}

function dedupeNormalized(values: readonly string[] | undefined): readonly string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const next = normalizeText(value);
    if (next.length === 0 || seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }
  return normalized;
}

export class SkillValidator {
  public validateSnapshot(snapshot: SkillSnapshot): SkillValidationResult<SkillSnapshot> {
    const issues: SkillValidationIssue[] = [];

    if (normalizeText(snapshot.id).length === 0) {
      pushIssue(issues, "id", "Skill id must not be empty.");
    }
    if (normalizeText(snapshot.version).length === 0) {
      pushIssue(issues, "version", "Skill version must not be empty.");
    }
    if (normalizeText(snapshot.title).length === 0) {
      pushIssue(issues, "title", "Skill title must not be empty.");
    }
    if (normalizeText(snapshot.content).length === 0) {
      pushIssue(issues, "content", "Skill content must not be empty.");
    }
    if (!Number.isFinite(snapshot.updatedAtMs) || snapshot.updatedAtMs <= 0) {
      pushIssue(issues, "updatedAtMs", "Skill updatedAtMs must be a positive timestamp.");
    }

    const tags = dedupeNormalized(snapshot.tags);
    const toolNames = dedupeNormalized(snapshot.toolNames);

    const nextSnapshot: SkillSnapshot = {
      id: normalizeText(snapshot.id),
      version: normalizeText(snapshot.version),
      title: normalizeText(snapshot.title),
      content: snapshot.content.trim(),
      updatedAtMs: snapshot.updatedAtMs,
      ...(snapshot.description === undefined
        ? {}
        : { description: normalizeText(snapshot.description) }),
      ...(tags === undefined ? {} : { tags }),
      ...(toolNames === undefined ? {} : { toolNames }),
      ...(snapshot.priority === undefined ? {} : { priority: snapshot.priority }),
      ...(snapshot.disableModelInvocation === undefined
        ? {}
        : { disableModelInvocation: snapshot.disableModelInvocation }),
      ...(snapshot.metadata === undefined ? {} : { metadata: { ...snapshot.metadata } }),
    };

    return {
      ok: issues.length === 0,
      ...(issues.length === 0 ? { value: nextSnapshot } : {}),
      issues,
    };
  }

  public validateProposal(proposal: SkillProposal): SkillValidationResult<SkillProposal> {
    const issues: SkillValidationIssue[] = [];

    if (proposal.kind !== "skills.snapshot_upsert") {
      pushIssue(issues, "kind", "Skill proposal kind must be skills.snapshot_upsert.");
    }
    if (normalizeText(proposal.sourceSessionId).length === 0) {
      pushIssue(issues, "sourceSessionId", "sourceSessionId must not be empty.");
    }
    if (normalizeText(proposal.sourceTurnId).length === 0) {
      pushIssue(issues, "sourceTurnId", "sourceTurnId must not be empty.");
    }
    if (normalizeText(proposal.trajectoryRef).length === 0) {
      pushIssue(issues, "trajectoryRef", "trajectoryRef must not be empty.");
    }
    if (normalizeText(proposal.provenance).length === 0) {
      pushIssue(issues, "provenance", "provenance must not be empty.");
    }

    const snapshotValidation = this.validateSnapshot(proposal.snapshot);
    if (!snapshotValidation.ok) {
      issues.push(
        ...snapshotValidation.issues.map((issue) => ({
          field: `snapshot.${issue.field}`,
          message: issue.message,
        })),
      );
    }

    const validatedSnapshot = snapshotValidation.value;
    if (issues.length === 0 && snapshotValidation.ok && validatedSnapshot !== undefined) {
      return {
        ok: true,
        value: {
          ...proposal,
          sourceSessionId: normalizeText(proposal.sourceSessionId),
          sourceTurnId: normalizeText(proposal.sourceTurnId),
          trajectoryRef: normalizeText(proposal.trajectoryRef),
          provenance: normalizeText(proposal.provenance),
          snapshot: validatedSnapshot,
        },
        issues,
      };
    }

    return {
      ok: false,
      issues,
    };
  }
}
