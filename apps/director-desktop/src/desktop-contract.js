export const DESKTOP_ACTIONS = Object.freeze({
  DESKTOP_PICK_DIRECTORY: "desktop.pickDirectory",
  SNAPSHOT: "desktop.snapshot",
  COMMAND_CATALOG: "command.catalog",
  COMMAND_RUN: "command.run",
  COMPOSER_SUBMIT: "composer.submit",
  COMPOSER_CANCEL: "composer.cancel",
  COMPOSER_RESET: "composer.reset",
  COMPOSER_SESSION_DELETE: "composer.sessionDelete",
  SETTINGS_SET: "settings.set",
  COST_BUDGET_SET: "costBudget.set",
  WEIXIN_GATEWAY_CONTROL: "weixinGateway.control",
  WEIXIN_GATEWAY_ACCOUNT_SELECT: "weixinGateway.accountSelect",
  WEIXIN_GATEWAY_LOGIN_START: "weixinGateway.loginStart",
  WEIXIN_GATEWAY_LOGIN_POLL: "weixinGateway.loginPoll",
  MCP_SERVER_UPSERT: "mcp.serverUpsert",
  MCP_SERVER_DELETE: "mcp.serverDelete",
  MCP_SERVER_TEST: "mcp.serverTest",
  MCP_SERVER_TOOL_SELECTION_SET: "mcp.serverToolSelectionSet",
  MCP_REFRESH: "mcp.refresh",
  MCP_LOGIN: "mcp.login",
  MCP_REVOKE: "mcp.revoke",
  API_PROVIDER_SET: "apiProvider.set",
  API_PROVIDER_SYNC_MODELS: "apiProvider.syncModels",
  API_PROVIDER_TEST: "apiProvider.test",
  API_PROVIDER_TEXT: "apiProvider.text",
  API_PROVIDER_IMAGE: "apiProvider.image",
  API_PROVIDER_VIDEO: "apiProvider.video",
  LIVE_RUNNER_LIST: "liveRunner.list",
  LIVE_RUNNER_READ: "liveRunner.read",
  LIVE_RUNNER_CANCEL: "liveRunner.cancel",
  LIVE_AUDIO_START: "liveAudio.start",
  LIVE_AUDIO_STOP: "liveAudio.stop",
  LIVE_AUDIO_CANCEL: "liveAudio.cancel",
  LIVE_AUDIO_STATUS: "liveAudio.status",
  TASK_RUNTIME_LIST: "taskRuntime.list",
  TASK_RUNTIME_READ: "taskRuntime.read",
  TASK_RUNTIME_CANCEL: "taskRuntime.cancel",
  CLIENT_RUNTIME_LIST: "clientRuntime.list",
  CLIENT_RUNTIME_READ: "clientRuntime.read",
  CLIENT_RUNTIME_STOP: "clientRuntime.stop",
  CLIENT_RUNTIME_FOLLOWUP: "clientRuntime.followup",
  CLIENT_RUNTIME_STEER: "clientRuntime.steer",
  RUNTIME_TOOL_APPROVAL_DECIDE: "runtimeToolApproval.decide",
  EXTERNAL_TOOL_MANAGE: "externalTool.manage",
  COMFYUI_SET: "comfyui.set",
  COMFYUI_TEST: "comfyui.test",
  COMFYUI_OPEN: "comfyui.open",
  COMFYUI_CREATE_WORKFLOW: "comfyui.createWorkflow",
  COMFYUI_RUN: "comfyui.run",
  COMFYUI_LIFECYCLE: "comfyui.lifecycle",
  COMFYUI_FIX_DEPENDENCIES: "comfyui.fixDependencies",
  DIRECTOR_PLAN: "director.plan",
  DIRECTOR_PLAN_ACCEPT: "director.planAccept",
  DIRECTOR_PLAN_IGNORE: "director.planIgnore",
  DIRECTOR_PLAN_RERUN: "director.planRerun",
  PRODUCTION_START: "production.start",
  EXPERIENCE_LEARN_DIRECTORY: "experience.learnDirectory",
  EXPERIENCE_LEARN_QUERY: "experience.learnQuery",
  EXPERIENCE_LEARN_URL: "experience.learnUrl",
  EXPERIENCE_LEARN_TEXT: "experience.learnText",
  LEARNING_MEDIA_UNDERSTAND: "learning.mediaUnderstand",
  EXPERIENCE_LIST: "experience.list",
  EXPERIENCE_UPDATE: "experience.update",
  EXPERIENCE_ACCEPT: "experience.accept",
  EXPERIENCE_REJECT: "experience.reject",
  EXPERIENCE_PROMOTE: "experience.promote",
  EXPERIENCE_CREATE_FROM_RUN_REPORT: "experience.createFromRunReport",
  EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL: "experience.createFromTraceProposal",
  EXPERIENCE_CLASSIFICATION_SAVE: "experience.classificationSave",
  EXPERIENCE_CATEGORY_CREATE: "experience.categoryCreate",
  EXPERIENCE_TAG_CREATE: "experience.tagCreate",
  SKILL_CLASSIFICATION_SAVE: "skill.classificationSave",
  SKILL_CATEGORY_CREATE: "skill.categoryCreate",
  SKILL_TAG_CREATE: "skill.tagCreate",
  SKILL_ENABLEMENT_SET: "skill.enablementSet",
  SKILL_UPDATE: "skill.update",
  SKILL_DELETE: "skill.delete",
  SKILL_CURATOR_REFRESH: "skill.curatorRefresh",
  SKILL_CURATOR_MARK_PATCHED: "skill.curatorMarkPatched",
  SKILL_CURATOR_APPLY_PATCH: "skill.curatorApplyPatch",
  SKILL_CURATOR_ARCHIVE: "skill.curatorArchive",
  SKILL_CURATOR_MERGE: "skill.curatorMerge",
  SKILL_PROPOSE_FROM_EXPERIENCE: "skill.proposeFromExperience",
  SKILL_PROPOSAL_ACCEPT: "skill.proposalAccept",
  SKILL_PROPOSAL_REJECT: "skill.proposalReject",
  SKILL_PROPOSAL_APPLY: "skill.proposalApply",
  KNOWLEDGE_CANDIDATE_LIST: "knowledge.candidateList",
  KNOWLEDGE_ACCEPT: "knowledge.accept",
  KNOWLEDGE_PUBLISH: "knowledge.publish",
  KNOWLEDGE_RECALL_PREVIEW: "knowledge.recallPreview",
  MEMPALACE_SOURCE_READ: "mempalace.sourceRead",
  RUN_CONTINUE: "run.continue",
  RUN_DELEGATIONS: "run.delegations",
  RUN_SCHEDULER_EXECUTOR: "run.schedulerExecutor",
  RUN_SCHEDULER_RECOVERY: "run.schedulerRecovery",
  RUN_REFLECT: "run.reflect",
  RUN_APPROVE_ASSIGNMENT: "run.approveAssignment",
  RUN_APPROVE_PENDING_ASSIGNMENTS: "run.approvePendingAssignments",
  MAINTENANCE_PREVIEW: "maintenance.preview",
  MAINTENANCE_APPLY: "maintenance.apply",
  SOUL_LIST: "soul.list",
  SOUL_EXPLAIN: "soul.explain",
  SOUL_ACCEPT: "soul.accept",
  SOUL_REJECT: "soul.reject",
  SOUL_VIEW: "soul.view",
  HEARTBEAT_STATUS: "heartbeat.status",
  SELF_REFLECTION_DAILY: "selfReflection.daily",
});

export const DESKTOP_PANELS = Object.freeze({
  PLAN: "state",
  EXPERIENCE: "state",
  RESULT: "result",
  RECALL: "recall",
});

export const DESKTOP_TOOLS = Object.freeze({
  LEARN_DIRECTORY: "learn-directory",
  LEARN_QUERY: "learn-query",
  REVIEW_CANDIDATE: "review-candidate",
  RUNTIME_RECALL: "runtime-recall",
});

export const DESKTOP_EVENT_ROLES = Object.freeze({
  USER: "user",
  ANGEL: "angel",
  SYSTEM: "system",
});

export const DESKTOP_HEALTH_STATES = Object.freeze({
  OK: "ok",
  WARNING: "warning",
  ERROR: "error",
});

const KNOWN_ACTIONS = new Set(Object.values(DESKTOP_ACTIONS));

export function assertDesktopAction(action) {
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    throw new Error("Director desktop action must be an object.");
  }
  if (!KNOWN_ACTIONS.has(action.type)) {
    throw new Error(`Unsupported Director desktop action type: ${String(action.type)}`);
  }
}

export function resolveComposerToolAction(tool) {
  switch (tool) {
    case DESKTOP_TOOLS.LEARN_DIRECTORY:
      return DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY;
    case DESKTOP_TOOLS.LEARN_QUERY:
      return DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY;
    case DESKTOP_TOOLS.REVIEW_CANDIDATE:
      return DESKTOP_ACTIONS.EXPERIENCE_LIST;
    case DESKTOP_TOOLS.RUNTIME_RECALL:
      return DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW;
    default:
      throw new Error(`Unsupported Director desktop tool id: ${String(tool)}`);
  }
}
