import type { ExternalToolInvokeResult, ExternalToolRegistry } from "./external-tools.js";
import { invokeExternalTool } from "./external-tools.js";

const DEFAULT_MOYIN_TOOL_ID = "moyin.provider";

export type MoyinProjectReadinessStatus = "blocked" | "ready";
export type MoyinProjectReadinessBlockerCode =
  | "MOYIN_CONTROL_PLANE_REQUIRED"
  | "MOYIN_PROVIDER_API_KEY_REQUIRED"
  | "MOYIN_PROJECT_REQUIRED"
  | "MOYIN_PROJECT_UNREADABLE"
  | "MOYIN_PROJECT_SCRIPT_REQUIRED"
  | "MOYIN_PROJECT_SCLASS_REQUIRED"
  | "MOYIN_PROJECT_STORE_READ_REQUIRED"
  | "MOYIN_WORKFLOW_RUN_LEDGER_UNREADABLE"
  | "MOYIN_TASK_LEDGER_UNREADABLE"
  | "MOYIN_ARTIFACT_REGISTRY_UNREADABLE"
  | "MOYIN_USER_SELECTED_MODEL_REQUIRED";

export interface MoyinProjectReadinessInput {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly projectId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MoyinProjectReadinessGate {
  readonly id:
    | "control-plane"
    | "model-catalog"
    | "moyin-project"
    | "provider-api-key"
    | "project-script"
    | "project-sclass"
    | "workflow-run"
    | "task-ledger"
    | "artifact-registry";
  readonly status: "blocked" | "passed" | "unknown";
  readonly summary: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface MoyinProjectReadinessProjectRef {
  readonly projectId: string;
  readonly name?: string;
  readonly source: "active-project" | "input-project";
}

export interface MoyinProjectReadinessReport {
  readonly schemaVersion: "director.moyin.project-readiness.v1";
  readonly provider: "moyin";
  readonly status: MoyinProjectReadinessStatus;
  readonly blockerCode?: MoyinProjectReadinessBlockerCode;
  readonly project?: MoyinProjectReadinessProjectRef;
  readonly gates: readonly MoyinProjectReadinessGate[];
  readonly handshake: ExternalToolInvokeResult;
  readonly projectList?: ExternalToolInvokeResult;
  readonly projectDetail?: ExternalToolInvokeResult;
  readonly workflowRuns?: ExternalToolInvokeResult;
  readonly taskList?: ExternalToolInvokeResult;
  readonly artifactList?: ExternalToolInvokeResult;
  readonly nextActions: readonly string[];
  readonly mutation: {
    readonly projectCreateAttempted: false;
    readonly workflowRunCreateAttempted: false;
    readonly submitAttempted: false;
  };
  readonly metadata: {
    readonly schemaVersion: "director.moyin.project-readiness.metadata.v1";
    readonly referencePatterns: readonly string[];
  };
}

export async function evaluateMoyinProjectReadiness(
  input: MoyinProjectReadinessInput,
): Promise<MoyinProjectReadinessReport> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const handshake = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "capabilities.handshake",
    args: {
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.project-readiness",
      submitAttempted: false,
      projectCreateAttempted: false,
      workflowRunCreateAttempted: false,
    },
  });
  const handshakeOutput = readMoyinEnvelopePayload(handshake.output);
  const capabilityGates = createMoyinCapabilityGates(handshake, handshakeOutput);

  if (!handshake.ok) {
    return createMoyinProjectReadinessReport({
      handshake,
      gates: [
        {
          id: "control-plane",
          status: "blocked",
          summary: handshake.content,
          evidence: { status: handshake.status, operationId: handshake.operationId },
        },
      ],
      status: "blocked",
      blockerCode: "MOYIN_CONTROL_PLANE_REQUIRED",
      nextActions: ["Start Moyin desktop and retry project readiness."],
    });
  }

  const projectList = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "project.list",
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.project-readiness",
      submitAttempted: false,
      projectCreateAttempted: false,
      workflowRunCreateAttempted: false,
    },
  });
  const projectListPayload = readMoyinEnvelopePayload(projectList.output);
  const projectSelection = selectMoyinProject(input.projectId, projectListPayload);
  const projectGate = createMoyinProjectGate(projectList, projectListPayload, projectSelection);

  if (!projectList.ok || projectSelection === undefined) {
    return createMoyinProjectReadinessReport({
      handshake,
      projectList,
      gates: [...capabilityGates, projectGate],
      status: "blocked",
      blockerCode: "MOYIN_PROJECT_REQUIRED",
      nextActions: [
        "Select an existing Moyin project or create one in Moyin before creating workflow-runs.",
      ],
    });
  }

  const projectDetail = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "project.get",
    args: { projectId: projectSelection.projectId },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.project-readiness",
      projectId: projectSelection.projectId,
      submitAttempted: false,
      projectCreateAttempted: false,
      workflowRunCreateAttempted: false,
    },
  });
  const projectDetailPayload = readMoyinEnvelopePayload(projectDetail.output);
  if (!projectDetail.ok) {
    return createMoyinProjectReadinessReport({
      handshake,
      projectList,
      projectDetail,
      gates: [
        ...capabilityGates,
        {
          ...projectGate,
          status: "blocked",
          summary: `Moyin project ${projectSelection.projectId} could not be read.`,
        },
      ],
      status: "blocked",
      blockerCode: "MOYIN_PROJECT_UNREADABLE",
      project: projectSelection,
      nextActions: ["Choose another Moyin project or fix Moyin project storage."],
    });
  }

  const project = {
    ...projectSelection,
    ...optionalStringField("name", readProjectName(projectDetailPayload) ?? projectSelection.name),
  };
  const scriptStoreSummary = findMoyinScopedStore(projectDetailPayload, "script");
  const sclassStoreSummary = findMoyinScopedStore(projectDetailPayload, "sclass");
  const scriptStore =
    scriptStoreSummary === undefined
      ? undefined
      : await invokeMoyinProjectReadinessProbe(input, {
          toolId,
          operationId: "project.store.get",
          args: { projectId: project.projectId, storeName: "script" },
          projectId: project.projectId,
        });
  const scriptStorePayload = readMoyinEnvelopePayload(scriptStore?.output);
  if (scriptStore !== undefined && !scriptStore.ok) {
    return createMoyinProjectReadinessReport({
      handshake,
      projectList,
      projectDetail,
      gates: [
        ...capabilityGates,
        projectGate,
        createMoyinScopedStoreGate({
          gateId: "project-script",
          storeName: "script",
          displayName: "script",
          blockedSummary:
            "Moyin project script scoped store content could not be read for hard validation.",
          payload: projectDetailPayload,
          storeRead: scriptStore,
        }),
      ],
      status: "blocked",
      blockerCode: "MOYIN_PROJECT_STORE_READ_REQUIRED",
      project,
      nextActions: ["Expose Moyin project.store.get for this Moyin version, then rerun readiness."],
    });
  }
  const sclassStore =
    sclassStoreSummary === undefined
      ? undefined
      : await invokeMoyinProjectReadinessProbe(input, {
          toolId,
          operationId: "project.store.get",
          args: { projectId: project.projectId, storeName: "sclass" },
          projectId: project.projectId,
        });
  const sclassStorePayload = readMoyinEnvelopePayload(sclassStore?.output);
  if (sclassStore !== undefined && !sclassStore.ok) {
    return createMoyinProjectReadinessReport({
      handshake,
      projectList,
      projectDetail,
      gates: [
        ...capabilityGates,
        projectGate,
        createMoyinScopedStoreGate({
          gateId: "project-script",
          storeName: "script",
          displayName: "script",
          blockedSummary:
            "Moyin project has no script scoped store; import or generate a script before S-Class automation.",
          payload: projectDetailPayload,
          ...(scriptStorePayload === undefined ? {} : { storePayload: scriptStorePayload }),
        }),
        createMoyinScopedStoreGate({
          gateId: "project-sclass",
          storeName: "sclass",
          displayName: "S-Class",
          blockedSummary:
            "Moyin project S-Class scoped store content could not be read for hard validation.",
          payload: projectDetailPayload,
          storeRead: sclassStore,
        }),
      ],
      status: "blocked",
      blockerCode: "MOYIN_PROJECT_STORE_READ_REQUIRED",
      project,
      nextActions: ["Expose Moyin project.store.get for this Moyin version, then rerun readiness."],
    });
  }
  const workflowRuns = await invokeMoyinProjectReadinessProbe(input, {
    toolId,
    operationId: "workflow-run.list",
    args: { projectId: project.projectId },
    projectId: project.projectId,
  });
  const workflowRunsPayload = readMoyinEnvelopePayload(workflowRuns.output);
  const taskList = await invokeMoyinProjectReadinessProbe(input, {
    toolId,
    operationId: "task.list",
    args: { projectId: project.projectId },
    projectId: project.projectId,
  });
  const taskListPayload = readMoyinEnvelopePayload(taskList.output);
  const artifactList = await invokeMoyinProjectReadinessProbe(input, {
    toolId,
    operationId: "artifact.list",
    args: { projectId: project.projectId },
    projectId: project.projectId,
  });
  const artifactListPayload = readMoyinEnvelopePayload(artifactList.output);
  const projectStateGates = createMoyinProjectStateGates(projectDetailPayload, {
    ...(scriptStorePayload === undefined ? {} : { script: scriptStorePayload }),
    ...(sclassStorePayload === undefined ? {} : { sclass: sclassStorePayload }),
  });
  const workflowRunGate = createMoyinReadOnlyLedgerGate(
    "workflow-run",
    "Moyin workflow-run ledger",
    workflowRuns,
    workflowRunsPayload,
  );
  const taskLedgerGate = createMoyinReadOnlyLedgerGate(
    "task-ledger",
    "Moyin task ledger",
    taskList,
    taskListPayload,
  );
  const artifactRegistryGate = createMoyinReadOnlyLedgerGate(
    "artifact-registry",
    "Moyin artifact registry",
    artifactList,
    artifactListPayload,
  );
  const gates = [
    ...capabilityGates,
    projectGate,
    ...projectStateGates,
    workflowRunGate,
    taskLedgerGate,
    artifactRegistryGate,
  ];
  const providerGate = capabilityGates.find((gate) => gate.id === "provider-api-key");
  const modelGate = capabilityGates.find((gate) => gate.id === "model-catalog");
  const blockerCode: MoyinProjectReadinessBlockerCode | undefined =
    providerGate?.status === "blocked"
      ? "MOYIN_PROVIDER_API_KEY_REQUIRED"
      : modelGate?.status === "blocked"
        ? "MOYIN_USER_SELECTED_MODEL_REQUIRED"
        : projectStateGates.find((gate) => gate.id === "project-script")?.status === "blocked"
          ? readMoyinProjectStoreReadRequired(projectStateGates)
            ? "MOYIN_PROJECT_STORE_READ_REQUIRED"
            : "MOYIN_PROJECT_SCRIPT_REQUIRED"
          : projectStateGates.find((gate) => gate.id === "project-sclass")?.status === "blocked"
            ? readMoyinProjectStoreReadRequired(projectStateGates)
              ? "MOYIN_PROJECT_STORE_READ_REQUIRED"
              : "MOYIN_PROJECT_SCLASS_REQUIRED"
            : workflowRunGate.status === "blocked"
              ? "MOYIN_WORKFLOW_RUN_LEDGER_UNREADABLE"
              : taskLedgerGate.status === "blocked"
                ? "MOYIN_TASK_LEDGER_UNREADABLE"
                : artifactRegistryGate.status === "blocked"
                  ? "MOYIN_ARTIFACT_REGISTRY_UNREADABLE"
                  : undefined;
  const nextActions =
    blockerCode === undefined
      ? ["Use this Moyin projectId for the next S-Class workflow-run draft."]
      : blockerCode === "MOYIN_PROJECT_STORE_READ_REQUIRED"
        ? ["Expose Moyin project.store.get for hard validation, then rerun readiness."]
        : blockerCode === "MOYIN_PROJECT_SCRIPT_REQUIRED"
          ? ["Import or generate the script inside Moyin for this project, then rerun readiness."]
          : blockerCode === "MOYIN_PROJECT_SCLASS_REQUIRED"
            ? ["Prepare the Moyin S-Class state for this project, then rerun readiness."]
            : blockerCode === "MOYIN_WORKFLOW_RUN_LEDGER_UNREADABLE"
              ? ["Fix Moyin workflow-run listing before continuing; execution must be auditable."]
              : blockerCode === "MOYIN_TASK_LEDGER_UNREADABLE"
                ? ["Fix Moyin task listing before continuing; task state must be auditable."]
                : blockerCode === "MOYIN_ARTIFACT_REGISTRY_UNREADABLE"
                  ? [
                      "Fix Moyin artifact registry listing before continuing; outputs must be traceable.",
                    ]
                  : [
                      "Configure Moyin user-selected provider/model/API key before creating workflow-runs.",
                    ];
  return createMoyinProjectReadinessReport({
    handshake,
    projectList,
    projectDetail,
    workflowRuns,
    taskList,
    artifactList,
    gates,
    status: blockerCode === undefined ? "ready" : "blocked",
    ...(blockerCode === undefined ? {} : { blockerCode }),
    project,
    nextActions,
  });
}

function createMoyinProjectReadinessReport(input: {
  readonly handshake: ExternalToolInvokeResult;
  readonly projectList?: ExternalToolInvokeResult;
  readonly projectDetail?: ExternalToolInvokeResult;
  readonly workflowRuns?: ExternalToolInvokeResult;
  readonly taskList?: ExternalToolInvokeResult;
  readonly artifactList?: ExternalToolInvokeResult;
  readonly gates: readonly MoyinProjectReadinessGate[];
  readonly status: MoyinProjectReadinessStatus;
  readonly blockerCode?: MoyinProjectReadinessBlockerCode;
  readonly project?: MoyinProjectReadinessProjectRef;
  readonly nextActions: readonly string[];
}): MoyinProjectReadinessReport {
  return {
    schemaVersion: "director.moyin.project-readiness.v1",
    provider: "moyin",
    status: input.status,
    ...(input.blockerCode === undefined ? {} : { blockerCode: input.blockerCode }),
    ...(input.project === undefined ? {} : { project: input.project }),
    gates: input.gates,
    handshake: input.handshake,
    ...(input.projectList === undefined ? {} : { projectList: input.projectList }),
    ...(input.projectDetail === undefined ? {} : { projectDetail: input.projectDetail }),
    ...(input.workflowRuns === undefined ? {} : { workflowRuns: input.workflowRuns }),
    ...(input.taskList === undefined ? {} : { taskList: input.taskList }),
    ...(input.artifactList === undefined ? {} : { artifactList: input.artifactList }),
    nextActions: input.nextActions,
    mutation: {
      projectCreateAttempted: false,
      workflowRunCreateAttempted: false,
      submitAttempted: false,
    },
    metadata: {
      schemaVersion: "director.moyin.project-readiness.metadata.v1",
      referencePatterns: [
        "hermes.tool-executor",
        "openclaw.provider-contract",
        "openclaw.tool-policy",
      ],
    },
  };
}

function createMoyinCapabilityGates(
  handshake: ExternalToolInvokeResult,
  handshakeOutput: Readonly<Record<string, unknown>> | undefined,
): readonly MoyinProjectReadinessGate[] {
  const providersPayloads = readHandshakePayloads(handshakeOutput, "discover.providers");
  const modelsPayloads = readHandshakePayloads(handshakeOutput, "discover.models");
  const hasApiKey = providersPayloads.some((payload) =>
    containsRecordValue(payload, "hasApiKey", true),
  );
  const modelCount = countListItems(modelsPayloads);
  return [
    {
      id: "control-plane",
      status: handshake.ok ? "passed" : "blocked",
      summary: handshake.ok ? "Moyin control-plane is reachable." : handshake.content,
      evidence: { status: handshake.status, operationId: handshake.operationId },
    },
    {
      id: "provider-api-key",
      status: hasApiKey ? "passed" : "blocked",
      summary: hasApiKey
        ? "At least one Moyin provider reports an API key."
        : "No Moyin provider API key was detected in capability discovery.",
    },
    {
      id: "model-catalog",
      status: modelCount > 0 ? "passed" : "blocked",
      summary:
        modelCount > 0
          ? `Moyin model catalog is readable (${modelCount} model entries detected).`
          : "Moyin user-selected model configuration was not detected.",
      evidence: { modelCount },
    },
  ];
}

function createMoyinProjectGate(
  projectList: ExternalToolInvokeResult,
  payload: Readonly<Record<string, unknown>> | undefined,
  project: MoyinProjectReadinessProjectRef | undefined,
): MoyinProjectReadinessGate {
  const projectCount = countListItemsInValue(payload);
  const activeProjectId = readRecordString(payload, "activeProjectId") ?? null;
  return {
    id: "moyin-project",
    status: projectList.ok && project !== undefined ? "passed" : "blocked",
    summary:
      projectList.ok && project !== undefined
        ? `Moyin project ${project.projectId} is selected.`
        : "A real Moyin project is required before creating workflow-runs.",
    evidence: {
      blockerCode: projectList.ok && project !== undefined ? undefined : "MOYIN_PROJECT_REQUIRED",
      projectCount,
      activeProjectId,
      ...(project === undefined ? {} : { projectId: project.projectId, source: project.source }),
    },
  };
}

async function invokeMoyinProjectReadinessProbe(
  input: MoyinProjectReadinessInput,
  probe: {
    readonly toolId: string;
    readonly operationId: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly projectId: string;
  },
): Promise<ExternalToolInvokeResult> {
  return invokeExternalTool(input.registry, {
    toolId: probe.toolId,
    operationId: probe.operationId,
    args: probe.args,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.project-readiness",
      projectId: probe.projectId,
      submitAttempted: false,
      projectCreateAttempted: false,
      workflowRunCreateAttempted: false,
    },
  });
}

function createMoyinProjectStateGates(
  projectDetailPayload: Readonly<Record<string, unknown>> | undefined,
  storePayloads: {
    readonly script?: Readonly<Record<string, unknown>>;
    readonly sclass?: Readonly<Record<string, unknown>>;
  } = {},
): readonly MoyinProjectReadinessGate[] {
  return [
    createMoyinScopedStoreGate({
      gateId: "project-script",
      storeName: "script",
      displayName: "script",
      blockedSummary:
        "Moyin project has no script scoped store; import or generate a script before S-Class automation.",
      payload: projectDetailPayload,
      ...(storePayloads.script === undefined ? {} : { storePayload: storePayloads.script }),
    }),
    createMoyinScopedStoreGate({
      gateId: "project-sclass",
      storeName: "sclass",
      displayName: "S-Class",
      blockedSummary:
        "Moyin project has no S-Class scoped store; prepare S-Class state before execution.",
      payload: projectDetailPayload,
      ...(storePayloads.sclass === undefined ? {} : { storePayload: storePayloads.sclass }),
    }),
  ];
}

function createMoyinScopedStoreGate(input: {
  readonly gateId: "project-script" | "project-sclass";
  readonly storeName: "script" | "sclass";
  readonly displayName: string;
  readonly blockedSummary: string;
  readonly payload: Readonly<Record<string, unknown>> | undefined;
  readonly storePayload?: Readonly<Record<string, unknown>>;
  readonly storeRead?: ExternalToolInvokeResult;
}): MoyinProjectReadinessGate {
  const store = findMoyinScopedStore(input.payload, input.storeName);
  const sizeBytes = readRecordNumber(store, "sizeBytes");
  const hasUsableStore = store !== undefined && sizeBytes !== 0;
  const hardValidation =
    input.storeName === "script"
      ? validateMoyinScriptStore(input.storePayload)
      : validateMoyinSclassStore(input.storePayload);
  const storeReadFailed = input.storeRead !== undefined && !input.storeRead.ok;
  const status = hasUsableStore && hardValidation.passed && !storeReadFailed ? "passed" : "blocked";
  const readFailureSummary = `Moyin project ${input.displayName} scoped store content could not be read for hard validation.`;
  const hardFailureSummary = `Moyin project ${input.displayName} scoped store failed hard validation: ${hardValidation.blockers.join(", ")}.`;
  return {
    id: input.gateId,
    status,
    summary:
      status === "passed"
        ? `Moyin project ${input.displayName} scoped store passed hard validation.`
        : storeReadFailed
          ? readFailureSummary
          : hasUsableStore && input.storePayload !== undefined
            ? hardFailureSummary
            : input.blockedSummary,
    evidence: {
      storeName: input.storeName,
      present: store !== undefined,
      contentRead: input.storePayload !== undefined,
      ...(store === undefined ? {} : { store }),
      ...(sizeBytes === undefined ? {} : { sizeBytes }),
      ...(input.storeRead === undefined
        ? {}
        : {
            storeRead: {
              status: input.storeRead.status,
              operationId: input.storeRead.operationId,
              ok: input.storeRead.ok,
            },
          }),
      hardValidation,
      scopedStoreKeys: readMoyinScopedStoreKeys(input.payload),
    },
  };
}

function readMoyinProjectStoreReadRequired(gates: readonly MoyinProjectReadinessGate[]): boolean {
  return gates.some((gate) => {
    const evidence = isRecord(gate.evidence) ? gate.evidence : {};
    return (
      readRecordBoolean(evidence, "present") === true &&
      readRecordBoolean(evidence, "contentRead") !== true
    );
  });
}

function validateMoyinScriptStore(payload: Readonly<Record<string, unknown>> | undefined): Readonly<
  Record<string, unknown>
> & {
  readonly passed: boolean;
  readonly blockers: readonly string[];
} {
  const state = readMoyinStoreState(payload);
  const projectData = readRecord(state?.projectData);
  const parseStatus = readRecordString(projectData, "parseStatus");
  const episodeRawScriptCount = readRecordArray(projectData?.episodeRawScripts).length;
  const scriptData = readRecord(projectData?.scriptData);
  const scenes = readRecordArray(scriptData?.scenes);
  const sceneCount = scenes.length;
  const projectShots = readRecordArray(projectData?.shots);
  const sceneShotCount = scenes.reduce<number>(
    (total, scene) => total + readRecordArray(scene.shots).length,
    0,
  );
  const shotCount = projectShots.length > 0 ? projectShots.length : sceneShotCount;
  const blockers = [
    ...(parseStatus === "ready" ? [] : ["script.parseStatus_not_ready"]),
    ...(episodeRawScriptCount > 0 ? [] : ["script.episodeRawScripts_empty"]),
    ...(sceneCount > 0 ? [] : ["script.scenes_empty"]),
    ...(shotCount > 0 ? [] : ["script.shots_empty"]),
  ];
  return {
    passed: blockers.length === 0,
    blockers,
    parseStatus: parseStatus ?? null,
    episodeRawScriptCount,
    sceneCount,
    shotCount,
  };
}

function validateMoyinSclassStore(payload: Readonly<Record<string, unknown>> | undefined): Readonly<
  Record<string, unknown>
> & {
  readonly passed: boolean;
  readonly blockers: readonly string[];
} {
  const state = readMoyinStoreState(payload);
  const projectData = readRecord(state?.projectData);
  const splitSceneCount = readRecordArray(projectData?.splitScenes).length;
  const shotGroupCount = readRecordArray(projectData?.shotGroups).length;
  const sceneAnchorCount = readRecordArray(projectData?.sceneAnchors).length;
  const lastAdaptationSummary = readRecord(projectData?.lastAdaptationSummary);
  const profileSnapshot = readRecord(lastAdaptationSummary?.profileSnapshot);
  const adaptationProfile = readRecord(projectData?.adaptationProfile);
  const hasRhythmEngineProfile =
    readRecord(profileSnapshot?.rhythmEngine) !== undefined ||
    readRecord(adaptationProfile?.rhythmEngine) !== undefined;
  const blockers = [
    ...(splitSceneCount > 0 ? [] : ["sclass.splitScenes_empty"]),
    ...(shotGroupCount > 0 ? [] : ["sclass.shotGroups_empty"]),
    ...(sceneAnchorCount > 0 ? [] : ["sclass.sceneAnchors_empty"]),
    ...(hasRhythmEngineProfile ? [] : ["sclass.rhythmEngine_missing"]),
  ];
  return {
    passed: blockers.length === 0,
    blockers,
    splitSceneCount,
    shotGroupCount,
    sceneAnchorCount,
    hasRhythmEngineProfile,
  };
}

function readMoyinStoreState(
  payload: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  const state = readRecord(payload?.state);
  if (state !== undefined) {
    return state;
  }
  const nested = readRecord(payload?.output);
  return readRecord(nested?.state);
}

function createMoyinReadOnlyLedgerGate(
  gateId: "workflow-run" | "task-ledger" | "artifact-registry",
  displayName: string,
  result: ExternalToolInvokeResult,
  payload: Readonly<Record<string, unknown>> | undefined,
): MoyinProjectReadinessGate {
  const itemCount = readListTotal(payload) ?? countListItemsInValue(payload);
  return {
    id: gateId,
    status: result.ok ? "passed" : "blocked",
    summary: result.ok
      ? `${displayName} is readable (${itemCount} items).`
      : `${displayName} could not be read: ${result.content}`,
    evidence: {
      status: result.status,
      operationId: result.operationId,
      itemCount,
      statuses: countItemStatuses(payload),
    },
  };
}

function selectMoyinProject(
  requestedProjectId: string | undefined,
  payload: Readonly<Record<string, unknown>> | undefined,
): MoyinProjectReadinessProjectRef | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const items = Array.isArray(payload.items) ? payload.items.filter(isRecord) : [];
  if (requestedProjectId !== undefined) {
    const project = items.find((item) => readRecordString(item, "id") === requestedProjectId);
    return {
      projectId: requestedProjectId,
      source: "input-project",
      ...optionalStringField("name", readProjectName(project)),
    };
  }
  const activeProjectId = readRecordString(payload, "activeProjectId");
  if (activeProjectId === undefined) {
    return undefined;
  }
  const activeProject = items.find((item) => readRecordString(item, "id") === activeProjectId);
  return {
    projectId: activeProjectId,
    source: "active-project",
    ...optionalStringField("name", readProjectName(activeProject)),
  };
}

function readMoyinEnvelopePayload(output: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(output)) {
    return undefined;
  }
  const nested = output.output;
  return isRecord(nested) ? nested : output;
}

function readHandshakePayloads(
  handshakeOutput: Readonly<Record<string, unknown>> | undefined,
  capability: string,
): readonly unknown[] {
  if (!isRecord(handshakeOutput) || !Array.isArray(handshakeOutput.checks)) {
    return [];
  }
  return handshakeOutput.checks.flatMap((check) => {
    if (!isRecord(check) || check.capability !== capability) {
      return [];
    }
    return check.payload === undefined ? [] : [check.payload];
  });
}

function countListItems(values: readonly unknown[]): number {
  return values.reduce<number>((total, value) => total + countListItemsInValue(value), 0);
}

function countListItemsInValue(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }
  if (Array.isArray(value.items)) {
    return value.items.length;
  }
  if (Array.isArray(value.providers)) {
    return value.providers.length;
  }
  return 0;
}

function readListTotal(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return readRecordNumber(value, "total");
}

function countItemStatuses(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return {};
  }
  const counts = new Map<string, number>();
  for (const item of value.items.filter(isRecord)) {
    const status = readRecordString(item, "status");
    if (status !== undefined) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts);
}

function findMoyinScopedStore(
  value: Readonly<Record<string, unknown>> | undefined,
  storeName: "script" | "sclass",
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stores = Array.isArray(value.stores) ? value.stores.filter(isRecord) : [];
  const fromStoreRecords = stores.find((store) => {
    const explicitStoreName = readRecordString(store, "storeName");
    if (explicitStoreName === storeName) {
      return true;
    }
    const key = readRecordString(store, "key");
    return key === storeName || key?.endsWith(`/${storeName}`) === true;
  });
  if (fromStoreRecords !== undefined) {
    return fromStoreRecords;
  }
  return readMoyinScopedStoreKeys(value).some(
    (key) => key === storeName || key.endsWith(`/${storeName}`),
  )
    ? { storeName }
    : undefined;
}

function readMoyinScopedStoreKeys(
  value: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  if (!isRecord(value)) {
    return [];
  }
  const directKeys = Array.isArray(value.scopedStoreKeys)
    ? value.scopedStoreKeys
        .map(readNonEmptyString)
        .filter((key): key is string => key !== undefined)
    : [];
  const storeKeys = Array.isArray(value.stores)
    ? value.stores
        .filter(isRecord)
        .map((store) => readRecordString(store, "key"))
        .filter((key): key is string => key !== undefined)
    : [];
  return [...new Set([...directKeys, ...storeKeys])].sort();
}

function containsRecordValue(value: unknown, key: string, expected: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsRecordValue(item, key, expected));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (value[key] === expected) {
    return true;
  }
  return Object.values(value).some((child) => containsRecordValue(child, key, expected));
}

function readProjectName(value: unknown): string | undefined {
  return isRecord(value) ? readRecordString(value, "name") : undefined;
}

function optionalStringField(key: string, value: unknown): Record<string, string> {
  const text = readNonEmptyString(value);
  return text === undefined ? {} : { [key]: text };
}

function readRecordString(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  return readNonEmptyString(value?.[key]);
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

function readRecordArray(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readRecordNumber(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const raw = value?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readRecordBoolean(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean | undefined {
  const raw = value?.[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
