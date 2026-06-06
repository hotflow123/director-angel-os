import type { ProposalRecord } from "@hotflow/contracts";

import { decodeSkillProposal } from "./proposal.js";
import type { SkillRepositoryPort, SkillSnapshot } from "./repository.js";
import { SkillValidator } from "./validator.js";

export interface SkillReconcileResult {
  readonly proposalId: string;
  readonly snapshot: SkillSnapshot;
  readonly appliedAtMs: number;
}

export interface SkillReconcilerOptions {
  readonly now?: () => number;
}

export class SkillReconciler {
  private readonly now: () => number;

  public constructor(
    private readonly repository: SkillRepositoryPort,
    private readonly validator: SkillValidator = new SkillValidator(),
    options: SkillReconcilerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  public applyAcceptedProposal(proposalRecord: ProposalRecord): SkillReconcileResult {
    if (proposalRecord.status !== "accepted" && proposalRecord.status !== "applied") {
      throw new Error(
        `Skill proposal ${proposalRecord.id} must be accepted before reconciliation.`,
      );
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

    const validatedProposal = validated.value;
    if (validatedProposal === undefined) {
      throw new Error(`Skill proposal ${proposalRecord.id} produced no validated snapshot.`);
    }

    this.repository.upsertApproved(validatedProposal.snapshot);

    return {
      proposalId: proposalRecord.id,
      snapshot: validatedProposal.snapshot,
      appliedAtMs: this.now(),
    };
  }
}
