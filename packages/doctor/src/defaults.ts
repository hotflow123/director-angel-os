import { type HotflowConfig, loadConfig } from "@hotflow/config";
import {
  type TaskOperationsState,
  type VerifierMailboxSnapshot,
  type WorkerMailboxSnapshot,
  createControlPlane,
} from "@hotflow/control-plane";
import { resolveOpenAICompatibleProviderEnv } from "@hotflow/models";
import { SessionStore } from "@hotflow/sessions";

import type {
  DoctorBootstrapControlPlaneInput,
  DoctorLoadConfigInput,
  DoctorOpenSessionStoreInput,
  DoctorProviderDescriptor,
  DoctorProviderRegistryResult,
  DoctorRegisterProvidersInput,
  DoctorResolveSessionDbPathInput,
} from "./types.js";

const EMPTY_TASK_OPERATIONS_STATE: TaskOperationsState = {
  schemaVersion: "0.1.0",
  todos: { items: [] },
  delegation: [],
  verification: [],
  proposalQueue: [],
  proposalOutbox: [],
};

function emptyWorkerMailboxSnapshot(workerId: string | undefined): WorkerMailboxSnapshot {
  return {
    ...(workerId === undefined ? {} : { workerId }),
    mailboxSize: 0,
    notificationCount: 0,
    coverage: "aligned",
    delegationIds: [],
    notificationIds: [],
    unnotifiedDelegationIds: [],
    orphanNotificationIds: [],
    items: [],
    notifications: [],
  };
}

function emptyVerifierMailboxSnapshot(verifierId: string | undefined): VerifierMailboxSnapshot {
  return {
    ...(verifierId === undefined ? {} : { verifierId }),
    mailboxSize: 0,
    notificationCount: 0,
    coverage: "aligned",
    verificationIds: [],
    notificationIds: [],
    unnotifiedVerificationIds: [],
    orphanNotificationIds: [],
    items: [],
    notifications: [],
  };
}

function readEnvVar(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function defaultLoadDoctorConfig(input: DoctorLoadConfigInput = {}): HotflowConfig {
  return loadConfig({
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
}

export function defaultResolveDoctorSessionDbPath(input: DoctorResolveSessionDbPathInput): string {
  return input.sessionDbPathOverride ?? input.config.sessionDbPath;
}

export function defaultRegisterDoctorProviders(
  input: DoctorRegisterProvidersInput,
): DoctorProviderRegistryResult {
  const env = input.env ?? process.env;
  const providerIds = ["scripted"];
  const providers: DoctorProviderDescriptor[] = [
    {
      id: "scripted",
      source: "builtin",
      available: true,
    },
  ];

  const openAIConfig = resolveOpenAICompatibleProviderEnv({
    ...(input.env ? { env: input.env } : {}),
  });
  if (openAIConfig) {
    providerIds.push(openAIConfig.providerId);
    providers.push({
      id: openAIConfig.providerId,
      source: "env",
      available: true,
      details: {
        baseUrl: openAIConfig.baseUrl,
        hasApiKey: Boolean(openAIConfig.apiKey),
      },
    });
  } else {
    const hintedProviderId = readEnvVar(env, "HOTFLOW_OPENAI_PROVIDER_ID");
    const apiKey = readEnvVar(env, "HOTFLOW_OPENAI_API_KEY");
    if (hintedProviderId || apiKey || input.config.defaultProvider === "openai-compatible") {
      providers.push({
        id: hintedProviderId ?? "openai-compatible",
        source: "env",
        available: false,
        reason: "HOTFLOW_OPENAI_BASE_URL is not set.",
        details: {
          hasApiKey: Boolean(apiKey),
        },
      });
    }
  }

  return {
    providerIds,
    providers,
    details: {
      mode: "static-catalog",
    },
  };
}

export function defaultOpenDoctorSessionStore(input: DoctorOpenSessionStoreInput): SessionStore {
  return new SessionStore({
    dbPath: input.sessionDbPath,
  });
}

export function defaultBootstrapDoctorControlPlane(
  _input: DoctorBootstrapControlPlaneInput,
): unknown {
  return createControlPlane({
    sessions: {
      compact(input) {
        return {
          sessionId: input.sessionId,
          compacted: false,
          strategy: input.strategy ?? "soft",
        };
      },
      resume(input) {
        return {
          sessionId: input.sessionId,
          checkpointId: input.checkpointId ?? null,
          status: "active",
        };
      },
      rewind(input) {
        return {
          sessionId: input.sessionId,
          requestedCheckpointId: input.checkpointId ?? null,
          selection: input.checkpointId === undefined ? "previous" : "explicit",
          targetCheckpointId: input.checkpointId ?? 1,
          targetUptoSeq: 0,
          currentCheckpointId: 1,
          currentUptoSeq: 0,
          latestTurnId: null,
          clearedLatestTurn: false,
        };
      },
      status(input) {
        return {
          sessionId: input.sessionId,
          status: "active",
          observe: input.observe ?? null,
        };
      },
      promptInspect(input) {
        return {
          sessionId: input.sessionId,
          turnId: input.turnId ?? "turn-doctor",
          stepIndex: input.stepIndex ?? 0,
          availableStepIndices: [input.stepIndex ?? 0],
          usedTokens: 0,
          remainingTokens: 0,
          staticSections: [],
          dynamicSections: [],
          omittedSections: [],
          runtimeDegradations: [],
        };
      },
      promptExplain(input) {
        return {
          sessionId: input.sessionId,
          turnId: input.turnId ?? "turn-doctor",
          stepIndex: input.stepIndex ?? 0,
          availableStepIndices: [input.stepIndex ?? 0],
          usedTokens: 0,
          remainingTokens: 0,
          focusSectionIds: [],
          omittedSectionIds: [],
          runtimeDegradations: [],
          addedDynamicSectionIds: [],
          removedDynamicSectionIds: [],
          newlyOmittedSectionIds: [],
          restoredOmittedSectionIds: [],
        };
      },
    },
    context: {
      setOutputStyle(input) {
        return {
          sessionId: input.sessionId,
          style: input.style,
        };
      },
      setResponseLanguage(input) {
        return {
          sessionId: input.sessionId,
          language: input.language,
        };
      },
    },
    policy: {
      setPermissionMode(input) {
        return {
          sessionId: input.sessionId,
          mode: input.mode,
        };
      },
    },
    memory: {
      inspect(input) {
        return {
          sessionId: input.sessionId,
          scope: input.scope ?? "all",
          layer0Count: 0,
          layer1Count: 0,
        };
      },
      clear(input) {
        return {
          sessionId: input.sessionId,
          scope: input.scope ?? "all",
          layer0Cleared: 0,
          layer1Cleared: 0,
        };
      },
    },
    operator: {
      doctor(input) {
        return {
          sessionId: input.sessionId,
          status: "pass",
        };
      },
      onboarding(input) {
        return {
          sessionId: input.sessionId,
          status: "pass",
          summary: "Onboarding default surface is available.",
        };
      },
      onboardingStatus(input) {
        return {
          sessionId: input.sessionId,
          implemented: false,
        };
      },
    },
    tasks: {
      status() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      workerMailbox(input) {
        return emptyWorkerMailboxSnapshot(input.workerId);
      },
      verifierMailbox(input) {
        return emptyVerifierMailboxSnapshot(input.verifierId);
      },
      enqueueDelegation() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      setDelegationStatus() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      upsertVerification() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      enqueueProposal() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      transitionProposal() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      getProposal() {
        return null;
      },
      previewProposal() {
        return null;
      },
      rollbackProposal() {
        return null;
      },
      listProposals() {
        return [];
      },
      reviewProposal() {
        return null;
      },
      explainProposal() {
        return null;
      },
      acceptProposal() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      rejectProposal() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      applyProposal() {
        return EMPTY_TASK_OPERATIONS_STATE;
      },
      drainProposalOutbox() {
        return [];
      },
    },
  });
}
