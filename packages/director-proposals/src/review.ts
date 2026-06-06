import type { DirectorTraceProposal, DirectorTraceProposalReview } from "./types.js";

export function reviewDirectorTraceProposal(
  proposal: DirectorTraceProposal,
): DirectorTraceProposalReview {
  const reasons: string[] = [];

  if (proposal.status !== "pending") {
    reasons.push(`Proposal is already ${proposal.status}.`);
  }
  if (proposal.riskLevel === "high") {
    reasons.push("Risk is high, so operator rejection is the default safe choice.");
  } else if (proposal.riskLevel === "medium") {
    reasons.push("Risk is medium, so operator should double-check the evidence before accepting.");
  } else {
    reasons.push("Risk is low.");
  }
  if (proposal.confidence < 0.55) {
    reasons.push("Confidence is low.");
  } else if (proposal.confidence < 0.75) {
    reasons.push("Confidence is moderate.");
  } else {
    reasons.push("Confidence is strong.");
  }
  if (proposal.selectedAdapters.length === 0) {
    reasons.push("No adapter evidence was captured.");
  }

  return {
    proposalId: proposal.proposalId,
    currentStatus: proposal.status,
    recommendation: resolveRecommendation(proposal),
    riskLevel: proposal.riskLevel,
    confidence: proposal.confidence,
    reasons,
  };
}

function resolveRecommendation(
  proposal: DirectorTraceProposal,
): DirectorTraceProposalReview["recommendation"] {
  if (proposal.status === "rejected") {
    return "reject";
  }
  if (proposal.status === "accepted") {
    return "accept";
  }
  if (proposal.riskLevel === "high" || proposal.confidence < 0.55) {
    return "reject";
  }
  if (proposal.riskLevel === "medium" || proposal.confidence < 0.75) {
    return "caution";
  }
  return "accept";
}
