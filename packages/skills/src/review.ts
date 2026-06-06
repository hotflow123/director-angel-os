import type { ProposalRecord } from "@hotflow/contracts";

import { type SkillProposal, decodeSkillProposal } from "./proposal.js";
import { SkillValidator } from "./validator.js";

export type SkillReviewSeverity = "fatal" | "risky" | "warning" | "info";

export interface SkillReviewIssue {
  readonly code: string;
  readonly field: string;
  readonly message: string;
  readonly severity: SkillReviewSeverity;
}

export interface SkillReviewResult {
  readonly proposalId: string;
  readonly verdict: "accepted" | "rejected" | "operator_review";
  readonly decisionNote: string;
  readonly issues: readonly SkillReviewIssue[];
  readonly proposal: SkillProposal | null;
}

export interface SkillProposalPolicyOptions {
  readonly allowedProvenancePrefixes?: readonly string[];
  readonly bannedContentPatterns?: readonly RegExp[];
  readonly maxContentLength?: number;
  readonly maxToolNames?: number;
}

const DEFAULT_BANNED_CONTENT_PATTERNS = [/rm\s+-rf/iu, /curl\s+.+\|\s*sh/iu, /sudo\s+/iu];
const AUTO_ACCEPT_MIN_CONFIDENCE = 0.5;

export class SkillProposalPolicy {
  private readonly allowedProvenancePrefixes: readonly string[];
  private readonly bannedContentPatterns: readonly RegExp[];
  private readonly maxContentLength: number;
  private readonly maxToolNames: number;

  public constructor(options: SkillProposalPolicyOptions = {}) {
    this.allowedProvenancePrefixes = options.allowedProvenancePrefixes ?? [
      "worker-jobs/",
      "skills/",
      "bench-",
      "test",
    ];
    this.bannedContentPatterns = options.bannedContentPatterns ?? DEFAULT_BANNED_CONTENT_PATTERNS;
    this.maxContentLength = options.maxContentLength ?? 4000;
    this.maxToolNames = options.maxToolNames ?? 8;
  }

  public evaluate(proposal: SkillProposal): readonly SkillReviewIssue[] {
    const issues: SkillReviewIssue[] = [];

    if (!proposal.trajectoryRef.startsWith("journal://")) {
      issues.push({
        code: "invalid_trajectory_ref",
        field: "trajectoryRef",
        message: "Skill proposals must point to a committed journal trajectory.",
        severity: "fatal",
      });
    }

    if (!this.allowedProvenancePrefixes.some((prefix) => proposal.provenance.startsWith(prefix))) {
      issues.push({
        code: "untrusted_provenance",
        field: "provenance",
        message: `Skill proposal provenance is not allowed: ${proposal.provenance}`,
        severity: "fatal",
      });
    }

    if (proposal.snapshot.content.length > this.maxContentLength) {
      issues.push({
        code: "content_too_large",
        field: "snapshot.content",
        message: `Skill content exceeds policy length limit (${this.maxContentLength}).`,
        severity: "fatal",
      });
    }

    if ((proposal.snapshot.toolNames?.length ?? 0) > this.maxToolNames) {
      issues.push({
        code: "too_many_tools",
        field: "snapshot.toolNames",
        message: `Skill references too many tools (max ${this.maxToolNames}).`,
        severity: "fatal",
      });
    }

    const matchedDangerousPatterns = this.bannedContentPatterns.filter((pattern) =>
      pattern.test(proposal.snapshot.content),
    );
    if (matchedDangerousPatterns.length > 0) {
      issues.push({
        code: "dangerous_content",
        field: "snapshot.content",
        message: `Skill content matched banned patterns: ${matchedDangerousPatterns
          .map((pattern) => String(pattern))
          .join(", ")}`,
        severity: "fatal",
      });
    }

    return issues;
  }
}

export class SkillProposalReviewer {
  public constructor(
    private readonly validator: SkillValidator = new SkillValidator(),
    private readonly policy: SkillProposalPolicy = new SkillProposalPolicy(),
  ) {}

  public reviewProposal(proposalRecord: ProposalRecord): SkillReviewResult {
    const decoded = decodeSkillProposal(proposalRecord);
    if (decoded === null) {
      return {
        proposalId: proposalRecord.id,
        verdict: "rejected",
        decisionNote: `Rejected invalid skill proposal ${proposalRecord.id}.`,
        issues: [
          {
            code: "invalid_skill_proposal",
            field: "kind",
            message: `Proposal ${proposalRecord.id} is not a valid skill proposal.`,
            severity: "fatal",
          },
        ],
        proposal: null,
      };
    }

    const validation = this.validator.validateProposal(decoded);
    if (!validation.ok) {
      const issues = validation.issues.map((issue) => ({
        code: "validation_failed",
        field: issue.field,
        message: issue.message,
        severity: "fatal" as const,
      }));
      return {
        proposalId: proposalRecord.id,
        verdict: "rejected",
        decisionNote: `Rejected skill proposal ${proposalRecord.id} due to validation issues.`,
        issues,
        proposal: decoded,
      };
    }

    const validatedProposal = validation.value;
    if (validatedProposal === undefined) {
      return {
        proposalId: proposalRecord.id,
        verdict: "rejected",
        decisionNote: `Rejected skill proposal ${proposalRecord.id} because validation returned no value.`,
        issues: [
          {
            code: "validation_missing_value",
            field: "proposal",
            message: `Proposal ${proposalRecord.id} did not produce a validated proposal payload.`,
            severity: "fatal",
          },
        ],
        proposal: decoded,
      };
    }

    const policyIssues = this.policy.evaluate(validatedProposal);
    const riskIssues = this.buildRiskIssues(validatedProposal);
    const duplicateIssues = this.buildDuplicateIssues(validatedProposal);
    const issues = [...policyIssues, ...riskIssues, ...duplicateIssues];
    const hasFatalIssue = issues.some((issue) => issue.severity === "fatal");
    const requiresOperatorReview = this.requiresOperatorReview(validatedProposal);

    return {
      proposalId: proposalRecord.id,
      verdict: hasFatalIssue ? "rejected" : requiresOperatorReview ? "operator_review" : "accepted",
      decisionNote: hasFatalIssue
        ? `Rejected skill proposal ${proposalRecord.id} due to fatal policy issues.`
        : requiresOperatorReview
          ? `Deferred automatic acceptance for skill proposal ${proposalRecord.id}; operator review required before accept.`
          : `Accepted skill proposal ${proposalRecord.id}.`,
      issues,
      proposal: validatedProposal,
    };
  }

  private buildRiskIssues(proposal: SkillProposal): SkillReviewIssue[] {
    const issues: SkillReviewIssue[] = [];

    if (proposal.riskLevel === "high") {
      issues.push({
        code: "high_risk_level",
        field: "riskLevel",
        message: "High risk proposals require operator review before applying.",
        severity: "risky",
      });
    } else if (proposal.riskLevel === "medium") {
      issues.push({
        code: "medium_risk_level",
        field: "riskLevel",
        message: "Medium risk proposals should be inspected before applying.",
        severity: "warning",
      });
    }

    if (proposal.confidence !== undefined && proposal.confidence < AUTO_ACCEPT_MIN_CONFIDENCE) {
      issues.push({
        code: "low_confidence",
        field: "confidence",
        message: `Proposal confidence ${proposal.confidence} is below the recommended threshold.`,
        severity: "warning",
      });
    }

    return issues;
  }

  private requiresOperatorReview(proposal: SkillProposal): boolean {
    if (proposal.riskLevel === "high") {
      return true;
    }

    return proposal.confidence !== undefined && proposal.confidence < AUTO_ACCEPT_MIN_CONFIDENCE;
  }

  private buildDuplicateIssues(proposal: SkillProposal): SkillReviewIssue[] {
    if (proposal.duplicateMatch === undefined) {
      return [];
    }

    return [
      {
        code: "duplicate_candidate",
        field: "duplicateMatch",
        message: `Matches ${proposal.duplicateMatch.skillId}: ${proposal.duplicateMatch.reason}.`,
        severity: "info",
      },
    ];
  }
}
