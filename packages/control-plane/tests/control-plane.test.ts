import { describe, expect, it, vi } from "vitest";

import { ControlPlane } from "../src/index.js";

describe("ControlPlane", () => {
  it("dispatches actions to matching ports", async () => {
    const taskState = {
      schemaVersion: "0.1.0" as const,
      todos: { items: [] },
      delegation: [],
      verification: [],
      proposalQueue: [],
      proposalOutbox: [],
    };
    const workerMailbox = {
      workerId: "worker-a",
      mailboxSize: 1,
      notificationCount: 1,
      coverage: "aligned" as const,
      delegationIds: ["d1"],
      notificationIds: ["notification_delegation_d1"],
      unnotifiedDelegationIds: [],
      orphanNotificationIds: [],
      items: [
        {
          id: "d1",
          workerId: "worker-a",
          instruction: "Summarize docs",
          specialization: "plan" as const,
          targetAgent: "plan-agent",
          status: "queued" as const,
          notificationId: "notification_delegation_d1",
          notificationStatus: "pending" as const,
          notificationSummary: "Delegation d1 is queued for worker worker-a.",
        },
      ],
      notifications: [
        {
          id: "notification_delegation_d1",
          kind: "delegation_assigned" as const,
          recipientKind: "worker" as const,
          recipientId: "worker-a",
          status: "pending" as const,
          summary: "Delegation d1 is queued for worker worker-a.",
          delegationId: "d1",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    };
    const verifierMailbox = {
      verifierId: "qa-a",
      mailboxSize: 1,
      notificationCount: 1,
      coverage: "aligned" as const,
      verificationIds: ["v1"],
      notificationIds: ["notification_verification_v1"],
      unnotifiedVerificationIds: [],
      orphanNotificationIds: [],
      items: [
        {
          id: "v1",
          verifierId: "qa-a",
          requirement: "Must include tests",
          status: "pending" as const,
          taskId: "todo_1",
          notificationId: "notification_verification_v1",
          notificationStatus: "pending" as const,
          notificationSummary: "Verification v1 is pending for verifier qa-a.",
        },
      ],
      notifications: [
        {
          id: "notification_verification_v1",
          kind: "verification_requested" as const,
          recipientKind: "verifier" as const,
          recipientId: "qa-a",
          status: "pending" as const,
          summary: "Verification v1 is pending for verifier qa-a.",
          verificationId: "v1",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    };

    const ports = {
      sessions: {
        compact: vi.fn(async () => ({ compacted: true })),
        resume: vi.fn(async () => ({ resumed: true })),
        rewind: vi.fn(async () => ({ rewound: true })),
        status: vi.fn(async () => ({ status: "ok" })),
        promptInspect: vi.fn(async () => ({ inspected: true })),
        promptExplain: vi.fn(async () => ({ explained: true })),
      },
      context: {
        setOutputStyle: vi.fn(async ({ style }: { style: string }) => ({ style })),
        setResponseLanguage: vi.fn(async ({ language }: { language: string }) => ({ language })),
      },
      policy: {
        setPermissionMode: vi.fn(async ({ mode }: { mode: string }) => ({ mode })),
      },
      memory: {
        inspect: vi.fn(async ({ scope }: { scope?: string }) => ({ scope: scope ?? "all" })),
        clear: vi.fn(async ({ scope }: { scope?: string }) => ({ scope: scope ?? "all" })),
      },
      operator: {
        doctor: vi.fn(async () => ({ status: "warn" })),
        onboarding: vi.fn(async () => ({ status: "pass", summary: "ready" })),
        onboardingStatus: vi.fn(async () => ({ implemented: false })),
      },
      tasks: {
        status: vi.fn(async () => taskState),
        workerMailbox: vi.fn(async () => workerMailbox),
        verifierMailbox: vi.fn(async () => verifierMailbox),
        enqueueDelegation: vi.fn(async () => taskState),
        setDelegationStatus: vi.fn(async () => taskState),
        upsertVerification: vi.fn(async () => taskState),
        enqueueProposal: vi.fn(async () => taskState),
        listProposals: vi.fn(async () => [
          {
            id: "p1",
            kind: "skills.snapshot_upsert",
            payload: { title: "README Summary" },
            status: "pending",
            schemaVersion: "0.1.0" as const,
            sourceSessionId: "s1",
            sourceTurnId: "turn-1",
            provenance: "worker-jobs",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ]),
        transitionProposal: vi.fn(async () => taskState),
        getProposal: vi.fn(async () => ({
          id: "p1",
          kind: "tasks.todo_write",
          payload: { items: [] },
          status: "accepted",
          schemaVersion: "0.1.0" as const,
          sourceSessionId: "s1",
          sourceTurnId: "turn-1",
          provenance: "worker-jobs",
          createdAtMs: 1,
          updatedAtMs: 1,
        })),
        previewProposal: vi.fn(async () => ({
          proposalId: "p1",
          skillId: "skill.readme-summary",
          operation: "update",
          currentHeadVersion: 1,
          nextHeadVersion: 2,
          proposalStatus: "accepted",
          changedFields: [{ field: "content" }],
          summary: "update skill.readme-summary with 1 changed field(s): content",
        })),
        reviewProposal: vi.fn(async () => ({
          proposalId: "p1",
          verdict: "accepted",
          decisionNote: "Accepted after structured review.",
          issues: [
            {
              code: "low_confidence",
              field: "confidence",
              message: "Confidence is low enough to warrant manual attention.",
              severity: "warning",
            },
          ],
          summary: {
            fatal: 0,
            risky: 0,
            warning: 1,
            info: 0,
          },
        })),
        acceptProposal: vi.fn(async () => taskState),
        rejectProposal: vi.fn(async () => taskState),
        explainProposal: vi.fn(async () => ({
          proposalId: "p1",
          kind: "skills.snapshot_upsert",
          status: "pending",
          provenance: "worker-jobs",
          evidenceSummary: "Opened README and summarized the repo structure.",
          riskLevel: "medium",
        })),
        applyProposal: vi.fn(async () => taskState),
        rollbackProposal: vi.fn(async () => ({
          currentVersionBefore: 2,
          restoredFromVersion: 1,
          currentVersionAfter: 3,
          approvedSkillCount: 1,
          restoredSkillIds: ["skill.readme-summary"],
        })),
        drainProposalOutbox: vi.fn(async () => [
          {
            id: `outbox-${Date.now()}`,
            eventType: "proposal.enqueued",
            proposalId: "p1",
            status: "pending",
            schemaVersion: "0.1.0" as const,
            createdAtMs: 1,
          },
        ]),
      },
    };

    const controlPlane = new ControlPlane(ports);

    const compactResult = await controlPlane.dispatch({
      type: "compact",
      sessionId: "s1",
      strategy: "soft",
    });
    const resumeResult = await controlPlane.dispatch({
      type: "resume",
      sessionId: "s1",
      checkpointId: 1,
    });
    const rewindResult = await controlPlane.dispatch({
      type: "rewind",
      sessionId: "s1",
      checkpointId: 3,
    });
    const statusResult = await controlPlane.dispatch({
      type: "status",
      sessionId: "s1",
      observe: {
        turnId: "turn-1",
        limit: 25,
        includeRecovery: true,
        includeAudit: true,
        includeStream: true,
        includeToolOutcomes: true,
        includeRuntimeStatus: true,
      },
    });
    const promptInspectResult = await controlPlane.dispatch({
      type: "prompt-inspect",
      sessionId: "s1",
      turnId: "turn-1",
      stepIndex: 0,
    });
    const promptExplainResult = await controlPlane.dispatch({
      type: "prompt-explain",
      sessionId: "s1",
      turnId: "turn-1",
      stepIndex: 0,
    });
    const outputStyleResult = await controlPlane.dispatch({
      type: "output-style",
      sessionId: "s1",
      style: "concise",
    });
    const permissionsResult = await controlPlane.dispatch({
      type: "permissions",
      sessionId: "s1",
      mode: "ask",
    });
    const languageResult = await controlPlane.dispatch({
      type: "language",
      sessionId: "s1",
      language: "zh-CN",
    });
    const memoryResult = await controlPlane.dispatch({
      type: "memory-inspect",
      sessionId: "s1",
      scope: "working",
    });
    const memoryClearResult = await controlPlane.dispatch({
      type: "memory-clear",
      sessionId: "s1",
      scope: "episodic",
    });
    const doctorResult = await controlPlane.dispatch({
      type: "doctor",
      sessionId: "operator",
    });
    const onboardingResult = await controlPlane.dispatch({
      type: "onboarding",
      sessionId: "operator",
    });
    const onboardingStatusResult = await controlPlane.dispatch({
      type: "onboarding-status",
      sessionId: "operator",
    });
    const taskStatusResult = await controlPlane.dispatch({
      type: "task-status",
      sessionId: "s1",
    });
    const taskWorkerMailboxResult = await controlPlane.dispatch({
      type: "task-worker-mailbox",
      sessionId: "s1",
      workerId: "worker-a",
    });
    const taskVerifierMailboxResult = await controlPlane.dispatch({
      type: "task-verifier-mailbox",
      sessionId: "s1",
      verifierId: "qa-a",
    });
    const delegationResult = await controlPlane.dispatch({
      type: "delegation-enqueue",
      sessionId: "s1",
      delegation: {
        id: "d1",
        workerId: "worker-a",
        instruction: "Summarize docs",
        specialization: "plan",
        targetAgent: "plan-agent",
      },
    });
    const delegationStatusResult = await controlPlane.dispatch({
      type: "delegation-status",
      sessionId: "s1",
      update: {
        id: "d1",
        status: "running",
      },
    });
    const verificationResult = await controlPlane.dispatch({
      type: "verification-upsert",
      sessionId: "s1",
      verification: {
        id: "v1",
        verifierId: "qa-a",
        requirement: "Must include tests",
        status: "pending",
      },
    });
    const proposalResult = await controlPlane.dispatch({
      type: "proposal-enqueue",
      sessionId: "s1",
      proposal: {
        id: "p1",
        kind: "skill-proposal",
        payload: { skill: "parser" },
        sourceSessionId: "s1",
        sourceTurnId: "turn-1",
        provenance: "worker-jobs",
      },
    });
    const proposalTransitionResult = await controlPlane.dispatch({
      type: "proposal-transition",
      sessionId: "s1",
      proposalId: "p1",
      status: "accepted",
    });
    const proposalListResult = await controlPlane.dispatch({
      type: "proposal-list",
      sessionId: "s1",
      status: "pending",
      limit: 5,
    });
    const proposalGetResult = await controlPlane.dispatch({
      type: "proposal-get",
      sessionId: "s1",
      proposalId: "p1",
    });
    const proposalPreviewResult = await controlPlane.dispatch({
      type: "proposal-preview",
      sessionId: "s1",
      proposalId: "p1",
    });
    const proposalReviewResult = await controlPlane.dispatch({
      type: "proposal-review",
      sessionId: "s1",
      proposalId: "p1",
    });
    const proposalExplainResult = await controlPlane.dispatch({
      type: "proposal-explain",
      sessionId: "s1",
      proposalId: "p1",
    });
    const proposalAcceptResult = await controlPlane.dispatch({
      type: "proposal-accept",
      sessionId: "s1",
      proposalId: "p1",
      decisionNote: "Accepted by operator.",
    });
    const proposalRejectResult = await controlPlane.dispatch({
      type: "proposal-reject",
      sessionId: "s1",
      proposalId: "p1",
      decisionNote: "Rejected by operator.",
    });
    const proposalApplyResult = await controlPlane.dispatch({
      type: "proposal-apply",
      sessionId: "s1",
      proposalId: "p1",
    });
    const proposalRollbackResult = await controlPlane.dispatch({
      type: "proposal-rollback",
      sessionId: "s1",
      version: 1,
    });
    const proposalOutboxResult = await controlPlane.dispatch({
      type: "proposal-outbox-drain",
      sessionId: "s1",
      limit: 3,
    });

    expect(compactResult.ok).toBe(true);
    expect(resumeResult.ok).toBe(true);
    expect(rewindResult.ok).toBe(true);
    expect(statusResult.ok).toBe(true);
    expect(promptInspectResult.ok).toBe(true);
    expect(promptExplainResult.ok).toBe(true);
    expect(outputStyleResult.data).toEqual({ style: "concise" });
    expect(permissionsResult.data).toEqual({ mode: "ask" });
    expect(languageResult.data).toEqual({ language: "zh-CN" });
    expect(memoryResult.data).toEqual({ scope: "working" });
    expect(memoryClearResult.data).toEqual({ scope: "episodic" });
    expect(doctorResult.data).toEqual({ status: "warn" });
    expect(onboardingResult.data).toEqual({ status: "pass", summary: "ready" });
    expect(onboardingStatusResult.data).toEqual({ implemented: false });
    expect(taskStatusResult.ok).toBe(true);
    expect(taskWorkerMailboxResult.data).toEqual(workerMailbox);
    expect(taskVerifierMailboxResult.data).toEqual(verifierMailbox);
    expect(delegationResult.ok).toBe(true);
    expect(delegationStatusResult.ok).toBe(true);
    expect(verificationResult.ok).toBe(true);
    expect(proposalResult.ok).toBe(true);
    expect(proposalTransitionResult.ok).toBe(true);
    expect(proposalListResult.ok).toBe(true);
    expect(proposalGetResult.ok).toBe(true);
    expect(proposalPreviewResult.ok).toBe(true);
    expect(proposalReviewResult.ok).toBe(true);
    expect(proposalExplainResult.ok).toBe(true);
    expect(proposalAcceptResult.ok).toBe(true);
    expect(proposalRejectResult.ok).toBe(true);
    expect(proposalApplyResult.ok).toBe(true);
    expect(proposalRollbackResult.ok).toBe(true);
    expect(proposalOutboxResult.ok).toBe(true);
    expect(ports.sessions.compact).toHaveBeenCalledOnce();
    expect(ports.sessions.resume).toHaveBeenCalledOnce();
    expect(ports.sessions.rewind).toHaveBeenCalledOnce();
    expect(ports.sessions.status).toHaveBeenCalledOnce();
    expect(ports.sessions.resume).toHaveBeenCalledWith({
      sessionId: "s1",
      checkpointId: 1,
    });
    expect(ports.sessions.rewind).toHaveBeenCalledWith({
      sessionId: "s1",
      checkpointId: 3,
    });
    expect(ports.sessions.status).toHaveBeenCalledWith({
      sessionId: "s1",
      observe: {
        turnId: "turn-1",
        limit: 25,
        includeRecovery: true,
        includeAudit: true,
        includeStream: true,
        includeToolOutcomes: true,
        includeRuntimeStatus: true,
      },
    });
    expect(ports.sessions.promptInspect).toHaveBeenCalledWith({
      sessionId: "s1",
      turnId: "turn-1",
      stepIndex: 0,
    });
    expect(ports.sessions.promptExplain).toHaveBeenCalledWith({
      sessionId: "s1",
      turnId: "turn-1",
      stepIndex: 0,
    });
    expect(ports.context.setOutputStyle).toHaveBeenCalledOnce();
    expect(ports.context.setResponseLanguage).toHaveBeenCalledOnce();
    expect(ports.policy.setPermissionMode).toHaveBeenCalledOnce();
    expect(ports.memory.inspect).toHaveBeenCalledOnce();
    expect(ports.memory.clear).toHaveBeenCalledOnce();
    expect(ports.operator.doctor).toHaveBeenCalledOnce();
    expect(ports.operator.onboarding).toHaveBeenCalledOnce();
    expect(ports.operator.onboardingStatus).toHaveBeenCalledOnce();
    expect(ports.tasks.status).toHaveBeenCalledOnce();
    expect(ports.tasks.workerMailbox).toHaveBeenCalledOnce();
    expect(ports.tasks.verifierMailbox).toHaveBeenCalledOnce();
    expect(ports.tasks.enqueueDelegation).toHaveBeenCalledOnce();
    expect(ports.tasks.setDelegationStatus).toHaveBeenCalledOnce();
    expect(ports.tasks.upsertVerification).toHaveBeenCalledOnce();
    expect(ports.tasks.enqueueProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.listProposals).toHaveBeenCalledOnce();
    expect(ports.tasks.transitionProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.getProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.reviewProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.explainProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.acceptProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.rejectProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.applyProposal).toHaveBeenCalledOnce();
    expect(ports.tasks.drainProposalOutbox).toHaveBeenCalledOnce();
    expect(ports.tasks.enqueueDelegation).toHaveBeenCalledWith({
      sessionId: "s1",
      delegation: {
        id: "d1",
        workerId: "worker-a",
        instruction: "Summarize docs",
        specialization: "plan",
        targetAgent: "plan-agent",
      },
    });
    expect(ports.tasks.workerMailbox).toHaveBeenCalledWith({
      sessionId: "s1",
      workerId: "worker-a",
    });
    expect(ports.tasks.verifierMailbox).toHaveBeenCalledWith({
      sessionId: "s1",
      verifierId: "qa-a",
    });
    expect(ports.tasks.transitionProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
      status: "accepted",
    });
    expect(ports.tasks.listProposals).toHaveBeenCalledWith({
      sessionId: "s1",
      status: "pending",
      limit: 5,
    });
    expect(ports.tasks.getProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
    });
    expect(ports.tasks.previewProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
    });
    expect(ports.tasks.reviewProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
    });
    expect(ports.tasks.explainProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
    });
    expect(ports.tasks.acceptProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
      decisionNote: "Accepted by operator.",
    });
    expect(ports.tasks.rejectProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
      decisionNote: "Rejected by operator.",
    });
    expect(ports.tasks.applyProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      proposalId: "p1",
    });
    expect(ports.tasks.rollbackProposal).toHaveBeenCalledWith({
      sessionId: "s1",
      version: 1,
    });
    expect(ports.tasks.drainProposalOutbox).toHaveBeenCalledWith({
      sessionId: "s1",
      limit: 3,
    });
    expect(ports.operator.doctor).toHaveBeenCalledWith({
      sessionId: "operator",
    });
    expect(ports.operator.onboarding).toHaveBeenCalledWith({
      sessionId: "operator",
    });
    expect(ports.operator.onboardingStatus).toHaveBeenCalledWith({
      sessionId: "operator",
    });
  });

  it("executes hooks and returns structured error results", async () => {
    const beforeAction = vi.fn();
    const afterAction = vi.fn();
    const onError = vi.fn();

    const controlPlane = new ControlPlane({
      sessions: {
        compact: vi.fn(async () => {
          throw new Error("compact failed");
        }),
        resume: vi.fn(),
        rewind: vi.fn(),
        status: vi.fn(),
        promptInspect: vi.fn(),
        promptExplain: vi.fn(),
      },
      context: {
        setOutputStyle: vi.fn(),
        setResponseLanguage: vi.fn(),
      },
      policy: {
        setPermissionMode: vi.fn(),
      },
      memory: {
        inspect: vi.fn(),
        clear: vi.fn(),
      },
      operator: {
        doctor: vi.fn(),
        onboarding: vi.fn(),
        onboardingStatus: vi.fn(),
      },
      tasks: {
        status: vi.fn(),
        workerMailbox: vi.fn(),
        verifierMailbox: vi.fn(),
        enqueueDelegation: vi.fn(),
        setDelegationStatus: vi.fn(),
        upsertVerification: vi.fn(),
        enqueueProposal: vi.fn(),
        listProposals: vi.fn(),
        transitionProposal: vi.fn(),
        getProposal: vi.fn(),
        previewProposal: vi.fn(),
        reviewProposal: vi.fn(),
        acceptProposal: vi.fn(),
        rejectProposal: vi.fn(),
        explainProposal: vi.fn(),
        applyProposal: vi.fn(),
        rollbackProposal: vi.fn(),
        drainProposalOutbox: vi.fn(),
      },
      hooks: {
        beforeAction,
        afterAction,
        onError,
      },
    });

    const failed = await controlPlane.dispatch({
      type: "compact",
      sessionId: "s1",
    });

    expect(beforeAction).toHaveBeenCalledOnce();
    expect(afterAction).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("compact failed");
  });

  it("rejects direct proposal-transition to applied and requires proposal-apply", async () => {
    const controlPlane = new ControlPlane({
      sessions: {
        compact: vi.fn(),
        resume: vi.fn(),
        rewind: vi.fn(),
        status: vi.fn(),
        promptInspect: vi.fn(),
        promptExplain: vi.fn(),
      },
      context: {
        setOutputStyle: vi.fn(),
        setResponseLanguage: vi.fn(),
      },
      policy: {
        setPermissionMode: vi.fn(),
      },
      memory: {
        inspect: vi.fn(),
        clear: vi.fn(),
      },
      operator: {
        doctor: vi.fn(),
        onboarding: vi.fn(),
        onboardingStatus: vi.fn(),
      },
      tasks: {
        status: vi.fn(),
        workerMailbox: vi.fn(),
        verifierMailbox: vi.fn(),
        enqueueDelegation: vi.fn(),
        setDelegationStatus: vi.fn(),
        upsertVerification: vi.fn(),
        enqueueProposal: vi.fn(),
        listProposals: vi.fn(),
        transitionProposal: vi.fn(),
        getProposal: vi.fn(),
        previewProposal: vi.fn(),
        reviewProposal: vi.fn(),
        acceptProposal: vi.fn(),
        rejectProposal: vi.fn(),
        explainProposal: vi.fn(),
        applyProposal: vi.fn(),
        rollbackProposal: vi.fn(),
        drainProposalOutbox: vi.fn(),
      },
    });

    const result = await controlPlane.dispatch({
      type: "proposal-transition",
      sessionId: "s1",
      proposalId: "p1",
      status: "applied",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Use proposal-apply");
  });
});
