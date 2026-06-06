import type {
  DelegationRecordInput,
  DelegationStatus,
  DelegationStatusUpdate,
  ProposalOutboxEntry,
  ProposalQueueInput,
  ProposalRecord,
  ProposalStatus,
  TaskOperationsState,
  VerificationGateInput,
  VerificationStatus,
  VerifierMailboxSnapshot,
  WorkerMailboxSnapshot,
} from "@hotflow/tasks-core";

export type MemoryScope = "working" | "episodic" | "all";
export type {
  DelegationRecordInput,
  DelegationStatus,
  DelegationStatusUpdate,
  ProposalOutboxEntry,
  ProposalQueueInput,
  ProposalStatus,
  TaskOperationsState,
  VerifierMailboxSnapshot,
  WorkerMailboxSnapshot,
  VerificationGateInput,
  VerificationStatus,
};

export interface CompactAction {
  type: "compact";
  sessionId: string;
  strategy?: "soft" | "hard";
}

export interface ResumeAction {
  type: "resume";
  sessionId: string;
  checkpointId?: number;
}

export interface RewindAction {
  type: "rewind";
  sessionId: string;
  checkpointId?: number;
}

export interface StatusAction {
  type: "status";
  sessionId: string;
  observe?: SessionObserveOptions;
}

export interface PromptInspectAction {
  type: "prompt-inspect";
  sessionId: string;
  turnId?: string;
  stepIndex?: number;
}

export interface PromptExplainAction {
  type: "prompt-explain";
  sessionId: string;
  turnId?: string;
  stepIndex?: number;
}

export interface SessionObserveOptions {
  turnId?: string;
  limit?: number;
  includeRecovery?: boolean;
  includeAudit?: boolean;
  includeStream?: boolean;
  includeToolOutcomes?: boolean;
  includeRuntimeStatus?: boolean;
}

export interface OutputStyleAction {
  type: "output-style";
  sessionId: string;
  style: string;
}

export interface PermissionsAction {
  type: "permissions";
  sessionId: string;
  mode: string;
}

export interface LanguageAction {
  type: "language";
  sessionId: string;
  language: string;
}

export interface MemoryInspectAction {
  type: "memory-inspect";
  sessionId: string;
  scope?: MemoryScope;
}

export interface MemoryClearAction {
  type: "memory-clear";
  sessionId: string;
  scope?: MemoryScope;
}

export interface DoctorAction {
  type: "doctor";
  sessionId: string;
}

export interface OnboardingAction {
  type: "onboarding";
  sessionId: string;
}

export interface OnboardingStatusAction {
  type: "onboarding-status";
  sessionId: string;
}

export interface TaskStatusAction {
  type: "task-status";
  sessionId: string;
}

export interface TaskWorkerMailboxAction {
  type: "task-worker-mailbox";
  sessionId: string;
  workerId?: string;
}

export interface TaskVerifierMailboxAction {
  type: "task-verifier-mailbox";
  sessionId: string;
  verifierId?: string;
}

export interface DelegationEnqueueAction {
  type: "delegation-enqueue";
  sessionId: string;
  delegation: DelegationRecordInput;
}

export interface DelegationStatusAction {
  type: "delegation-status";
  sessionId: string;
  update: DelegationStatusUpdate;
}

export interface VerificationUpsertAction {
  type: "verification-upsert";
  sessionId: string;
  verification: VerificationGateInput;
}

export interface ProposalEnqueueAction {
  type: "proposal-enqueue";
  sessionId: string;
  proposal: ProposalQueueInput;
}

export interface ProposalTransitionAction {
  type: "proposal-transition";
  sessionId: string;
  proposalId: string;
  status: ProposalStatus;
  decisionNote?: string;
}

export interface ProposalGetAction {
  type: "proposal-get";
  sessionId: string;
  proposalId: string;
}

export interface ProposalPreviewAction {
  type: "proposal-preview";
  sessionId: string;
  proposalId: string;
}

export interface ProposalApplyAction {
  type: "proposal-apply";
  sessionId: string;
  proposalId: string;
}

export interface ProposalRollbackAction {
  type: "proposal-rollback";
  sessionId: string;
  version?: number;
}

export interface ProposalOutboxDrainAction {
  type: "proposal-outbox-drain";
  sessionId: string;
  limit?: number;
}

export interface ProposalListAction {
  type: "proposal-list";
  sessionId: string;
  status?: ProposalStatus;
  limit?: number;
}

export interface ProposalReviewAction {
  type: "proposal-review";
  sessionId: string;
  proposalId: string;
}

export interface ProposalExplainAction {
  type: "proposal-explain";
  sessionId: string;
  proposalId: string;
}

export interface ProposalAcceptAction {
  type: "proposal-accept";
  sessionId: string;
  proposalId: string;
  decisionNote?: string;
}

export interface ProposalRejectAction {
  type: "proposal-reject";
  sessionId: string;
  proposalId: string;
  decisionNote?: string;
}

export type ControlPlaneAction =
  | CompactAction
  | ResumeAction
  | RewindAction
  | StatusAction
  | PromptInspectAction
  | PromptExplainAction
  | OutputStyleAction
  | PermissionsAction
  | LanguageAction
  | MemoryInspectAction
  | MemoryClearAction
  | DoctorAction
  | OnboardingAction
  | OnboardingStatusAction
  | TaskStatusAction
  | TaskWorkerMailboxAction
  | TaskVerifierMailboxAction
  | DelegationEnqueueAction
  | DelegationStatusAction
  | VerificationUpsertAction
  | ProposalEnqueueAction
  | ProposalTransitionAction
  | ProposalGetAction
  | ProposalPreviewAction
  | ProposalApplyAction
  | ProposalRollbackAction
  | ProposalOutboxDrainAction
  | ProposalListAction
  | ProposalReviewAction
  | ProposalExplainAction
  | ProposalAcceptAction
  | ProposalRejectAction;

export interface ControlPlaneResult<TData = unknown> {
  action: ControlPlaneAction["type"];
  ok: boolean;
  data?: TData;
  error?: string;
}

export interface SessionControlPort {
  compact(input: Omit<CompactAction, "type">): Promise<unknown> | unknown;
  resume(input: Omit<ResumeAction, "type">): Promise<unknown> | unknown;
  rewind(input: Omit<RewindAction, "type">): Promise<unknown> | unknown;
  status(input: Omit<StatusAction, "type">): Promise<unknown> | unknown;
  promptInspect(input: Omit<PromptInspectAction, "type">): Promise<unknown> | unknown;
  promptExplain(input: Omit<PromptExplainAction, "type">): Promise<unknown> | unknown;
}

export interface ContextControlPort {
  setOutputStyle(input: Omit<OutputStyleAction, "type">): Promise<unknown> | unknown;
  setResponseLanguage(input: Omit<LanguageAction, "type">): Promise<unknown> | unknown;
}

export interface PolicyControlPort {
  setPermissionMode(input: Omit<PermissionsAction, "type">): Promise<unknown> | unknown;
}

export interface MemoryControlPort {
  inspect(input: Omit<MemoryInspectAction, "type">): Promise<unknown> | unknown;
  clear(input: Omit<MemoryClearAction, "type">): Promise<unknown> | unknown;
}

export interface OperatorControlPort {
  doctor(input: Omit<DoctorAction, "type">): Promise<unknown> | unknown;
  onboarding(input: Omit<OnboardingAction, "type">): Promise<unknown> | unknown;
  onboardingStatus(input: Omit<OnboardingStatusAction, "type">): Promise<unknown> | unknown;
}

export interface TasksControlPort {
  status(input: Omit<TaskStatusAction, "type">): Promise<TaskOperationsState> | TaskOperationsState;
  workerMailbox(
    input: Omit<TaskWorkerMailboxAction, "type">,
  ): Promise<WorkerMailboxSnapshot> | WorkerMailboxSnapshot;
  verifierMailbox(
    input: Omit<TaskVerifierMailboxAction, "type">,
  ): Promise<VerifierMailboxSnapshot> | VerifierMailboxSnapshot;
  enqueueDelegation(
    input: Omit<DelegationEnqueueAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
  setDelegationStatus(
    input: Omit<DelegationStatusAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
  upsertVerification(
    input: Omit<VerificationUpsertAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
  enqueueProposal(
    input: Omit<ProposalEnqueueAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
  transitionProposal(
    input: Omit<ProposalTransitionAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
  getProposal(
    input: Omit<ProposalGetAction, "type">,
  ): Promise<ProposalRecord | null> | ProposalRecord | null;
  previewProposal(input: Omit<ProposalPreviewAction, "type">): Promise<unknown> | unknown;
  applyProposal(
    input: Omit<ProposalApplyAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
  rollbackProposal(input: Omit<ProposalRollbackAction, "type">): Promise<unknown> | unknown;
  drainProposalOutbox(
    input: Omit<ProposalOutboxDrainAction, "type">,
  ): Promise<readonly ProposalOutboxEntry[]> | readonly ProposalOutboxEntry[];
  listProposals(
    input: Omit<ProposalListAction, "type">,
  ): Promise<readonly ProposalRecord[]> | readonly ProposalRecord[];
  reviewProposal(input: Omit<ProposalReviewAction, "type">): Promise<unknown> | unknown;
  explainProposal(input: Omit<ProposalExplainAction, "type">): Promise<unknown> | unknown;
  acceptProposal(
    input: Omit<ProposalAcceptAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
  rejectProposal(
    input: Omit<ProposalRejectAction, "type">,
  ): Promise<TaskOperationsState> | TaskOperationsState;
}

export interface ControlPlaneHooks {
  beforeAction?: (action: ControlPlaneAction) => void | Promise<void>;
  afterAction?: (action: ControlPlaneAction, result: ControlPlaneResult) => void | Promise<void>;
  onError?: (action: ControlPlaneAction, error: unknown) => void | Promise<void>;
}

export interface ControlPlanePorts {
  sessions: SessionControlPort;
  context: ContextControlPort;
  policy: PolicyControlPort;
  memory: MemoryControlPort;
  operator: OperatorControlPort;
  tasks: TasksControlPort;
  hooks?: ControlPlaneHooks;
}

export class ControlPlane {
  constructor(private readonly ports: ControlPlanePorts) {}

  async dispatch(action: ControlPlaneAction): Promise<ControlPlaneResult> {
    try {
      await this.ports.hooks?.beforeAction?.(action);

      const data = await this.route(action);
      const result: ControlPlaneResult = {
        action: action.type,
        ok: true,
        data,
      };

      await this.ports.hooks?.afterAction?.(action, result);
      return result;
    } catch (error) {
      await this.ports.hooks?.onError?.(action, error);
      return {
        action: action.type,
        ok: false,
        error: normalizeError(error),
      };
    }
  }

  private route(action: ControlPlaneAction): Promise<unknown> | unknown {
    switch (action.type) {
      case "compact":
        return this.ports.sessions.compact({
          sessionId: action.sessionId,
          ...(action.strategy ? { strategy: action.strategy } : {}),
        });
      case "resume":
        return this.ports.sessions.resume({
          sessionId: action.sessionId,
          ...(action.checkpointId ? { checkpointId: action.checkpointId } : {}),
        });
      case "rewind":
        return this.ports.sessions.rewind({
          sessionId: action.sessionId,
          ...(action.checkpointId === undefined ? {} : { checkpointId: action.checkpointId }),
        });
      case "status":
        return this.ports.sessions.status({
          sessionId: action.sessionId,
          ...(action.observe ? { observe: action.observe } : {}),
        });
      case "prompt-inspect":
        return this.ports.sessions.promptInspect({
          sessionId: action.sessionId,
          ...(action.turnId === undefined ? {} : { turnId: action.turnId }),
          ...(action.stepIndex === undefined ? {} : { stepIndex: action.stepIndex }),
        });
      case "prompt-explain":
        return this.ports.sessions.promptExplain({
          sessionId: action.sessionId,
          ...(action.turnId === undefined ? {} : { turnId: action.turnId }),
          ...(action.stepIndex === undefined ? {} : { stepIndex: action.stepIndex }),
        });
      case "output-style":
        return this.ports.context.setOutputStyle({
          sessionId: action.sessionId,
          style: action.style,
        });
      case "permissions":
        return this.ports.policy.setPermissionMode({
          sessionId: action.sessionId,
          mode: action.mode,
        });
      case "language":
        return this.ports.context.setResponseLanguage({
          sessionId: action.sessionId,
          language: action.language,
        });
      case "memory-inspect":
        return this.ports.memory.inspect({
          sessionId: action.sessionId,
          ...(action.scope ? { scope: action.scope } : {}),
        });
      case "memory-clear":
        return this.ports.memory.clear({
          sessionId: action.sessionId,
          ...(action.scope ? { scope: action.scope } : {}),
        });
      case "doctor":
        return this.ports.operator.doctor({
          sessionId: action.sessionId,
        });
      case "onboarding":
        return this.ports.operator.onboarding({
          sessionId: action.sessionId,
        });
      case "onboarding-status":
        return this.ports.operator.onboardingStatus({
          sessionId: action.sessionId,
        });
      case "task-status":
        return this.ports.tasks.status({
          sessionId: action.sessionId,
        });
      case "task-worker-mailbox":
        return this.ports.tasks.workerMailbox({
          sessionId: action.sessionId,
          ...(action.workerId === undefined ? {} : { workerId: action.workerId }),
        });
      case "task-verifier-mailbox":
        return this.ports.tasks.verifierMailbox({
          sessionId: action.sessionId,
          ...(action.verifierId === undefined ? {} : { verifierId: action.verifierId }),
        });
      case "delegation-enqueue":
        return this.ports.tasks.enqueueDelegation({
          sessionId: action.sessionId,
          delegation: action.delegation,
        });
      case "delegation-status":
        return this.ports.tasks.setDelegationStatus({
          sessionId: action.sessionId,
          update: action.update,
        });
      case "verification-upsert":
        return this.ports.tasks.upsertVerification({
          sessionId: action.sessionId,
          verification: action.verification,
        });
      case "proposal-enqueue":
        return this.ports.tasks.enqueueProposal({
          sessionId: action.sessionId,
          proposal: action.proposal,
        });
      case "proposal-transition":
        if (action.status === "applied") {
          throw new Error("Use proposal-apply for accepted -> applied safe merge.");
        }
        return this.ports.tasks.transitionProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
          status: action.status,
          ...(action.decisionNote ? { decisionNote: action.decisionNote } : {}),
        });
      case "proposal-get":
        return this.ports.tasks.getProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
        });
      case "proposal-preview":
        return this.ports.tasks.previewProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
        });
      case "proposal-list":
        return this.ports.tasks.listProposals({
          sessionId: action.sessionId,
          ...(action.status ? { status: action.status } : {}),
          ...(action.limit === undefined ? {} : { limit: action.limit }),
        });
      case "proposal-review":
        return this.ports.tasks.reviewProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
        });
      case "proposal-explain":
        return this.ports.tasks.explainProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
        });
      case "proposal-accept":
        return this.ports.tasks.acceptProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
          ...(action.decisionNote ? { decisionNote: action.decisionNote } : {}),
        });
      case "proposal-reject":
        return this.ports.tasks.rejectProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
          ...(action.decisionNote ? { decisionNote: action.decisionNote } : {}),
        });
      case "proposal-apply":
        return this.ports.tasks.applyProposal({
          sessionId: action.sessionId,
          proposalId: action.proposalId,
        });
      case "proposal-rollback":
        return this.ports.tasks.rollbackProposal({
          sessionId: action.sessionId,
          ...(action.version === undefined ? {} : { version: action.version }),
        });
      case "proposal-outbox-drain":
        return this.ports.tasks.drainProposalOutbox({
          sessionId: action.sessionId,
          ...(action.limit === undefined ? {} : { limit: action.limit }),
        });
      default:
        return assertNever(action);
    }
  }
}

export function createControlPlane(ports: ControlPlanePorts): ControlPlane {
  return new ControlPlane(ports);
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled control-plane action: ${String(value)}`);
}
