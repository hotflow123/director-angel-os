import type { SessionStore } from "@hotflow/sessions";
import { SkillProposalReviewer } from "@hotflow/skills";
import { SessionStoreTaskPlanePort, readCommittedSessionTaskSnapshot } from "@hotflow/tasks-core";

import { type BootstrapWorkerJobsOptions, bootstrapWorkerJobs } from "./bootstrap.js";
import { resolveWorkerJobSessionStore } from "./session-store.js";

export interface ReviewSkillProposalInput extends BootstrapWorkerJobsOptions {
  readonly sessionId: string;
  readonly proposalId: string;
  readonly reviewerId?: string;
  readonly sessionStore?: SessionStore;
}

export interface ReviewSkillProposalReport {
  readonly status: "ok";
  readonly sessionId: string;
  readonly proposalId: string;
  readonly reviewerId: string;
  readonly proposalStatusBefore: "pending";
  readonly proposalStatusAfter: "accepted" | "rejected" | "pending";
  readonly issueCount: number;
  readonly decisionNote: string;
  readonly journalDelta: number;
  readonly latestTurnId: string | null;
}

export async function runSkillProposalReviewJob(
  input: ReviewSkillProposalInput,
): Promise<ReviewSkillProposalReport> {
  const ownRuntime = input.sessionStore === undefined;
  const runtime = ownRuntime ? bootstrapWorkerJobs(input) : null;
  const sessionStore = resolveWorkerJobSessionStore(input.sessionStore, runtime);
  const reviewerId = input.reviewerId ?? "skill-reviewer/default";

  try {
    const before = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);
    const taskPlane = new SessionStoreTaskPlanePort(sessionStore, input.sessionId, {
      createIfMissing: false,
    });
    const proposal = await taskPlane.getProposal(input.proposalId);
    if (!proposal) {
      throw new Error(`Unknown proposal: ${input.proposalId}`);
    }
    if (proposal.status !== "pending") {
      throw new Error(`Skill proposal review only supports pending proposals: ${input.proposalId}`);
    }

    const review = new SkillProposalReviewer().reviewProposal(proposal);
    const nextStatus =
      review.verdict === "accepted"
        ? "accepted"
        : review.verdict === "rejected"
          ? "rejected"
          : "pending";
    const decisionNote =
      review.issues.length === 0
        ? `${review.decisionNote} reviewer=${reviewerId}`
        : `${review.decisionNote} reviewer=${reviewerId} issues=${review.issues
            .map((issue) => `${issue.code}:${issue.field}`)
            .join(",")}`;

    if (nextStatus !== proposal.status) {
      await taskPlane.transitionProposal({
        proposalId: input.proposalId,
        status: nextStatus,
        decisionNote,
      });
    }

    const after = readCommittedSessionTaskSnapshot(sessionStore, input.sessionId);

    return {
      status: "ok",
      sessionId: input.sessionId,
      proposalId: input.proposalId,
      reviewerId,
      proposalStatusBefore: "pending",
      proposalStatusAfter: nextStatus,
      issueCount: review.issues.length,
      decisionNote,
      journalDelta: after.journal.length - before.journal.length,
      latestTurnId: after.latestTurnId,
    };
  } finally {
    if (ownRuntime) {
      runtime?.close();
    }
  }
}
