import { createDirectorAngelBridgeClient } from "./bridge-client.js";
import { createDesktopAppState } from "./controllers/state.js";
import { DESKTOP_ACTIONS, DESKTOP_EVENT_ROLES, DESKTOP_HEALTH_STATES } from "./desktop-contract.js";
import { resolveWorkflowIdForCommandSelection } from "./desktop-workflow-selection.js";
import { createDirectorConsolePanel } from "./ui/director-console.js";
import {
  createEvidenceDisclosureDetails,
  resolveMediaAuthorizationActionPayload,
} from "./ui/evidence.js";
import {
  createExperienceLibraryLayout,
  createExperienceLibraryToolbar,
} from "./ui/experience-library.js";
import {
  createThinkingIndicator,
  createTimelineStreamingMarkdownFrame,
  createTimelineTextChunks,
  renderTimelineStreamingMarkdownFrame,
  resolveTimelineStreamDelay,
  setTimelineMessageBodyText,
} from "./ui/timeline.js";
import {
  addComposerAttachment,
  createComposerAttachmentsFromFiles,
  createComposerAttachmentsFromPastedFiles,
  insertComposerNewline,
  looksLikeDroppedPath,
  removeComposerAttachment,
  resolveComposerKeyAction,
} from "./ui/composer-state.js";
import {
  discardDesktopAttachmentDataUrls,
  materializeDesktopAttachmentPayloads,
  registerDesktopAttachmentPayload,
  releaseDesktopAttachmentPayloads,
} from "./ui/attachment-payload-store.js";
import {
  createDesktopChatSession,
  deleteDesktopChatSession,
  ensureDesktopChatSessions,
  reconcileDesktopChatRunLifecycle,
  flushDesktopChatQueue,
  handleDesktopChatSubmit,
  renameDesktopChatSession,
  selectDesktopChatSession,
  updateDesktopChatSessionFromPrompt,
} from "./ui/chat.js";
import {
  applyDesktopUiPersistenceSnapshot,
  createDesktopUiPersistenceSnapshot,
} from "./ui/persistence.js";
import {
  createRunCenterRenderScheduler,
  createRunCenterTaskRow,
  createRunCenterToastState,
  formatTaskRuntimeStatus,
  updateRunCenterToastStateFromTasks,
} from "./ui/run-center.js";

let bridge = null;
const state = createDesktopAppState();
state.taskRuntime.toastState = createRunCenterToastState();
state.taskRuntime.renderScheduler = createRunCenterRenderScheduler(() => {
  tryRenderRunCenter();
});

const SETTINGS_TABS = Object.freeze([
  { id: "api", label: "API 管理" },
  { id: "models", label: "模型绑定" },
  { id: "externalTools", label: "外部工具" },
  { id: "guardrails", label: "护栏预算" },
  { id: "communications", label: "通信网关" },
  { id: "switches", label: "功能开关" },
  { id: "paths", label: "存储路径" },
  { id: "diagnostics", label: "诊断" },
]);

const COMPOSER_STOP_CLICK_GRACE_MS = 1200;
const COMPOSER_BRIDGE_TIMEOUT_MS = 180_000;
const COMPOSER_BRIDGE_WAITING_NOTICE_MS = 20_000;
const DESKTOP_SESSION_TRANSCRIPT_LIMIT = 80;
const DESKTOP_SESSION_TRANSCRIPT_BODY_LIMIT = 12000;
const COMPOSER_BRIDGE_WATCHDOG_TIMEOUT_MS = 75_000;
const STALE_STREAMING_TIMELINE_TIMEOUT_MS = 90_000;
const TASK_RUNTIME_REFRESH_TIMEOUT_MS = 5_000;
const TASK_RUNTIME_POLL_INTERVAL_MS = 3_000;
const TASK_RUNTIME_ACTIVE_STATUSES = new Set(["pending", "queued", "running", "retry_wait"]);
const TASK_RUNTIME_PROBLEM_STATUSES = new Set(["failed", "interrupted", "cancelled", "needs_attention"]);
const TASK_RUNTIME_HISTORY_LIMIT = 80;
const UI_STATE_PERSIST_DEBOUNCE_MS = 250;
const MEMEFAST_RECOMMENDED_PURCHASE_URL = "https://memefast.top/";

const ASSET_WORKFLOW_IDS = new Set(["experience", "skills", "tools", "review"]);
const SNAPSHOT_QUICK_ACTION_LIMITS = Object.freeze({
  experience: 10,
  knowledge: 6,
  skillProposals: 8,
  skills: 32,
  tools: 10,
});

const WORKFLOWS = Object.freeze([
  {
    id: "workbench",
    glyph: "W",
    label: "工作台",
    domain: "Workbench",
    title: "Angel 工作台",
    objective: "底部输入框是唯一执行入口；中间栏只展示真实命令目录中的常用能力。",
    commandIds: [
      "production.start",
      "workspace.status",
      "workspace.doctor",
      "workspace.runtime",
      "heartbeat.status",
      "apiProvider.image",
      "apiProvider.video",
    ],
  },
  {
    id: "experience",
    glyph: "E",
    label: "经验库",
    domain: "Experience",
    title: "经验库",
    objective: "学习到的经验按来源和状态归档，审查后才能发布成可召回知识。",
    commandIds: [
      "learning.directory",
      "learning.query",
      "learning.url",
      "learning.text",
      "experience.list",
      "experience.accept",
      "experience.reject",
      "experience.promote",
      "knowledge.candidates",
      "knowledge.accept",
      "knowledge.publish",
      "knowledge.recallPreview",
    ],
  },
  {
    id: "skills",
    glyph: "S",
    label: "Skills",
    domain: "Skills",
    title: "Skills",
    objective: "区分 Angel 自己进化的 Skill 与外部导入 Skill，并进入审查门禁。",
    commandIds: [
      "task.proposalList",
      "task.proposal-get",
      "task.proposal-review",
      "task.proposal-accept",
      "task.proposal-reject",
      "task.proposal-explain",
      "task.proposal-preview",
      "task.proposal-apply",
      "task.proposalRollback",
    ],
  },
  {
    id: "tools",
    glyph: "T",
    label: "外部工具",
    domain: "Tools",
    title: "外部工具",
    objective: "集中管理外部 CLI、软件和平台适配器，后续用于制作执行。",
    commandIds: [
      "adapter.list",
      "adapter.register",
      "adapter.enable",
      "adapter.disable",
      "adapter.explain",
      "platform.capabilities",
    ],
  },
  {
    id: "review",
    glyph: "R",
    label: "运行与审查",
    domain: "Review",
    title: "运行与审查",
    objective: "集中处理运行状态、失败重试、提案审查和人工确认。",
    commandIds: [
      "traceProposal.status",
      "traceProposal.list",
      "traceProposal.explain",
      "traceProposal.review",
      "traceProposal.preview",
      "traceProposal.accept",
      "traceProposal.reject",
      "traceProposal.replay",
      "task.proposalList",
      "task.proposal-apply",
      "run.status",
      "run.start",
      "run.once",
      "run.pause",
      "run.resume",
      "run.abort",
      "run.audit",
      "run.explain",
      "run.retry",
      "run.approve",
      "run.approvePending",
      "run.reroute",
      "run.report",
    ],
  },
  {
    id: "settings",
    glyph: "G",
    label: "设置",
    domain: "Settings",
    title: "设置",
    objective: "集中查看数据目录、功能开关、诊断状态和记忆控制。",
    commandIds: [
      "workspace.switches",
      "settings.set",
      "apiProvider.set",
      "apiProvider.syncModels",
      "workspace.doctor",
      "workspace.status",
      "workspace.runtime",
      "memory.status",
      "gateway.weixin.status",
      "gateway.weixin.start",
      "control.memoryInspect",
      "control.memoryClear",
    ],
  },
]);

const elements = {
  desktopShell: document.querySelector(".desktop-shell"),
  workbenchSurface: document.querySelector(".workbench"),
  commandGroups: document.getElementById("command-groups"),
  commandBoard: document.querySelector(".command-board"),
  commandList: document.getElementById("command-list"),
  commandCount: document.getElementById("command-count"),
  commandBoardTitle: document.getElementById("command-board-title"),
  activeGroupDomain: document.getElementById("active-group-domain"),
  activeGroupTitle: document.getElementById("active-group-title"),
  groupCount: document.getElementById("group-count"),
  sessionList: document.getElementById("session-list"),
  newSession: document.getElementById("new-session"),
  statusCount: document.getElementById("status-count"),
  statusList: document.getElementById("status-list"),
  timeline: document.getElementById("timeline"),
  runCenter: document.getElementById("run-center"),
  directorConsole: document.getElementById("director-console"),
  runCenterList: document.getElementById("run-center-list"),
  runCenterTabs: Array.from(document.querySelectorAll("[data-run-center-panel]")),
  runCenterActiveCount: document.querySelector('[data-run-center-count="active"]'),
  runCenterProblemCount: document.querySelector('[data-run-center-count="problem"]'),
  composer: document.querySelector(".composer"),
  composerAttachments: document.getElementById("composer-attachments"),
  angelInput: document.getElementById("angel-input"),
  runImage: document.getElementById("run-image"),
  runVideo: document.getElementById("run-video"),
  liveAudioToggle: document.getElementById("live-audio-toggle"),
  liveAudioStatus: document.getElementById("live-audio-status"),
  runCommand: document.getElementById("run-command"),
  pickDirectory: document.getElementById("pick-directory"),
  refreshSnapshot: document.getElementById("refresh-snapshot"),
  refreshCatalog: document.getElementById("refresh-catalog"),
  quickActions: document.getElementById("quick-actions"),
  workspacePath: document.getElementById("workspace-path"),
  healthPill: document.getElementById("health-pill"),
  selectedCommand: document.getElementById("selected-command"),
  argForm: document.getElementById("arg-form"),
  inspectorTabs: Array.from(document.querySelectorAll(".inspector-tab")),
  inspectorPanels: Array.from(document.querySelectorAll(".inspector-panel")),
  candidateCount: document.getElementById("candidate-count"),
  knowledgeCount: document.getElementById("knowledge-count"),
  recallState: document.getElementById("recall-state"),
  candidateState: document.getElementById("candidate-state"),
  knowledgeState: document.getElementById("knowledge-state"),
  backgroundLearningList: document.getElementById("background-learning-list"),
  experienceList: document.getElementById("experience-list"),
  knowledgeList: document.getElementById("knowledge-list"),
  skillList: document.getElementById("skill-list"),
  toolList: document.getElementById("tool-list"),
  settingsList: document.getElementById("settings-list"),
  recallList: document.getElementById("recall-list"),
  resultOutput: document.getElementById("result-output"),
  operatorTraceOutput: document.getElementById("operator-trace-output"),
};

installEventHandlers();
bridge = createBridge();
await initialize();

function createBridge() {
  try {
    return createDirectorAngelBridgeClient({ mode: "native" });
  } catch (error) {
    renderFatalError(error);
    return null;
  }
}

function installEventHandlers() {
  installGlobalKeyboardShortcuts();
  elements.refreshSnapshot?.addEventListener("click", async () => {
    await refreshSnapshot();
  });
  elements.refreshCatalog?.addEventListener("click", async () => {
    await loadCatalog();
  });
  elements.runCommand?.addEventListener("pointerdown", () => {
    if (state.running || state.activeComposerTurn) {
      state.composerStopClickArmedUntilMs = Date.now() + COMPOSER_STOP_CLICK_GRACE_MS;
    }
  });
  elements.runCommand?.addEventListener("click", async () => {
    await submitComposer();
  });
  elements.runImage?.addEventListener("click", async () => {
    await submitImageComposer();
  });
  elements.runVideo?.addEventListener("click", async () => {
    await submitVideoComposer();
  });
  elements.liveAudioToggle?.addEventListener("click", async () => {
    await toggleLiveAudio();
  });
  elements.argForm?.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  elements.pickDirectory?.addEventListener("click", async () => {
    await pickLearningSource();
  });
  elements.composer?.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.files?.length) {
      event.preventDefault();
      elements.composer.classList.add("drag-over");
    }
  });
  elements.composer?.addEventListener("dragleave", () => {
    elements.composer.classList.remove("drag-over");
  });
  elements.composer?.addEventListener("drop", (event) => {
    void handleComposerDrop(event);
  });
  elements.angelInput?.addEventListener("paste", (event) => {
    void handleComposerPaste(event);
  });
  elements.composerAttachments?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const removeButton = target?.closest("[data-composer-attachment-remove]");
    if (removeButton?.dataset.composerAttachmentRemove) {
      removeComposerAttachmentById(removeButton.dataset.composerAttachmentRemove);
    }
  });
  elements.newSession?.addEventListener("click", () => {
    createDesktopSession();
  });
  elements.sessionList?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    const renameButton = target.closest("[data-desktop-session-rename]");
    if (renameButton?.dataset.desktopSessionRename) {
      event.stopPropagation();
      renameDesktopSession(renameButton.dataset.desktopSessionRename);
      return;
    }
    const closeButton = target.closest("[data-desktop-session-close]");
    if (closeButton?.dataset.desktopSessionClose) {
      event.stopPropagation();
      closeDesktopSession(closeButton.dataset.desktopSessionClose).catch((error) => {
        reportNonFatalUiError(error, "关闭桌面会话失败");
      });
      return;
    }
    const sessionButton = target.closest("[data-desktop-session-key]");
    const sessionKey = sessionButton?.dataset.desktopSessionKey;
    if (sessionKey) {
      selectDesktopSession(sessionKey);
    }
  });
  elements.angelInput?.addEventListener("keydown", async (event) => {
    if (event.key === "Escape" && state.quickActionsOpen) {
      state.quickActionsOpen = false;
      renderQuickActions();
      return;
    }
    if (handleComposerHistoryNavigation(event)) {
      return;
    }
    const composerAction = resolveComposerKeyAction(event);
    if (composerAction === "ignore") {
      return;
    }
    event.preventDefault();
    if (composerAction === "newline") {
      const input = elements.angelInput;
      if (!input) {
        return;
      }
      const next = insertComposerNewline(input.value, input.selectionStart, input.selectionEnd);
      setInputValue(next.value);
      input.setSelectionRange(next.cursor, next.cursor);
      return;
    }
    if (composerAction === "submit") {
      await submitComposer();
    }
  });
  elements.angelInput?.addEventListener("input", () => {
    syncComposerStateFromInput();
    syncQuickActionsFromComposerInput();
  });
  elements.angelInput?.addEventListener("change", () => {
    maybeAttachComposerPath(elements.angelInput?.value ?? "");
  });
  elements.quickActions?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    event.stopPropagation();
    const toggleButton = target.closest("[data-slash-command-toggle]");
    if (toggleButton) {
      state.quickActionsOpen = !state.quickActionsOpen;
      renderQuickActions();
      return;
    }
    const commandButton = target.closest("[data-quick-action-index]");
    if (!commandButton?.dataset.quickActionIndex) {
      return;
    }
    const actionIndex = Number(commandButton.dataset.quickActionIndex);
    const action = getQuickActionsForSurface(getActiveWorkflow()?.id)[actionIndex];
    if (!action) {
      return;
    }
    applyQuickAction(action);
  });
  for (const tab of elements.runCenterTabs) {
    tab.addEventListener("click", () => {
      state.taskRuntime.activePanel = tab.dataset.runCenterPanel ?? "active";
      scheduleRunCenterRender({ force: true });
      persistDesktopUiState();
    });
  }
  elements.runCenterList?.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    const pointerCopyButton = target.closest("[data-run-center-pointer-copy]");
    if (pointerCopyButton?.dataset.runCenterPointerCopy) {
      await copyRunCenterPointer(pointerCopyButton.dataset.runCenterPointerCopy);
      return;
    }
    const pointerOpenButton = target.closest("[data-run-center-pointer-open]");
    if (pointerOpenButton?.dataset.runCenterPointerOpen) {
      await openRunCenterPointerSource(pointerOpenButton.dataset.runCenterPointerOpen);
      return;
    }
    const cancelButton = target.closest("[data-task-cancel]");
    if (cancelButton?.dataset.taskCancel) {
      await cancelTaskRuntimeTask(cancelButton.dataset.taskCancel, "operator cancelled via run center");
      return;
    }
    const retryButton = target.closest("[data-task-retry]");
    if (retryButton?.dataset.taskRetry) {
      await retryRunCenterTask(retryButton.dataset.taskRetry);
      return;
    }
    const readButton = target.closest("[data-task-read]");
    if (readButton?.dataset.taskRead) {
      await readTaskRuntimeTask(readButton.dataset.taskRead);
    }
  });
  elements.directorConsole?.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-director-console-action]");
    if (!button?.dataset.directorConsoleAction) {
      return;
    }
    const action = createDirectorConsoleDecisionAction(button.dataset.directorConsoleAction);
    if (action === null) {
      return;
    }
    await executeAssetAction(action, button, button.textContent || "执行");
  });
  document.addEventListener("click", (event) => {
    if (!state.quickActionsOpen || !elements.quickActions) {
      return;
    }
    if (event.target instanceof Node && elements.quickActions.contains(event.target)) {
      return;
    }
    state.quickActionsOpen = false;
    renderQuickActions();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.quickActionsOpen) {
      return;
    }
    state.quickActionsOpen = false;
    renderQuickActions();
    elements.angelInput?.focus();
  });
  elements.commandGroups?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-group-id]");
    if (!button) {
      return;
    }
    selectGroup(button.dataset.groupId);
  });
  elements.commandList?.addEventListener("click", (event) => {
    const workbenchPromptButton = event.target.closest("[data-workbench-prompt]");
    if (workbenchPromptButton?.dataset.workbenchPrompt !== undefined) {
      openWorkbenchPrompt(workbenchPromptButton.dataset.workbenchPrompt);
      return;
    }
    const button = event.target.closest("[data-command-id]");
    const assetButton = event.target.closest("[data-asset-id]");
    const promptButton = event.target.closest("[data-prompt]");
    if (isWorkbenchActive() && promptButton?.dataset.prompt !== undefined) {
      setInputValue(promptButton.dataset.prompt);
      elements.angelInput?.focus();
      return;
    }
    if (assetButton) {
      selectAssetDetail(assetButton.dataset.assetSurface, assetButton.dataset.assetId);
      return;
    }
    if (!button) {
      return;
    }
    selectCommand(button.dataset.commandId);
  });
  for (const tab of elements.inspectorTabs) {
    tab.addEventListener("click", () => {
      selectInspectorPanel(tab.dataset.panel);
    });
  }
  elements.experienceList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-candidate-id]");
    if (!row) {
      return;
    }
    selectExperienceAction(row.dataset.candidateId, row.dataset.status);
  });
  elements.knowledgeList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-knowledge-id]");
    if (!row) {
      return;
    }
    selectKnowledgeAction(row.dataset.knowledgeId, row.dataset.status);
  });
  elements.settingsList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-setting-id]");
    if (!row) {
      return;
    }
    selectAssetDetail("settings", row.dataset.settingId);
  });
  elements.skillList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-skill-id]");
    if (!row) {
      return;
    }
    selectAssetDetail("skills", row.dataset.skillId);
  });
  elements.toolList?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-tool-id]");
    if (!row) {
      return;
    }
    selectAssetDetail("tools", row.dataset.toolId);
  });
}

function installGlobalKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    handleGlobalKeyboardShortcut(event);
  });
}

function handleGlobalKeyboardShortcut(event) {
  if (event.key === "Escape") {
    if (state.running || state.activeComposerTurn) {
      event.preventDefault();
      requestStopActiveComposerTurn();
      return;
    }
    if (state.quickActionsOpen) {
      event.preventDefault();
      state.quickActionsOpen = false;
      renderQuickActions();
      focusComposerInput();
    }
    return;
  }
  if (!isSystemShortcutEvent(event)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "k") {
    event.preventDefault();
    focusComposerInput();
    return;
  }
  if (event.key === ",") {
    event.preventDefault();
    openSettingsSurface();
    return;
  }
  const workflowIndex = Number.parseInt(event.key, 10);
  if (Number.isInteger(workflowIndex) && workflowIndex >= 1 && workflowIndex <= WORKFLOWS.length) {
    event.preventDefault();
    selectWorkflowByKeyboardIndex(workflowIndex - 1);
  }
}

function isSystemShortcutEvent(event) {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

function focusComposerInput() {
  if (!isWorkbenchActive()) {
    selectGroup("workbench");
  }
  elements.angelInput?.focus();
}

function openSettingsSurface() {
  selectGroup("settings");
}

function selectWorkflowByKeyboardIndex(index) {
  const workflow = WORKFLOWS[index];
  if (!workflow) {
    return;
  }
  selectGroup(workflow.id);
}

async function initialize() {
  renderQuickActions();
  if (!bridge) {
    setControlsDisabled(true);
    return;
  }
  installBridgeEventHandlers();
  startStaleTimelineMonitor();
  setControlsDisabled(false);
  await loadCatalog();
  await hydrateDesktopUiState();
  await refreshSnapshot();
  await refreshTaskRuntime({ activeOnly: false });
  await refreshLiveAudioStatus({ silent: true });
  renderDirectorConsole();
  renderDesktopSessions();
  const restoredTranscript = renderActiveDesktopSessionTranscript();
  if (!restoredTranscript) {
    appendTimelineMessage({
      role: DESKTOP_EVENT_ROLES.SYSTEM,
      title: "本机运行服务已连接",
      body: "当前桌面端只执行本地真实 action 或命令目录中的 CLI 命令。",
    });
  }
}

async function hydrateDesktopUiState() {
  if (!bridge?.uiState?.read) {
    return false;
  }
  try {
    const snapshot = await bridge.uiState.read();
    const applied = applyDesktopUiPersistenceSnapshot(state, snapshot);
    state.uiStateHydrated = true;
    if (applied) {
      setInputValue(state.chat.composer.input, { persist: false });
      scheduleRunCenterRender({ force: true });
      renderDesktopSessions();
    }
    return applied;
  } catch (error) {
    reportNonFatalUiError(error, "桌面 UI 状态恢复失败");
    return false;
  }
}

function persistDesktopUiState() {
  if (!state.uiStateHydrated || !bridge?.uiState?.write) {
    return;
  }
  if (state.uiStatePersistTimerId !== null) {
    window.clearTimeout(state.uiStatePersistTimerId);
  }
  state.uiStatePersistTimerId = window.setTimeout(() => {
    state.uiStatePersistTimerId = null;
    void flushDesktopUiState();
  }, UI_STATE_PERSIST_DEBOUNCE_MS);
}

async function flushDesktopUiState() {
  if (!bridge?.uiState?.write) {
    return;
  }
  if (state.uiStatePersisting) {
    state.uiStatePersistAgain = true;
    return;
  }
  state.uiStatePersisting = true;
  try {
    await bridge.uiState.write(createDesktopUiPersistenceSnapshot(state));
  } catch (error) {
    reportNonFatalUiError(error, "桌面 UI 状态保存失败");
  } finally {
    state.uiStatePersisting = false;
    if (state.uiStatePersistAgain) {
      state.uiStatePersistAgain = false;
      persistDesktopUiState();
    }
  }
}

async function loadCatalog() {
  const result = await invokeBridge({ type: DESKTOP_ACTIONS.COMMAND_CATALOG });
  if (!result?.catalog) {
    return;
  }
  state.catalog = result.catalog;
  state.selectedGroupId ??= "workbench";
  applyInitialSurfaceFromLocation();
  state.selectedCommandId ??=
    resolveRecommendedCommandId() ?? getWorkflowCommands(getActiveWorkflow())[0]?.id ?? null;
  renderCatalog();
  renderSelectedCommand();
}

function applyInitialSurfaceFromLocation() {
  const surfaceId = new URLSearchParams(window.location.search).get("surface");
  if (!surfaceId || !WORKFLOWS.some((workflow) => workflow.id === surfaceId)) {
    return;
  }
  state.selectedGroupId = surfaceId;
  state.selectedCommandId = null;
  state.selectedAsset = null;
}

async function refreshSnapshot() {
  const result = await invokeBridge({ type: DESKTOP_ACTIONS.SNAPSHOT });
  if (result?.snapshot) {
    renderSnapshot(result.snapshot);
  }
}

async function refreshTaskRuntime(options = {}) {
  if (state.taskRuntime.refreshPromise) {
    return state.taskRuntime.refreshPromise;
  }
  const action = {
    type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
    activeOnly: options.activeOnly === true,
  };
  state.taskRuntime.refreshLastStartedAt = Date.now();
  state.taskRuntime.refreshPromise = (async () => {
    const result =
      options.timeoutMs === null
        ? await invokeBridge(action)
        : await invokeBridgeWithTimeout(action, {
            timeoutMs: options.timeoutMs ?? TASK_RUNTIME_REFRESH_TIMEOUT_MS,
            timeoutMessage: "任务运行中心刷新超时，已跳过本次刷新。",
            silentTimeout: true,
          });
    if (result?.taskRuntime) {
      applyTaskRuntimeSnapshot(result.taskRuntime);
    } else if (result?.snapshot?.assets?.tools?.taskRuntime) {
      applyTaskRuntimeSnapshot(result.snapshot.assets.tools.taskRuntime);
    }
    return result?.taskRuntime ?? null;
  })();
  try {
    return await state.taskRuntime.refreshPromise;
  } finally {
    state.taskRuntime.refreshPromise = null;
    state.taskRuntime.refreshLastCompletedAt = Date.now();
  }
}

function applyTaskRuntimeSnapshot(taskRuntime) {
  const tasks = Array.isArray(taskRuntime?.tasks)
    ? taskRuntime.tasks.map(normalizeTaskRuntimeTask).filter(shouldKeepIncomingTaskRuntimeTask)
    : [];
  reconcileActiveComposerTurnFromTaskRuntime(tasks);
  state.taskRuntime.tasks = pruneTaskRuntimeHistory(mergeOptimisticTaskRuntimeTasks(tasks));
  state.taskRuntime.lastUpdatedAt = Date.now();
  resumeTaskRuntimePollingForActiveBackendTasks();
  scheduleRunCenterRender();
  persistDesktopUiState();
}

function shouldKeepIncomingTaskRuntimeTask(task) {
  const turnId = resolveTaskRuntimeComposerTurnId(task);
  return !(
    turnId &&
    state.taskRuntime.completedComposerTurns.has(turnId) &&
    isTaskRuntimeActive(task)
  );
}

function reconcileActiveComposerTurnFromTaskRuntime(tasks) {
  const activeTurn = state.activeComposerTurn;
  if (!activeTurn || activeTurn.stopped === true) {
    return;
  }
  const expectedTaskId = activeTurn.activeTaskId ?? createOptimisticComposerTaskId(activeTurn.turnId);
  const matchingTask = tasks.find(
    (task) =>
      !isTaskRuntimeActive(task) &&
      (task.id === expectedTaskId ||
        task.payload?.turnId === activeTurn.turnId ||
        task.externalTaskId === activeTurn.turnId),
  );
  if (!matchingTask) {
    return;
  }
  activeTurn.activeTaskId = matchingTask.id;
  const pendingHandle = activeTurn.timelineHandle ?? state.activeStreamHandle;
  if (shouldUpdateComposerTimelineFromTask(activeTurn, pendingHandle, matchingTask)) {
    updateTimelineMessage(pendingHandle, createConversationRuntimeTaskTimelineMessage(matchingTask));
  }
  renderConversationRuntimeTaskResult(matchingTask);
  if (matchingTask.status === "completed") {
    state.taskRuntime.completedComposerTurns.add(activeTurn.turnId);
    forgetOptimisticComposerTurnTasks(
      activeTurn,
      new Set([matchingTask.id, expectedTaskId]),
    );
    setInputValue("");
  } else {
    rememberOptimisticTaskRuntimeTask(matchingTask);
  }
  releaseComposerTurnRunning(activeTurn);
}

function shouldUpdateComposerTimelineFromTask(activeTurn, pendingHandle, task) {
  if (!pendingHandle?.article?.classList.contains("streaming")) {
    return false;
  }
  if (activeTurn?.renderingFinalResult === true) {
    return false;
  }
  if (task?.status !== "completed") {
    return true;
  }
  return resolveConversationRuntimeTaskFinalText(task).length > 0;
}

function normalizeTaskRuntimeTask(task) {
  const now = Date.now();
  return {
    ...task,
    id: String(task?.id ?? task?.taskId ?? ""),
    status: normalizeTaskRuntimeStatus(task?.status),
    label: typeof task?.label === "string" && task.label.trim().length > 0 ? task.label.trim() : "运行任务",
    progress: normalizeTaskRuntimeProgress(task?.progress),
    progressMode: task?.progressMode === "determinate" ? "determinate" : "indeterminate",
    createdAt: normalizeTaskRuntimeTimestamp(task?.createdAt, now),
    startedAt: normalizeTaskRuntimeTimestamp(task?.startedAt, now),
    updatedAt: normalizeTaskRuntimeTimestamp(task?.updatedAt, now),
    completedAt:
      task?.completedAt === undefined ? undefined : normalizeTaskRuntimeTimestamp(task.completedAt, now),
    payload: task?.payload && typeof task.payload === "object" ? task.payload : {},
  };
}

function normalizeTaskRuntimeStatus(status) {
  switch (status) {
    case "pending":
    case "queued":
    case "running":
    case "retry_wait":
    case "completed":
    case "failed":
    case "interrupted":
    case "cancelled":
    case "needs_attention":
      return status;
    default:
      return "failed";
  }
}

function normalizeTaskRuntimeProgress(progress) {
  return typeof progress === "number" && Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.round(progress)))
    : 0;
}

function normalizeTaskRuntimeTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pruneTaskRuntimeHistory(tasks) {
  const seen = new Set();
  const normalized = tasks.filter((task) => {
    if (!task.id || seen.has(task.id)) {
      return false;
    }
    seen.add(task.id);
    return true;
  });
  const active = normalized.filter(isTaskRuntimeActive);
  const terminal = normalized
    .filter((task) => !isTaskRuntimeActive(task))
    .sort(compareTaskRuntimeUpdatedAt)
    .slice(0, TASK_RUNTIME_HISTORY_LIMIT);
  const next = [...active.sort(compareTaskRuntimeUpdatedAt), ...terminal];
  if (active.length === 0) {
    window.setTimeout(stopTaskRuntimePollingIfIdle, 0);
  }
  return next;
}

function mergeOptimisticTaskRuntimeTasks(tasks) {
  const merged = new Map(tasks.map((task) => [task.id, task]));
  const terminalComposerTurns = collectTerminalComposerTurnIds(merged.values());
  for (const task of [...merged.values()]) {
    const turnId = resolveTaskRuntimeComposerTurnId(task);
    if (
      turnId &&
      (state.taskRuntime.completedComposerTurns.has(turnId) || terminalComposerTurns.has(turnId)) &&
      isTaskRuntimeActive(task)
    ) {
      merged.delete(task.id);
    }
  }
  const activeComposerTask = state.taskRuntime.activeComposerTask;
  if (state.running && activeComposerTask && isTaskRuntimeActive(activeComposerTask)) {
    const incoming = merged.get(activeComposerTask.id);
    if (!incoming || isTaskRuntimeActive(incoming)) {
      merged.set(activeComposerTask.id, activeComposerTask);
    }
  }
  for (const [taskId, task] of state.taskRuntime.optimisticTasks.entries()) {
    if (isLocalOptimisticConversationRuntimeTask(task)) {
      const turnId = task.payload?.turnId ?? task.externalTaskId ?? task.artifactId;
      const taskIdsToRemove = new Set([taskId]);
      const hasTerminalIncomingForTurn =
        terminalComposerTurns.has(turnId) ||
        [...merged.values()].some(
          (incomingTask) =>
            !isTaskRuntimeActive(incomingTask) &&
            isTaskRuntimeComposerTurnTask(incomingTask, turnId, taskIdsToRemove),
        );
      if (hasTerminalIncomingForTurn) {
        state.taskRuntime.optimisticTasks.delete(taskId);
        if (isTaskRuntimeComposerTurnTask(state.taskRuntime.activeComposerTask, turnId, taskIdsToRemove)) {
          state.taskRuntime.activeComposerTask = null;
        }
        const incomingById = merged.get(taskId);
        if (!incomingById || isTaskRuntimeActive(incomingById)) {
          merged.delete(taskId);
        }
        continue;
      }
    }
    if (
      !state.running &&
      isTaskRuntimeActive(task) &&
      task.payload?.source === "desktop.conversation-runtime"
    ) {
      state.taskRuntime.optimisticTasks.delete(task.id);
      if (state.taskRuntime.activeComposerTask?.id === task.id) {
        state.taskRuntime.activeComposerTask = null;
      }
      continue;
    }
    const incoming = merged.get(task.id);
    if (incoming && !isTaskRuntimeActive(incoming)) {
      state.taskRuntime.optimisticTasks.delete(task.id);
      if (state.taskRuntime.activeComposerTask?.id === task.id) {
        state.taskRuntime.activeComposerTask = null;
      }
      continue;
    }
    if (!incoming) {
      merged.set(task.id, task);
      continue;
    }
    if (task.payload?.localCancelRequested === true && isTaskRuntimeActive(incoming)) {
      merged.set(task.id, task);
    }
  }
  return [...merged.values()];
}

function collectTerminalComposerTurnIds(tasks) {
  const terminalTurnIds = new Set();
  for (const task of tasks) {
    const turnId = resolveTaskRuntimeComposerTurnId(task);
    if (turnId && !isTaskRuntimeActive(task)) {
      terminalTurnIds.add(turnId);
      if (task.status === "completed") {
        state.taskRuntime.completedComposerTurns.add(turnId);
      }
    }
  }
  return terminalTurnIds;
}

function isLocalOptimisticConversationRuntimeTask(task) {
  return (
    task?.payload?.localOptimistic === true &&
    task?.payload?.source === "desktop.conversation-runtime"
  );
}

function isTaskRuntimeComposerTurnTask(task, turnId, taskIdsToRemove = new Set()) {
  if (!task || typeof turnId !== "string" || turnId.length === 0) {
    return false;
  }
  return (
    taskIdsToRemove.has(task.id) ||
    task.payload?.turnId === turnId ||
    task.externalTaskId === turnId ||
    task.artifactId === turnId ||
    task.summary?.turnId === turnId
  );
}

function resolveTaskRuntimeComposerTurnId(task) {
  return (
    task?.payload?.turnId ??
    task?.externalTaskId ??
    task?.artifactId ??
    task?.summary?.turnId ??
    null
  );
}

function upsertTaskRuntimeTask(task) {
  const normalized = normalizeTaskRuntimeTask(task);
  rememberOptimisticTaskRuntimeTask(normalized);
  state.taskRuntime.tasks = pruneTaskRuntimeHistory([
    normalized,
    ...state.taskRuntime.tasks.filter((item) => item.id !== normalized.id),
  ]);
  state.taskRuntime.lastUpdatedAt = Date.now();
  scheduleRunCenterRender();
  persistDesktopUiState();
  return normalized;
}

function scheduleRunCenterRender(options = {}) {
  state.taskRuntime.renderScheduler?.schedule(options.force === true);
}

function tryRenderRunCenter() {
  try {
    renderRunCenter();
  } catch (error) {
    reportNonFatalUiError(error, "任务运行中心渲染失败");
  }
}

function rememberOptimisticTaskRuntimeTask(task) {
  if (task.payload?.localOptimistic === true) {
    state.taskRuntime.optimisticTasks.set(task.id, task);
    if (isTaskRuntimeActive(task) && task.payload?.source === "desktop.conversation-runtime") {
      state.taskRuntime.activeComposerTask = task;
    }
  }
}

function forgetOptimisticTaskRuntimeTask(taskId) {
  state.taskRuntime.optimisticTasks.delete(taskId);
  if (state.taskRuntime.activeComposerTask?.id === taskId) {
    state.taskRuntime.activeComposerTask = null;
  }
}

function forgetOptimisticComposerTurnTasks(controller, taskIdsToRemove = new Set()) {
  for (const [taskId, task] of state.taskRuntime.optimisticTasks.entries()) {
    if (taskIdsToRemove.has(taskId) || isTaskRuntimeComposerTurnTask(task, controller.turnId, taskIdsToRemove)) {
      state.taskRuntime.optimisticTasks.delete(taskId);
    }
  }
  if (isTaskRuntimeComposerTurnTask(state.taskRuntime.activeComposerTask, controller.turnId, taskIdsToRemove)) {
    state.taskRuntime.activeComposerTask = null;
  }
}

function createOptimisticComposerTaskId(turnId) {
  return `conversation:${turnId}`;
}

function createOptimisticComposerTask(controller, prompt, overrides = {}) {
  const now = Date.now();
  const taskId = controller.activeTaskId ?? createOptimisticComposerTaskId(controller.turnId);
  return {
    id: taskId,
    category: "conversation-runtime",
    label: "Angel 回复",
    moduleSource: "workbench",
    lane: "text",
    provider: "conversation-runtime",
    model: "runtime",
    artifactType: "text",
    artifactId: controller.turnId,
    artifactLabel: null,
    routeTab: "workbench",
    routeLabel: "工作台",
    externalTaskId: controller.turnId,
    progress: 15,
    progressMode: "indeterminate",
    cancellable: true,
    status: "running",
    summary: {
      turnId: controller.turnId,
      runtimeEventCount: 0,
      toolCount: 0,
      pendingApprovalCount: 0,
    },
    payload: {
      turnId: controller.turnId,
      source: "desktop.conversation-runtime",
      promptPreview: prompt,
      localOptimistic: true,
    },
    events: [
      {
        type: "conversation.sent",
        title: "发送请求",
        message: "正在发送请求",
        occurredAt: new Date(now).toISOString(),
        progress: 15,
      },
    ],
    attemptCount: 0,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function registerOptimisticComposerTask(controller, prompt) {
  controller.promptPreview = prompt;
  try {
    const task = upsertTaskRuntimeTask(createOptimisticComposerTask(controller, prompt));
    controller.activeTaskId = task.id;
    return task;
  } catch (error) {
    const task = normalizeTaskRuntimeTask(createOptimisticComposerTask(controller, prompt));
    controller.activeTaskId = task.id;
    state.taskRuntime.optimisticTasks.set(task.id, task);
    state.taskRuntime.activeComposerTask = task;
    state.taskRuntime.lastUpdatedAt = Date.now();
    reportNonFatalUiError(error, "本地运行任务注册失败");
    tryRenderRunCenter();
    return task;
  }
}

function markTaskRuntimeTaskCancelledLocally(taskId, reason) {
  const now = Date.now();
  const existingTask = getTaskRuntimeTaskById(taskId) ?? createTaskRuntimeTaskForActiveComposer(taskId);
  if (existingTask) {
    const terminalTask = markTaskRuntimeTaskTerminal(existingTask, "cancelled", reason, now);
    rememberOptimisticTaskRuntimeTask(terminalTask);
    if (state.taskRuntime.activeComposerTask?.id === taskId) {
      state.taskRuntime.activeComposerTask = terminalTask;
    }
  }
  state.taskRuntime.tasks = pruneTaskRuntimeHistory(
    mergeOptimisticTaskRuntimeTasks(state.taskRuntime.tasks).map((task) =>
      task.id === taskId
        ? markTaskRuntimeTaskTerminal(task, "cancelled", reason, now)
        : task,
    ),
  );
  state.taskRuntime.lastUpdatedAt = now;
  scheduleRunCenterRender();
  persistDesktopUiState();
}

function markTaskRuntimeTaskTerminal(task, status, reason, now = Date.now()) {
  return {
    ...task,
    status,
    progress: 100,
    progressMode: "determinate",
    cancellable: false,
    error: reason,
    updatedAt: now,
    completedAt: now,
    payload: {
      ...task.payload,
      ...(reason === undefined ? {} : { cancelReason: reason }),
      ...(status === "cancelled" ? { localCancelRequested: true } : {}),
      ...(status === "completed" ? { localOptimistic: false } : {}),
    },
  };
}

function finalizeOptimisticComposerTask(controller, status, reason = undefined) {
  const taskId = controller.activeTaskId ?? createOptimisticComposerTaskId(controller.turnId);
  const taskIdsToRemove = new Set([taskId, createOptimisticComposerTaskId(controller.turnId)]);
  const now = Date.now();
  const existingTask =
    [
      ...state.taskRuntime.tasks,
      ...state.taskRuntime.optimisticTasks.values(),
    ].find((task) => isTaskRuntimeComposerTurnTask(task, controller.turnId, taskIdsToRemove)) ??
    createOptimisticComposerTask(controller, controller.promptPreview ?? "");
  const terminalTask = markTaskRuntimeTaskTerminal(existingTask, status, reason, now);
  if (status === "completed") {
    state.taskRuntime.completedComposerTurns.add(controller.turnId);
    forgetOptimisticComposerTurnTasks(controller, taskIdsToRemove);
  } else {
    rememberOptimisticTaskRuntimeTask(terminalTask);
    if (state.taskRuntime.activeComposerTask?.id === taskId) {
      state.taskRuntime.activeComposerTask = terminalTask;
    }
  }
  state.taskRuntime.tasks = pruneTaskRuntimeHistory([
    terminalTask,
    ...state.taskRuntime.tasks.filter(
      (task) => !isTaskRuntimeComposerTurnTask(task, controller.turnId, taskIdsToRemove),
    ),
  ]);
  state.taskRuntime.lastUpdatedAt = now;
  scheduleRunCenterRender();
  persistDesktopUiState();
}

function getTaskRuntimeTaskById(taskId) {
  return (
    state.taskRuntime.tasks.find((task) => task.id === taskId) ??
    state.taskRuntime.optimisticTasks.get(taskId) ??
    null
  );
}

function createTaskRuntimeTaskForActiveComposer(taskId) {
  const controller = state.activeComposerTurn;
  if (!controller || createOptimisticComposerTaskId(controller.turnId) !== taskId) {
    return null;
  }
  return createOptimisticComposerTask(controller, controller.promptPreview ?? "");
}

function isTaskRuntimeActive(task) {
  return TASK_RUNTIME_ACTIVE_STATUSES.has(task.status);
}

function isTaskRuntimeProblem(task) {
  return TASK_RUNTIME_PROBLEM_STATUSES.has(task.status);
}

function compareTaskRuntimeUpdatedAt(left, right) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function findActiveComposerTask() {
  const activeTurn = state.activeComposerTurn;
  if (!activeTurn) {
    return null;
  }
  if (activeTurn.activeTaskId) {
    const byId = getTaskRuntimeTaskById(activeTurn.activeTaskId);
    if (byId && isTaskRuntimeActive(byId)) {
      return byId;
    }
  }
  const optimisticTask = state.taskRuntime.optimisticTasks.get(createOptimisticComposerTaskId(activeTurn.turnId));
  if (optimisticTask && isTaskRuntimeActive(optimisticTask)) {
    return optimisticTask;
  }
  return (
    mergeOptimisticTaskRuntimeTasks(state.taskRuntime.tasks).find(
      (task) => isTaskRuntimeActive(task) && task.payload?.turnId === activeTurn.turnId,
    ) ?? null
  );
}

function startTaskRuntimePolling() {
  if (state.taskRuntime.refreshTimerId !== null) {
    return;
  }
  if (!state.running) {
    refreshTaskRuntime({ activeOnly: false }).catch(() => undefined);
  }
  state.taskRuntime.refreshTimerId = window.setInterval(() => {
    if (state.running || state.taskRuntime.refreshPromise) {
      return;
    }
    refreshTaskRuntime({ activeOnly: false }).catch(() => undefined);
  }, TASK_RUNTIME_POLL_INTERVAL_MS);
}

function resumeTaskRuntimePollingForActiveBackendTasks() {
  const hasActiveTask = state.taskRuntime.tasks.some(isTaskRuntimeActive);
  if (!hasActiveTask) {
    return;
  }
  startTaskRuntimePolling();
}

function stopTaskRuntimePollingIfIdle() {
  if (state.taskRuntime.refreshTimerId === null) {
    return;
  }
  const hasActiveTask = state.taskRuntime.tasks.some(isTaskRuntimeActive);
  if (state.running || hasActiveTask) {
    return;
  }
  window.clearInterval(state.taskRuntime.refreshTimerId);
  state.taskRuntime.refreshTimerId = null;
}

function renderRunCenter() {
  if (!elements.runCenterList) {
    return;
  }
  const tasks = getRenderableTaskRuntimeTasks().sort(compareTaskRuntimeUpdatedAt);
  updateRunCenterToastStateFromTasks(state.taskRuntime.toastState, tasks, {
    onChange: () => scheduleRunCenterRender({ force: true }),
  });
  const activeTasks = tasks.filter(isTaskRuntimeActive);
  const problemTasks = tasks.filter(isTaskRuntimeProblem);
  const completedTasks = tasks.filter((task) => task.status === "completed");
  setText(elements.runCenterActiveCount, `${activeTasks.length} 运行`);
  setText(elements.runCenterProblemCount, `${problemTasks.length} 异常`);
  for (const tab of elements.runCenterTabs) {
    tab.classList.toggle("active", tab.dataset.runCenterPanel === state.taskRuntime.activePanel);
  }
  renderRunCenterFallbackToast();
  const visibleTasks =
    state.taskRuntime.activePanel === "active"
      ? activeTasks
      : state.taskRuntime.activePanel === "problem"
        ? problemTasks
        : [...activeTasks, ...problemTasks, ...completedTasks].sort(compareTaskRuntimeUpdatedAt);
  elements.runCenterList.replaceChildren();
  if (visibleTasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "run-center-empty";
    empty.textContent =
      state.taskRuntime.activePanel === "active"
        ? "当前没有正在运行的任务"
        : state.taskRuntime.activePanel === "problem"
          ? "当前没有失败或取消的任务"
          : "当前还没有任务历史";
    elements.runCenterList.append(empty);
    return;
  }
  for (const task of visibleTasks.slice(0, 12)) {
    elements.runCenterList.append(createRunCenterTaskRow(task));
  }
}

function renderRunCenterFallbackToast() {
  if (!elements.runCenter) {
    return;
  }
  let toast = elements.runCenter.querySelector("[data-run-center-fallback-toast]");
  const status = state.taskRuntime.toastState?.fallbackStatus ?? null;
  if (status === null) {
    toast?.remove();
    return;
  }
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "run-center-fallback-toast";
    toast.dataset.runCenterFallbackToast = "true";
    const anchor = elements.runCenter.querySelector(".run-center-tabs") ?? elements.runCenterList;
    elements.runCenter.insertBefore(toast, anchor ?? null);
  }
  toast.textContent = [
    "模型降级",
    `${status.selected} -> ${status.active}`,
    status.reason ? `原因 ${status.reason}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderDirectorConsole(consoleProjection = state.directorConsole?.projection) {
  if (!elements.directorConsole) {
    return;
  }
  elements.directorConsole.replaceChildren(createDirectorConsolePanel(consoleProjection));
}

function createDirectorConsoleDecisionAction(actionId) {
  if (actionId === "accept_and_generate" || actionId === "accept_mode_model") {
    return createCommandRunAction("director.planAccept", {
      decisionActionId: actionId,
    });
  }
  if (actionId === "ignore_and_continue") {
    return createCommandRunAction("director.planIgnore");
  }
  if (actionId === "rerun_director") {
    return createCommandRunAction("director.planRerun");
  }
  return null;
}

function getRenderableTaskRuntimeTasks() {
  const tasks = mergeOptimisticTaskRuntimeTasks(state.taskRuntime.tasks);
  const activeTurn = state.activeComposerTurn;
  if (!state.running || !activeTurn || activeTurn.stopped === true) {
    return tasks;
  }
  if (state.taskRuntime.completedComposerTurns.has(activeTurn.turnId)) {
    return tasks;
  }
  const taskId = activeTurn.activeTaskId ?? createOptimisticComposerTaskId(activeTurn.turnId);
  if (tasks.some((task) => task.id === taskId)) {
    return tasks;
  }
  if (tasks.some((task) => !isTaskRuntimeActive(task) && isTaskRuntimeComposerTurnTask(task, activeTurn.turnId))) {
    return tasks;
  }
  return [createOptimisticComposerTask(activeTurn, activeTurn.promptPreview ?? ""), ...tasks];
}


async function cancelTaskRuntimeTask(taskId, reason) {
  markTaskRuntimeTaskCancelledLocally(taskId, reason);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
    taskId,
    reason,
  });
  if (result?.taskRuntimeCancel?.cancelled > 0) {
    state.taskRuntime.tasks = state.taskRuntime.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status: "cancelled",
            cancellable: false,
            updatedAt: Date.now(),
            completedAt: Date.now(),
          }
        : task,
    );
    scheduleRunCenterRender();
  }
  if (result?.snapshot) {
    renderSnapshot(result.snapshot);
  }
  await refreshTaskRuntime({ activeOnly: false });
  return result;
}

async function retryRunCenterTask(taskId) {
  const task = findLocalTaskRuntimeTask(taskId);
  const prompt = readNonEmptyTimelineText(task?.payload?.promptPreview);
  if (!prompt) {
    setResultOutputWithContext("这条任务没有保存可重试的原始输入，已阻止空重试。", null);
    selectInspectorPanel("result");
    return;
  }
  const sessionKey = readNonEmptyTimelineText(task?.payload?.sessionKey ?? task?.sessionKey);
  if (sessionKey && sessionKey !== state.chat.sessionKey) {
    selectDesktopChatSession(state.chat, sessionKey);
    await clearDesktopWorkbenchRuntimeForSessionSwitch();
    renderDesktopChatSessions();
    persistDesktopUiState();
  }
  await submitComposerMessage(prompt);
}

async function copyRunCenterPointer(pointer) {
  try {
    await navigator.clipboard?.writeText(String(pointer ?? ""));
  } catch (error) {
    reportNonFatalUiError(error, "记忆来源指针复制失败");
  }
}

async function openRunCenterPointerSource(pointerPayload) {
  const source = parseRunCenterPointerSource(pointerPayload);
  if (source.type === "moyin") {
    setResultOutputWithContext(createRunCenterMoyinPointerSourceLines(source).join("\n"), null);
    selectInspectorPanel("result");
    return;
  }
  let drawerContent = source.drawerContent;
  let sourceReadFailure = null;
  if (!drawerContent && (source.drawerId || (source.sourceFile && source.drawerIndex !== null))) {
    const result = await invokeBridge({
      type: DESKTOP_ACTIONS.MEMPALACE_SOURCE_READ,
      ...(source.drawerId ? { drawerId: source.drawerId } : {}),
      ...(source.sourceFile ? { sourceFile: source.sourceFile } : {}),
      ...(source.drawerIndex === null ? {} : { drawerIndex: source.drawerIndex }),
      ...(source.wing ? { wing: source.wing } : {}),
      ...(source.room ? { room: source.room } : {}),
    });
    const read = result?.mempalaceSource;
    if (read?.ok && typeof read.content === "string" && read.content.trim().length > 0) {
      drawerContent = read.content.trim();
      source.totalDrawers = read.source?.totalDrawers ?? source.totalDrawers;
      source.layerLabel = read.source?.layerLabel ?? source.layerLabel;
    } else {
      sourceReadFailure =
        read?.degraded?.message ?? read?.degraded?.reason ?? "后端没有返回完整 drawer 原文。";
    }
  }
  const lines = createRunCenterPointerSourceLines(source, drawerContent, sourceReadFailure);
  setResultOutputWithContext(lines.join("\n"), null);
  selectInspectorPanel("result");
}

function createRunCenterPointerSourceLines(source, drawerContent, sourceReadFailure) {
  return [
    "MemPalace 来源定位",
    source.drawerId ? `Drawer ID：${source.drawerId}` : null,
    `来源文件：${source.sourceFile ?? "未知"}`,
    source.layerLabel ? `记忆层级：${source.layerLabel}` : null,
    source.drawerIndex === null
      ? null
      : `Drawer：${source.drawerIndex}${source.totalDrawers === null ? "" : `/${source.totalDrawers}`}`,
    drawerContent ? `Drawer 原文：${drawerContent}` : null,
    source.verbatimExcerpt ? `原文片段：${source.verbatimExcerpt}` : null,
    drawerContent
      ? "已展示完整 drawer 原文；来源来自召回事件快照、MemPalace drawerId 或 sourceFile+drawerIndex 二次读取。"
      : `二次读取完整 drawer 原文失败：${sourceReadFailure ?? "缺少 drawerId、sourceFile 或 drawerIndex，不能假装已打开 drawer 原文。"}`,
  ].filter(Boolean);
}

function createRunCenterMoyinPointerSourceLines(source) {
  return [
    "Moyin 来源定位",
    source.projectId ? `项目：${source.projectId}` : null,
    source.runId ? `Workflow Run：${source.runId}` : null,
    source.stepId ? `步骤：${source.stepId}` : null,
    source.taskId ? `任务：${source.taskId}` : null,
    source.sealedRequestId ? `Sealed Request：${source.sealedRequestId}` : null,
    source.resumeToken ? `恢复令牌：${source.resumeToken}` : null,
    source.approvalId ? `审批：${source.approvalId}` : null,
    source.command ? `调用命令：${source.command}` : null,
    typeof source.artifactCount === "number" ? `产物数量：${source.artifactCount}` : null,
    typeof source.backfillAttemptedCount === "number"
      ? `产物回填：${source.backfillAttemptedCount} 次`
      : null,
    Array.isArray(source.exports) && source.exports.length > 0
      ? `导出：${source.exports.join("、")}`
      : null,
    typeof source.readyForComfyUi === "boolean"
      ? `ComfyUI：${source.readyForComfyUi ? "就绪" : "未就绪"}`
      : null,
    "这是 Director Angel 运行中心的 Moyin 事件定位；真实内容仍以 Moyin 项目和 artifact registry 为准。",
  ].filter(Boolean);
}

function parseRunCenterPointerSource(pointerPayload) {
  try {
    const parsed = JSON.parse(String(pointerPayload ?? "{}"));
    if (parsed && typeof parsed === "object") {
      if (parsed.type === "moyin") {
        return {
          type: "moyin",
          projectId: readNonEmptyTimelineText(parsed.projectId),
          runId: readNonEmptyTimelineText(parsed.runId),
          stepId: readNonEmptyTimelineText(parsed.stepId),
          taskId: readNonEmptyTimelineText(parsed.taskId),
          sealedRequestId: readNonEmptyTimelineText(parsed.sealedRequestId),
          resumeToken: readNonEmptyTimelineText(parsed.resumeToken),
          approvalId: readNonEmptyTimelineText(parsed.approvalId),
          command: readNonEmptyTimelineText(parsed.command),
          artifactCount: readNullableNumber(parsed.artifactCount),
          backfillAttemptedCount: readNullableNumber(parsed.backfillAttemptedCount),
          exports: Array.isArray(parsed.exports)
            ? parsed.exports.map((item) => readNonEmptyTimelineText(item)).filter(Boolean)
            : [],
          readyForComfyUi:
            typeof parsed.readyForComfyUi === "boolean" ? parsed.readyForComfyUi : null,
        };
      }
      return {
        type: "mempalace",
        drawerId: readNonEmptyTimelineText(parsed.drawerId ?? parsed.drawer_id),
        sourceFile: readNonEmptyTimelineText(parsed.sourceFile),
        layerLabel: readNonEmptyTimelineText(parsed.layerLabel ?? parsed.memoryLayer),
        verbatimExcerpt: readNonEmptyTimelineText(parsed.verbatimExcerpt),
        drawerContent: readNonEmptyTimelineText(parsed.drawerContent),
        wing: readNonEmptyTimelineText(parsed.wing),
        room: readNonEmptyTimelineText(parsed.room),
        drawerIndex: readNullableNumber(parsed.drawerIndex),
        totalDrawers: readNullableNumber(parsed.totalDrawers),
      };
    }
  } catch {
    // Fall through to a text-only pointer below.
  }
  return {
    type: "mempalace",
    drawerId: null,
    sourceFile: readNonEmptyTimelineText(pointerPayload),
    layerLabel: null,
    verbatimExcerpt: null,
    drawerContent: null,
    wing: null,
    room: null,
    drawerIndex: null,
    totalDrawers: null,
  };
}

function readNullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readTaskRuntimeTask(taskId) {
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
    taskId,
  });
  const task = result?.taskRuntimeTask ?? findLocalTaskRuntimeTask(taskId);
  if (task) {
    const rendered = renderTaskRuntimeTaskDetail(task, {
      evidenceDisclosure: resolveTaskRuntimeEvidenceDisclosure(task),
    });
    if (!rendered) {
      setResultOutputWithContext("任务详情不可用。", null, {
        evidenceDisclosure: resolveTaskRuntimeEvidenceDisclosure(task),
      });
      selectInspectorPanel("result");
    }
  }
  return result;
}

function findLocalTaskRuntimeTask(taskId) {
  const id = String(taskId ?? "");
  if (!id) {
    return null;
  }
  return (
    state.taskRuntime.tasks.find((task) => String(task?.id ?? task?.taskId ?? "") === id) ??
    state.taskRuntime.optimisticTasks.get(id) ??
    (String(state.taskRuntime.activeComposerTask?.id ?? "") === id ? state.taskRuntime.activeComposerTask : null)
  );
}

function renderTaskRuntimeTaskDetail(task, options = {}) {
  if (!task) {
    return false;
  }
  const normalizedTask = normalizeTaskRuntimeTask(task);
  const eventLines = Array.isArray(normalizedTask.events)
    ? normalizedTask.events.slice(0, 8).map(formatTaskRuntimeDetailEventLine).filter(Boolean)
    : [];
  const restoredLine =
    normalizedTask.payload?.restoredFromUiState === true ? "来源：本地恢复历史" : null;
  setResultOutputWithContext(
    [
      `任务：${normalizedTask.label}`,
      `状态：${formatTaskRuntimeStatus(normalizedTask.status)}`,
      restoredLine,
      ...eventLines,
    ]
      .filter(Boolean)
      .join("\n"),
    null,
    {
      evidenceDisclosure: options.evidenceDisclosure ?? resolveTaskRuntimeEvidenceDisclosure(normalizedTask),
    },
  );
  selectInspectorPanel("result");
  return true;
}

function formatTaskRuntimeDetailEventLine(event) {
  const type = readNonEmptyTimelineText(event?.type ?? event?.kind) ?? "event";
  const message = readNonEmptyTimelineText(
    event?.message ?? event?.title ?? event?.detail ?? event?.payload?.message,
  );
  return message ? `${type}: ${message}` : type;
}

async function submitComposer() {
  if (!isWorkbenchActive()) {
    return;
  }
  const input = elements.angelInput?.value.trim() ?? "";
  if (shouldTreatComposerSubmitAsStop(input)) {
    await requestStopActiveComposerTurn();
    return;
  }
  syncComposerStateFromInput();
  await handleDesktopChatSubmit(state.chat, {
    send: submitComposerMessage,
    abort: requestStopActiveComposerTurn,
    resetConversation: resetDesktopWorkbenchConversation,
    onInputCleared: () => {
      setInputValue("");
      renderComposerAttachments();
    },
    onInputRestored: (message) => {
      setInputValue(message);
      renderComposerAttachments();
    },
  });
}

async function resetDesktopWorkbenchConversation(message = "/new") {
  state.chat.queue = [];
  state.chat.runId = state.running ? state.chat.runId : null;
  if (elements.timeline) {
    elements.timeline.replaceChildren();
  }
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.COMPOSER_RESET,
    prompt: message,
    surface: "workbench",
  });
  await renderBridgeResult(result);
  setInputValue("");
  elements.angelInput?.focus();
}

async function submitComposerMessage(input, options = {}) {
  const localCommand = resolveLocalSlashCommand(input);
  if (localCommand) {
    await submitLocalSlashCommand(input, localCommand);
    return { ok: true };
  }

  await submitComposerToBridge(input, {
    attachments: options?.attachments,
  });
  return { ok: true };
}

function shouldTreatComposerSubmitAsStop(input) {
  const now = Date.now();
  if (state.composerStopClickArmedUntilMs > now) {
    return true;
  }
  if (state.running && String(input ?? "").trim().length === 0) {
    return true;
  }
  return input.length === 0 && now - state.lastComposerTurnFinishedAtMs < COMPOSER_STOP_CLICK_GRACE_MS;
}

async function submitImageComposer() {
  if (state.running || !isWorkbenchActive()) {
    return;
  }

  const input = elements.angelInput?.value.trim() ?? "";
  if (input.length === 0) {
    setInputValue("/图片 ");
    elements.angelInput?.focus();
    return;
  }

  const prompt = /^\/\s*(图片|图像|出图|image|draw)(\s|$)/iu.test(input) ? input : `/图片 ${input}`;
  await submitComposerToBridge(prompt);
}

async function submitVideoComposer() {
  if (state.running || !isWorkbenchActive()) {
    return;
  }

  const input = elements.angelInput?.value.trim() ?? "";
  if (input.length === 0) {
    setInputValue("/视频 ");
    elements.angelInput?.focus();
    return;
  }

  const prompt = /^\/\s*(视频|生成视频|video)(\s|$)/iu.test(input) ? input : `/视频 ${input}`;
  await submitComposerToBridge(prompt);
}

async function toggleLiveAudio() {
  if (!bridge || !isWorkbenchActive() || state.liveAudio.busy) {
    return;
  }
  if (state.liveAudio.active) {
    await stopLiveAudio();
    return;
  }
  await startLiveAudio();
}

async function startLiveAudio() {
  updateLiveAudioState({
    busy: true,
    reason: "正在检查语音权限...",
  });
  try {
    const result = await invokeBridge({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_START,
      turnId: `desktop-live-audio-ui-${Date.now().toString(36)}`,
      mode: "push-to-talk",
    });
    applyLiveAudioBridgeResult(result, "start");
    await renderBridgeResult(result);
    await refreshTaskRuntime({ activeOnly: false });
  } finally {
    updateLiveAudioState({ busy: false });
  }
}

async function stopLiveAudio() {
  updateLiveAudioState({
    busy: true,
    reason: "正在停止语音...",
  });
  try {
    const result = await invokeBridge({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_STOP,
      reason: "operator stopped desktop live audio from composer",
    });
    applyLiveAudioBridgeResult(result, "stop");
    await renderBridgeResult(result);
    await refreshTaskRuntime({ activeOnly: false });
  } finally {
    updateLiveAudioState({ busy: false });
  }
}

async function refreshLiveAudioStatus(options = {}) {
  if (!bridge) {
    return null;
  }
  const result = await invokeBridge({ type: DESKTOP_ACTIONS.LIVE_AUDIO_STATUS });
  applyLiveAudioBridgeResult(result, "status", options);
  return result?.liveAudio ?? null;
}

function applyLiveAudioBridgeResult(result, action, options = {}) {
  const liveAudio = result?.liveAudio;
  if (!liveAudio) {
    if (options.silent !== true) {
      updateLiveAudioState({
        active: false,
        status: "error",
        reason: "没有拿到语音状态。",
      });
    }
    return;
  }
  const active = liveAudio.active === true || liveAudio.status === "recording";
  updateLiveAudioState({
    active,
    status: liveAudio.status ?? (active ? "recording" : "idle"),
    reason: resolveLiveAudioStatusCopy(liveAudio, action),
  });
}

function updateLiveAudioState(patch) {
  state.liveAudio = {
    ...state.liveAudio,
    ...patch,
    lastUpdatedAt: Date.now(),
  };
  renderLiveAudioStatus();
}

function renderLiveAudioStatus() {
  if (elements.liveAudioStatus) {
    elements.liveAudioStatus.textContent = state.liveAudio.reason;
    elements.liveAudioStatus.dataset.status = state.liveAudio.status;
  }
  if (elements.liveAudioToggle) {
    const isActive = state.liveAudio.active === true;
    elements.liveAudioToggle.textContent = isActive ? "停止语音" : "语音";
    elements.liveAudioToggle.dataset.status = state.liveAudio.status;
    elements.liveAudioToggle.classList.toggle("active", isActive);
    elements.liveAudioToggle.setAttribute(
      "aria-label",
      isActive ? "停止桌面语音" : "查看并启动桌面语音",
    );
    setButtonDisabled(
      elements.liveAudioToggle,
      state.liveAudio.busy || (state.running && state.liveAudio.active !== true),
    );
  }
}

function resolveLiveAudioStatusCopy(liveAudio, action) {
  if (typeof liveAudio.reason === "string" && liveAudio.reason.trim().length > 0) {
    return liveAudio.reason.trim();
  }
  if (liveAudio.status === "recording" || liveAudio.active === true) {
    return "语音正在采集，可随时停止。";
  }
  if (liveAudio.status === "blocked") {
    return extractLiveAudioSessionMessage(liveAudio) ?? "真实麦克风默认关闭，未启动。";
  }
  if (liveAudio.status === "stopped") {
    return "语音已停止。";
  }
  if (action === "stop") {
    return "没有正在运行的语音。";
  }
  return "语音未运行";
}

function extractLiveAudioSessionMessage(liveAudio) {
  const errorMessage = liveAudio.latestSession?.error?.message ?? liveAudio.session?.error?.message;
  if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
    return errorMessage.trim();
  }
  return null;
}

async function pickLearningSource() {
  if (!bridge || state.running || !isWorkbenchActive()) {
    return;
  }
  const composerTurn = createComposerTurnController("pick-source");
  appendTimelineMessage({
    role: DESKTOP_EVENT_ROLES.USER,
    title: "选择学习资料",
    body: "从本机选择文件或目录交给 Angel。",
  });
  const pendingMessage = appendTimelineMessage(
    {
      role: DESKTOP_EVENT_ROLES.ANGEL,
      title: "Angel 正在处理",
      body: "正在等待本机选择结果...",
    },
    { streaming: true },
  );
  attachTimelineRunTranscript(pendingMessage, composerTurn, {
    initialLabel: "正在等待选择资料",
  });
  appendTimelineRunTranscriptStep(pendingMessage, {
    key: "pick-source-dialog",
    kind: "command",
    state: "active",
    label: "等待本机文件或目录选择",
  });
  state.activeStreamHandle = pendingMessage;
  composerTurn.timelineHandle = pendingMessage;
  registerOptimisticComposerTask(composerTurn, "");
  startComposerBridgeWatchdog(composerTurn, pendingMessage, {
    waitingLabel: "正在等待本机选择或运行结果",
    timeoutReason: "本机选择超过 75 秒没有返回；已自动结束这次请求。",
  });
  setRunning(true);
  try {
    startTaskRuntimePolling();
    const result = await invokeBridge({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "",
      surface: "workbench",
      pickSource: true,
      turnId: composerTurn.turnId,
      sessionKey: state.chat.sessionKey,
    });
    if (!isComposerTurnActive(composerTurn)) {
      return;
    }
    state.activeStreamHandle = null;
    releaseComposerTurnRunning(composerTurn);
    composerTurn.renderingFinalResult = true;
    const timelineConsumed = await renderBridgeResult(result, {
      timelineHandle: pendingMessage,
      composerTurn,
    });
    composerTurn.renderingFinalResult = false;
    if (!isComposerTurnActive(composerTurn)) {
      return;
    }
    if (!timelineConsumed) {
      removeTimelineMessage(pendingMessage);
    }
    if (result) {
      setInputValue("");
    }
  } finally {
    finishComposerTurn(composerTurn);
  }
}

async function submitComposerToBridge(input, options = {}) {
  updateCurrentDesktopSessionFromPrompt(input);
  const attachments = normalizeComposerSubmitAttachments(options.attachments);
  const composerTurn = createComposerTurnController("submit");
  appendTimelineMessage({
    role: DESKTOP_EVENT_ROLES.USER,
    title: input.length === 0 ? "继续" : "交给 Angel",
    body: formatComposerUserMessageBody(input, attachments),
  });
  setInputValue("");
  renderComposerAttachments();
  const pendingMessage = appendTimelineMessage(
    {
      role: DESKTOP_EVENT_ROLES.ANGEL,
      title: "Angel 正在处理",
      body: "正在等待工具或模型结果...",
    },
    { streaming: true },
  );
  attachTimelineRunTranscript(pendingMessage, composerTurn, {
    initialLabel: "正在发送请求",
  });
  appendTimelineRunTranscriptPromptSteps(pendingMessage, input);
  state.activeStreamHandle = pendingMessage;
  composerTurn.timelineHandle = pendingMessage;
  registerOptimisticComposerTask(composerTurn, input);
  startComposerBridgeWatchdog(composerTurn, pendingMessage);
  setRunning(true);
  let bridgeResultRendered = false;
  try {
    startTaskRuntimePolling();
    const result = await invokeBridgeWithTimeout(
      {
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: input,
        surface: "workbench",
        turnId: composerTurn.turnId,
        sessionKey: state.chat.sessionKey,
        ...(attachments.length > 0 ? { attachments: materializeDesktopAttachmentPayloads(attachments) } : {}),
      },
      {
        timeoutMs: COMPOSER_BRIDGE_TIMEOUT_MS,
        timeoutMessage: `本机运行服务在 ${Math.round(COMPOSER_BRIDGE_TIMEOUT_MS / 1000)} 秒内没有返回结果。`,
      },
    );
    if (!result) {
      if (isComposerTurnActive(composerTurn)) {
        appendTimelineRunTranscriptStep(pendingMessage, {
          key: "bridge-no-result",
          kind: "error",
          state: "failed",
          label: "本机运行服务没有返回结果",
        });
        finalizeOptimisticComposerTask(composerTurn, "failed", "本机运行服务没有返回结果。");
        markTimelineMessageAsStale(pendingMessage, "等待已结束");
      }
      return;
    }
    if (!isComposerTurnActive(composerTurn)) {
      return;
    }
    state.activeStreamHandle = null;
    releaseComposerTurnRunning(composerTurn);
    composerTurn.renderingFinalResult = true;
    const timelineConsumed = await renderBridgeResult(result, {
      timelineHandle: pendingMessage,
      composerTurn,
    });
    composerTurn.renderingFinalResult = false;
    bridgeResultRendered = true;
    if (!isComposerTurnActive(composerTurn)) {
      return;
    }
    if (!timelineConsumed) {
      removeTimelineMessage(pendingMessage);
    }
    if (result) {
      finalizeOptimisticComposerTask(composerTurn, "completed");
      discardDesktopAttachmentDataUrls(attachments);
    }
    await refreshTaskRuntime({ activeOnly: false });
  } finally {
    if (state.activeStreamHandle === pendingMessage) {
      state.activeStreamHandle = null;
    }
    if (isComposerTurnActive(composerTurn) && !bridgeResultRendered) {
      releaseComposerTurnRunning(composerTurn);
    }
    finishComposerTurn(composerTurn);
    if (!bridgeResultRendered) {
      releaseDesktopAttachmentPayloads(attachments);
    }
    await refreshTaskRuntime({ activeOnly: false }).catch((error) => {
      reportNonFatalUiError(error, "任务运行中心收尾刷新失败");
    });
    stopTaskRuntimePollingIfIdle();
  }
}

async function submitLocalSlashCommand(input, localCommand) {
  const composerTurn = createComposerTurnController("local-command");
  appendTimelineMessage({
    role: DESKTOP_EVENT_ROLES.USER,
    title: "执行本地命令",
    body: input,
  });
  setInputValue("");
  const pendingMessage = appendTimelineMessage(
    {
      role: DESKTOP_EVENT_ROLES.ANGEL,
      title: "Angel 正在处理",
      body: "正在等待本地命令结果...",
    },
    { streaming: true },
  );
  attachTimelineRunTranscript(pendingMessage, composerTurn, {
    initialLabel: `正在执行 ${localCommand.commandId}`,
  });
  appendTimelineRunTranscriptPromptSteps(pendingMessage, input);
  state.activeStreamHandle = pendingMessage;
  composerTurn.timelineHandle = pendingMessage;
  registerOptimisticComposerTask(composerTurn, input);
  startComposerBridgeWatchdog(composerTurn, pendingMessage, {
    waitingLabel: `正在等待本地命令 ${localCommand.commandId} 返回`,
    timeoutReason: `本地命令 ${localCommand.commandId} 超过 75 秒没有返回；已自动结束这次请求。`,
  });
  setRunning(true);
  let bridgeResultRendered = false;
  try {
    startTaskRuntimePolling();
    const command = findCommand(localCommand.commandId);
    const result = command
      ? await invokeBridge(createCommandRunAction(command.id, localCommand.args))
      : null;
    if (!result) {
      if (isComposerTurnActive(composerTurn)) {
        appendTimelineRunTranscriptStep(pendingMessage, {
          key: "local-command-no-result",
          kind: "error",
          state: "failed",
          label: "本地命令没有返回结果",
        });
        finalizeOptimisticComposerTask(composerTurn, "failed", "本机运行服务没有返回结果。");
        markTimelineMessageAsStale(pendingMessage, "等待已结束");
      }
      return;
    }
    if (!isComposerTurnActive(composerTurn)) {
      return;
    }
    state.activeStreamHandle = null;
    releaseComposerTurnRunning(composerTurn);
    composerTurn.renderingFinalResult = true;
    const timelineConsumed = await renderBridgeResult(result, {
      timelineHandle: pendingMessage,
      composerTurn,
    });
    composerTurn.renderingFinalResult = false;
    bridgeResultRendered = true;
    if (!isComposerTurnActive(composerTurn)) {
      return;
    }
    if (!timelineConsumed) {
      updateTimelineMessage(pendingMessage, createLocalCommandTimelineMessage(result, command));
    }
    finalizeOptimisticComposerTask(composerTurn, "completed");
    await refreshTaskRuntime({ activeOnly: false });
  } finally {
    if (state.activeStreamHandle === pendingMessage) {
      state.activeStreamHandle = null;
    }
    if (isComposerTurnActive(composerTurn) && !bridgeResultRendered) {
      releaseComposerTurnRunning(composerTurn);
    }
    finishComposerTurn(composerTurn);
    await refreshTaskRuntime({ activeOnly: false }).catch((error) => {
      reportNonFatalUiError(error, "任务运行中心收尾刷新失败");
    });
    stopTaskRuntimePollingIfIdle();
  }
}

function resolveLocalSlashCommand(input) {
  const normalized = input.trim().replace(/\s+/gu, " ");
  if (normalized === "/工具" || /^\/tools?$/iu.test(normalized)) {
    return { commandId: "adapter.list", args: {} };
  }
  if (normalized === "/工具 平台" || /^\/tools?\s+(平台|platform|capabilities)$/iu.test(normalized)) {
    return { commandId: "platform.capabilities", args: {} };
  }
  return null;
}

function createLocalCommandTimelineMessage(result, command) {
  const event = Array.isArray(result?.events) ? result.events.at(-1) : null;
  const commandResult = result?.commandResult;
  const title = commandResult?.status === "completed" ? "Angel 已回复" : "本地命令已完成";
  const body =
    event?.body ??
    event?.summary ??
    commandResult?.stdout ??
    commandResult?.stderr ??
    `${command?.label ?? "本地命令"} 已完成。`;
  return {
    role: DESKTOP_EVENT_ROLES.ANGEL,
    title,
    body,
  };
}

function createComposerTurnController(kind) {
  state.composerTurnSequence += 1;
  state.composerStopClickArmedUntilMs = 0;
  const controller = {
    id: state.composerTurnSequence,
    turnId: `desktop-composer-turn-${Date.now().toString(36)}-${state.composerTurnSequence}`,
    kind,
    startedAtMs: Date.now(),
    stopped: false,
    renderingFinalResult: false,
    activeTaskId: null,
    timelineHandle: null,
    bridgeWatchdogTimers: [],
  };
  state.activeComposerTurn = controller;
  return controller;
}

function isComposerTurnActive(controller) {
  return Boolean(controller && state.activeComposerTurn === controller && controller.stopped !== true);
}

function startComposerBridgeWatchdog(controller, handle, options = {}) {
  if (!controller || !handle?.runTranscript) {
    return;
  }
  clearComposerBridgeWatchdog(controller);
  const waitingTimer = window.setTimeout(() => {
    if (!isComposerTurnActive(controller)) {
      return;
    }
    appendTimelineRunTranscriptStep(handle, {
      key: "bridge-waiting-notice",
      kind: "command",
      state: "active",
      label: options.waitingLabel ?? "正在等待工具或模型结果",
    });
  }, COMPOSER_BRIDGE_WAITING_NOTICE_MS);
  const timeoutTimer = window.setTimeout(() => {
    if (!isComposerTurnActive(controller)) {
      return;
    }
    const reason =
      options.timeoutReason ??
      `等待超过 ${Math.round(COMPOSER_BRIDGE_WATCHDOG_TIMEOUT_MS / 1000)} 秒没有返回；已自动结束这次请求。`;
    appendTimelineRunTranscriptStep(handle, {
      key: "bridge-watchdog-timeout",
      kind: "error",
      state: "failed",
      label: reason,
    });
    finalizeOptimisticComposerTask(controller, "failed", reason);
    markTimelineMessageAsStale(handle, "等待已结束");
    releaseComposerTurnRunning(controller);
    finishComposerTurn(controller);
    refreshTaskRuntime({ activeOnly: false }).catch(() => undefined);
    stopTaskRuntimePollingIfIdle();
  }, COMPOSER_BRIDGE_WATCHDOG_TIMEOUT_MS);
  controller.bridgeWatchdogTimers = [waitingTimer, timeoutTimer];
}

function clearComposerBridgeWatchdog(controller) {
  const timers = Array.isArray(controller?.bridgeWatchdogTimers)
    ? controller.bridgeWatchdogTimers
    : [];
  for (const timer of timers) {
    window.clearTimeout(timer);
  }
  if (controller) {
    controller.bridgeWatchdogTimers = [];
  }
}

async function requestStopActiveComposerTurn() {
  const controller = state.activeComposerTurn;
  if (!controller || controller.stopped === true) {
    state.composerStopClickArmedUntilMs = 0;
    state.lastComposerStopRequestAtMs = Date.now();
    setRunning(false);
    return;
  }
  state.lastComposerStopRequestAtMs = Date.now();
  controller.stopped = true;
  state.composerStopClickArmedUntilMs = 0;
  const pendingHandle = controller.timelineHandle ?? state.activeStreamHandle;
  if (pendingHandle) {
    updateTimelineMessage(pendingHandle, {
      role: DESKTOP_EVENT_ROLES.SYSTEM,
      title: "已停止",
      body: "已停止当前请求；迟到结果会被忽略。",
    });
  }
  state.activeStreamHandle = null;
  setRunning(false);
  elements.angelInput?.focus();
  cancelActiveComposerTask(controller).catch(() => undefined);
}

async function cancelActiveComposerTask(controller) {
  const activeTask = findActiveComposerTask();
  if (activeTask) {
    controller.activeTaskId = activeTask.id;
    await cancelTaskRuntimeTask(activeTask.id, "operator stopped current composer turn");
    return;
  }
  const taskCancelResult = await invokeBridge({
    type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
    turnId: controller.turnId,
    reason: "operator stopped current composer turn",
  }).catch(() => undefined);
  applyBridgeTaskRuntimeSnapshot(taskCancelResult);
  const cancelResult = await invokeBridge({
    type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
    turnId: controller.turnId,
    reason: "operator stopped current composer turn",
  }).catch(() => undefined);
  applyBridgeTaskRuntimeSnapshot(cancelResult);
  await refreshTaskRuntime({ activeOnly: false }).catch(() => undefined);
}

function applyBridgeTaskRuntimeSnapshot(result) {
  if (result?.taskRuntime) {
    applyTaskRuntimeSnapshot(result.taskRuntime);
  } else if (result?.snapshot?.assets?.tools?.taskRuntime) {
    applyTaskRuntimeSnapshot(result.snapshot.assets.tools.taskRuntime);
  }
}

function releaseComposerTurnRunning(controller) {
  if (state.activeComposerTurn !== controller) {
    return;
  }
  clearComposerBridgeWatchdog(controller);
  state.activeStreamHandle = null;
  state.lastComposerTurnFinishedAtMs = Date.now();
  setRunning(false);
  scheduleReleasedComposerTurnFinalizer(controller);
}

function scheduleReleasedComposerTurnFinalizer(controller) {
  window.setTimeout(() => {
    if (
      state.activeComposerTurn === controller &&
      !state.running &&
      controller.renderingFinalResult !== true &&
      controller.timelineHandle?.article?.classList.contains("streaming")
    ) {
      finalizeOrphanedComposerTurn(controller);
    }
  }, 1_500);
}

function finishComposerTurn(controller) {
  if (state.activeComposerTurn !== controller) {
    return;
  }
  clearComposerBridgeWatchdog(controller);
  finalizePendingComposerTimelineHandle(controller);
  state.activeComposerTurn = null;
  state.activeStreamHandle = null;
  state.lastComposerTurnFinishedAtMs = Date.now();
  reconcileDesktopChatRunLifecycle(state.chat, {
    outcome: controller.stopped === true ? "interrupted" : "completed",
    runId: state.chat.runId,
    sessionKey: state.chat.sessionKey,
  });
  setRunning(false);
  window.setTimeout(() => {
    flushQueuedComposerSubmit();
  }, 0);
}

function finalizePendingComposerTimelineHandle(controller) {
  const handle = controller?.timelineHandle;
  if (!handle?.runTranscript || !handle.article.classList.contains("streaming")) {
    return;
  }
  appendTimelineRunTranscriptStep(handle, {
    key: "turn-ended-without-final",
    kind: "error",
    state: "failed",
    label: "请求已结束，未收到最终回复",
  });
  markTimelineMessageAsStale(handle, "等待已结束");
}

function startStaleTimelineMonitor() {
  if (state.staleTimelineMonitorTimerId !== null) {
    return;
  }
  state.staleTimelineMonitorTimerId = window.setInterval(() => {
    finalizeStaleStreamingTimelineMessages();
  }, 5_000);
}

function finalizeStaleStreamingTimelineMessages() {
  if (!elements.timeline || state.running) {
    return;
  }
  const activeTurn = state.activeComposerTurn;
  if (
    activeTurn?.timelineHandle?.article?.classList.contains("streaming") &&
    activeTurn.renderingFinalResult !== true &&
    isComposerTurnDetachedFromBackend(activeTurn)
  ) {
    finalizeOrphanedComposerTurn(activeTurn);
  }
  const now = Date.now();
  const staleMessages = elements.timeline.querySelectorAll(".message.streaming.run-transcript-message");
  for (const article of staleMessages) {
    const startedAtMs = Number.parseInt(article.dataset.streamingStartedAtMs ?? "", 10);
    if (!Number.isFinite(startedAtMs) || now - startedAtMs < STALE_STREAMING_TIMELINE_TIMEOUT_MS) {
      continue;
    }
    finalizeStaleStreamingTimelineMessage(article);
  }
}

function flushQueuedComposerSubmit() {
  if (!isWorkbenchActive() || state.running || state.activeComposerTurn) {
    return;
  }
  const next = flushDesktopChatQueue(state.chat);
  if (!next) {
    return;
  }
  submitComposerMessage(next.text, {
    attachments: next.attachments,
  }).catch((error) => {
    reportNonFatalUiError(error, "续发排队输入失败");
  });
}

function isComposerTurnDetachedFromBackend(controller) {
  if (!controller || state.running) {
    return false;
  }
  const activeTask = findActiveComposerTask();
  return !activeTask || !isTaskRuntimeComposerTurnTask(activeTask, controller.turnId);
}

function finalizeOrphanedComposerTurn(controller) {
  appendTimelineRunTranscriptStep(controller.timelineHandle, {
    key: "turn-detached-from-backend",
    kind: "error",
    state: "failed",
    label: "后台没有对应运行任务，已结束这次等待",
  });
  finalizeOptimisticComposerTask(controller, "failed", "后台没有对应运行任务，桌面端结束等待。");
  finishComposerTurn(controller);
}

function finalizeStaleStreamingTimelineMessage(article) {
  const transcript = article.querySelector(".run-transcript");
  const list = article.querySelector(".run-transcript-list");
  transcript?.classList.add("stale");
  if (list) {
    const row = document.createElement("div");
    row.className = "run-transcript-step";
    row.dataset.state = "failed";
    row.innerHTML =
      '<span class="run-transcript-icon">!</span><span>后台已无运行任务，但这张等待卡未收到最终回复，已自动结束。</span>';
    list.append(row);
  }
  markTimelineMessageAsStale(article, "等待已结束");
}

function installBridgeEventHandlers() {
  if (state.bridgeEventUnsubscribe || typeof bridge?.onEvent !== "function") {
    return;
  }
  state.bridgeEventUnsubscribe = bridge.onEvent((event) => {
    handleNativeBridgeEvent(event);
  });
}

function handleNativeBridgeEvent(event) {
  if (event?.type === "external-tool.timeline") {
    mergeExternalToolTimelineEvent(event);
  }
  if (
    event?.actionType === "background.scheduler" ||
    event?.actionType === "background.worker"
  ) {
    rememberBackgroundLearningRuntimeEvent(event);
  }
  if (event?.type === "task-runtime.event" && event.taskRuntime) {
    applyTaskRuntimeSnapshot(event.taskRuntime);
  }
  appendTimelineRunTranscriptFromNativeBridgeEvent(event);
  if (!event?.stream || !state.activeStreamHandle || !shouldAppendNativeBridgeStreamEvent(event)) {
    return;
  }
  if (event.type === "conversation.model.delta") {
    appendTimelineMessageTextDelta(state.activeStreamHandle, {
      title: event.title ?? "Angel 正在处理",
      body: event.body ?? "",
      role: event.role ?? DESKTOP_EVENT_ROLES.ANGEL,
    });
    return;
  }
  const streamMessage = createUserFacingBridgeStreamMessage(event);
  appendTimelineMessageChunk(state.activeStreamHandle, {
    title: streamMessage.title,
    body: streamMessage.body,
    role: streamMessage.role,
  });
}

function createUserFacingBridgeStreamMessage(event) {
  if (event?.type === "external-tool.timeline") {
    return createUserFacingExternalToolTimelineMessage(event);
  }
  return {
    title: event.title ?? "Angel 正在执行",
    body: scrubUserFacingRuntimeText(event.body ?? ""),
    role: event.role ?? DESKTOP_EVENT_ROLES.ANGEL,
  };
}

function createUserFacingExternalToolTimelineMessage(event) {
  const toolId =
    typeof event?.externalToolExecution?.toolId === "string"
      ? event.externalToolExecution.toolId
      : "";
  const status =
    typeof event?.externalToolTimelineEntry?.status === "string"
      ? event.externalToolTimelineEntry.status
      : "";
  return {
    title: "Angel 正在处理",
    body: formatUserFacingExternalToolProgress(toolId, status),
    role: DESKTOP_EVENT_ROLES.ANGEL,
  };
}

function formatUserFacingExternalToolProgress(toolId, status) {
  if (toolId === "web_extract" || toolId === "web_extract_artifact_read") {
    if (status === "completed") return "网页读取完成，正在整理结果。";
    if (status === "failed") return "这次没有读到可用正文，正在尝试收口。";
    return "正在读取网页正文。";
  }
  if (toolId.startsWith("browser_") || toolId === "browser") {
    if (status === "completed") return "页面检查完成，正在整理结果。";
    if (status === "failed") return "浏览器没有拿到可用页面，正在换方式处理。";
    return "正在打开并检查页面。";
  }
  if (toolId === "web_search") {
    if (status === "completed") return "搜索完成，正在核对来源。";
    if (status === "failed") return "这次没有搜到可靠结果，正在收口。";
    return "正在检索公开资料。";
  }
  if (status === "completed") return "能力调用完成，正在整理结果。";
  if (status === "failed") return "能力调用没有拿到可用结果，正在收口。";
  return "正在调用需要的能力。";
}

function scrubUserFacingRuntimeText(value) {
  const text = String(value ?? "").trim();
  if (text.length === 0) {
    return "";
  }
  if (/(?:web_extract|web_search|browser_snapshot|browser_navigate|External tool|next_actions|provider:|status:|summary:)/iu.test(text)) {
    return "正在处理资料，稍等一下。";
  }
  return text;
}

function shouldAppendNativeBridgeStreamEvent(event) {
  const activeTurn = state.activeComposerTurn;
  if (!activeTurn || activeTurn.stopped === true) {
    return false;
  }
  const eventTurnId = readNativeBridgeEventTurnId(event);
  const eventSessionKey = readNativeBridgeEventSessionKey(event);
  const sessionMatches = eventSessionKey === null || eventSessionKey === state.chat.sessionKey;
  return sessionMatches && (eventTurnId === null || eventTurnId === activeTurn.turnId);
}

function readNativeBridgeEventTurnId(event) {
  const candidates = [
    event?.turnId,
    event?.metadata?.turnId,
    event?.externalToolExecution?.turnId,
    event?.externalToolExecution?.metadata?.turnId,
    event?.externalToolTimelineEntry?.metadata?.turnId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function readNativeBridgeEventSessionKey(event) {
  const candidates = [
    event?.sessionKey,
    event?.metadata?.sessionKey,
    event?.externalToolExecution?.sessionKey,
    event?.externalToolExecution?.metadata?.sessionKey,
    event?.externalToolTimelineEntry?.metadata?.sessionKey,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function mergeExternalToolTimelineEvent(event) {
  const externalToolBus = state.snapshot?.assets?.tools?.externalToolBus;
  const execution = event?.externalToolExecution;
  if (!externalToolBus || !execution?.id) {
    return;
  }
  const history = [execution, ...(externalToolBus.history ?? []).filter((item) => item.id !== execution.id)]
    .sort((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))
    .slice(0, 12);
  const activeStatuses = new Set(["queued", "executing", "yielded"]);
  const terminalStatuses = new Set(["cancelled", "completed", "failed"]);
  state.snapshot = {
    ...state.snapshot,
    assets: {
      ...state.snapshot.assets,
      tools: {
        ...state.snapshot.assets.tools,
        externalToolBus: {
          ...externalToolBus,
          history,
          executionCount: history.length,
          activeExecutionCount: history.filter((item) => activeStatuses.has(item.status)).length,
          completedExecutionCount: history.filter((item) => terminalStatuses.has(item.status)).length,
          failedExecutionCount: history.filter((item) => item.status === "failed").length,
          latestExecution: history[0] ?? null,
        },
      },
    },
  };
  if (state.selectedGroupId === "tools") {
    renderCommandList();
  } else if (state.selectedGroupId === "settings" && state.selectedSettingsTab === "externalTools") {
    renderSettingsSurface();
  }
}

function applyExternalToolBusSnapshot(externalToolBus) {
  if (!externalToolBus || typeof externalToolBus !== "object" || !state.snapshot) {
    return;
  }
  const assets = state.snapshot.assets ?? {};
  const tools = assets.tools ?? {};
  state.snapshot = {
    ...state.snapshot,
    assets: {
      ...assets,
      tools: {
        ...tools,
        externalToolBus,
      },
    },
  };
  if (state.selectedGroupId === "tools") {
    renderCommandList();
  } else if (state.selectedGroupId === "settings" && state.selectedSettingsTab === "externalTools") {
    renderSettingsSurface();
  }
  scheduleRunCenterRender();
}

async function invokeBridge(action) {
  if (!bridge) {
    return null;
  }
  const traceId = logRendererBridgeInvoke("start", action);
  try {
    const result = await bridge.invoke(action);
    logRendererBridgeInvoke("finish", action, { traceId });
    return result;
  } catch (error) {
    logRendererBridgeInvoke("error", action, {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });
    renderCommandError(error);
    return null;
  }
}

function logRendererBridgeInvoke(phase, action, details = {}) {
  state.rendererBridgeTraceSequence += 1;
  const traceId = details.traceId ?? `renderer-bridge-${state.rendererBridgeTraceSequence}`;
  const payload = {
    traceId,
    phase,
    actionType: action?.type ?? "unknown",
    turnId: action?.turnId ?? action?.payload?.turnId ?? "",
    timestamp: new Date().toISOString(),
    ...details,
  };
  console.info("[Director Angel renderer bridge] " + JSON.stringify(payload));
  return traceId;
}

async function invokeBridgeWithTimeout(action, options = {}) {
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : null;
  if (timeoutMs === null) {
    return await invokeBridge(action);
  }
  let timeout = null;
  try {
    return await Promise.race([
      invokeBridge(action),
      new Promise((resolve) => {
        timeout = setTimeout(() => {
          const error = new Error(options.timeoutMessage ?? `本机运行服务请求超时：${timeoutMs}ms`);
          if (options.silentTimeout === true) {
            reportNonFatalUiError(error, "本机运行服务请求超时");
          } else {
            renderCommandError(error);
          }
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

async function renderBridgeResult(result, options = {}) {
  if (!result) {
    return false;
  }
  await renderTimelineRunTranscriptFromResult(result, options);
  renderOperatorTraceResult(result.operatorTrace);
  if (result.snapshot) {
    renderSnapshot(result.snapshot);
  }
  if (result.taskRuntime) {
    applyTaskRuntimeSnapshot(result.taskRuntime);
  }
  if (result.externalToolBus) {
    applyExternalToolBusSnapshot(result.externalToolBus);
  }
  if (result.commandResult) {
    renderCommandResult(result.commandResult);
  }
  if (result.apiProviderRun) {
    renderApiProviderRunResult(result.apiProviderRun);
    if (options.timelineHandle) {
      await completeTimelineMessageStreaming(
        options.timelineHandle,
        createApiProviderRunTimelineMessage(result.apiProviderRun),
      );
      return true;
    }
  }
  if (result.apiProviderImage) {
    renderApiProviderImageResult(result.apiProviderImage);
    if (options.timelineHandle) {
      updateTimelineMessage(options.timelineHandle, createApiProviderMediaTimelineMessage(result.apiProviderImage, "图片"));
      return true;
    }
  }
  if (result.apiProviderVideo) {
    renderApiProviderVideoResult(result.apiProviderVideo);
    if (options.timelineHandle) {
      updateTimelineMessage(options.timelineHandle, createApiProviderMediaTimelineMessage(result.apiProviderVideo, "视频"));
      return true;
    }
  }
  if (result.apiProviderModelSync) {
    renderApiProviderModelSyncResult(result.apiProviderModelSync);
  }
  if (result.comfyUiWorkflow) {
    renderComfyUiWorkflowResult(result.comfyUiWorkflow);
  }
  if (result.comfyUiRun) {
    renderComfyUiRunResult(result.comfyUiRun);
  }
  if (result.comfyUiLifecycle) {
    renderComfyUiLifecycleResult(result.comfyUiLifecycle, result.externalToolExecution);
  }
  if (result.comfyUiDependencyFix) {
    renderComfyUiDependencyFixResult(result.comfyUiDependencyFix, result.externalToolExecution);
  }
  if (result.runControlResult) {
    renderRunControlResult(result.runControlResult);
  }
  if (result.reflectionResult) {
    renderReflectionResult(result.reflectionResult);
  }
  if (result.productionRun) {
    if (options.composerTurn && !isComposerTurnActive(options.composerTurn)) {
      return Boolean(options.timelineHandle);
    }
    await renderProductionRunResult(result.productionRun, options);
    return Boolean(options.timelineHandle);
  }
  const runtimeTimelineMessage = createConversationRuntimeBridgeTimelineMessage(result);
  if (runtimeTimelineMessage && options.timelineHandle) {
    if (options.composerTurn && !isComposerTurnActive(options.composerTurn)) {
      return true;
    }
    setResultOutputWithContext(runtimeTimelineMessage.body, null, {
      evidenceDisclosure: runtimeTimelineMessage.evidenceDisclosure,
    });
    selectInspectorPanel("result");
    await completeTimelineMessageStreaming(options.timelineHandle, runtimeTimelineMessage);
    return true;
  }
  const eventResultRendered = renderEventOnlyBridgeResult(result);
  const primaryEvent = selectPrimaryBridgeResultEvent(result.events);
  if (primaryEvent && options.timelineHandle) {
    if (options.composerTurn && !isComposerTurnActive(options.composerTurn)) {
      return true;
    }
    await completeTimelineMessageStreaming(options.timelineHandle, primaryEvent);
    return true;
  }
  for (const event of result.events ?? []) {
    if (options.composerTurn && !isComposerTurnActive(options.composerTurn)) {
      return Boolean(options.timelineHandle);
    }
    appendTimelineMessage(event);
    await waitForTimelineStep();
  }
  if (!eventResultRendered) {
    renderEventOnlyBridgeResult(result);
  }
  return false;
}

function createConversationRuntimeBridgeTimelineMessage(result) {
  const runtime = isPlainObject(result?.conversationRuntime) ? result.conversationRuntime : null;
  const task = findConversationRuntimeTaskForBridgeResult(result);
  if (runtime === null && task === null) {
    return null;
  }
  const body =
    readNonEmptyTimelineText(runtime?.finalText) ??
    readNonEmptyTimelineText(runtime?.userFacingProjection?.userText) ??
    (task === null ? null : resolveConversationRuntimeTaskFinalText(task));
  if (body === null || body.length === 0) {
    return null;
  }
  const failed = runtime?.replySource === "degraded-error" || task?.status === "failed";
  return {
    role: failed ? DESKTOP_EVENT_ROLES.SYSTEM : DESKTOP_EVENT_ROLES.ANGEL,
    title: failed ? "Angel 没有回复成功" : "Angel 已回复",
    body,
    evidenceDisclosure:
      runtime?.evidenceDisclosure ?? resolveTaskRuntimeEvidenceDisclosure(task) ?? null,
  };
}

function findConversationRuntimeTaskForBridgeResult(result) {
  const turnId = readNonEmptyTimelineText(result?.conversationRuntime?.turnId);
  const tasks = collectConversationRuntimeTasksFromBridgeResult(result);
  if (turnId !== null) {
    const matched = tasks.find((task) => {
      const taskTurnId =
        readNonEmptyTimelineText(task?.turnId) ??
        readNonEmptyTimelineText(task?.payload?.turnId);
      return taskTurnId === turnId;
    });
    if (matched) {
      return matched;
    }
  }
  return tasks.find((task) => task?.category === "conversation-runtime") ?? null;
}

function collectConversationRuntimeTasksFromBridgeResult(result) {
  const taskRuntime = result?.taskRuntime;
  const snapshotTaskRuntime = result?.snapshot?.assets?.tools?.taskRuntime;
  return [
    ...(Array.isArray(taskRuntime?.recentTasks) ? taskRuntime.recentTasks : []),
    ...(Array.isArray(taskRuntime?.tasks) ? taskRuntime.tasks : []),
    ...(Array.isArray(taskRuntime?.activeTasks) ? taskRuntime.activeTasks : []),
    ...(Array.isArray(snapshotTaskRuntime?.tasks) ? snapshotTaskRuntime.tasks : []),
    ...(Array.isArray(snapshotTaskRuntime?.recentTasks) ? snapshotTaskRuntime.recentTasks : []),
  ].filter((task) => isPlainObject(task));
}

function renderEventOnlyBridgeResult(result) {
  const primary = selectPrimaryBridgeResultEvent(result?.events);
  if (!primary) {
    return false;
  }
  const title = typeof primary.title === "string" ? primary.title.trim() : "";
  const body = typeof primary.body === "string" ? primary.body.trim() : "";
  const value = [title, body].filter(Boolean).join("\n");
  if (value.length === 0) {
    return false;
  }
  setResultOutputWithContext(value, result.apiProviderRun?.contextualRecall ?? null, {
    evidenceDisclosure:
      primary.evidenceDisclosure ?? result.conversationRuntime?.evidenceDisclosure ?? null,
  });
  selectInspectorPanel("result");
  return true;
}

function selectPrimaryBridgeResultEvent(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }
  const candidates = events.filter((event) => {
    const body = typeof event?.body === "string" ? event.body.trim() : "";
    return body.length > 0;
  });
  if (candidates.length === 0) {
    return null;
  }
  return (
    candidates
      .slice()
      .reverse()
      .find((event) => {
        const title = typeof event?.title === "string" ? event.title : "";
        return event?.role === DESKTOP_EVENT_ROLES.ANGEL || title.includes("Angel") || event?.evidenceDisclosure;
      }) ?? candidates.at(-1)
  );
}

function renderOperatorTraceResult(operatorTrace) {
  if (!elements.operatorTraceOutput) {
    return;
  }
  const lines = [...formatOperatorTraceSummaryLines(operatorTrace), ...formatOperatorTraceLines(operatorTrace)];
  elements.operatorTraceOutput.textContent =
    lines.length > 0 ? lines.join("\n") : "暂无 turn trace。";
}

function formatOperatorTraceSummaryLines(trace) {
  if (!Array.isArray(trace) || trace.length === 0) {
    return [];
  }
  const summary = summarizeOperatorTrace(trace);
  return [
    "运行摘要",
    `意图：${summary.intent}`,
    `召回：${summary.recall}`,
    `工具确认：${summary.approval}`,
    `模型/工具循环：${summary.modelLoop}`,
    `最终状态：${summary.finalState}`,
    "",
    "详细 trace",
  ];
}

function formatOperatorTraceLines(trace) {
  if (!Array.isArray(trace)) {
    return [];
  }
  return trace.map((item, index) => {
    const stage = item?.stage ?? "unknown";
    const detail = item?.detail ?? "";
    const metadata = item?.metadata ? ` · ${JSON.stringify(item.metadata)}` : "";
    return `${index + 1}. ${stage}${detail ? `：${detail}` : ""}${metadata}`;
  });
}

function summarizeOperatorTrace(trace) {
  const orchestrated = trace.find((item) => item?.stage === "turn.orchestrated");
  const capability = trace.find((item) => item?.stage === "capability.resolved");
  const capabilityDegraded = trace.find((item) => item?.stage === "capability.degraded");
  const production = trace.find((item) => item?.stage === "production.dispatched");
  const modelLoop = trace.find((item) => item?.stage === "model.loop.completed");
  const approval = trace.find(
    (item) =>
      item?.stage === "tool.approval.required" ||
      item?.stage === "tool.authorized" ||
      item?.stage === "tool.blocked",
  );
  return {
    intent: formatOperatorTraceMetadataValue(orchestrated?.metadata?.intent),
    recall: formatOperatorTraceRecall(capability, capabilityDegraded),
    approval: approval
      ? `${approval.stage}${approval.detail ? ` · ${approval.detail}` : ""}`
      : "无待确认工具",
    modelLoop: modelLoop
      ? `${formatOperatorTraceMetadataValue(modelLoop.metadata?.stoppedReason)} · 事件 ${formatOperatorTraceMetadataValue(
          modelLoop.metadata?.eventCount,
        )}`
      : "未进入模型/工具循环",
    finalState: production
      ? `${formatOperatorTraceMetadataValue(production.metadata?.status)} · 经验 ${formatOperatorTraceMetadataValue(
          production.metadata?.recallStatus,
        )} · Skill ${formatOperatorTraceMetadataValue(production.metadata?.skillStatus)}`
      : "非制作任务或尚未派发制作",
  };
}

function formatOperatorTraceRecall(capability, capabilityDegraded) {
  if (capability) {
    return `${formatOperatorTraceMetadataValue(capability.metadata?.status)} · 命中 ${formatOperatorTraceMetadataValue(
      capability.metadata?.hitCount,
    )}`;
  }
  if (capabilityDegraded) {
    return "degraded";
  }
  return "未请求召回";
}

function formatOperatorTraceMetadataValue(value) {
  if (value === undefined || value === null || value === "") {
    return "unknown";
  }
  return String(value);
}

function renderReflectionResult(reflectionResult) {
  const lines = [
    "运行复盘",
    `复盘结论：${formatReflectionOutcome(reflectionResult.outcome)}`,
    `运行：${reflectionResult.runId ?? "未知"}`,
    `报告：${reflectionResult.reportId ?? "未知"}`,
    `建议沉淀：${formatReflectionIntent(reflectionResult.suggestedExperienceIntent)}`,
    `已写入经验候选：${formatReflectionWriteStatus(
      reflectionResult.experienceWriteStatus,
      reflectionResult.recommendedCandidateId,
      reflectionResult.learningEnabled,
    )}`,
    reflectionResult.soulCandidateId
      ? `灵魂候选：${reflectionResult.soulCandidateId}（${formatReflectionWriteStatus(
          reflectionResult.soulWriteStatus,
        )}）`
      : null,
    reflectionResult.positiveBlocked
      ? "正向经验：本次结果没有作为正向经验发布，已转入失败教训或隔离链路。"
      : null,
    ...formatReflectionSection("做对了", reflectionResult.whatWorked, "暂无明确正向证据。"),
    ...formatReflectionSection("问题记录", reflectionResult.whatFailed, "暂无明确失败证据。"),
    ...formatReflectionSection("可复用经验", reflectionResult.reusableLessons, "暂无可复用经验。"),
    ...formatReflectionSection("失败教训", reflectionResult.failureLessons, "暂无失败教训。"),
    ...formatReflectionSection("下一步", reflectionResult.nextActions, "暂无下一步动作。"),
    reflectionResult.reflectionPath ? `复盘文件：${reflectionResult.reflectionPath}` : null,
    reflectionResult.soulWritePath ? `灵魂文件：${reflectionResult.soulWritePath}` : null,
    reflectionResult.reflectionId ? `复盘 ID：${reflectionResult.reflectionId}` : null,
  ];
  setResultOutput(lines.filter(Boolean).join("\n"));
  selectInspectorPanel("result");
}

function renderRunControlResult(runControlResult) {
  const lines = [
    runControlResult.ok ? "运行推进完成" : "运行推进失败",
    `Run：${runControlResult.runId ?? "未知"}`,
    `状态：${runControlResult.initialStatus ?? "未知"} -> ${runControlResult.runStatus ?? "未知"}`,
    `批准：${runControlResult.approvedAssignments?.length ?? 0} 个`,
    `执行：${runControlResult.executedAssignments?.length ?? 0} 个`,
    runControlResult.assignmentCounts
      ? `任务：${formatProductionAssignmentCounts(runControlResult.assignmentCounts)}`
      : null,
    runControlResult.reportId ? `报告：${runControlResult.reportId}` : null,
    runControlResult.reportSummary?.length > 0
      ? ["报告摘要：", ...runControlResult.reportSummary.map((item) => `- ${item}`)].join("\n")
      : null,
    runControlResult.reportFlags?.length > 0
      ? `标记：${formatList(runControlResult.reportFlags)}`
      : null,
    runControlResult.memoryIngest
      ? `长期记忆：${formatMemoryIngestStatus(runControlResult.memoryIngest)}`
      : null,
    runControlResult.nextAction ? `下一步：${runControlResult.nextAction}` : null,
  ];
  setResultOutput(lines.filter(Boolean).join("\n"));
  selectInspectorPanel("result");
}

function formatMemoryIngestStatus(memoryIngest) {
  const status =
    memoryIngest.status === "ok" ? "已写入" : `异常 · ${memoryIngest.status ?? "unknown"}`;
  const record = memoryIngest.recordId ? ` · ${memoryIngest.recordId}` : "";
  const note =
    Array.isArray(memoryIngest.notes) && memoryIngest.notes.length > 0
      ? ` · ${memoryIngest.notes[0]}`
      : "";
  return `${status}${record}${note}`;
}

function formatReflectionOutcome(outcome) {
  const labels = {
    success: "成功，可以考虑沉淀为正向经验。",
    failure: "失败，应优先沉淀为失败教训。",
    mixed: "部分成功，先记录风险和失败教训，再决定是否复用。",
    unknown: "结果不明确，需要人工回看运行证据。",
  };
  return labels[outcome] ?? outcome ?? "未知";
}

function formatReflectionIntent(intent) {
  const labels = {
    "positive-experience": "正向经验",
    "failure-lesson": "失败教训",
    none: "不建议沉淀",
  };
  return labels[intent] ?? intent ?? "未知";
}

function formatReflectionWriteStatus(status, candidateId = null, learningEnabled = true) {
  if (candidateId) {
    return `${candidateId}（${formatReflectionWriteStatus(status)}）`;
  }
  if (learningEnabled === false || status === "disabled") {
    return "未写入，自我学习入口已关闭。";
  }
  const labels = {
    ok: "已写入，等待经验库审核。",
    degraded: "已尝试写入，但存在降级或警告，需要回看证据。",
    none: "未写入，本次没有生成候选。",
    pending: "已生成，等待审核。",
  };
  return labels[status] ?? status ?? "未知";
}

function formatReflectionSection(title, items, emptyCopy) {
  const values = Array.isArray(items)
    ? items.filter((item) => String(item ?? "").trim().length > 0)
    : [];
  return [title, ...(values.length > 0 ? values.map((item) => `- ${item}`) : [`- ${emptyCopy}`])];
}

async function renderProductionRunResult(productionRun, options = {}) {
  setResultOutput(productionRun.workbenchOutput || "没有可显示的制作结果。");
  selectInspectorPanel("result");
  const message = {
    role: DESKTOP_EVENT_ROLES.ANGEL,
    title: productionRun.ok ? "制作结果" : "制作未完成",
    body: createProductionWorkbenchReply(productionRun),
  };
  if (options.timelineHandle) {
    await renderProductionTimelineProgress(options.timelineHandle, productionRun);
    const finalHandle = await completeTimelineMessageStreaming(options.timelineHandle, message);
    attachProductionRunTimelineActions(finalHandle, productionRun);
    return;
  }
  const handle = appendTimelineMessage(message);
  attachProductionRunTimelineActions(handle, productionRun);
}

async function renderProductionTimelineProgress(handle, productionRun) {
  const stages = Array.isArray(productionRun.stageTimeline) ? productionRun.stageTimeline : [];
  if (!handle || stages.length === 0) {
    return;
  }
  const visibleStages = [];
  for (const [index, stage] of stages.entries()) {
    const stageMessage = createProductionStageProgressMessage(stage, index, stages.length);
    visibleStages.push(`${stageMessage.title}\n${stageMessage.body}`);
    updateTimelineMessage(handle, {
      role: stageMessage.role,
      title: "Angel 正在制作",
      body: visibleStages.join("\n\n"),
    });
    await waitForTimelineStep();
  }
}

function createProductionStageProgressMessage(stage, index, total) {
  const fields = Array.isArray(stage.fields)
    ? stage.fields.slice(0, 5).map((field) => `- ${field.label}: ${field.value}`)
    : [];
  return {
    role: DESKTOP_EVENT_ROLES.ANGEL,
    title: `执行流 · ${stage.title}`,
    body: [
      `第 ${index + 1}/${total} 步 · ${formatProductionStageStatus(stage.status)}`,
      stage.source ? `来源：${stage.source}` : null,
      stage.summary,
      fields.length > 0 ? "" : null,
      ...fields,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function createProductionWorkbenchReply(productionRun) {
  return productionRun.workbenchOutput || "没有可显示的制作结果。";
}

function renderProductionStageTimeline(stageTimeline) {
  if (!Array.isArray(stageTimeline) || stageTimeline.length === 0) {
    return ["- 后端没有返回阶段流。"];
  }
  return stageTimeline.map((stage, index) => {
    const fields = Array.isArray(stage.fields)
      ? stage.fields
          .slice(0, 3)
          .map((field) => `${field.label}: ${field.value}`)
          .join("；")
      : "";
    const detail = fields.length > 0 ? ` · ${fields}` : "";
    return `${index + 1}. ${stage.title} · ${formatProductionStageStatus(stage.status)}${detail}\n   ${stage.summary}`;
  });
}

function formatProductionStageStatus(status) {
  const labels = {
    completed: "已完成",
    created: "已创建",
    hit: "命中",
    miss: "未命中",
    disabled: "已关闭",
    warning: "需留意",
    skipped: "已跳过",
    running: "进行中",
    pending: "待审查",
    failed: "失败",
    blocked: "阻塞",
  };
  return labels[status] ?? status ?? "未知";
}

function formatProductionReviewDecision(decision) {
  const labels = {
    approved: "已通过",
    blocked: "已阻断",
    needs_review: "需要人工审查",
    operator_approve: "需要人工批准",
    forbidden_in_beta1: "Beta-1 禁止执行",
  };
  return labels[decision] ?? decision ?? "未知";
}

function formatProductionRecallStatus(status) {
  const labels = {
    hit: "命中",
    miss: "未命中",
    skipped: "已跳过",
    disabled: "已关闭",
    degraded: "降级",
    blocked: "阻断",
    ok: "正常",
  };
  return labels[status] ?? status ?? "未知";
}

function formatProductionAssignmentCounts(counts) {
  return [
    `已完成 ${counts.completed ?? 0}`,
    `待审 ${counts.pending ?? 0}`,
    `就绪 ${counts.ready ?? 0}`,
    `失败 ${counts.failed ?? 0}`,
  ].join("；");
}

function attachProductionRunTimelineActions(handle, productionRun) {
  if (!handle?.bubble || !productionRun.runId) {
    return;
  }
  const actions = document.createElement("div");
  actions.className = "timeline-actions";
  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.className = "secondary-button";
  runButton.textContent = "查看运行详情";
  runButton.addEventListener("click", () => {
    selectAssetDetail("review", `run:${productionRun.runId}`);
  });
  actions.append(runButton);
  handle.bubble.append(actions);
}

function renderApiProviderRunResult(runResult) {
  const visibleBody = readApiProviderRunVisibleBody(runResult);
  const lines = [
    runResult.ok ? "Angel 已回复" : "Angel 没有回复成功",
    ...(runResult.ok
      ? [formatApiProviderRunEndpoint(runResult), formatApiProviderRunLatency(runResult)]
      : formatApiProviderRunFailureDetails(runResult)),
    visibleBody,
  ];
  setResultOutputWithContext(lines.filter(Boolean).join("\n"), runResult.contextualRecall, {
    approvalNotice: createRuntimeApprovalNotice(runResult.runtimeEvents),
    evidenceDisclosure: runResult.evidenceDisclosure,
  });
}

function formatApiProviderRunEndpoint(runResult) {
  return typeof runResult.endpoint === "string" && runResult.endpoint.trim().length > 0
    ? `接口：${runResult.endpoint}`
    : "接口：统一运行时";
}

function formatApiProviderRunLatency(runResult) {
  return typeof runResult.latencyMs === "number" && Number.isFinite(runResult.latencyMs)
    ? `耗时：${runResult.latencyMs}ms`
    : "耗时：未记录";
}

function formatApiProviderRunFailureDetails(runResult) {
  const details = [];
  if (typeof runResult.endpoint === "string" && runResult.endpoint.trim().length > 0) {
    details.push(formatApiProviderRunEndpoint(runResult));
  }
  if (
    typeof runResult.latencyMs === "number" &&
    Number.isFinite(runResult.latencyMs) &&
    runResult.latencyMs > 0
  ) {
    details.push(formatApiProviderRunLatency(runResult));
  }
  if (details.length === 0) {
    details.push("这次失败没有拿到有效接口或耗时记录；详细 trace 留在运行记录里。");
  }
  return details;
}

function createApiProviderRunTimelineMessage(runResult) {
  const body = createApiProviderRunTimelineBody(runResult);
  return {
    role: runResult.ok ? DESKTOP_EVENT_ROLES.ANGEL : DESKTOP_EVENT_ROLES.SYSTEM,
    title: runResult.ok ? "Angel 已回复" : "Angel 没有回复成功",
    body,
    evidenceDisclosure: runResult.evidenceDisclosure,
  };
}

function createApiProviderRunTimelineBody(runResult) {
  if (
    runResult?.replySource === "structured-renderer" &&
    typeof runResult.output === "string" &&
    runResult.output.trim().length > 0
  ) {
    return runResult.output.trim();
  }
  return readApiProviderRunVisibleBody(runResult);
}

function readApiProviderRunVisibleBody(runResult) {
  const output = typeof runResult?.output === "string" ? runResult.output.trim() : "";
  if (output.length > 0) {
    return output;
  }
  return typeof runResult?.message === "string" ? runResult.message.trim() : "";
}

function createConversationRuntimeTaskTimelineMessage(task) {
  const ok = task.status === "completed";
  return {
    role: ok ? DESKTOP_EVENT_ROLES.ANGEL : DESKTOP_EVENT_ROLES.SYSTEM,
    title: ok ? "Angel 已回复" : "Angel 没有回复成功",
    body: resolveConversationRuntimeTaskFinalText(task),
    evidenceDisclosure: resolveTaskRuntimeEvidenceDisclosure(task),
  };
}

function resolveConversationRuntimeTaskFinalText(task) {
  const ok = task?.status === "completed";
  const finalText =
    readNonEmptyTimelineText(task?.payload?.finalText) ??
    readNonEmptyTimelineText(task?.finalText) ??
    readNonEmptyTimelineText(task?.summary?.finalText);
  if (finalText !== null) {
    return finalText;
  }
  const preview = readNonEmptyTimelineText(task?.payload?.finalTextPreview ?? task?.finalTextPreview);
  if (preview !== null && preview !== "ConversationRuntime 已完成本回合。") {
    return preview;
  }
  return readNonEmptyTimelineText(task?.error) ?? (ok ? "" : "ConversationRuntime 没有返回可展示结果。");
}

function readNonEmptyTimelineText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function renderConversationRuntimeTaskResult(task) {
  const message = createConversationRuntimeTaskTimelineMessage(task);
  const title = typeof message.title === "string" ? message.title.trim() : "";
  const body = typeof message.body === "string" ? message.body.trim() : "";
  const value = [title, body].filter(Boolean).join("\n");
  if (value.length === 0) {
    return false;
  }
  setResultOutputWithContext(value, null, {
    evidenceDisclosure: message.evidenceDisclosure,
  });
  selectInspectorPanel("result");
  return true;
}

function resolveTaskRuntimeEvidenceDisclosure(task) {
  return (
    task?.evidenceDisclosure ??
    task?.payload?.evidenceDisclosure ??
    task?.summary?.evidenceDisclosure ??
    null
  );
}

function createApiProviderMediaTimelineMessage(mediaResult, label) {
  return {
    role: mediaResult.ok ? DESKTOP_EVENT_ROLES.ANGEL : DESKTOP_EVENT_ROLES.SYSTEM,
    title: mediaResult.ok ? `${label}生成完成` : `${label}生成失败`,
    body: [
      `${mediaResult.providerId} · ${mediaResult.model}`,
      mediaResult.output ?? mediaResult.message,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function setResultOutputWithContext(value, contextualRecall, options = {}) {
  if (!elements.resultOutput) {
    return;
  }
  const text = document.createElement("pre");
  text.className = "result-output-text";
  text.textContent = value;
  const context = createContextualRecallDisclosure(contextualRecall);
  const children = [text];
  if (options.approvalNotice) {
    children.push(options.approvalNotice);
  }
  const evidence = createEvidenceDisclosureDetails(options.evidenceDisclosure, {
    onAuthorizeMedia: executeMediaAuthorization,
  });
  if (evidence) {
    children.push(evidence);
  }
  if (context) {
    children.push(context);
  }
  elements.resultOutput.replaceChildren(...children);
}

function createRuntimeApprovalNotice(runtimeEvents) {
  const approvalEvents = (runtimeEvents ?? []).filter((event) => event?.kind === "runtime.approval");
  if (approvalEvents.length === 0) {
    return null;
  }
  const approval = approvalEvents[0]?.payload?.approval;
  const notice = document.createElement("section");
  notice.className = "runtime-approval-notice";
  const title = document.createElement("strong");
  title.textContent = "需要你确认";
  const body = document.createElement("p");
  body.textContent = formatRuntimeApprovalSummary(approval);
  const meta = document.createElement("div");
  meta.className = "runtime-approval-meta";
  meta.append(
    createRuntimeApprovalMetaRow("工具", approval?.metadata?.toolName ?? "受控工具"),
    createRuntimeApprovalMetaRow(
      "权限模式",
      formatRuntimeApprovalMode(approval?.metadata?.decisionMetadata?.toolApprovalMode),
    ),
    createRuntimeApprovalMetaRow(
      "风险",
      formatRuntimeApprovalRisk(
        approval?.metadata?.toolMetadata?.risk ?? approval?.metadata?.decisionMetadata?.risk,
      ),
    ),
  );
  const processLedger = createRuntimeApprovalProcessLedger(approval);
  if (processLedger) {
    meta.append(processLedger);
  }
  const next = document.createElement("small");
  next.className = "runtime-approval-next";
  next.textContent = "等待确认，不会自动执行。可以到设置 · 护栏预算切换工具确认模式。";
  const actions = createRuntimeApprovalActions(approval);
  notice.append(title, body, meta, next);
  if (actions) {
    notice.append(actions);
  }
  return notice;
}

function formatRuntimeApprovalSummary(approval) {
  if (!approval) {
    return "有一步需要确认后才能继续执行。";
  }
  const title = approval.title || "这一步";
  const summary = approval.summary || "需要确认后再执行。";
  const toolName = approval.metadata?.toolName ? ` 工具：${approval.metadata.toolName}。` : "";
  return `${title}：${summary}${toolName}`;
}

function createRuntimeApprovalMetaRow(label, value) {
  const item = document.createElement("span");
  item.textContent = `${label}：${value || "未知"}`;
  return item;
}

function createRuntimeApprovalProcessLedger(approval) {
  const ledger = readRuntimeApprovalProcessCapabilityLedger(approval);
  if (!ledger || !Number.isFinite(ledger.totalEntries) || ledger.totalEntries <= 0) {
    return null;
  }
  const details = document.createElement("details");
  details.className = "runtime-approval-process-ledger";
  const summary = document.createElement("summary");
  summary.textContent = `Agent OS 进程账本：total=${ledger.totalEntries} host=${ledger.riskyHostEntries ?? 0}`;
  const list = document.createElement("ul");
  for (const entry of (ledger.entries ?? []).slice(0, 3)) {
    const item = document.createElement("li");
    item.textContent = formatRuntimeApprovalProcessLedgerEntry(entry);
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

function readRuntimeApprovalProcessCapabilityLedger(approval) {
  const metadata = approval?.metadata;
  return (
    metadata?.agentOsProcessCapabilityLedger ??
    metadata?.decisionMetadata?.agentOsProcessCapabilityLedger ??
    null
  );
}

function formatRuntimeApprovalProcessLedgerEntry(entry) {
  const command =
    entry?.command ??
    (entry?.commandPattern
      ? [entry.commandPattern.executable, ...(entry.commandPattern.argv ?? [])].join(" ")
      : null);
  const operationId = entry?.operationId ?? entry?.commandPattern?.operationId;
  return [
    entry?.runnerKind ?? "process",
    entry?.backend ? `backend=${entry.backend}` : null,
    `status=${entry?.status ?? "unknown"}`,
    command ? `command=${command}` : null,
    operationId ? `operation=${operationId}` : null,
    entry?.process?.pid ? `pid=${entry.process.pid}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatRuntimeApprovalMode(mode) {
  const labels = {
    ask: "每次确认",
    "auto-allow-trusted-desktop": "可信桌面自动确认",
  };
  return labels[mode] ?? mode ?? "按默认权限";
}

function formatRuntimeApprovalRisk(risk) {
  const labels = {
    "capability-configuration": "能力配置变更",
    "external-execution": "外部执行",
  };
  return labels[risk] ?? risk ?? "受控操作";
}

function createRuntimeApprovalActions(approval) {
  if (!approval?.id || approval.status !== "pending") {
    return null;
  }
  const row = document.createElement("div");
  row.className = "runtime-approval-actions";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "primary-button compact";
  approve.textContent = approval.actionLabels?.[0] ?? "确认";
  approve.addEventListener("click", async () => {
    await executeRuntimeToolApprovalDecision(approval.id, "approve", approve);
  });
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "danger-button compact";
  reject.textContent = approval.actionLabels?.[1] ?? "拒绝";
  reject.addEventListener("click", async () => {
    await executeRuntimeToolApprovalDecision(approval.id, "reject", reject);
  });
  row.append(approve, reject);
  return row;
}

async function executeRuntimeToolApprovalDecision(approvalId, decision, button) {
  if (state.running || !bridge) {
    return;
  }
  setRunning(true);
  button.disabled = true;
  button.textContent = decision === "approve" ? "确认中" : "拒绝中";
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
    approvalId,
    decision,
  });
  await renderBridgeResult(result);
  setRunning(false);
  button.disabled = false;
}

function createContextualRecallDisclosure(contextualRecall) {
  if (!contextualRecall || contextualRecall.visibleSummary === "未召回额外上下文。") {
    return null;
  }
  const details = document.createElement("details");
  details.className = "result-context-disclosure";
  const summary = document.createElement("summary");
  summary.textContent = contextualRecall.visibleSummary || "查看参考来源";
  const body = document.createElement("div");
  body.className = "result-context-body";
  const sourceLines = [
    ...formatContextualRecallHitLines("经验", contextualRecall.knowledgeHits),
    ...formatContextualRecallHitLines("Skill", contextualRecall.skillHits),
    ...formatContextualRecallMemoryLines(contextualRecall.recallTrace),
  ];
  body.textContent = sourceLines.length > 0 ? sourceLines.join("\n") : "没有可展开的参考来源。";
  details.append(summary, body);
  return details;
}


async function executeMediaAuthorization(source, mode, button) {
  if (state.running || !bridge) {
    return;
  }
  setRunning(true);
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = mode === "media_inventory" ? "记录中" : "执行中";
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
    ...resolveMediaAuthorizationActionPayload(source, mode),
  });
  await renderBridgeResult(result);
  setRunning(false);
  button.disabled = false;
  button.textContent = originalLabel;
}


function formatContextualRecallHitLines(label, hits) {
  return (hits ?? []).slice(0, 5).map((hit) => `${label}：${hit.title || hit.id}`);
}

function formatContextualRecallMemoryLines(trace) {
  return (trace ?? [])
    .filter((item) => item?.source === "memory" && item.status === "hit")
    .slice(0, 3)
    .map((item) => `记忆：${item.title || item.id}`);
}

function renderApiProviderImageResult(imageResult) {
  const firstImage = imageResult.images?.[0] ?? null;
  const imageSource =
    firstImage?.url ?? (firstImage?.b64Json ? `data:image/png;base64,${firstImage.b64Json}` : null);
  const lines = [
    `${imageResult.ok ? "图片生成完成" : "图片生成失败"} · ${imageResult.providerId} · ${imageResult.model}`,
    `接口：${imageResult.endpoint}`,
    `耗时：${imageResult.latencyMs}ms`,
    imageResult.output ?? imageResult.message,
    firstImage?.revisedPrompt ? `修订提示词：${firstImage.revisedPrompt}` : null,
  ].filter(Boolean);

  if (!elements.resultOutput || imageSource === null) {
    setResultOutput(lines.join("\n"));
    return;
  }

  const summary = document.createElement("pre");
  summary.className = "result-output-text";
  summary.textContent = lines.join("\n");
  const image = document.createElement("img");
  image.className = "generated-image";
  image.src = imageSource;
  image.alt = "API 供应方生成图片结果";
  elements.resultOutput.replaceChildren(summary, image);
}

function renderApiProviderVideoResult(videoResult) {
  const firstVideo = videoResult.videos?.[0] ?? null;
  const videoSource = firstVideo?.url ?? null;
  const lines = [
    `${videoResult.ok ? "视频生成完成" : "视频生成失败"} · ${videoResult.providerId} · ${videoResult.model}`,
    `接口：${videoResult.endpoint}`,
    `耗时：${videoResult.latencyMs}ms`,
    videoResult.output ?? videoResult.message,
  ].filter(Boolean);

  if (!elements.resultOutput || videoSource === null) {
    setResultOutput(lines.join("\n"));
    return;
  }

  const summary = document.createElement("pre");
  summary.className = "result-output-text";
  summary.textContent = lines.join("\n");
  const video = document.createElement("video");
  video.className = "generated-video";
  video.src = videoSource;
  video.controls = true;
  video.preload = "metadata";
  video.setAttribute("aria-label", "API 供应方生成视频结果");
  elements.resultOutput.replaceChildren(summary, video);
}

function renderApiProviderModelSyncResult(syncResult) {
  const lines = [
    `${syncResult.ok ? "模型池同步完成" : "模型池同步失败"} · ${syncResult.providerId}`,
    `模型：${syncResult.count} 个`,
    `动态元数据：${syncResult.metadataCount} 个`,
    `Endpoint 类型：${syncResult.endpointTypeCount} 个`,
    `公开模型接口：${syncResult.pricingEndpoint}`,
    `账号模型接口：${syncResult.modelsEndpoint}`,
    `耗时：${syncResult.latencyMs}ms`,
    syncResult.message,
  ];
  setResultOutput(lines.filter(Boolean).join("\n"));
}

function renderComfyUiRunResult(runResult) {
  const firstArtifact = runResult.artifacts?.[0] ?? null;
  const imageSource =
    runResult.readiness !== "generation" ? null : formatArtifactImageSource(firstArtifact);
  const lines = [
    `${formatComfyUiRunResultTitle(runResult)}`,
    `执行类型：${formatComfyUiReadiness(runResult.readiness)}`,
    `接口：${runResult.endpoint}`,
    `耗时：${runResult.latencyMs}ms`,
    runResult.promptId ? `Prompt ID：${runResult.promptId}` : null,
    runResult.promptApplied === false
      ? "提示词注入：未命中 workflow 文本节点；这次只验证 ComfyUI 调用链路。"
      : "提示词注入：已写入 workflow。",
    runResult.workflowDiagnostics
      ? `Workflow：提示词节点 ${runResult.workflowDiagnostics.promptNodeCount ?? 0}；模型依赖 ${
          runResult.workflowDiagnostics.modelDependencyCount ?? 0
        }；输出节点 ${runResult.workflowDiagnostics.outputNodeCount ?? 0}`
      : null,
    ...(runResult.diagnostics ?? []).map((line) => `诊断：${line}`),
    `产物：${runResult.artifactCount ?? 0}`,
    ...(runResult.artifacts ?? []).map(
      (artifact) => artifact.localPath ?? artifact.url ?? artifact.filename,
    ),
    runResult.message,
  ].filter(Boolean);

  if (!elements.resultOutput || imageSource === null) {
    setResultOutput(lines.join("\n"));
    return;
  }

  const summary = document.createElement("pre");
  summary.className = "result-output-text";
  summary.textContent = lines.join("\n");
  const image = document.createElement("img");
  image.className = "generated-image";
  image.src = imageSource;
  image.alt = "ComfyUI 生成图片结果";
  elements.resultOutput.replaceChildren(summary, image);
}

function renderComfyUiLifecycleResult(result, execution) {
  const lines = [
    "ComfyUI 生命周期",
    `状态：${result.ok ? "成功" : "失败"}`,
    `动作：${result.action ?? "unknown"}`,
    `执行：${result.executed === true ? "已执行" : "未执行"}`,
    result.message,
    ...(result.plan ?? []).map(
      (item) => `命令：${item.command} ${(item.args ?? []).join(" ")}`.trim(),
    ),
    ...formatExternalToolExecutionTimelineLines(execution),
  ].filter(Boolean);
  setResultOutput(lines.join("\n"));
}

function renderComfyUiDependencyFixResult(result, execution) {
  const lines = [
    "ComfyUI 依赖修复",
    `状态：${result.status ?? "unknown"}`,
    `模式：${result.dryRun === false ? "执行" : "计划"}`,
    `可执行项：${(result.actions ?? []).length}`,
    `待补充项：${(result.failures ?? []).length}`,
    result.needsServerRestart ? "提示：安装 custom node 后需要重启 ComfyUI。" : null,
    result.message,
    ...(result.actions ?? []).map((action) =>
      `计划：${action.kind} ${action.packageName ?? action.filename ?? ""} -> ${action.command?.command ?? ""} ${(
        action.command?.args ?? []
      ).join(" ")}`.trim(),
    ),
    ...(result.failures ?? []).map(
      (failure) =>
        `待补充：${failure.kind} ${failure.filename ?? failure.classType ?? ""} · ${failure.reason}`,
    ),
    ...formatExternalToolExecutionTimelineLines(execution),
  ].filter(Boolean);
  setResultOutput(lines.join("\n"));
}

function formatExternalToolExecutionTimelineLines(execution) {
  if (!execution || !Array.isArray(execution.timeline) || execution.timeline.length === 0) {
    return [];
  }
  return [
    "",
    "外部工具队列：",
    ...execution.timeline.map((item) => `${item.status} · ${item.detail}`),
  ];
}

function renderComfyUiWorkflowResult(workflowResult) {
  const lines = [
    workflowResult.ok ? "ComfyUI 工作流已创建" : "ComfyUI 工作流创建失败",
    `类型：${formatComfyUiWorkflowKind(workflowResult.workflowKind)}`,
    `组合：${formatComfyUiWorkflowModes(workflowResult.workflowModes)}`,
    `目标：${workflowResult.objective}`,
    workflowResult.opened === false
      ? "画布：未打开，请检查 ComfyUI 地址或浏览器权限。"
      : workflowResult.directOpenReady
        ? "画布：已尝试直接打开到这条工作流。"
        : "画布：已尝试打开 ComfyUI，请在 Workflows / DirectorAngel 中查看。",
    workflowResult.uploadedToComfyUi
      ? "同步：已写入 ComfyUI 工作流列表。"
      : workflowResult.uploadMessage
        ? `ComfyUI 同步：${workflowResult.uploadMessage}`
        : null,
    `执行：${workflowResult.executable ? "可执行" : "已创建节点画布，未自动提交"}`,
    workflowResult.message,
    "下一步：检查节点、模型和输出目录，确认后再执行。",
  ].filter(Boolean);
  setResultOutput(lines.join("\n"));
  selectInspectorPanel("result");
}

function formatComfyUiRunResultTitle(runResult) {
  if (!runResult.ok) {
    return "ComfyUI 未完成生成";
  }
  if (runResult.readiness === "connectivity_check" || runResult.promptApplied === false) {
    return "ComfyUI 连通性验证完成";
  }
  return "ComfyUI 生成完成";
}

function formatComfyUiWorkflowKind(workflowKind) {
  const labels = {
    script: "脚本",
    copywriting: "文案",
    image: "图片",
    video: "视频",
  };
  return labels[workflowKind] ?? workflowKind ?? "未知";
}

function formatComfyUiWorkflowModes(workflowModes) {
  const labels = {
    script: "脚本",
    image: "图片",
    video: "视频",
  };
  const modes = Array.isArray(workflowModes) ? workflowModes : [];
  return modes.map((mode) => labels[mode] ?? mode).filter(Boolean).join("+") || "脚本";
}

function formatComfyUiReadiness(readiness) {
  if (readiness === "generation") {
    return "真实生成";
  }
  if (readiness === "connectivity_check") {
    return "连通性验证";
  }
  return "未就绪";
}

function formatArtifactImageSource(artifact) {
  if (!artifact || artifact.kind !== "image") {
    return null;
  }
  if (typeof artifact.localPath === "string" && artifact.localPath.length > 0) {
    if (/^file:\/\//iu.test(artifact.localPath)) {
      return artifact.localPath;
    }
    const normalized = artifact.localPath.startsWith("/")
      ? artifact.localPath
      : `/${artifact.localPath}`;
    return `file://${normalized
      .split("/")
      .map((segment, index) => (index === 0 ? "" : encodeURIComponent(segment)))
      .join("/")}`;
  }
  return artifact.url ?? null;
}

function renderFatalError(error) {
  setHealth("bridge error", "warn");
  appendTimelineMessage({
    role: DESKTOP_EVENT_ROLES.SYSTEM,
    title: "本机运行服务不可用",
    body: error instanceof Error ? error.message : String(error),
  });
}

function renderCommandError(error) {
  setHealth("command error", "warn");
  const message = error instanceof Error ? error.message : String(error);
  appendTimelineMessage({
    role: DESKTOP_EVENT_ROLES.SYSTEM,
    title: "执行失败",
    body: message,
  });
  setResultOutput(message);
}

function reportNonFatalUiError(error, context = "桌面端 UI 状态更新失败") {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[Director Angel] ${context}: ${message}`);
}

function renderCatalog() {
  renderWorkbenchSurfaceVisibility();
  renderDesktopSessions();
  updateComposerPlaceholder();
  setText(elements.groupCount, String(WORKFLOWS.length));
  replaceChildren(elements.commandGroups, WORKFLOWS, (group) => {
    const button = document.createElement("button");
    button.className = `mode-item${group.id === state.selectedGroupId ? " active" : ""}`;
    button.type = "button";
    button.dataset.groupId = group.id;

    const glyph = document.createElement("span");
    glyph.className = "mode-glyph";
    glyph.textContent = group.glyph;

    const label = document.createElement("span");
    label.textContent = group.label;

    const count = document.createElement("small");
    count.textContent = String(getWorkflowCount(group));
    button.append(glyph, label, count);
    return button;
  });
  renderCommandList();
}

function renderDesktopSessions() {
  if (!elements.sessionList) {
    return;
  }
  const sessions = ensureDesktopChatSessions(state.chat);
  replaceChildren(elements.sessionList, sessions, (session) => {
    const button = document.createElement("button");
    button.className = `session-row${session.key === state.chat.sessionKey ? " active-session" : ""}`;
    button.type = "button";
    button.dataset.desktopSessionKey = session.key;

    const title = document.createElement("span");
    title.textContent = session.title || "新会话";

    const meta = document.createElement("small");
    meta.textContent = formatDesktopSessionMeta(session);

    const actions = document.createElement("span");
    actions.className = "session-actions";
    const rename = document.createElement("span");
    rename.className = "session-action-button";
    rename.setAttribute("data-desktop-session-rename", session.key);
    rename.title = "重命名会话";
    rename.textContent = "✎";
    const close = document.createElement("span");
    close.className = "session-action-button";
    close.setAttribute("data-desktop-session-close", session.key);
    close.title = "关闭会话";
    close.textContent = "×";
    actions.append(rename, close);

    button.append(title, meta, actions);
    return button;
  });
}

function renderActiveDesktopSessionTranscript() {
  const messages = getActiveDesktopSessionTranscript();
  if (messages.length === 0 || !elements.timeline) {
    return false;
  }
  elements.timeline.replaceChildren();
  for (const message of messages) {
    appendTimelineMessage(message, { persistToSession: false });
  }
  return true;
}

function getActiveDesktopSessionTranscript() {
  const transcripts = ensureDesktopSessionTranscripts();
  const messages = transcripts[state.chat.sessionKey];
  return Array.isArray(messages) ? messages : [];
}

function ensureDesktopSessionTranscripts() {
  if (!state.chat.sessionTranscripts || typeof state.chat.sessionTranscripts !== "object") {
    state.chat.sessionTranscripts = {};
  }
  return state.chat.sessionTranscripts;
}

function createDesktopSession() {
  persistCurrentDesktopSessionTranscript();
  const session = createDesktopChatSession(state.chat);
  if (!session) {
    return;
  }
  state.chat.sessionTranscripts[session.key] = [];
  clearDesktopWorkbenchTimelineForSessionSwitch(session.title);
  selectGroup("workbench");
  renderDesktopSessions();
  setInputValue("");
  persistDesktopUiState();
  elements.angelInput?.focus();
}

function selectDesktopSession(sessionKey) {
  persistCurrentDesktopSessionTranscript();
  const changed = selectDesktopChatSession(state.chat, sessionKey);
  if (!changed) {
    return;
  }
  const restoredTranscript = renderActiveDesktopSessionTranscript();
  if (!restoredTranscript) {
    clearDesktopWorkbenchTimelineForSessionSwitch("已切换会话");
  }
  selectGroup("workbench");
  renderDesktopSessions();
  setInputValue(state.chat.composer.input);
  persistDesktopUiState();
  elements.angelInput?.focus();
}

function updateCurrentDesktopSessionFromPrompt(prompt) {
  updateDesktopChatSessionFromPrompt(state.chat, prompt);
  renderDesktopSessions();
  persistDesktopUiState();
}

function renameDesktopSession(sessionKey) {
  const current = state.chat.sessions.find((session) => session.key === sessionKey);
  const nextTitle = window.prompt("重命名会话", current?.title ?? "新会话");
  if (nextTitle === null) {
    return;
  }
  if (!renameDesktopChatSession(state.chat, sessionKey, nextTitle)) {
    return;
  }
  renderDesktopSessions();
  persistDesktopUiState();
}

async function closeDesktopSession(sessionKey) {
  const current = state.chat.sessions.find((session) => session.key === sessionKey);
  const title = current?.title ?? "这个会话";
  if (!window.confirm(`关闭会话“${title}”？`)) {
    return;
  }
  await invokeBridge({
    type: DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE,
    sessionKey,
  }).catch((error) => {
    reportNonFatalUiError(error, "桌面会话后端上下文清理失败");
  });
  const wasCurrent = state.chat.sessionKey === sessionKey;
  if (!deleteDesktopChatSession(state.chat, sessionKey)) {
    return;
  }
  delete state.chat.sessionTranscripts[sessionKey];
  if (wasCurrent) {
    elements.timeline.replaceChildren();
    appendTimelineMessage({
      role: DESKTOP_EVENT_ROLES.SYSTEM,
      title: "已关闭会话",
      body: "已切换到最近的可用会话；新的提问会使用当前会话上下文。",
    });
  }
  selectGroup("workbench");
  renderDesktopSessions();
  persistDesktopUiState();
}

function clearDesktopWorkbenchTimelineForSessionSwitch(title) {
  if (elements.timeline) {
    elements.timeline.replaceChildren();
  }
  appendTimelineMessage({
    role: DESKTOP_EVENT_ROLES.SYSTEM,
    title,
    body: "已进入独立会话；新的提问会使用当前会话上下文。",
  });
}

function formatDesktopSessionMeta(session) {
  const date = new Date(session.updatedAt);
  if (!Number.isFinite(date.getTime())) {
    return "独立上下文";
  }
  return `${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })} · 独立上下文`;
}

function renderCommandList() {
  const group = getActiveWorkflow();
  markCommandBoardScrollResetForSurface(resolveCommandBoardSurfaceKey(group));
  setText(elements.activeGroupDomain, group?.domain ?? "Workspace");
  setText(elements.activeGroupTitle, group?.title ?? "真实能力控制台");
  setText(elements.commandBoardTitle, group?.objective ?? "选择一个步骤继续。");
  if (group?.id === "settings") {
    setText(elements.commandCount, String(SETTINGS_TABS.length));
    renderSettingsSurface();
    resetCommandBoardScrollIfNeeded();
    return;
  }
  if (isAssetSurfaceWorkflow(group?.id)) {
    renderAssetSurface(group);
    resetCommandBoardScrollIfNeeded();
    return;
  }
  const items = getWorkflowItems(group);
  setText(elements.commandCount, String(items.length));
  elements.commandList.className = "command-grid";
  replaceChildren(elements.commandList, items, (item, index) => {
    const command = item.commandId ? findCommand(item.commandId) : findCommand(item.id);
    const hasAssetDetail = Boolean(item.assetId);
    const isInteractive =
      Boolean(command) || hasAssetDetail || (isWorkbenchActive() && item.prompt !== undefined);
    const tile = document.createElement(isInteractive ? "button" : "article");
    const itemId = item.commandId ?? item.id ?? item.label;
    const stepState = command ? resolveStepState(command.id) : "";
    tile.className = [
      "command-tile",
      isInteractive ? "" : "asset-tile",
      command?.id === state.selectedCommandId ? "selected" : "",
      hasAssetDetail && isSelectedAsset(item.assetSurface, item.assetId) ? "selected" : "",
      stepState ? `step-${stepState}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (isInteractive) {
      tile.type = "button";
    }
    if (command) {
      tile.dataset.commandId = command.id;
    }
    if (hasAssetDetail) {
      tile.setAttribute("data-asset-surface", item.assetSurface ?? getActiveWorkflow()?.id ?? "");
      tile.setAttribute("data-asset-id", item.assetId);
    }
    const actionPrompt =
      isWorkbenchActive() && command ? createCommandActionPrompt(command) : item.prompt;
    if (isWorkbenchActive() && actionPrompt !== null && actionPrompt !== undefined) {
      tile.dataset.prompt = actionPrompt;
    }

    const step = document.createElement("small");
    step.textContent = item.kicker ?? formatCardKicker(group, command, index, stepState);
    const label = document.createElement("strong");
    label.textContent = item.label ?? command?.label ?? itemId;
    const description = document.createElement("span");
    description.textContent = item.description ?? command?.description ?? "";
    const meta = document.createElement("small");
    meta.textContent = item.meta ?? resolveCardMeta(group, command);
    tile.append(step, label, description, meta);
    return tile;
  });
  resetCommandBoardScrollIfNeeded();
}

function resolveCommandBoardSurfaceKey(group) {
  const workflowId = group?.id ?? "workbench";
  const assetKey = state.selectedAsset
    ? `${state.selectedAsset.surface}:${state.selectedAsset.assetId}`
    : "list";
  if (workflowId === "settings") {
    return `settings:${state.selectedSettingsTab ?? "api"}`;
  }
  if (isAssetSurfaceWorkflow(workflowId)) {
    return `${workflowId}:${assetKey}`;
  }
  return `workflow:${workflowId}`;
}

function markCommandBoardScrollResetForSurface(surfaceKey) {
  if (state.renderedSurfaceKey === surfaceKey) {
    return;
  }
  state.renderedSurfaceKey = surfaceKey;
  state.pendingScrollReset = true;
}

function renderSelectedCommand() {
  const workflowId = getActiveWorkflow()?.id;
  if (workflowId === "settings" || isAssetSurfaceWorkflow(workflowId)) {
    elements.selectedCommand?.replaceChildren();
    elements.argForm?.replaceChildren();
    return;
  }
  const command = findCommand(state.selectedCommandId);
  if (!command) {
    renderSurfaceInspector();
    return;
  }

  elements.selectedCommand.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = command.label;
  const description = document.createElement("p");
  description.textContent = command.description;
  const meta = document.createElement("small");
  meta.textContent = isWorkbenchActive()
    ? "通过工作台底部输入框用 /能力 调用。"
    : "这里只查看资产；执行请回到工作台用 /能力。";
  elements.selectedCommand.append(title, description, meta);

  renderArgForm(command, createCommandActionPrompt(command));
  renderCommandList();
}

function renderSurfaceInspector() {
  const group = getActiveWorkflow();
  elements.selectedCommand.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = group?.title ?? "Angel";
  const description = document.createElement("p");
  description.textContent = group?.objective ?? "通过底部输入框继续。";
  const meta = document.createElement("small");
  meta.textContent = isWorkbenchActive()
    ? "当前板块由底部 composer 驱动。"
    : "当前板块只负责浏览、分类和状态展示。";
  elements.selectedCommand.append(title, description, meta);
  elements.argForm.replaceChildren();
  const guide = document.createElement("div");
  guide.className = "empty-state";
  guide.textContent = resolveSurfaceComposerCopy(group?.id);
  elements.argForm.append(guide);
  renderCommandList();
}

function renderArgForm(command, actionPrompt = null) {
  elements.argForm.replaceChildren();

  const guide = document.createElement("div");
  guide.className = "empty-state";
  guide.textContent = isWorkbenchActive()
    ? resolveLearningStepCopy(command.id)
    : "这里只查看资产；执行请回到工作台底部输入 /能力。";
  elements.argForm.append(guide);
  if (!isWorkbenchActive() && actionPrompt) {
    elements.argForm.append(createDetailField("工作台指令", actionPrompt));
    appendWorkbenchPromptButton(elements.argForm, actionPrompt);
  }
}

function appendWorkbenchPromptButton(container, prompt, label = "带到工作台") {
  container.append(createWorkbenchPromptButton(prompt, label));
}

function createWorkbenchPromptButton(prompt, label = "带到工作台") {
  const actionButton = document.createElement("button");
  actionButton.className = "secondary-button";
  actionButton.type = "button";
  actionButton.textContent = label;
  actionButton.dataset.workbenchPrompt = prompt;
  actionButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openWorkbenchPrompt(prompt);
  });
  return actionButton;
}

function renderAssetSurface(group) {
  const surfaceId = group?.id;
  const selectedDetail =
    state.selectedAsset?.surface === surfaceId ? findAssetDetail(state.selectedAsset) : null;
  setText(elements.commandCount, String(getWorkflowCount(group)));
  elements.commandList.replaceChildren();
  elements.commandList.className = `asset-page asset-page-${surfaceId}`;

  if (surfaceId === "experience" && selectedDetail?.kind === "experience-candidate") {
    renderExperienceDetailRoute(elements.commandList, selectedDetail, group);
    return;
  }
  if (surfaceId === "skills" && selectedDetail?.kind === "skill") {
    renderSkillDetailRoute(elements.commandList, selectedDetail, group);
    return;
  }
  if (surfaceId === "skills" && selectedDetail?.kind === "skill-proposal") {
    renderSkillProposalDetailRoute(elements.commandList, selectedDetail, group);
    return;
  }
  if (surfaceId === "tools" && selectedDetail?.kind === "tool") {
    renderToolDetailRoute(elements.commandList, selectedDetail, group);
    return;
  }
  if (surfaceId === "review" && selectedDetail?.kind?.startsWith("review-")) {
    renderReviewDetailRoute(elements.commandList, selectedDetail, group);
    return;
  }

  const header = createAssetPageHeader(group);
  const body = document.createElement("section");
  body.className = `asset-page-body asset-page-body-${surfaceId}`;
  const main = document.createElement("div");
  main.className = "asset-page-main";
  const detail = document.createElement("aside");
  detail.className = "asset-detail-page";
  renderAssetSurfaceBody(main, surfaceId);
  renderAssetDetailPage(detail, selectedDetail, group);
  body.append(main, detail);
  elements.commandList.append(header, body);
}

function createAssetPageHeader(group) {
  const header = document.createElement("div");
  header.className = "asset-page-header";
  const copy = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = group?.domain ?? "ASSET";
  const title = document.createElement("h2");
  title.textContent = group?.title ?? "资产";
  const description = document.createElement("p");
  description.textContent = group?.objective ?? "查看当前板块的真实后端快照。";
  copy.append(eyebrow, title, description);

  const actions = document.createElement("div");
  actions.className = "asset-header-actions";
  for (const action of getPrimaryWorkbenchPrompts(group?.id)) {
    actions.append(createWorkbenchPromptButton(action.prompt, action.label));
  }
  header.append(copy, actions);
  return header;
}

function renderExperienceDetailRoute(container, detail, group) {
  const candidate = detail.candidate;
  const header = document.createElement("div");
  header.className = "experience-detail-header";
  const back = document.createElement("button");
  back.className = "secondary-button compact";
  back.type = "button";
  back.textContent = "← 返回经验库";
  back.addEventListener("click", () => {
    state.selectedAsset = null;
    renderCatalog();
    renderSelectedCommand();
  });
  const copy = document.createElement("div");
  const breadcrumb = document.createElement("small");
  breadcrumb.textContent = `经验库 / ${candidate.category?.name ?? "待分类"} / ${candidate.title}`;
  const title = document.createElement("h2");
  title.textContent = candidate.title;
  const meta = document.createElement("p");
  meta.textContent = `${formatExperienceStatusLabel(candidate.status)} · ${formatExperienceDistillation(
    candidate,
  )} · ${formatEpochDate(candidate.createdAtMs)}`;
  copy.append(breadcrumb, title, meta);
  const actions = document.createElement("div");
  actions.className = "asset-detail-actions";
  for (const actionPrompt of createExperienceReviewPrompts(candidate)) {
    if (!actionPrompt.action) {
      continue;
    }
    actions.append(
      createAssetDirectActionButton(actionPrompt.action, actionPrompt.label, actionPrompt.tone),
    );
  }
  header.append(back, copy, actions);

  const body = document.createElement("section");
  body.className = "experience-detail-route-body";
  body.append(
    createExperienceDetailNav(),
    createExperienceDetailDocument(detail, group),
    createExperienceTaxonomyEditor(candidate),
  );
  container.append(header, body);
}

function renderSkillDetailRoute(container, detail, group) {
  const skill = detail.skill;
  const header = document.createElement("div");
  header.className = "skill-detail-header";
  const back = document.createElement("button");
  back.className = "secondary-button compact";
  back.type = "button";
  back.textContent = "← 返回 Skills";
  back.addEventListener("click", () => {
    state.selectedAsset = null;
    renderCatalog();
    renderSelectedCommand();
  });
  const copy = document.createElement("div");
  const breadcrumb = document.createElement("small");
  breadcrumb.textContent = `Skills / ${formatSkillSourceLabel(skill.source)} / ${skill.title}`;
  const title = document.createElement("h2");
  title.textContent = skill.title;
  const meta = document.createElement("p");
  meta.textContent = `${formatSkillSourceLabel(skill.source)} · ${skill.version ?? "unknown"} · ${formatSkillUpdated(
    skill,
  )}`;
  copy.append(breadcrumb, title, meta);
  const actions = document.createElement("div");
  actions.className = "asset-detail-actions";
  actions.append(createSkillEnablementSwitch(skill));
  for (const actionPrompt of createSkillDirectActions(skill)) {
    actions.append(
      createAssetDirectActionButton(actionPrompt.action, actionPrompt.label, actionPrompt.tone),
    );
  }
  actions.append(createWorkbenchPromptButton("/技能", "/技能"));
  header.append(back, copy, actions);

  const body = document.createElement("section");
  body.className = "skill-detail-route-body";
  body.append(
    createSkillDetailNav(),
    createSkillDetailDocument(detail, group),
    createSkillDetailMetaPanel(skill),
  );
  container.append(header, body);
}

function renderSkillProposalDetailRoute(container, detail, group) {
  const proposal = detail.proposal;
  const header = document.createElement("div");
  header.className = "skill-detail-header";
  const back = document.createElement("button");
  back.className = "secondary-button compact";
  back.type = "button";
  back.textContent = "← 返回 Skills";
  back.addEventListener("click", () => {
    state.selectedAsset = null;
    renderCatalog();
    renderSelectedCommand();
  });
  const copy = document.createElement("div");
  const breadcrumb = document.createElement("small");
  breadcrumb.textContent = `Skills / 候选 / ${proposal.id}`;
  const title = document.createElement("h2");
  title.textContent = proposal.title;
  const meta = document.createElement("p");
  meta.textContent = `${formatSkillProposalStatusLabel(proposal.status)} · ${formatSkillRiskLabel(
    proposal.riskLevel,
  )} · ${formatEpochDate(proposal.updatedAtMs)}`;
  copy.append(breadcrumb, title, meta);
  const actions = document.createElement("div");
  actions.className = "asset-detail-actions";
  for (const actionPrompt of createSkillProposalDirectActions(proposal)) {
    actions.append(
      createAssetDirectActionButton(actionPrompt.action, actionPrompt.label, actionPrompt.tone),
    );
  }
  header.append(back, copy, actions);

  const body = document.createElement("section");
  body.className = "skill-detail-route-body";
  body.append(
    createSkillProposalDetailNav(),
    createSkillProposalDetailDocument(detail),
    createSkillProposalDetailMetaPanel(proposal),
  );
  container.append(header, body);
}

function createSkillProposalDetailNav() {
  const nav = document.createElement("nav");
  nav.className = "skill-detail-nav";
  for (const label of ["候选内容", "证据", "审核", "应用", "历史"]) {
    const item = document.createElement("a");
    item.href = `#${label}`;
    item.textContent = label;
    nav.append(item);
  }
  return nav;
}

function createSkillProposalDetailDocument(detail) {
  const proposal = detail.proposal;
  const article = document.createElement("article");
  article.className = "skill-detail-document";
  article.append(
    createSkillDocSection("候选内容", proposal.content || "当前 proposal 未返回 Skill 正文。"),
    createSkillDocSection(
      "证据",
      formatList([
        proposal.evidenceRef,
        proposal.evidenceSummary,
        proposal.trigger ? `触发：${proposal.trigger}` : null,
      ]),
    ),
    createSkillDocSection(
      "审核",
      formatList([
        `审查结论：${formatSkillProposalReviewVerdict(proposal.reviewVerdict)}`,
        proposal.reviewDecisionNote,
        formatSkillProposalReviewIssues(proposal.reviewIssues),
      ]),
    ),
    createSkillDocSection(
      "应用",
      formatList([
        `目标 Skill：${proposal.skillId}`,
        `状态：${formatSkillProposalStatusLabel(proposal.status)}`,
        proposal.status === "accepted" ? "可以安全应用到 approved Skill snapshot。" : null,
        proposal.status === "pending" ? "需要先接受或拒绝，不能热注入。" : null,
      ]),
    ),
    createSkillDocSection(
      "历史",
      formatList([
        `Proposal：${proposal.id}`,
        `Session：${proposal.sessionId}`,
        `来源：${proposal.provenance}`,
        `轨迹：${proposal.trajectoryRef}`,
        `创建：${formatEpochDate(proposal.createdAtMs)}`,
      ]),
    ),
  );
  return article;
}

function createSkillProposalDetailMetaPanel(proposal) {
  const panel = document.createElement("aside");
  panel.className = "skill-detail-meta";
  const title = document.createElement("h3");
  title.textContent = "候选操作";
  const actions = document.createElement("div");
  actions.className = "review-detail-actions";
  for (const actionPrompt of createSkillProposalDirectActions(proposal)) {
    actions.append(
      createAssetDirectActionButton(actionPrompt.action, actionPrompt.label, actionPrompt.tone),
    );
  }
  panel.append(title);
  if (actions.childElementCount > 0) {
    panel.append(actions);
  }
  panel.append(
    createReadonlyRow("状态", formatSkillProposalStatusLabel(proposal.status)),
    createReadonlyRow("风险", formatSkillRiskLabel(proposal.riskLevel)),
    createReadonlyRow("置信度", proposal.confidence ?? "未返回"),
    createReadonlyRow("证据", proposal.evidenceRef || "未返回"),
  );
  return panel;
}

function createSkillDetailNav() {
  const nav = document.createElement("nav");
  nav.className = "skill-detail-nav";
  for (const label of [
    "用途",
    "Skill 正文",
    "触发与来源",
    "工具依赖",
    "权限与审计",
    "版本与路径",
  ]) {
    const item = document.createElement("a");
    item.href = `#${label}`;
    item.textContent = label;
    nav.append(item);
  }
  return nav;
}

function createSkillDetailDocument(detail, group) {
  const skill = detail.skill;
  const article = document.createElement("article");
  article.className = "skill-detail-document";
  article.append(
    createSkillDocSection("用途", skill.chineseIntro || skill.description || "未提供说明。"),
    createSkillDocSection("Skill 正文", skill.content || "当前后端 snapshot 未返回正文。"),
    createSkillDocSection("触发与来源", formatSkillOrigin(skill)),
    createSkillDocSection(
      "工具依赖",
      formatList([
        `声明：${formatList(skill.toolNames)}`,
        `诊断：${formatSkillDoctorStatusLabel(skill.doctorStatus ?? skill.runtimeStatus)}`,
        skill.doctorSummary,
        (skill.missingToolNames ?? []).length > 0
          ? `缺失：${formatList(skill.missingToolNames)}`
          : null,
        (skill.nextActions ?? []).length > 0 ? `下一步：${formatList(skill.nextActions)}` : null,
      ]),
    ),
    createSkillExplanationSurfaceBlock(skill.explanationSurface),
    createSkillDocSection(
      "权限与审计",
      formatList([
        formatSkillPermissionDetail(skill),
        `风险：${formatSkillRiskLabel(skill.riskLevel)}`,
        `信任：${formatSkillTrustLabel(skill.trustStatus)}`,
        skill.auditSummary,
      ]),
    ),
    createSkillDocSection("版本与路径", formatList([skill.id, skill.version, detail.snapshotPath])),
  );
  return article;
}

function createSkillDocSection(titleText, bodyText) {
  const section = document.createElement("section");
  section.className = "skill-doc-section";
  section.id = titleText;
  const title = document.createElement("h3");
  title.textContent = titleText;
  const body = document.createElement("p");
  body.textContent = String(bodyText ?? "无");
  section.append(title, body);
  return section;
}

function createSkillDetailMetaPanel(skill) {
  const taxonomy = state.snapshot?.assets?.skills?.taxonomy ?? { categories: [], tags: [] };
  const panel = document.createElement("aside");
  panel.className = "skill-detail-meta";
  const title = document.createElement("h3");
  title.textContent = "分类与标签";

  const categoryLabel = document.createElement("label");
  categoryLabel.textContent = "分类";
  const categorySelect = document.createElement("select");
  categorySelect.dataset.field = "categoryId";
  const currentCategoryId = resolveSkillCategoryId(skill);
  const categories = mergeSkillCategoryOptions(taxonomy.categories, skill);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category.categoryId ?? category.id;
    option.textContent = category.name ?? category.label ?? option.value;
    option.selected = option.value === currentCategoryId;
    categorySelect.append(option);
  }
  categoryLabel.append(categorySelect);

  const tagField = document.createElement("div");
  tagField.className = "experience-taxonomy-checks";
  const tagTitle = document.createElement("strong");
  tagTitle.textContent = "自定义标签";
  tagField.append(tagTitle);
  const selectedTagIds = new Set(
    skill.taxonomyTags?.map((tag) => tag.tagId ?? tag.id).filter(Boolean) ?? [],
  );
  const tags = mergeSkillTagOptions(taxonomy.tags, skill);
  if (tags.length === 0) {
    const empty = document.createElement("small");
    empty.textContent = "暂无标签，可先新建。";
    tagField.append(empty);
  }
  for (const tag of tags) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag.tagId ?? tag.id;
    input.checked = selectedTagIds.has(input.value);
    label.append(input, document.createTextNode(tag.name));
    tagField.append(label);
  }

  const save = document.createElement("button");
  save.className = "primary-button";
  save.type = "button";
  save.textContent = "保存分类标签";
  save.addEventListener("click", async () => {
    const tagIds = [...tagField.querySelectorAll("input[type='checkbox']:checked")].map(
      (input) => input.value,
    );
    await executeAssetAction(
      {
        type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
        skillId: skill.id,
        categoryId: categorySelect.value,
        tagIds,
      },
      save,
      "保存分类标签",
    );
  });

  const createCategory = createTaxonomyCreateControl({
    placeholder: "新建 Skill 分类",
    buttonLabel: "新建分类",
    actionType: DESKTOP_ACTIONS.SKILL_CATEGORY_CREATE,
  });
  const createTag = createTaxonomyCreateControl({
    placeholder: "添加 Skill 标签",
    buttonLabel: "新建标签",
    actionType: DESKTOP_ACTIONS.SKILL_TAG_CREATE,
  });

  const statusTitle = document.createElement("h3");
  statusTitle.textContent = "状态";
  panel.append(
    title,
    categoryLabel,
    tagField,
    save,
    createCategory,
    createTag,
    createSkillSnapshotEditor(skill),
    createSkillExplanationSurfaceBlock(skill.explanationSurface),
    createSkillRuntimeDiagnostics(skill),
    statusTitle,
    createReadonlyRow("来源", formatSkillSourceLabel(skill.source)),
    createReadonlyRow("启用状态", formatSkillEnablementLabel(skill.enabled)),
    createReadonlyRow("模型可见", formatSkillModelVisibility(skill)),
    createReadonlyRow("召回资格", formatSkillEligibility(skill)),
    createReadonlyRow("依赖诊断", formatSkillDoctorStatusLabel(skill.doctorStatus ?? skill.runtimeStatus)),
    createReadonlyRow("缺失工具", formatList(skill.missingToolNames)),
    createReadonlyRow("可用工具", formatList(skill.availableToolNames)),
    createReadonlyRow("诊断说明", skill.doctorSummary ?? "未返回"),
    createReadonlyRow("下一步", formatList(skill.nextActions)),
    createReadonlyRow("权限状态", formatSkillPermissionStatus(skill)),
    createReadonlyRow("状态说明", skill.statusReason ?? "未返回"),
    createReadonlyRow("快照版本", formatSkillSnapshotVersion(skill)),
    createReadonlyRow("中文简介", skill.chineseIntro ?? "未返回"),
    createReadonlyRow("工具", formatSkillTools(skill)),
    createReadonlyRow("权限", formatSkillPermissionDetail(skill)),
    createReadonlyRow("风险", formatSkillRiskLabel(skill.riskLevel)),
    createReadonlyRow("信任", formatSkillTrustLabel(skill.trustStatus)),
    createReadonlyRow("审计", formatSkillAuditStatusLabel(skill.auditStatus)),
    createReadonlyRow("更新时间", formatSkillUpdated(skill)),
    createSkillLifecycleBlock(skill),
  );
  return panel;
}

function renderToolDetailRoute(container, detail, group) {
  const adapter = detail.adapter;
  const header = document.createElement("div");
  header.className = "tool-detail-header";
  const back = document.createElement("button");
  back.className = "secondary-button compact";
  back.type = "button";
  back.textContent = "← 返回外部工具";
  back.addEventListener("click", () => {
    state.selectedAsset = null;
    renderCatalog();
    renderSelectedCommand();
  });
  const copy = document.createElement("div");
  const breadcrumb = document.createElement("small");
  breadcrumb.textContent = `外部工具 / ${adapter.kind ?? "adapter"} / ${adapter.title}`;
  const title = document.createElement("h2");
  title.textContent = adapter.title;
  const meta = document.createElement("p");
  meta.textContent = `${adapter.provider} · ${adapter.enabled ? "启用" : "停用"} · ${
    adapter.healthStatus ?? "unknown"
  }`;
  copy.append(breadcrumb, title, meta);
  const actions = document.createElement("div");
  actions.className = "asset-detail-actions";
  actions.append(createToolEnablementSwitch(adapter));
  for (const action of detail.actionPrompts ?? []) {
    if (action.action) {
      actions.append(createAssetDirectActionButton(action.action, action.label, action.tone));
    }
  }
  header.append(back, copy, actions);

  const body = document.createElement("section");
  body.className = "tool-detail-route-body";
  body.append(
    createToolDetailNav(),
    createToolDetailDocument(detail, group),
    createToolDetailMetaPanel(detail.adapter),
  );
  container.append(header, body);
}

function createToolDetailNav() {
  const nav = document.createElement("nav");
  nav.className = "tool-detail-nav";
  for (const label of ["用途与状态", "动作清单", "动作契约", "审计与门禁", "路径与运行时"]) {
    const item = document.createElement("a");
    item.href = `#${label}`;
    item.textContent = label;
    nav.append(item);
  }
  return nav;
}

function createToolDetailDocument(detail, group) {
  const adapter = detail.adapter;
  const article = document.createElement("article");
  article.className = "tool-detail-document";
  article.append(
    createToolDocSection(
      "用途与状态",
      formatList([
        detail.summary,
        `Provider：${adapter.provider}`,
        `类型：${adapter.kind}`,
        `启用：${formatBoolean(adapter.enabled)}`,
        `健康：${adapter.healthStatus ?? "unknown"}`,
        `真实执行：${formatBoolean(adapter.realExecutionEligible)}`,
        group?.objective,
      ]),
    ),
    createToolDocSection("动作清单", formatAdapterActionCatalog(adapter.actions)),
    createToolDocSection("动作契约", formatAdapterActionContracts(adapter.actions)),
    createToolDocSection(
      "审计与门禁",
      formatList([
        adapter.auditSummary,
        `风险等级：${formatSkillRiskLabel(adapter.riskLevel)}`,
        `审批要求：${formatAdapterApprovalMode(adapter.approvalMode)}`,
        `权限范围：${formatList(adapter.permissionScopes)}`,
        `数据保留：${adapter.dataRetentionPolicy ?? "未声明"}`,
        `限流策略：${adapter.rateLimitPolicy ?? "未声明"}`,
        `预算策略：${adapter.budgetPolicy ?? "未声明"}`,
        `高风险动作：${adapter.highRiskActionCount ?? countAdapterActions(adapter.actions, "riskLevel", "high")}`,
        `需审批动作：${
          adapter.operatorApprovalActionCount ??
          countAdapterActions(adapter.actions, "approvalMode", "operator_approve")
        }`,
        ...(adapter.notes ?? []),
      ]),
    ),
    createToolDocSection(
      "路径与运行时",
      formatList([
        `Adapter ID：${adapter.id}`,
        `Registry：${detail.registryRoot ?? "未提供"}`,
        `Index：${detail.indexPath ?? "未提供"}`,
        `运行时：${detail.runtimeStatus ?? "unknown"}`,
      ]),
    ),
  );
  return article;
}

function createToolDocSection(titleText, bodyText) {
  const section = document.createElement("section");
  section.className = "tool-doc-section";
  section.id = titleText;
  const title = document.createElement("h3");
  title.textContent = titleText;
  const body = document.createElement("p");
  body.textContent = String(bodyText ?? "无");
  section.append(title, body);
  return section;
}

function createToolDetailMetaPanel(adapter) {
  const panel = document.createElement("aside");
  panel.className = "tool-detail-meta";
  const title = document.createElement("h3");
  title.textContent = "Adapter 状态";
  panel.append(
    title,
    createReadonlyRow("Adapter ID", adapter.id),
    createReadonlyRow("Provider", adapter.provider),
    createReadonlyRow("启用", formatBoolean(adapter.enabled)),
    createReadonlyRow("健康", adapter.healthStatus ?? "unknown"),
    createReadonlyRow("桥接", formatBoolean(adapter.bridgeCapable)),
    createReadonlyRow("真实执行", formatBoolean(adapter.realExecutionEligible)),
    createReadonlyRow("审批", formatAdapterApprovalMode(adapter.approvalMode)),
    createReadonlyRow("风险", formatSkillRiskLabel(adapter.riskLevel)),
    createReadonlyRow("权限", formatList(adapter.permissionScopes)),
    createReadonlyRow("Mock only", formatBoolean(adapter.mockOnly)),
    createReadonlyRow("Dry run", formatBoolean(adapter.dryRunSupported)),
  );
  return panel;
}

function renderReviewDetailRoute(container, detail, group) {
  const header = document.createElement("div");
  header.className = "review-detail-header";
  const back = document.createElement("button");
  back.className = "secondary-button compact";
  back.type = "button";
  back.textContent = "← 返回运行与审查";
  back.addEventListener("click", () => {
    state.selectedAsset = null;
    renderCatalog();
    renderSelectedCommand();
  });
  const copy = document.createElement("div");
  const breadcrumb = document.createElement("small");
  breadcrumb.textContent = `运行与审查 / ${formatReviewLaneLabel(detail.lane)} / ${detail.title}`;
  const title = document.createElement("h2");
  title.textContent = detail.title;
  const meta = document.createElement("p");
  meta.textContent = `${formatReviewStatusLabel(detail.status)} · ${detail.meta ?? "真实后端快照"}`;
  copy.append(breadcrumb, title, meta);
  const actions = document.createElement("div");
  actions.className = "asset-detail-actions";
  const headerActions = shouldShowReviewDecisionPanel(detail)
    ? selectReviewDecisionActions(detail, getReviewDecisionGroups(detail))
    : (detail.actionPrompts ?? []);
  for (const action of headerActions) {
    if (action.action) {
      actions.append(createAssetDirectActionButton(action.action, action.label, action.tone));
    }
  }
  header.append(back, copy, actions);

  const body = document.createElement("section");
  body.className = "review-detail-route-body";
  body.append(
    createReviewDetailNav(detail),
    createReviewDetailDocument(detail, group),
    createReviewDetailMetaPanel(detail),
  );
  container.append(header, body);
}

function createReviewDetailNav(detail) {
  const nav = document.createElement("nav");
  nav.className = "review-detail-nav";
  if (shouldShowReviewDecisionPanel(detail)) {
    const item = document.createElement("a");
    item.href = "#review-decision";
    item.textContent = "下一步";
    nav.append(item);
  }
  if (shouldShowReviewOverview(detail)) {
    const item = document.createElement("a");
    item.href = "#review-overview";
    item.textContent = "概览";
    nav.append(item);
  }
  for (const section of detail.sections ?? []) {
    const item = document.createElement("a");
    item.href = `#${section.title}`;
    item.textContent = section.title;
    nav.append(item);
  }
  if (detail.assignmentTable) {
    const item = document.createElement("a");
    item.href = "#review-assignments";
    item.textContent = "执行任务明细";
    nav.append(item);
  }
  if (detail.delegationSnapshot) {
    const item = document.createElement("a");
    item.href = "#review-delegations";
    item.textContent = hasReviewSubagentRuns(detail.delegationSnapshot) ? "Agent OS 子代理" : "协作角色";
    nav.append(item);
  }
  return nav;
}

function createReviewDetailDocument(detail, group) {
  const article = document.createElement("article");
  article.className = "review-detail-document";
  const decisionPanel = createReviewDecisionPanel(detail);
  if (decisionPanel) {
    article.append(decisionPanel);
  }
  const overview = createReviewOverviewPanel(detail);
  if (overview) {
    article.append(overview);
  }
  for (const section of detail.sections ?? []) {
    article.append(createReviewDocSection(section.title, section.body));
  }
  if (detail.assignmentTable) {
    article.append(createReviewAssignmentSection(detail));
  }
  if (detail.delegationSnapshot) {
    article.append(createReviewDelegationSection(detail));
  }
  return article;
}

function shouldShowReviewDecisionPanel(detail) {
  return detail.kind === "review-run" || detail.kind === "review-report";
}

function shouldShowReviewOverview(detail) {
  return detail.kind === "review-run" || detail.kind === "review-report";
}

function createReviewOverviewPanel(detail) {
  if (!shouldShowReviewOverview(detail)) {
    return null;
  }
  const panel = document.createElement("section");
  panel.id = "review-overview";
  panel.className = "review-overview-panel";
  const items = createReviewOverviewItems(detail);
  for (const item of items) {
    const block = document.createElement("div");
    block.className = "review-overview-item";
    const label = document.createElement("small");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = item.value;
    block.append(label, value);
    panel.append(block);
  }
  return panel;
}

function createReviewOverviewItems(detail) {
  const assignments = detail.assignmentTable ?? [];
  const approvals = assignments.filter(isApprovableAssignment).length;
  const blocked = assignments.filter((assignment) =>
    ["failed", "blocked", "aborted"].includes(assignment.status),
  ).length;
  const ready = assignments.filter((assignment) => assignment.status === "ready").length;
  const completed = assignments.filter((assignment) => assignment.status === "completed").length;
  const recallSection = (detail.sections ?? []).find((section) => section.title === "输入与召回");
  return [
    { label: "当前状态", value: formatReviewStatusLabel(detail.status) },
    {
      label: "最该处理",
      value:
        approvals > 0
          ? `先批准 ${approvals} 个待审任务`
          : blocked > 0
            ? `先处理 ${blocked} 个异常任务`
            : ready > 0
              ? `推进 ${ready} 个就绪任务`
              : detail.status === "completed"
                ? "复盘并决定是否沉淀经验"
                : "查看报告或状态",
    },
    { label: "执行进度", value: `完成 ${completed} · 待审 ${approvals} · 异常 ${blocked}` },
    { label: "召回情况", value: compactReviewOverviewText(recallSection?.body) },
  ];
}

function compactReviewOverviewText(value) {
  const text = String(value ?? "未记录").replace(/\s+/gu, " ").trim();
  if (text.length <= 80) {
    return text || "未记录";
  }
  return `${text.slice(0, 79)}…`;
}

function compactInlineText(value, limit = 120) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (text.length <= limit) {
    return text || "无";
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function createReviewDecisionPanel(detail) {
  if (!shouldShowReviewDecisionPanel(detail)) {
    return null;
  }
  const groups = getReviewDecisionGroups(detail);
  const panel = document.createElement("section");
  panel.id = "review-decision";
  panel.className = "review-decision-panel";
  const eyebrow = document.createElement("small");
  eyebrow.textContent = "你现在只看这里";
  const title = document.createElement("h3");
  title.textContent = "下一步该做什么";
  const body = document.createElement("p");
  body.textContent = createReviewDecisionCopy(detail, groups);
  const actions = document.createElement("div");
  actions.className = "review-decision-actions";
  for (const action of selectReviewDecisionActions(detail, groups)) {
    actions.append(createAssetDirectActionButton(action.action, action.label, action.tone));
  }
  const hints = document.createElement("div");
  hints.className = "review-decision-hints";
  for (const hint of createReviewDecisionHints(detail, groups)) {
    const item = document.createElement("span");
    item.textContent = hint;
    hints.append(item);
  }
  panel.append(eyebrow, title, body);
  if (actions.childElementCount > 0) {
    panel.append(actions);
  }
  panel.append(hints);
  return panel;
}

function getReviewDecisionGroups(detail) {
  const assignments = detail.assignmentTable ?? [];
  return {
    approvalRequired: assignments.filter(isApprovableAssignment),
    blocked: assignments.filter((assignment) =>
      ["failed", "blocked", "aborted"].includes(assignment.status),
    ),
    ready: assignments.filter((assignment) => assignment.status === "ready"),
  };
}

function createReviewDecisionCopy(detail, groups) {
  if (groups.approvalRequired.length > 0) {
    return "这个运行卡在人工批准。你不用复制 Run ID 或 Assignment ID，先点“批准全部待审任务”，系统会自动带上这些参数。批准后再点“启动”或“推进一次”。";
  }
  if (groups.blocked.length > 0) {
    return "这个运行有失败或阻塞任务。先点“重试失败任务”或“切换 Adapter”；如果仍然失败，再复盘并记录教训。";
  }
  if (groups.ready.length > 0) {
    return "任务已经准备好。点“推进一次”，让本地 worker 执行下一步。";
  }
  if (detail.status === "created") {
    return "这个运行已经创建，但还没有启动。点“启动”即可开始。";
  }
  if (detail.status === "completed") {
    return "这个运行已经完成。下一步是复盘，决定是否把结果沉淀成经验。";
  }
  return "当前没有明确卡点。优先看“报告”，如果没有报告就点“报告”重新生成。";
}

function createReviewDecisionHints(detail, groups) {
  return [
    `待人工 ${groups.approvalRequired.length}`,
    `可推进 ${groups.ready.length}`,
    `异常 ${groups.blocked.length}`,
    `状态 ${formatReviewStatusLabel(detail.status)}`,
  ];
}

function selectReviewDecisionActions(detail, groups) {
  if (groups.approvalRequired.length > 0) {
    return [
      ...findReviewDirectActions(detail, [DESKTOP_ACTIONS.RUN_CONTINUE]),
      ...findReviewDirectActions(detail, [
        DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS,
        DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT,
      ]),
    ].slice(0, 2);
  }
  if (groups.blocked.length > 0) {
    return findReviewActions(detail, ["run.retry", "run.reroute", "run.report"]).slice(0, 2);
  }
  if (groups.ready.length > 0) {
    return [
      ...findReviewDirectActions(detail, [DESKTOP_ACTIONS.RUN_CONTINUE]),
      ...findReviewActions(detail, ["run.once", "run.status"]),
    ].slice(0, 2);
  }
  if (detail.status === "created") {
    return [
      ...findReviewDirectActions(detail, [DESKTOP_ACTIONS.RUN_CONTINUE]),
      ...findReviewActions(detail, ["run.start", "run.report"]),
    ].slice(0, 2);
  }
  if (detail.status === "completed") {
    return (detail.actionPrompts ?? []).filter((action) =>
      ["复盘", "沉淀经验"].includes(action.label),
    );
  }
  return findReviewActions(detail, ["run.report", "run.audit"]);
}

function findReviewActions(detail, commandIds) {
  const commandIdSet = new Set(commandIds);
  return (detail.actionPrompts ?? []).filter((action) =>
    commandIdSet.has(action.action?.commandId),
  );
}

function findReviewDirectActions(detail, actionTypes) {
  const actionTypeSet = new Set(actionTypes);
  return (detail.actionPrompts ?? []).filter((action) => actionTypeSet.has(action.action?.type));
}

function createReviewDocSection(titleText, bodyText) {
  const section = document.createElement("section");
  section.className = "review-doc-section";
  section.id = titleText;
  const title = document.createElement("h3");
  title.textContent = titleText;
  const body = document.createElement("p");
  body.textContent = String(bodyText ?? "无");
  section.append(title, body);
  return section;
}

function createReviewAssignmentSection(detail) {
  const section = document.createElement("section");
  section.className = "review-doc-section";
  section.id = "review-assignments";
  const title = document.createElement("h3");
  title.textContent = "执行任务明细";
  const assignments = detail.assignmentTable ?? [];
  if (assignments.length === 0) {
    section.append(title, createAssetEmptyState("当前运行没有 assignment 明细。"));
    return section;
  }
  const table = document.createElement("table");
  table.className = "review-assignment-table";
  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  for (const label of ["任务", "现在状态", "为什么", "下一步", "动作"]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  thead.append(head);
  const tbody = document.createElement("tbody");
  for (const assignment of assignments) {
    tbody.append(createReviewAssignmentRow(detail, assignment));
  }
  table.append(thead, tbody);
  section.append(title, table);
  return section;
}

function createReviewDelegationSection(detail) {
  const snapshot = detail.delegationSnapshot ?? {};
  const subagentRuns = Array.isArray(snapshot.subagentRuns) ? snapshot.subagentRuns : [];
  const delegations = Array.isArray(snapshot.delegations) ? snapshot.delegations : [];
  const verification = Array.isArray(snapshot.verification) ? snapshot.verification : [];
  const schedulerHeartbeat = snapshot.subagentSchedulerHeartbeat ?? null;
  const schedulerDispatchPlan = snapshot.subagentSchedulerDispatchPlan ?? null;
  const schedulerTick = snapshot.subagentSchedulerTick ?? null;
  const schedulerRecoveryPlan = snapshot.subagentSchedulerRecoveryPlan ?? null;
  const section = document.createElement("section");
  section.className = "review-doc-section";
  section.id = "review-delegations";
  const title = document.createElement("h3");
  title.textContent = subagentRuns.length > 0 ? "Agent OS 子代理" : "协作角色";
  const summary = document.createElement("p");
  summary.textContent = formatReviewDelegationSummary(snapshot);
  section.append(title, summary);
  if (schedulerHeartbeat) {
    const schedulerSummary = document.createElement("p");
    schedulerSummary.className = "review-assignment-muted";
    schedulerSummary.textContent = formatReviewSubagentSchedulerHeartbeat(schedulerHeartbeat);
    section.append(schedulerSummary);
  }
  if (schedulerDispatchPlan) {
    const dispatchSummary = document.createElement("p");
    dispatchSummary.className = "review-assignment-muted";
    dispatchSummary.textContent = formatReviewSubagentSchedulerDispatchPlan(schedulerDispatchPlan);
    section.append(dispatchSummary);
  }
  if (schedulerTick) {
    const tickSummary = document.createElement("p");
    tickSummary.className = "review-assignment-muted";
    tickSummary.textContent = formatReviewSubagentSchedulerTick(schedulerTick);
    section.append(tickSummary);
  }
  if (schedulerRecoveryPlan) {
    const recoverySummary = document.createElement("p");
    recoverySummary.className = "review-assignment-muted";
    recoverySummary.textContent = formatReviewSubagentSchedulerRecoveryPlan(schedulerRecoveryPlan);
    section.append(recoverySummary);
  }
  if (subagentRuns.length > 0) {
    const table = document.createElement("table");
    table.className = "review-delegation-table";
    const thead = document.createElement("thead");
    const head = document.createElement("tr");
    for (const label of ["子代理", "状态", "任务/消息", "验证"]) {
      const th = document.createElement("th");
      th.textContent = label;
      head.append(th);
    }
    thead.append(head);
    const tbody = document.createElement("tbody");
    for (const run of subagentRuns) {
      tbody.append(createReviewSubagentRunRow(run));
    }
    table.append(thead, tbody);
    section.append(table);
    return section;
  }
  if (delegations.length === 0) {
    section.append(createAssetEmptyState("当前运行还没有协作角色记录。"));
    return section;
  }
  const table = document.createElement("table");
  table.className = "review-delegation-table";
  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  for (const label of ["角色", "职责", "状态", "验证"]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  thead.append(head);
  const tbody = document.createElement("tbody");
  for (const delegation of delegations) {
    tbody.append(createReviewDelegationRow(delegation, verification));
  }
  table.append(thead, tbody);
  section.append(table);
  return section;
}

function createReviewDelegationRow(delegation, verification) {
  const row = document.createElement("tr");
  const role = document.createElement("td");
  const worker = document.createElement("strong");
  worker.textContent = delegation.workerId ?? "unknown-worker";
  const meta = document.createElement("small");
  meta.textContent = formatList([
    delegation.targetAgent,
    delegation.specialization ? `specialization=${delegation.specialization}` : null,
    delegation.taskId,
  ]);
  role.append(worker, meta);
  const instruction = createTextCell(readReviewDelegationInstructionSummary(delegation));
  const status = document.createElement("td");
  status.append(
    createStatusPill(
      formatReviewDelegationStatus(delegation.status),
      mapReviewTone(delegation.status),
    ),
  );
  const statusMeta = document.createElement("small");
  statusMeta.className = "review-assignment-muted";
  statusMeta.textContent = formatList([
    delegation.resultSummary,
    delegation.error ? `错误：${delegation.error}` : null,
  ]);
  status.append(statusMeta);
  const verificationCell = createTextCell(formatReviewDelegationVerification(delegation, verification));
  row.append(role, instruction, status, verificationCell);
  return row;
}

function createReviewSubagentRunRow(run) {
  const row = document.createElement("tr");
  const identity = document.createElement("td");
  const title = document.createElement("strong");
  title.textContent = run.profileId ?? run.workerId ?? run.subagentId ?? "unknown-subagent";
  const meta = document.createElement("small");
  meta.textContent = formatList([
    run.subagentId,
    run.workerId ? `worker=${run.workerId}` : null,
    run.role ? `role=${run.role}` : null,
    run.isolatedContext === false ? "shared-context" : "isolated",
    run.scheduling?.parallelGroup ? `parallel=${run.scheduling.parallelGroup}` : null,
    Number.isFinite(run.scheduling?.parallelBatch) ? `batch=${run.scheduling.parallelBatch}` : null,
    Number.isFinite(run.scheduling?.scheduleOrder) ? `order=${run.scheduling.scheduleOrder}` : null,
    typeof run.scheduling?.readyToStart === "boolean"
      ? `ready=${String(run.scheduling.readyToStart)}`
      : null,
  ]);
  identity.append(title, meta);
  const status = document.createElement("td");
  status.append(
    createStatusPill(formatReviewDelegationStatus(run.status), mapReviewTone(run.status)),
  );
  const result = document.createElement("small");
  result.className = "review-assignment-muted";
  result.textContent = formatList([
    run.parentVisibleResult?.summary ?? run.resultSummary,
    run.error ? `错误：${run.error}` : null,
    run.parentVisibleResult?.verificationVerdict
      ? `verdict=${run.parentVisibleResult.verificationVerdict}`
      : null,
    run.scheduling?.canRunInParallel === false
      ? `写集冲突：${formatList(run.scheduling.conflictsWith)}`
      : null,
    run.scheduling?.observedConflictWith?.length > 0
      ? `实际写集冲突：${formatList(run.scheduling.observedConflictWith)}`
      : null,
    run.scheduling?.undeclaredObservedWriteSet?.length > 0
      ? `声明外写入：${formatList(run.scheduling.undeclaredObservedWriteSet)}`
      : null,
    run.scheduling?.blockedBy?.length > 0
      ? `等待：${formatList(run.scheduling.blockedBy)}`
      : null,
  ]);
  status.append(result);
  const task = createTextCell(formatReviewSubagentTaskSummary(run));
  const verification = createTextCell(formatReviewSubagentVerification(run));
  row.append(identity, status, task, verification);
  return row;
}

function formatReviewDelegationSummary(snapshot) {
  return formatList([
    `Agent OS 子代理：${snapshot.subagentRunCount ?? snapshot.subagentRuns?.length ?? 0} 个`,
    `Worker：${snapshot.workerIds?.length ?? 0} 个`,
    `队列：${snapshot.pendingDelegationCount ?? 0}`,
    `运行：${snapshot.runningDelegationCount ?? 0}`,
    `完成：${snapshot.completedDelegationCount ?? 0}`,
    `失败：${snapshot.failedDelegationCount ?? 0}`,
    `验证：${snapshot.verificationCount ?? 0}`,
  ]);
}

function formatReviewSubagentSchedulerHeartbeat(heartbeat) {
  return formatList([
    "调度心跳",
    `ready=${heartbeat.readyCount ?? 0}`,
    `blocked=${heartbeat.blockedCount ?? 0}`,
    `running=${heartbeat.runningCount ?? 0}`,
    `unscheduled=${heartbeat.unscheduledQueuedCount ?? 0}`,
    `canContinue=${String(Boolean(heartbeat.canContinue))}`,
    heartbeat.stoppedReason ? `stopped=${heartbeat.stoppedReason}` : null,
    Number.isFinite(heartbeat.nextParallelBatch) ? `nextBatch=${heartbeat.nextParallelBatch}` : null,
    Array.isArray(heartbeat.nextReadySubagentIds) && heartbeat.nextReadySubagentIds.length > 0
      ? `next=${formatList(heartbeat.nextReadySubagentIds)}`
      : null,
    Array.isArray(heartbeat.blockedSubagentIds) && heartbeat.blockedSubagentIds.length > 0
      ? `blockedByScheduler=${formatList(heartbeat.blockedSubagentIds)}`
      : null,
    Number.isFinite(heartbeat.heartbeatOrdinal) ? `heartbeat=${heartbeat.heartbeatOrdinal}` : null,
  ]);
}

function formatReviewSubagentSchedulerDispatchPlan(plan) {
  return formatList([
    "调度计划",
    `canDispatch=${String(Boolean(plan.canDispatch))}`,
    plan.dispatchReason ? `reason=${plan.dispatchReason}` : null,
    `max=${plan.maxDispatchableCount ?? 0}`,
    Array.isArray(plan.dispatchableSubagentIds) && plan.dispatchableSubagentIds.length > 0
      ? `dispatchable=${formatList(plan.dispatchableSubagentIds)}`
      : null,
    Array.isArray(plan.dispatchBatches) && plan.dispatchBatches.length > 0
      ? `batches=${formatReviewSubagentDispatchBatches(plan.dispatchBatches)}`
      : null,
    Array.isArray(plan.blockedSubagentIds) && plan.blockedSubagentIds.length > 0
      ? `blocked=${formatList(plan.blockedSubagentIds)}`
      : null,
    Array.isArray(plan.runningSubagentIds) && plan.runningSubagentIds.length > 0
      ? `running=${formatList(plan.runningSubagentIds)}`
      : null,
    Number.isFinite(plan.planOrdinal) ? `plan=${plan.planOrdinal}` : null,
    Number.isFinite(plan.heartbeatOrdinal) ? `heartbeat=${plan.heartbeatOrdinal}` : null,
  ]);
}

function formatReviewSubagentSchedulerTick(tick) {
  return formatList([
    "调度意图",
    `intents=${Array.isArray(tick.dispatchIntents) ? tick.dispatchIntents.length : 0}`,
    `claimDryRun=${String(Boolean(tick.claimDryRun))}`,
    tick.sessionId ? `session=${tick.sessionId}` : null,
    tick.latestTurnId ? `latestTurn=${tick.latestTurnId}` : null,
    Array.isArray(tick.dispatchIntents) && tick.dispatchIntents.length > 0
      ? `dispatch=${formatReviewSubagentSchedulerTickIntents(tick.dispatchIntents)}`
      : null,
  ]);
}

function formatReviewSubagentSchedulerTickIntents(intents) {
  return intents
    .map((intent) =>
      formatList([
        intent.delegationId,
        intent.workerId ? `worker=${intent.workerId}` : null,
        Number.isFinite(intent.parallelBatch) ? `batch=${intent.parallelBatch}` : null,
        Array.isArray(intent.writeSet) && intent.writeSet.length > 0
          ? `writeSet=${formatList(intent.writeSet)}`
          : null,
        intent.writeSetSource ? `writeSetSource=${intent.writeSetSource}` : null,
      ]),
    )
    .join("; ");
}

function formatReviewSubagentSchedulerRecoveryPlan(plan) {
  return formatList([
    "恢复建议",
    `canRecover=${String(Boolean(plan.canRecover))}`,
    `actions=${Array.isArray(plan.recoveryActions) ? plan.recoveryActions.length : 0}`,
    `groups=${Array.isArray(plan.recoveryGroups) ? plan.recoveryGroups.length : 0}`,
    Array.isArray(plan.blockedSubagentIds) && plan.blockedSubagentIds.length > 0
      ? `blocked=${formatList(plan.blockedSubagentIds)}`
      : null,
    Array.isArray(plan.conflictedSubagentIds) && plan.conflictedSubagentIds.length > 0
      ? `conflicted=${formatList(plan.conflictedSubagentIds)}`
      : null,
    Array.isArray(plan.recoveryGroups) && plan.recoveryGroups.length > 0
      ? `group=${formatReviewSubagentSchedulerRecoveryGroups(plan.recoveryGroups)}`
      : null,
    Array.isArray(plan.recoveryActions) && plan.recoveryActions.length > 0
      ? `next=${formatReviewSubagentSchedulerRecoveryActions(plan.recoveryActions)}`
      : null,
    Number.isFinite(plan.recoveryOrdinal) ? `recovery=${plan.recoveryOrdinal}` : null,
  ]);
}

function formatReviewSubagentSchedulerRecoveryGroups(groups) {
  return groups
    .map((group) =>
      formatList([
        group.groupId,
        group.groupType,
        group.severity,
        Array.isArray(group.writeSet) && group.writeSet.length > 0
          ? `writeSet=${formatList(group.writeSet)}`
          : null,
        Array.isArray(group.runningSubagentIds)
          ? `running=${group.runningSubagentIds.length}`
          : null,
        Array.isArray(group.blockedSubagentIds)
          ? `blocked=${group.blockedSubagentIds.length}`
          : null,
        Array.isArray(group.completedSubagentIds)
          ? `completed=${group.completedSubagentIds.length}`
          : null,
      ]),
    )
    .join("; ");
}

function formatReviewSubagentSchedulerRecoveryActions(actions) {
  return actions
    .map((action) =>
      formatList([
        action.subagentId,
        action.actionType,
        action.severity,
        action.reason,
        Array.isArray(action.relatedSubagentIds) && action.relatedSubagentIds.length > 0
          ? `related=${formatList(action.relatedSubagentIds)}`
          : null,
      ]),
    )
    .join("; ");
}

function formatReviewSubagentDispatchBatches(batches) {
  return batches
    .map((batch) => {
      const subagents = Array.isArray(batch.subagentIds) ? batch.subagentIds.join(",") : "";
      const workers = Array.isArray(batch.workerIds) ? batch.workerIds.join(",") : "";
      return `${batch.parallelBatch}:${subagents || "none"}@${workers || "none"}`;
    })
    .join("; ");
}

function readReviewDelegationInstructionSummary(delegation) {
  const instruction = String(delegation.instruction ?? "");
  const objective =
    instruction
      .split("\n")
      .find((line) => line.startsWith("Objective:"))
      ?.replace(/^Objective:\s*/u, "") ?? instruction;
  return objective.length > 220 ? `${objective.slice(0, 220)}...` : objective || "无";
}

function formatReviewSubagentTaskSummary(run) {
  return formatList([
    run.parentTurnId ? `parent=${run.parentTurnId}` : null,
    run.taskId ? `task=${run.taskId}` : null,
    run.scheduling?.writeSet?.length > 0
      ? `writeSet=${formatList(run.scheduling.writeSet)}`
      : null,
    run.scheduling?.writeSetSource ? `writeSetSource=${run.scheduling.writeSetSource}` : null,
    run.scheduling?.undeclaredObservedWriteSet?.length > 0
      ? `undeclaredObservedWriteSet=${formatList(run.scheduling.undeclaredObservedWriteSet)}`
      : null,
    run.scheduling?.observedConflictWith?.length > 0
      ? `observedConflictWith=${formatList(run.scheduling.observedConflictWith)}`
      : null,
    run.observedWriteSet?.length > 0
      ? `observedWriteSet=${formatList(run.observedWriteSet)}`
      : null,
    run.observedWriteSetSource ? `observedWriteSetSource=${run.observedWriteSetSource}` : null,
    readReviewDelegationInstructionSummary(run),
    run.contextSnapshot ? `context=${compactInlineText(run.contextSnapshot, 160)}` : null,
  ]);
}

function formatReviewDelegationVerification(delegation, verification) {
  const request = delegation.verificationRequest;
  if (!request) {
    return "无需独立验证";
  }
  const record = verification.find((item) => item.id === request.verificationId);
  return formatList([
    request.verifierId ? `验证者：${request.verifierId}` : null,
    record?.status ? `状态：${formatReviewDelegationStatus(record.status)}` : "状态：待验证",
    request.requirement,
  ]);
}

function formatReviewSubagentVerification(run) {
  const verification = run.verification;
  if (!verification) {
    return "暂无独立验证记录";
  }
  return formatList([
    verification.verifierId ? `验证者：${verification.verifierId}` : null,
    verification.status ? `状态：${formatReviewDelegationStatus(verification.status)}` : null,
    verification.verdict ? `结论：${verification.verdict}` : null,
    verification.verdictSummary,
    verification.requirement,
    Array.isArray(verification.checks) && verification.checks.length > 0
      ? `检查：${verification.checks.map(formatReviewVerificationCheck).join("；")}`
      : null,
  ]);
}

function formatReviewVerificationCheck(check) {
  return formatList([check.id, check.status, check.summary]);
}

function formatReviewDelegationStatus(status) {
  const labels = {
    queued: "排队中",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    pending: "待处理",
    passed: "已通过",
    warning: "有警告",
    blocked: "阻塞",
  };
  return labels[status] ?? formatReviewStatusLabel(status);
}

function hasReviewSubagentRuns(snapshot) {
  return Array.isArray(snapshot?.subagentRuns) && snapshot.subagentRuns.length > 0;
}

function createReviewAssignmentRow(detail, assignment) {
  const row = document.createElement("tr");
  const info = document.createElement("td");
  const title = document.createElement("strong");
  title.textContent = formatReviewAssignmentTitle(assignment);
  const summary = document.createElement("small");
  summary.textContent = formatList([
    assignment.objective,
    assignment.deliverable,
    assignment.assignmentId,
  ]);
  info.append(title, summary);
  const status = document.createElement("td");
  const humanState = formatReviewAssignmentHumanState(assignment);
  status.append(
    createStatusPill(formatReviewStatusLabel(assignment.status), mapReviewTone(assignment.status)),
  );
  const stateCopy = document.createElement("small");
  stateCopy.className = "review-assignment-muted";
  stateCopy.textContent = humanState;
  status.append(stateCopy);
  const reason = createTextCell(formatReviewAssignmentReason(assignment));
  const nextStep = createTextCell(formatReviewAssignmentNextStep(assignment));
  const actions = document.createElement("td");
  actions.className = "review-assignment-actions";
  for (const action of createAssignmentDirectActions(detail, assignment)) {
    actions.append(createAssetDirectActionButton(action.action, action.label, action.tone));
  }
  if (actions.childElementCount === 0) {
    const empty = document.createElement("small");
    empty.className = "review-assignment-muted";
    empty.textContent = "无需按钮";
    actions.append(empty);
  }
  row.append(info, status, reason, nextStep, actions);
  return row;
}

function createReviewDetailMetaPanel(detail) {
  const panel = document.createElement("aside");
  panel.className = "review-detail-meta";
  const title = document.createElement("h3");
  title.textContent = "操作与状态";
  const actions = document.createElement("div");
  actions.className = "review-detail-actions";
  for (const action of detail.actionPrompts ?? []) {
    if (action.action) {
      actions.append(createAssetDirectActionButton(action.action, action.label, action.tone));
    }
  }
  panel.append(title);
  if (actions.childElementCount > 0) {
    panel.append(actions);
  }
  for (const field of detail.fields ?? []) {
    panel.append(createReadonlyRow(field.label, field.value));
  }
  return panel;
}

function createExperienceDetailNav() {
  const nav = document.createElement("nav");
  nav.className = "experience-detail-nav";
  for (const label of ["原始来源", "提炼经验", "审核", "召回", "历史"]) {
    const item = document.createElement("a");
    item.href = `#${label}`;
    item.textContent = label;
    nav.append(item);
  }
  return nav;
}

function createExperienceDetailDocument(detail, group) {
  const candidate = detail.candidate;
  const article = document.createElement("article");
  article.className = "experience-detail-document";
  article.append(
    createExperienceOriginalSourceSection(detail),
    createExperienceExtractedExperienceSection(candidate),
    createExperienceReviewSection(candidate),
    createExperienceRecallSection(candidate, detail),
    createExperienceHistorySection(candidate),
  );
  return article;
}

function createExperienceOriginalSourceSection(detail) {
  const body = document.createElement("div");
  body.className = "experience-doc-block";
  if (detail.sourceReader) {
    body.append(createSourceReaderBlock(detail.sourceReader));
  } else {
    const empty = document.createElement("p");
    empty.textContent = "当前后端 snapshot 未返回完整来源。";
    body.append(empty);
  }
  return createExperienceDocSection("原始来源", body);
}

function createExperienceExtractedExperienceSection(candidate) {
  const body = document.createElement("div");
  body.className = "experience-doc-block";
  body.append(createExperienceEditForm(candidate));
  return createExperienceDocSection("提炼经验", body);
}

function createExperienceReviewSection(candidate) {
  const body = document.createElement("div");
  body.className = "experience-review-panel";
  const summary = document.createElement("p");
  summary.textContent = createExperienceReviewSummary(candidate);
  const quality = document.createElement("p");
  quality.textContent = `质量门禁：${formatExperienceQuality(candidate)}；原因：${formatList(
    candidate.quality?.reasons ?? candidate.qualityReasons,
  )}`;
  const risks = document.createElement("p");
  risks.textContent = `风险：${formatList(candidate.risks)}`;
  const evidence = document.createElement("p");
  evidence.textContent = `证据：${formatExperienceEvidenceDetail(candidate.evidence)}`;
  const actions = document.createElement("div");
  actions.className = "review-decision-actions";
  for (const actionPrompt of createExperienceReviewPrompts(candidate)) {
    if (actionPrompt.action) {
      actions.append(
        createAssetDirectActionButton(actionPrompt.action, actionPrompt.label, actionPrompt.tone),
      );
    }
  }
  body.append(summary, quality, risks, evidence);
  if (actions.childElementCount > 0) {
    body.append(actions);
  }
  return createExperienceDocSection("审核", body);
}

function createExperienceRecallSection(candidate, detail) {
  const body = document.createElement("div");
  body.className = "experience-doc-block";
  body.append(
    createReadonlyRow("当前状态", formatExperienceStatusLabel(candidate.status)),
    createReadonlyRow("知识链路", detail.meta),
    createReadonlyRow("分类", candidate.category?.name ?? "待分类"),
    createReadonlyRow(
      "标签",
      formatList([
        ...(candidate.tags ?? []),
        ...(candidate.taxonomyTags ?? []).map((tag) => tag.name),
      ]),
    ),
    createReadonlyRow("运行时召回", createExperienceRecallCopy(candidate)),
  );
  return createExperienceDocSection("召回", body);
}

function createExperienceHistorySection(candidate) {
  const body = document.createElement("div");
  body.className = "experience-doc-block";
  body.append(
    createReadonlyRow("创建时间", formatEpochDate(candidate.createdAtMs)),
    createReadonlyRow("来源类型", formatExperienceSourceKind(candidate.sourceKind)),
    createReadonlyRow("来源引用", candidate.sourceRef ?? "未返回"),
    createReadonlyRow("Source Artifact", candidate.sourceArtifactId ?? "未返回"),
    createReadonlyRow("Source Digest", candidate.sourceDigest ?? "未返回"),
    createReadonlyRow("Adapter", candidate.adapterId ?? "未返回"),
    createReadonlyRow("隐私级别", candidate.privacy ?? "未返回"),
    createReadonlyRow("Provenance", candidate.provenance ?? "未返回"),
  );
  return createExperienceDocSection("历史", body);
}

function createExperienceEditForm(candidate) {
  const form = document.createElement("form");
  form.className = "experience-edit-form";
  const editable = resolveExperienceLifecycleStatus(candidate) === "harvested";
  form.append(
    createExperienceEditTextarea("summary", "提炼摘要", candidate.summary, 5, editable),
    createExperienceEditTextarea(
      "applicability",
      "适用场景",
      candidate.applicability ?? "",
      3,
      editable,
    ),
    createExperienceEditTextarea(
      "risks",
      "风险提醒",
      (candidate.risks ?? []).join("\n"),
      4,
      editable,
    ),
    createExperienceEditTextarea(
      "tags",
      "经验标签",
      (candidate.tags ?? []).join(", "),
      2,
      editable,
    ),
  );
  if (editable) {
    const save = document.createElement("button");
    save.className = "primary-button";
    save.type = "submit";
    save.textContent = "保存提炼经验";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await executeAssetAction(
        {
          type: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
          candidateId: candidate.id,
          summary: readExperienceEditField(form, "summary"),
          applicability: readExperienceEditField(form, "applicability"),
          risks: readExperienceEditField(form, "risks"),
          tags: readExperienceEditField(form, "tags"),
        },
        save,
        "保存提炼经验",
      );
    });
    form.append(save);
  } else {
    const locked = document.createElement("p");
    locked.className = "experience-edit-locked";
    locked.textContent = "这条经验已经完成审核，提炼内容锁定；如需改写，请重新学习生成新候选。";
    form.append(locked);
  }
  return form;
}

function createExperienceEditTextarea(field, labelText, value, rows, editable) {
  const label = document.createElement("label");
  label.className = "experience-edit-field";
  const title = document.createElement("span");
  title.textContent = labelText;
  const textarea = document.createElement("textarea");
  textarea.setAttribute("data-experience-edit-field", field);
  textarea.rows = rows;
  textarea.value = String(value ?? "");
  textarea.readOnly = !editable;
  label.append(title, textarea);
  return label;
}

function readExperienceEditField(form, field) {
  return form.querySelector(`[data-experience-edit-field="${field}"]`)?.value ?? "";
}

function createExperienceRecallCopy(candidate) {
  const lifecycleStatus = resolveExperienceLifecycleStatus(candidate);
  if (lifecycleStatus === "promoted") {
    return "已进入知识候选；知识发布后可被制作任务召回。";
  }
  if (lifecycleStatus === "publish-ready") {
    return "已标记发布就绪；下一步晋升到知识候选链路。";
  }
  if (lifecycleStatus === "reviewed") {
    return "已通过经验审核；下一步晋升为知识候选。";
  }
  if (lifecycleStatus === "harvested") {
    return "仍在采集/经验审核前，不会被制作任务召回。";
  }
  return "当前状态不会参与制作召回。";
}

function createExperienceDocSection(titleText, bodyContent) {
  const section = document.createElement("section");
  section.className = "experience-doc-section";
  section.id = titleText;
  const title = document.createElement("h3");
  title.textContent = titleText;
  section.append(title);
  if (Array.isArray(bodyContent)) {
    section.append(...bodyContent);
  } else if (bodyContent && typeof bodyContent === "object" && "nodeType" in bodyContent) {
    section.append(bodyContent);
  } else {
    const body = document.createElement("p");
    body.textContent = String(bodyContent ?? "无");
    section.append(body);
  }
  return section;
}

function createExperienceSteps(candidate) {
  const claims = candidate.evidence?.map((entry) => entry.summary).filter(Boolean) ?? [];
  if (claims.length > 0) {
    return claims.join("；");
  }
  return candidate.summary;
}

function createExperienceTaxonomyEditor(candidate) {
  const taxonomy = state.snapshot?.assets?.experience?.taxonomy ?? { categories: [], tags: [] };
  const panel = document.createElement("aside");
  panel.className = "experience-taxonomy-editor";
  const title = document.createElement("h3");
  title.textContent = "分类与标签";

  const categoryLabel = document.createElement("label");
  categoryLabel.textContent = "分类";
  const categorySelect = document.createElement("select");
  categorySelect.dataset.field = "categoryId";
  for (const category of taxonomy.categories ?? []) {
    if (category.categoryId === "all") {
      continue;
    }
    const option = document.createElement("option");
    option.value = category.categoryId;
    option.textContent = category.name;
    option.selected =
      candidate.category?.categoryId === category.categoryId ||
      (!candidate.category && category.categoryId === "uncategorized");
    categorySelect.append(option);
  }
  categoryLabel.append(categorySelect);

  const tagField = document.createElement("div");
  tagField.className = "experience-taxonomy-checks";
  const tagTitle = document.createElement("strong");
  tagTitle.textContent = "自定义标签";
  tagField.append(tagTitle);
  const selectedTagIds = new Set(candidate.taxonomyTags?.map((tag) => tag.tagId) ?? []);
  for (const tag of taxonomy.tags ?? []) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag.tagId;
    input.checked = selectedTagIds.has(tag.tagId);
    label.append(input, document.createTextNode(tag.name));
    tagField.append(label);
  }

  const save = document.createElement("button");
  save.className = "primary-button";
  save.type = "button";
  save.textContent = "保存分类标签";
  save.addEventListener("click", async () => {
    const tagIds = [...tagField.querySelectorAll("input[type='checkbox']:checked")].map(
      (input) => input.value,
    );
    await executeAssetAction(
      {
        type: DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
        candidateId: candidate.id,
        categoryId: categorySelect.value,
        tagIds,
      },
      save,
      "保存分类标签",
    );
  });

  const createCategory = createTaxonomyCreateControl({
    placeholder: "新建分类名称",
    buttonLabel: "新建分类",
    actionType: DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE,
  });
  const createTag = createTaxonomyCreateControl({
    placeholder: "添加自定义标签",
    buttonLabel: "新建标签",
    actionType: DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE,
  });
  panel.append(
    title,
    categoryLabel,
    tagField,
    save,
    createCategory,
    createTag,
    createLifecycleBlock(candidate),
  );
  return panel;
}

function createTaxonomyCreateControl({ placeholder, buttonLabel, actionType }) {
  const wrapper = document.createElement("div");
  wrapper.className = "taxonomy-create-control";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  const button = document.createElement("button");
  button.className = "secondary-button";
  button.type = "button";
  button.textContent = buttonLabel;
  button.addEventListener("click", async () => {
    const name = input.value.trim();
    if (name.length === 0) {
      input.focus();
      return;
    }
    await executeAssetAction({ type: actionType, name }, button, buttonLabel);
  });
  wrapper.append(input, button);
  return wrapper;
}

function createSkillSnapshotEditor(skill) {
  const form = document.createElement("form");
  form.className = "skill-edit-form";
  const title = document.createElement("h3");
  title.textContent = "编辑 Skill";
  form.append(
    title,
    createSkillEditInput("title", "标题", skill.title ?? skill.id),
    createSkillEditTextarea("description", "中文简介 / 描述", skill.description ?? "", 4),
    createSkillEditTextarea("content", "Skill 正文", skill.content ?? "", 8),
    createSkillEditInput("tags", "标签", (skill.tags ?? []).join(", ")),
    createSkillEditInput("toolNames", "工具", (skill.toolNames ?? []).join(", ")),
  );
  const save = document.createElement("button");
  save.className = "primary-button";
  save.type = "submit";
  save.textContent = "保存 Skill";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await executeAssetAction(
      {
        type: DESKTOP_ACTIONS.SKILL_UPDATE,
        skillId: skill.id,
        title: readSkillEditField(form, "title"),
        description: readSkillEditField(form, "description"),
        content: readSkillEditField(form, "content"),
        tags: parseSkillListField(readSkillEditField(form, "tags")),
        toolNames: parseSkillListField(readSkillEditField(form, "toolNames")),
      },
      save,
      "保存 Skill",
    );
  });
  form.append(save);
  return form;
}

function createSkillEditInput(field, labelText, value) {
  const label = document.createElement("label");
  label.className = "skill-edit-field";
  const title = document.createElement("span");
  title.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("data-skill-edit-field", field);
  input.value = String(value ?? "");
  label.append(title, input);
  return label;
}

function createSkillEditTextarea(field, labelText, value, rows) {
  const label = document.createElement("label");
  label.className = "skill-edit-field";
  const title = document.createElement("span");
  title.textContent = labelText;
  const textarea = document.createElement("textarea");
  textarea.setAttribute("data-skill-edit-field", field);
  textarea.rows = rows;
  textarea.value = String(value ?? "");
  label.append(title, textarea);
  return label;
}

function readSkillEditField(form, field) {
  return form.querySelector(`[data-skill-edit-field="${field}"]`)?.value?.trim() ?? "";
}

function parseSkillListField(value) {
  return value
    .split(/[,，\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createLifecycleBlock(candidate) {
  const block = document.createElement("div");
  block.className = "experience-lifecycle";
  const title = document.createElement("strong");
  title.textContent = "经验生命周期";
  const lifecycleStatus = resolveExperienceLifecycleStatus(candidate);
  const stageRank = {
    harvested: 0,
    reviewed: 1,
    "publish-ready": 2,
    promoted: 3,
  };
  const currentRank = stageRank[lifecycleStatus] ?? -1;
  const steps = [
    ["harvested", "已采集", currentRank >= stageRank.harvested],
    ["reviewed", "已审核", currentRank >= stageRank.reviewed],
    ["publish-ready", "发布就绪", currentRank >= stageRank["publish-ready"]],
    ["promoted", "已晋升", currentRank >= stageRank.promoted],
  ];
  block.append(title);
  for (const [stage, label, active] of steps) {
    const row = document.createElement("span");
    row.className = active ? "active" : "";
    row.dataset.lifecycleStage = stage;
    row.textContent = label;
    block.append(row);
  }
  return block;
}

function getPrimaryWorkbenchPrompts(surfaceId) {
  const prompts = {
    experience: [
      { label: "/学习", prompt: "/学习 " },
      { label: "/经验", prompt: "/经验 列表" },
      { label: "/知识", prompt: "/知识 列表" },
    ],
    skills: [
      { label: "/技能", prompt: "/技能" },
      { label: "查看提案", prompt: "/技能 查看 " },
    ],
    tools: [
      { label: "/工具", prompt: "/工具" },
      { label: "注册工具", prompt: "/工具 注册 " },
      { label: "平台能力", prompt: "/工具 平台" },
    ],
    review: [
      { label: "/审查", prompt: "/审查" },
      { label: "/运行", prompt: "/运行 状态 " },
    ],
  };
  return prompts[surfaceId] ?? [];
}

function renderAssetSurfaceBody(container, surfaceId) {
  if (surfaceId === "experience") {
    renderExperienceAssetSurface(container);
    return;
  }
  if (surfaceId === "skills") {
    renderSkillsAssetSurface(container);
    return;
  }
  if (surfaceId === "tools") {
    renderToolsAssetSurface(container);
    return;
  }
  if (surfaceId === "review") {
    renderReviewAssetSurface(container);
    return;
  }
  container.append(createAssetEmptyState("当前板块暂无资产。"));
}

function renderExperienceAssetSurface(container) {
  const experience = state.snapshot?.assets?.experience;
  const candidate = state.snapshot?.candidate;
  const knowledge = state.snapshot?.knowledge;
  container.append(
    createAssetMetricGrid([
      ["待审查", experience?.pendingCount ?? 0],
      ["已接受", experience?.acceptedCount ?? 0],
      ["已晋升", experience?.promotedCount ?? 0],
      ["隔离", experience?.quarantineCount ?? 0],
    ]),
    createExperienceLibraryToolbar(experience, createExperienceLibraryOptions(candidate?.items ?? [])),
    createExperienceLibraryLayout(candidate?.items ?? [], experience, createExperienceLibraryOptions(candidate?.items ?? [])),
    createAssetSection("隔离来源", experience?.quarantineItems ?? [], {
      emptyCopy: "暂无被隔离的学习来源。",
      toCard: createExperienceQuarantineCard,
    }),
    createAssetSection("知识候选 / 已发布", createKnowledgeAssetItems(knowledge), {
      emptyCopy: "暂无知识候选或已发布知识。",
      toCard: createKnowledgeAssetCard,
    }),
  );
}

function createExperienceLibraryOptions(candidates) {
  return {
    candidates,
    formatEpochDate,
    formatExperienceDistillation,
    formatExperienceSourceKind,
    formatExperienceStatusLabel,
    resolveExperienceLifecycleStatus,
  };
}


function renderSkillsAssetSurface(container) {
  const skills = state.snapshot?.assets?.skills;
  container.append(
    createSkillLibraryToolbar(skills),
    createSkillStatusStrip(skills),
    createSkillCuratorPanel(skills?.curator),
    createSkillLibraryLayout(skills?.items ?? [], skills),
    createSkillProposalTable(skills?.proposals ?? []),
  );
}

function createSkillCuratorPanel(curator) {
  const section = document.createElement("section");
  section.className = "skill-list-section skill-curator-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Skill Curator";
  const subtitle = document.createElement("small");
  subtitle.textContent = "failure / stale / duplicate review";
  titleWrap.append(title, subtitle);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(curator?.actionCount ?? 0);
  header.append(titleWrap, count);

  const refresh = createAssetDirectActionButton(
    { type: DESKTOP_ACTIONS.SKILL_CURATOR_REFRESH },
    "刷新 Curator",
    "secondary",
  );
  refresh.classList.add("compact");

  if (!curator || (curator.actions ?? []).length === 0) {
    section.append(header, refresh, createAssetEmptyState("暂无 Skill curator 建议。"));
    return section;
  }

  const summary = curator.summary ?? {};
  const list = document.createElement("div");
  list.className = "skill-list skill-curator-list";
  for (const action of curator.actions ?? []) {
    list.append(createSkillCuratorRow(action));
  }
  section.append(
    header,
    createAssetMetricGrid([
      ["总数", summary.totalSkills ?? 0],
      ["修补", summary.patchCount ?? 0],
      ["归档", summary.archiveCount ?? 0],
      ["合并", summary.mergeCount ?? 0],
      ["保持", summary.keepCount ?? 0],
    ]),
    refresh,
    list,
  );
  return section;
}

function createSkillCuratorRow(action) {
  const row = document.createElement("article");
  row.className = "skill-list-row skill-curator-row";
  row.dataset.skillCuratorKind = action.kind ?? "";
  row.dataset.status = action.status ?? "";
  row.dataset.skillId = action.skillId ?? "";

  const main = document.createElement("div");
  main.className = "skill-list-main";
  const titleCell = document.createElement("div");
  titleCell.className = "skill-title-cell";
  const button = document.createElement("button");
  button.className = "skill-title-link";
  button.type = "button";
  button.dataset.assetSurface = "review";
  button.dataset.assetId = `skill-curator:${action.skillId}`;
  button.textContent = action.title ?? action.skillId;
  const summary = document.createElement("small");
  summary.textContent = action.summary ?? action.reason ?? "";
  titleCell.append(button, summary);
  main.append(titleCell, createSkillCuratorMetaStrip(action));

  const detail = document.createElement("div");
  detail.className = "skill-list-detail";
  detail.append(
    createSkillListLine("建议", formatSkillCuratorKindLabel(action.kind)),
    createSkillListLine("证据", formatSkillCuratorEvidence(action.evidence)),
    createSkillListLine("重复项", formatList(action.duplicateSkillIds)),
    createSkillExplanationSurfaceBlock(action.explanationSurface, { compact: true }),
  );

  const controls = document.createElement("div");
  controls.className = "skill-list-controls";
  const buttons = document.createElement("div");
  buttons.className = "skill-row-actions";
  for (const actionPrompt of createSkillCuratorDirectActions(action)) {
    const control = createAssetDirectActionButton(
      actionPrompt.action,
      actionPrompt.label,
      actionPrompt.tone,
    );
    control.classList.add("compact", "skill-action-button");
    buttons.append(control);
  }
  controls.append(buttons);
  if (action.kind === "patch") {
    controls.append(createSkillCuratorPatchEditor(action));
  }
  row.append(main, detail, controls);
  return row;
}

function createSkillCuratorMetaStrip(action) {
  const strip = document.createElement("div");
  strip.className = "skill-list-meta-strip";
  for (const value of [
    formatSkillCuratorKindLabel(action.kind),
    formatSkillCuratorSeverityLabel(action.severity),
    action.skillId,
    action.canonicalSkillId ? `canonical ${action.canonicalSkillId}` : null,
    action.updatedAtMs ? formatEpochDate(action.updatedAtMs) : null,
  ]) {
    if (!value) {
      continue;
    }
    const chip = document.createElement("span");
    chip.textContent = value;
    strip.append(chip);
  }
  return strip;
}

function createSkillStatusStrip(skills) {
  const strip = document.createElement("section");
  strip.className = "skill-status-strip";
  const summary = skills?.runtimeSummary ?? {};
  for (const [label, value] of [
    ["总数", skills?.total ?? 0],
    ["自进化", skills?.selfCount ?? 0],
    ["外部", skills?.externalCount ?? 0],
    ["外部开启", skills?.externalEnabledCount ?? 0],
    ["外部关闭", skills?.externalDisabledCount ?? 0],
    ["可用", summary.readyCount ?? skills?.readyCount ?? countSkillsByDoctorStatus(skills?.items, "ready")],
    ["需配置", summary.needsSetupCount ?? skills?.needsSetupCount ?? countSkillsByDoctorStatus(skills?.items, "needs-setup")],
    ["关闭", summary.disabledCount ?? skills?.disabledRuntimeCount ?? countSkillsByDoctorStatus(skills?.items, "disabled")],
    [
      "模型关闭",
      summary.modelInvocationDisabledCount ??
        skills?.modelInvocationDisabledCount ??
        countSkillsByDoctorStatus(skills?.items, "model-invocation-disabled"),
    ],
    ["阻塞", summary.blockedCount ?? skills?.blockedCount ?? 0],
    ["已移除", summary.missingSkillCount ?? skills?.missingSkillCount ?? 0],
    ["未检查工具", summary.uncheckedToolCount ?? skills?.uncheckedToolCount ?? 0],
    [
      "模型可见",
      summary.modelVisibleCount ??
        skills?.modelVisibleCount ??
        countSkillsByRuntimeStatus(skills?.items, "modelVisible"),
    ],
    [
      "可召回",
      summary.eligibleCount ??
        skills?.eligibleCount ??
        countSkillsByRuntimeStatus(skills?.items, "eligible"),
    ],
    ["候选", skills?.proposalCount ?? 0],
    ["Curator", skills?.curatorActionCount ?? 0],
    ["需修补", skills?.curatorPatchCount ?? 0],
    ["可归档", skills?.curatorArchiveCount ?? 0],
    ["可合并", skills?.curatorMergeCount ?? 0],
  ]) {
    const item = document.createElement("span");
    item.textContent = `${label} ${value}`;
    strip.append(item);
  }
  return strip;
}

function renderReviewAssetSurface(container) {
  const review = state.snapshot?.assets?.review;
  const items = createReviewQueueItems(review);
  container.append(
    createAssetMetricGrid([
      ["待处理", review?.pendingCount ?? 0],
      ["经验审查", review?.pendingExperienceCount ?? 0],
      ["知识审查", review?.pendingKnowledgeCount ?? 0],
      ["Trace 待审", review?.pendingTraceProposalCount ?? 0],
      ["Run 需处理", review?.runAttentionCount ?? 0],
      ["失败", review?.failedRunCount ?? 0],
    ]),
  );
  const agentOsReleaseGatePanel = createAgentOsReleaseGateOpsPanel(review?.agentOsReleaseGate);
  if (agentOsReleaseGatePanel) {
    container.append(agentOsReleaseGatePanel);
  }
  const agentOsReleaseSmokeReadinessPanel = createAgentOsReleaseSmokeReadinessOpsPanel(review?.agentOsReleaseSmokeReadiness);
  if (agentOsReleaseSmokeReadinessPanel) {
    container.append(agentOsReleaseSmokeReadinessPanel);
  }
  const agentOsReleaseSmokeAdmissionPanel = createAgentOsReleaseSmokeAdmissionOpsPanel(review?.agentOsReleaseSmokeAdmission);
  if (agentOsReleaseSmokeAdmissionPanel) {
    container.append(agentOsReleaseSmokeAdmissionPanel);
  }
  const agentOsReleaseSmokeExecutionPreflightPanel = createAgentOsReleaseSmokeExecutionPreflightOpsPanel(review?.agentOsReleaseSmokeExecutionPreflight);
  if (agentOsReleaseSmokeExecutionPreflightPanel) {
    container.append(agentOsReleaseSmokeExecutionPreflightPanel);
  }
  const agentOsReleaseSmokeEvidenceIntakePanel = createAgentOsReleaseSmokeEvidenceIntakeOpsPanel(review?.agentOsReleaseSmokeEvidenceIntake);
  if (agentOsReleaseSmokeEvidenceIntakePanel) {
    container.append(agentOsReleaseSmokeEvidenceIntakePanel);
  }
  const agentOsReleaseSmokeEvidenceManifestPreflightPanel = createAgentOsReleaseSmokeEvidenceManifestPreflightOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestPreflight);
  if (agentOsReleaseSmokeEvidenceManifestPreflightPanel) {
    container.append(agentOsReleaseSmokeEvidenceManifestPreflightPanel);
  }
  const agentOsReleaseSmokeEvidenceManifestValidationPanel = createAgentOsReleaseSmokeEvidenceManifestValidationOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestValidation);
  if (agentOsReleaseSmokeEvidenceManifestValidationPanel) {
    container.append(agentOsReleaseSmokeEvidenceManifestValidationPanel);
  }
  const agentOsReleaseSmokeEvidenceManifestPathAuthorizationPanel = createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestPathAuthorization);
  if (agentOsReleaseSmokeEvidenceManifestPathAuthorizationPanel) {
    container.append(agentOsReleaseSmokeEvidenceManifestPathAuthorizationPanel);
  }
  const agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessPanel = createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadiness);
  if (agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessPanel) {
    container.append(agentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessPanel);
  }
  const agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingPanel = createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBinding);
  if (agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingPanel) {
    container.append(agentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingPanel);
  }
  const agentOsReleaseSmokeEvidenceManifestReadAuthorizationPanel = createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestReadAuthorization);
  if (agentOsReleaseSmokeEvidenceManifestReadAuthorizationPanel) {
    container.append(agentOsReleaseSmokeEvidenceManifestReadAuthorizationPanel);
  }
  const agentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessPanel = createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessOpsPanel(review?.agentOsReleaseSmokeEvidenceManifestAuditArtifactReadiness);
  if (agentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessPanel) {
    container.append(agentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessPanel);
  }
  const agentOsReleaseSmokeRunnerIntentSigningRevocationPanel = createAgentOsReleaseSmokeRunnerIntentSigningRevocationOpsPanel(review?.agentOsReleaseSmokeRunnerIntentSigningRevocation);
  if (agentOsReleaseSmokeRunnerIntentSigningRevocationPanel) {
    container.append(agentOsReleaseSmokeRunnerIntentSigningRevocationPanel);
  }
  const agentOsMemoryEvalPanel = createAgentOsMemoryEvalOpsPanel(review?.agentOsMemoryEval);
  if (agentOsMemoryEvalPanel) {
    container.append(agentOsMemoryEvalPanel);
  }
  const agentOsMemorySweepSafetyPanel = createAgentOsMemorySweepSafetyOpsPanel(review?.agentOsMemorySweepSafety);
  if (agentOsMemorySweepSafetyPanel) {
    container.append(agentOsMemorySweepSafetyPanel);
  }
  const agentOsMemoryEvalDashboardPanel = createAgentOsMemoryEvalDashboardOpsPanel(review?.agentOsMemoryEvalDashboard);
  if (agentOsMemoryEvalDashboardPanel) {
    container.append(agentOsMemoryEvalDashboardPanel);
  }
  const governancePanel = createReviewMemoryGovernancePanel(review);
  if (governancePanel) {
    container.append(governancePanel);
  }
  container.append(createReviewLibraryToolbar(items), createReviewConsoleLayout(items, review));
}

const AGENT_OS_RELEASE_GATE_TIERS = Object.freeze([
  "smoke",
  "synthetic",
  "real-provider",
  "real-data",
]);

function createAgentOsReleaseGateOpsPanel(releaseGate) {
  if (!releaseGate) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-gate-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布门禁";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(releaseGate.status)} · ${
    releaseGate.summary?.passedTiers ?? 0
  }/${releaseGate.summary?.tiers ?? 0}`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-gate-body";
  const overview = document.createElement("div");
  overview.className = "agent-os-release-gate-overview";
  const overviewText = document.createElement("p");
  overviewText.textContent =
    "CI-safe release gate 已读取最近一次 director-agent-os-all 结果；真实设备、账号、live provider 和真实数据仍按 skipped checklist 交给 operator 验收。";
  overview.append(
    overviewText,
    createAssetMetricGrid([
      ["Tier", releaseGate.summary?.tiers ?? 0],
      ["Suite", releaseGate.summary?.suiteRuns ?? 0],
      ["Skipped", releaseGate.summary?.skippedChecks ?? 0],
      ["Failed", releaseGate.summary?.failed ?? 0],
    ]),
  );

  const tierGrid = document.createElement("div");
  tierGrid.className = "agent-os-release-gate-tier-grid";
  const tiersById = new Map((releaseGate.tiers ?? []).map((tier) => [tier.id, tier]));
  for (const tierId of AGENT_OS_RELEASE_GATE_TIERS) {
    tierGrid.append(createAgentOsReleaseGateTierCard(tiersById.get(tierId) ?? { id: tierId }));
  }

  body.append(overview, tierGrid, createAgentOsReleaseGateChecklist(releaseGate));
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseGateTierCard(tier) {
  const card = document.createElement("article");
  card.className = "agent-os-release-gate-tier";
  card.dataset.agentOsReleaseGateTier = tier.id;
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateTierLabel(tier.id);
  const status = createStatusPill(
    formatAgentOsReleaseGateStatus(tier.status ?? "missing"),
    mapReviewTone(tier.status ?? "missing"),
  );
  const stats = document.createElement("p");
  stats.textContent = `suites ${tier.passedSuites ?? 0}/${tier.suiteRuns ?? 0} · skipped ${
    tier.skippedChecks?.length ?? 0
  }`;
  card.append(title, status, stats);
  return card;
}

function createAgentOsReleaseGateChecklist(releaseGate) {
  const checklist = document.createElement("div");
  checklist.className = "agent-os-release-gate-checklist";
  const title = document.createElement("h4");
  title.textContent = "live-only checklist";
  const list = document.createElement("ul");
  const skippedChecks = releaseGate.skippedChecks ?? [];
  for (const check of skippedChecks) {
    const item = document.createElement("li");
    item.textContent = `${formatAgentOsReleaseGateSkippedCheckId(check.id)} · ${formatAgentOsReleaseGateSkipReason(
      check.skipReason,
    )} · ${check.detail || "需要 operator 验收"}`;
    list.append(item);
  }
  if (skippedChecks.length === 0) {
    for (const itemText of releaseGate.releaseChecklist ?? []) {
      const item = document.createElement("li");
      item.textContent = itemText;
      list.append(item);
    }
  }
  checklist.append(title, list);
  return checklist;
}

function formatAgentOsReleaseGateTierLabel(tierId) {
  switch (tierId) {
    case "smoke":
      return "smoke";
    case "synthetic":
      return "synthetic";
    case "real-provider":
      return "real-provider";
    case "real-data":
      return "real-data";
    default:
      return tierId ?? "unknown";
  }
}

function formatAgentOsReleaseGateStatus(status) {
  switch (status) {
    case "passed":
      return "通过";
    case "failed":
      return "失败";
    case "skipped":
      return "跳过";
    case "missing":
      return "缺失";
    case "degraded":
      return "降级";
    default:
      return status ?? "未知";
  }
}

function formatAgentOsReleaseGateSkipReason(reason) {
  switch (reason) {
    case "missing-auth":
      return "missing-auth：缺少账号或授权";
    case "missing-local-service":
      return "missing-local-service：本地服务未启动";
    case "provider-disabled":
      return "provider-disabled：live provider 未启用";
    case "unsafe-environment":
      return "unsafe-environment：需要匿名化和人工批准";
    default:
      return `${reason ?? "unknown"}：需要人工复核`;
  }
}

function formatAgentOsReleaseGateSkippedCheckId(checkId) {
  switch (checkId) {
    case "real-desktop-device-release-smoke":
      return "真实桌面 smoke";
    case "real-weixin-device-release-smoke":
      return "真实微信 smoke";
    case "live-external-provider-account-smoke":
      return "live external provider";
    case "live-browser-authenticated-smoke":
      return "登录态 browser";
    case "live-user-memory-dataset-sweep":
      return "真实用户记忆数据 sweep";
    default:
      return checkId ?? "unknown";
  }
}

function createAgentOsReleaseSmokeReadinessOpsPanel(releaseSmokeReadiness) {
  if (!releaseSmokeReadiness) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-readiness-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 预检";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(releaseSmokeReadiness.status)} · ${
    releaseSmokeReadiness.summary?.blockedCount ?? 0
  } blocked`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-readiness-body";
  const intro = document.createElement("p");
  intro.textContent =
    "readiness plans 只把 live-only smoke 的 operator action、授权、环境和数据安全前置条件列出来；当前 canExecuteLiveCheck=false，live runner 不会自动启动。";
  const plans = document.createElement("div");
  plans.className = "agent-os-release-smoke-readiness-plans";
  for (const plan of releaseSmokeReadiness.plans ?? []) {
    plans.append(createAgentOsReleaseSmokeReadinessPlanCard(plan));
  }
  body.append(intro, plans);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeReadinessPlanCard(plan) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-readiness-plan";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-readiness-plan-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(plan.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(plan.status)} · ${
      plan.canExecuteLiveCheck ? "canExecuteLiveCheck=true" : "canExecuteLiveCheck=false"
    }`,
    mapReviewTone(plan.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["tier", plan.tierId ?? "unknown"],
    ["reason", plan.skipReason ?? "unknown"],
    ["operator action", plan.requiresOperatorAction ? "required" : "none"],
    ["live runner", plan.liveRunnerEnabled ? "enabled" : "disabled"],
  ]);

  const detail = document.createElement("p");
  detail.className = "agent-os-release-smoke-readiness-detail";
  detail.textContent = plan.operatorAction || plan.detail || "operator action required";

  card.append(header, metrics, detail, createAgentOsReleaseSmokeReadinessRequirementList(plan));
  return card;
}

function createAgentOsReleaseSmokeReadinessRequirementList(plan) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-readiness-requirements";
  const title = document.createElement("h4");
  title.textContent = "requirements";
  const list = document.createElement("ul");
  const requirements = [
    ...(plan.requirements ?? []),
    ...(plan.inheritedBlockedReasons ?? []).map((reason) => `memory:${reason}`),
  ];
  for (const requirement of requirements) {
    const item = document.createElement("li");
    item.textContent = formatAgentOsReleaseSmokeReadinessRequirement(requirement);
    list.append(item);
  }
  if (requirements.length === 0) {
    const item = document.createElement("li");
    item.textContent = "operator review：需要人工复核";
    list.append(item);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeReadinessRequirement(requirement) {
  switch (requirement) {
    case "operator-started-desktop":
      return "desktop：需要 operator 启动本地桌面应用";
    case "local-service-health":
      return "desktop：需要本地服务 health 通过";
    case "manual-smoke-script":
      return "smoke：需要人工执行发布冒烟脚本";
    case "operator-auth":
      return "auth：需要 operator 授权";
    case "weixin-device":
      return "weixin：需要已认证设备/账号";
    case "provider-credentials":
      return "provider：需要 live 凭据";
    case "provider-enabled":
      return "provider：需要显式启用";
    case "network-policy-approval":
      return "network：需要网络策略批准";
    case "browser-auth-profile":
      return "browser：需要已批准登录态 profile";
    case "operator-approval":
      return "memory：需要 operator approval";
    case "live-user-memory-eval-scope":
      return "memory：scope 必须是 live-user-memory-eval";
    case "irreversible-anonymization":
      return "memory：需要不可逆匿名化";
    case "raw-content-storage-forbidden":
      return "memory：禁止保存 raw content";
    case "dry-run-readonly-network-disabled":
      return "memory：必须 dry-run/read-only/network disabled";
    default:
      if (String(requirement ?? "").startsWith("memory:")) {
        return `${requirement}：继承 memory sweep blocked reason`;
      }
      return `${requirement ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeAdmissionOpsPanel(releaseSmokeAdmission) {
  if (!releaseSmokeAdmission) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-admission-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 准入";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(releaseSmokeAdmission.status)} · ${
    releaseSmokeAdmission.summary?.admittedCount ?? 0
  } admitted`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-admission-body";
  const intro = document.createElement("p");
  intro.textContent =
    "admission verdicts 会在真实 smoke 前检查 operator scope、environment isolation、audit evidence 和数据策略；当前 admitted=false，runnerIntentCreated=false。";
  const verdicts = document.createElement("div");
  verdicts.className = "agent-os-release-smoke-admission-verdicts";
  for (const verdict of releaseSmokeAdmission.verdicts ?? []) {
    verdicts.append(createAgentOsReleaseSmokeAdmissionVerdictCard(verdict));
  }
  body.append(intro, verdicts);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeAdmissionVerdictCard(verdict) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-admission-verdict";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-admission-verdict-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(verdict.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(verdict.status)} · ${
      verdict.admitted ? "admitted=true" : "admitted=false"
    }`,
    mapReviewTone(verdict.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["operator scope", verdict.operatorScope ?? "missing"],
    ["environment isolation", verdict.environmentIsolation ?? "missing"],
    ["audit evidence", verdict.auditEvidence ?? "missing"],
    ["data policy", verdict.dataPolicy ?? "not-required"],
    ["runner intent", verdict.runnerIntentCreated ? "created" : "runnerIntentCreated=false"],
    ["token", verdict.executionTokenIssued ? "issued" : "executionTokenIssued=false"],
  ]);

  card.append(header, metrics, createAgentOsReleaseSmokeAdmissionSignalList(verdict));
  return card;
}

function createAgentOsReleaseSmokeAdmissionSignalList(verdict) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-admission-signals";
  const title = document.createElement("h4");
  title.textContent = "missing signals";
  const list = document.createElement("ul");
  const signals = verdict.missingSignals ?? [];
  for (const signal of signals) {
    const item = document.createElement("li");
    item.textContent = formatAgentOsReleaseSmokeAdmissionSignal(signal);
    list.append(item);
  }
  if (signals.length === 0) {
    const item = document.createElement("li");
    item.textContent = "admission：准入信号完整";
    list.append(item);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeAdmissionSignal(signal) {
  switch (signal) {
    case "operator-scope":
      return "operator scope：缺少本次 live smoke 授权范围";
    case "environment-isolation":
      return "environment isolation：缺少隔离环境声明";
    case "audit-evidence":
      return "audit evidence：缺少可审计证据路径";
    case "auth-context":
      return "auth：缺少账号/profile 授权上下文";
    case "provider-credentials":
      return "provider：缺少 live provider 凭据";
    case "network-policy":
      return "network：缺少网络策略批准";
    case "data-policy":
      return "data policy：缺少真实用户数据策略";
    case "anonymization-evidence":
      return "data policy：缺少匿名化证据";
    case "retention-policy":
      return "data policy：缺少 retention 策略";
    default:
      return `${signal ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeExecutionPreflightOpsPanel(executionPreflight) {
  if (!executionPreflight) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-execution-preflight-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 执行预检";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(executionPreflight.status)} · ${
    executionPreflight.summary?.readyToExecuteCount ?? 0
  } ready`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-execution-preflight-body";
  const intro = document.createElement("p");
  intro.textContent =
    "execution preflight packets 会在真实 smoke 创建执行意图前检查 operator scope evidence、environment isolation evidence、audit artifact、auth/provider/data policy evidence；当前 executionIntentCreated=false，liveRunnerStarted=false。";
  const packets = document.createElement("div");
  packets.className = "agent-os-release-smoke-execution-preflight-packets";
  for (const packet of executionPreflight.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeExecutionPreflightPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeExecutionPreflightPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-execution-preflight-packet";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-execution-preflight-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.readyToExecute ? "readyToExecute=true" : "readyToExecute=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["blocked reason", packet.executionBlockedReason ?? "admission-blocked"],
    ["operator scope evidence", packet.operatorScopeEvidence ?? "missing"],
    ["environment isolation evidence", packet.environmentIsolationEvidence ?? "missing"],
    ["audit artifact", packet.auditArtifact ?? "missing"],
    ["execution intent", packet.executionIntentCreated ? "created" : "executionIntentCreated=false"],
    ["live runner", packet.liveRunnerStarted ? "started" : "liveRunnerStarted=false"],
  ]);

  card.append(header, metrics, createAgentOsReleaseSmokeExecutionPreflightEvidenceList(packet));
  return card;
}

function createAgentOsReleaseSmokeExecutionPreflightEvidenceList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-execution-preflight-evidence";
  const title = document.createElement("h4");
  title.textContent = "missing evidence";
  const list = document.createElement("ul");
  const evidence = packet.missingEvidence ?? packet.requiredEvidence ?? [];
  for (const item of evidence) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeExecutionEvidence(item);
    list.append(row);
  }
  if (evidence.length === 0) {
    const row = document.createElement("li");
    row.textContent = "execution preflight：证据完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeExecutionEvidence(evidence) {
  switch (evidence) {
    case "operator-scope-evidence":
      return "operator scope evidence：缺少本次 live smoke 授权记录";
    case "environment-isolation-evidence":
      return "environment isolation evidence：缺少隔离环境证据";
    case "audit-artifact":
      return "audit artifact：缺少审计 artifact 路径";
    case "auth-context-evidence":
      return "auth evidence：缺少账号/profile 授权证据";
    case "provider-credential-evidence":
      return "provider evidence：缺少 live provider 凭据证据";
    case "network-policy-evidence":
      return "network evidence：缺少网络策略证据";
    case "data-policy-evidence":
      return "data policy evidence：缺少真实用户数据策略证据";
    case "anonymization-evidence":
      return "data evidence：缺少匿名化证据";
    case "retention-policy-evidence":
      return "data evidence：缺少 retention 策略证据";
    default:
      return `${evidence ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeEvidenceIntakeOpsPanel(evidenceIntake) {
  if (!evidenceIntake) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-intake-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 证据录入";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(evidenceIntake.status)} · ${
    evidenceIntake.summary?.acceptedEvidenceCount ?? 0
  } accepted`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-intake-body";
  const intro = document.createElement("p");
  intro.textContent =
    "evidence intake packets 只接受 local operator evidence manifest 的本地路径声明；当前 remoteIntakeAllowed=false，runnerIntentUnlocked=false，不读取真实用户数据。";
  const packets = document.createElement("div");
  packets.className = "agent-os-release-smoke-evidence-intake-packets";
  for (const packet of evidenceIntake.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceIntakePacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceIntakePacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-intake-packet";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-evidence-intake-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.runnerIntentUnlocked ? "runnerIntentUnlocked=true" : "runnerIntentUnlocked=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["mode", packet.evidenceIntakeMode ?? "local-operator-file"],
    ["evidence manifest", packet.evidenceManifestPath ?? "missing"],
    ["accepted", packet.acceptedEvidenceCount ?? 0],
    ["remote intake", packet.remoteIntakeAllowed ? "remoteIntakeAllowed=true" : "remoteIntakeAllowed=false"],
    ["user data", packet.canReadUserData ? "canReadUserData=true" : "canReadUserData=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(header, metrics, createAgentOsReleaseSmokeEvidenceIntakeMissingList(packet));
  return card;
}

function createAgentOsReleaseSmokeEvidenceIntakeMissingList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-intake-missing";
  const title = document.createElement("h4");
  title.textContent = "local operator evidence";
  const list = document.createElement("ul");
  const evidence = packet.missingEvidence ?? packet.requiredEvidence ?? [];
  for (const item of evidence) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceIntakeItem(item);
    list.append(row);
  }
  if (evidence.length === 0) {
    const row = document.createElement("li");
    row.textContent = "evidence intake：本地 operator evidence 已完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceIntakeItem(item) {
  switch (item) {
    case "operator-scope-evidence":
      return "operator scope evidence：等待本地 operator evidence manifest";
    case "environment-isolation-evidence":
      return "environment isolation evidence：等待隔离环境证据 manifest";
    case "audit-artifact":
      return "audit artifact：等待本地审计 artifact 路径";
    case "auth-context-evidence":
      return "auth evidence：等待账号/profile 授权 evidence manifest";
    case "provider-credential-evidence":
      return "provider evidence：等待 live provider 凭据 evidence manifest";
    case "network-policy-evidence":
      return "network policy evidence：等待网络策略 evidence manifest";
    case "data-policy-evidence":
      return "data policy evidence：等待真实用户数据策略 evidence manifest";
    case "anonymization-evidence":
      return "anonymization evidence：等待匿名化 evidence manifest";
    case "retention-policy-evidence":
      return "retention policy evidence：等待 retention evidence manifest";
    default:
      return `${item ?? "unknown"}：等待本地 operator evidence manifest`;
  }
}

function createAgentOsReleaseSmokeEvidenceManifestPreflightOpsPanel(manifestPreflight) {
  if (!manifestPreflight) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-manifest-preflight-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 证据清单预检";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(manifestPreflight.status)} · ${
    manifestPreflight.summary?.manifestSchemaValidCount ?? 0
  } valid`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-manifest-preflight-body";
  const intro = document.createElement("p");
  intro.textContent =
    "manifest preflight packets 只声明 evidence manifest schema required fields；当前 manifestSchemaValid=false，manifestContentRead=false，不读取本地清单内容。";
  const packets = document.createElement("div");
  packets.className = "agent-os-release-smoke-evidence-manifest-preflight-packets";
  for (const packet of manifestPreflight.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceManifestPreflightPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceManifestPreflightPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-manifest-preflight-packet";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-evidence-manifest-preflight-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.manifestSchemaValid ? "manifestSchemaValid=true" : "manifestSchemaValid=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["schema", packet.manifestSchemaVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1"],
    ["manifest path", packet.evidenceManifestPath ?? "missing"],
    ["path status", packet.manifestPathStatus ?? "missing"],
    ["content read", packet.manifestContentRead ? "manifestContentRead=true" : "manifestContentRead=false"],
    ["remote manifest", packet.remoteManifestAllowed ? "remoteManifestAllowed=true" : "remoteManifestAllowed=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(header, metrics, createAgentOsReleaseSmokeEvidenceManifestFieldList(packet));
  return card;
}

function createAgentOsReleaseSmokeEvidenceManifestFieldList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-manifest-preflight-fields";
  const title = document.createElement("h4");
  title.textContent = "schema required fields";
  const list = document.createElement("ul");
  const fields = packet.missingManifestFields ?? packet.requiredManifestFields ?? [];
  for (const field of fields) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceManifestField(field);
    list.append(row);
  }
  if (fields.length === 0) {
    const row = document.createElement("li");
    row.textContent = "evidence manifest schema：字段完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceManifestField(field) {
  switch (field) {
    case "schemaVersion":
      return "schemaVersion：必须声明 evidence manifest schema";
    case "checkId":
      return "checkId：必须绑定 live-only smoke check";
    case "operator":
      return "operator：必须记录本地 operator 身份或授权引用";
    case "createdAt":
      return "createdAt：必须记录本地清单创建时间";
    case "evidence":
      return "evidence：必须包含 evidence item 列表";
    case "operatorScope":
      return "operatorScope：必须包含 operator scope evidence";
    case "environmentIsolation":
      return "environmentIsolation：必须包含隔离环境 evidence";
    case "auditArtifact":
      return "auditArtifact：必须包含审计 artifact 路径";
    case "authContext":
      return "authContext：必须包含账号/profile 授权 evidence";
    case "providerCredential":
      return "providerCredential：必须包含 provider 凭据 evidence";
    case "networkPolicy":
      return "networkPolicy：必须包含网络策略 evidence";
    case "dataPolicy":
      return "dataPolicy：必须包含真实用户数据策略 evidence";
    case "anonymization":
      return "anonymization：必须包含匿名化 evidence";
    case "retentionPolicy":
      return "retentionPolicy：必须包含 retention 策略 evidence";
    default:
      return `${field ?? "unknown"}：evidence manifest schema required field`;
  }
}

function createAgentOsReleaseSmokeEvidenceManifestValidationOpsPanel(manifestValidation) {
  if (!manifestValidation) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-manifest-validation-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 清单校验";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(manifestValidation.status)} · ${
    manifestValidation.summary?.manifestValidatedCount ?? 0
  } validated`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-manifest-validation-body";
  const intro = document.createElement("p");
  intro.textContent =
    "manifest validation packets 只定义 schema-only local file 校验契约；当前 manifestValidated=false，manifestReadAllowed=false，auditArtifactReady=false，runnerIntentUnlocked=false。";
  const packets = document.createElement("div");
  packets.className = "agent-os-release-smoke-evidence-manifest-validation-packets";
  for (const packet of manifestValidation.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceManifestValidationPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceManifestValidationPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-manifest-validation-packet";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-evidence-manifest-validation-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.manifestValidated ? "manifestValidated=true" : "manifestValidated=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["mode", packet.manifestValidationMode ?? "schema-only-local-file"],
    ["validation status", packet.manifestValidationStatus ?? "blocked"],
    ["manifest read", packet.manifestReadAllowed ? "manifestReadAllowed=true" : "manifestReadAllowed=false"],
    ["content read", packet.manifestContentRead ? "manifestContentRead=true" : "manifestContentRead=false"],
    ["audit artifact", packet.auditArtifactReady ? "ready" : "auditArtifactReady=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(header, metrics, createAgentOsReleaseSmokeEvidenceManifestValidationIssueList(packet));
  return card;
}

function createAgentOsReleaseSmokeEvidenceManifestValidationIssueList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-manifest-validation-issues";
  const title = document.createElement("h4");
  title.textContent = "validation issues";
  const list = document.createElement("ul");
  const issues = packet.validationIssues ?? [];
  for (const issue of issues) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceManifestValidationIssue(issue);
    list.append(row);
  }
  if (issues.length === 0) {
    const row = document.createElement("li");
    row.textContent = "manifest validation：校验契约完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceManifestValidationIssue(issue) {
  switch (issue) {
    case "manifest-path-missing":
      return "manifest path：缺少本地 operator evidence manifest 路径";
    case "manifest-read-not-allowed":
      return "manifest read：当前契约不允许读取真实清单内容";
    case "manifest-schema-not-validated":
      return "schema validation：清单 schema 尚未完成本地校验";
    case "audit-artifact-not-ready":
      return "audit artifact：审计 artifact 尚未 ready";
    default:
      return `${issue ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationOpsPanel(pathAuthorization) {
  if (!pathAuthorization) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-manifest-path-authorization-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 清单路径授权";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(pathAuthorization.status)} · ${
    pathAuthorization.summary?.manifestPathAuthorizedCount ?? 0
  } authorized`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-manifest-path-authorization-body";
  const intro = document.createElement("p");
  intro.textContent =
    "manifest path authorization packets 只定义 operator-owned local path 授权契约；当前 manifestPathAuthorized=false，manifestPathReadAllowed=false，remotePathRejected=true，runnerIntentUnlocked=false。";
  const packets = document.createElement("div");
  packets.className = "agent-os-release-smoke-evidence-manifest-path-authorization-packets";
  for (const packet of pathAuthorization.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-manifest-path-authorization-packet";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-evidence-manifest-path-authorization-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.manifestPathAuthorized
        ? "manifestPathAuthorized=true"
        : "manifestPathAuthorized=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["mode", packet.manifestPathAuthorizationMode ?? "operator-owned-local-path"],
    ["path status", packet.manifestPathStatus ?? "missing"],
    ["read allowed", packet.manifestPathReadAllowed ? "manifestPathReadAllowed=true" : "manifestPathReadAllowed=false"],
    ["directory", packet.manifestDirectoryAllowed ? "allowlisted" : "manifestDirectoryAllowed=false"],
    ["remote path", packet.remotePathRejected ? "remotePathRejected=true" : "remotePathRejected=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(
    header,
    metrics,
    createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationIssueList(packet),
  );
  return card;
}

function createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationIssueList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-manifest-path-authorization-issues";
  const title = document.createElement("h4");
  title.textContent = "path authorization issues";
  const list = document.createElement("ul");
  const issues = packet.pathAuthorizationIssues ?? [];
  for (const issue of issues) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceManifestPathAuthorizationIssue(issue);
    list.append(row);
  }
  if (issues.length === 0) {
    const row = document.createElement("li");
    row.textContent = "manifest path authorization：路径授权契约完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceManifestPathAuthorizationIssue(issue) {
  switch (issue) {
    case "operator-owned-path-missing":
      return "operator-owned path：缺少 operator 显式授权的本地 manifest 路径";
    case "manifest-directory-not-allowlisted":
      return "manifest directory：清单目录尚未进入本地 allowlist";
    case "manifest-read-not-authorized":
      return "manifest read：路径读取尚未授权";
    case "remote-path-rejected":
      return "remote path：远程路径默认拒绝";
    default:
      return `${issue ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessOpsPanel(readiness) {
  if (!readiness) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-manifest-schema-validator-readiness-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 清单 schema 校验器";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(readiness.status)} · ${
    readiness.summary?.schemaValidatorReadyCount ?? 0
  } ready`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-manifest-schema-validator-readiness-body";
  const intro = document.createElement("p");
  intro.textContent =
    "schema validator readiness packets 只定义 local schema contract 的校验器 readiness；当前 schemaValidatorReady=false，schemaDefinitionLoaded=false，manifestReadAllowed=false，runnerIntentUnlocked=false。";
  const packets = document.createElement("div");
  packets.className =
    "agent-os-release-smoke-evidence-manifest-schema-validator-readiness-packets";
  for (const packet of readiness.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-manifest-schema-validator-readiness-packet";
  const header = document.createElement("div");
  header.className =
    "agent-os-release-smoke-evidence-manifest-schema-validator-readiness-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.schemaValidatorReady ? "schemaValidatorReady=true" : "schemaValidatorReady=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["mode", packet.schemaValidatorMode ?? "local-schema-contract"],
    ["validator status", packet.schemaValidatorStatus ?? "blocked"],
    ["schema version", packet.schemaDefinitionVersion ?? "director.agent-os.release-smoke-evidence-manifest.v1"],
    ["schema loaded", packet.schemaDefinitionLoaded ? "schemaDefinitionLoaded=true" : "schemaDefinitionLoaded=false"],
    ["manifest read", packet.manifestReadAllowed ? "manifestReadAllowed=true" : "manifestReadAllowed=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(
    header,
    metrics,
    createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessIssueList(packet),
  );
  return card;
}

function createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessIssueList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-manifest-schema-validator-readiness-issues";
  const title = document.createElement("h4");
  title.textContent = "schema validator issues";
  const list = document.createElement("ul");
  const issues = packet.schemaValidatorIssues ?? [];
  for (const issue of issues) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessIssue(issue);
    list.append(row);
  }
  if (issues.length === 0) {
    const row = document.createElement("li");
    row.textContent = "schema validator readiness：校验器 readiness 契约完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessIssue(issue) {
  switch (issue) {
    case "manifest-path-not-authorized":
      return "manifest path：路径授权尚未通过";
    case "schema-definition-not-bound":
      return "schema definition：校验器 schema definition 尚未绑定";
    case "manifest-read-not-authorized":
      return "manifest read：清单读取尚未授权";
    case "audit-artifact-not-ready":
      return "audit artifact：审计 artifact 尚未 ready";
    default:
      return `${issue ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingOpsPanel(binding) {
  if (!binding) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-manifest-schema-definition-binding-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 清单 schema 定义绑定";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(binding.status)} · ${
    binding.summary?.schemaDefinitionBindingReadyCount ?? 0
  } ready`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-manifest-schema-definition-binding-body";
  const intro = document.createElement("p");
  intro.textContent =
    "schema definition binding packets 只绑定 embedded schema definition ref 的本地契约引用；当前 schemaDefinitionBound=false，schemaDefinitionBindingReady=false，manifestReadAllowed=false，runnerIntentUnlocked=false。";
  const packets = document.createElement("div");
  packets.className =
    "agent-os-release-smoke-evidence-manifest-schema-definition-binding-packets";
  for (const packet of binding.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-manifest-schema-definition-binding-packet";
  const header = document.createElement("div");
  header.className =
    "agent-os-release-smoke-evidence-manifest-schema-definition-binding-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.schemaDefinitionBindingReady
        ? "schemaDefinitionBindingReady=true"
        : "schemaDefinitionBindingReady=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["mode", packet.schemaDefinitionBindingMode ?? "embedded-schema-definition-ref"],
    ["binding status", packet.schemaDefinitionBindingStatus ?? "blocked"],
    [
      "definition",
      packet.schemaDefinitionBound ? "schemaDefinitionBound=true" : "schemaDefinitionBound=false",
    ],
    ["schema ref", packet.schemaDefinitionReference ?? "director.agent-os.release-smoke-evidence-manifest.v1"],
    ["loader", packet.schemaLoaderReady ? "schemaLoaderReady=true" : "schemaLoaderReady=false"],
    [
      "validator",
      packet.schemaValidatorReady ? "schemaValidatorReady=true" : "schemaValidatorReady=false",
    ],
    ["manifest read", packet.manifestReadAllowed ? "manifestReadAllowed=true" : "manifestReadAllowed=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(
    header,
    metrics,
    createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingIssueList(packet),
  );
  return card;
}

function createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingIssueList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-manifest-schema-definition-binding-issues";
  const title = document.createElement("h4");
  title.textContent = "schema definition binding issues";
  const list = document.createElement("ul");
  const issues = packet.schemaDefinitionBindingIssues ?? [];
  for (const issue of issues) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingIssue(issue);
    list.append(row);
  }
  if (issues.length === 0) {
    const row = document.createElement("li");
    row.textContent = "schema definition binding：schema definition binding 契约完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingIssue(issue) {
  switch (issue) {
    case "schema-definition-not-bound":
      return "schema definition：本地 schema definition reference 尚未绑定";
    case "schema-loader-not-ready":
      return "schema loader：schema loader 尚未 ready";
    case "validator-not-ready":
      return "validator：schema validator readiness 尚未通过";
    case "manifest-read-not-authorized":
      return "manifest read：清单读取尚未授权";
    case "audit-artifact-not-ready":
      return "audit artifact：审计 artifact 尚未 ready";
    default:
      return `${issue ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationOpsPanel(authorization) {
  if (!authorization) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-manifest-read-authorization-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 清单读取授权";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(authorization.status)} · ${
    authorization.summary?.manifestReadAuthorizationReadyCount ?? 0
  } ready`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-manifest-read-authorization-body";
  const intro = document.createElement("p");
  intro.textContent =
    "manifest read authorization packets 只定义 local manifest read authorization；当前 manifestReadAuthorized=false，manifestReadAuthorizationReady=false，manifestContentRead=false，runnerIntentUnlocked=false。";
  const packets = document.createElement("div");
  packets.className =
    "agent-os-release-smoke-evidence-manifest-read-authorization-packets";
  for (const packet of authorization.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-manifest-read-authorization-packet";
  const header = document.createElement("div");
  header.className =
    "agent-os-release-smoke-evidence-manifest-read-authorization-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.manifestReadAuthorizationReady
        ? "manifestReadAuthorizationReady=true"
        : "manifestReadAuthorizationReady=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["mode", packet.manifestReadAuthorizationMode ?? "local-manifest-read-authorization"],
    ["read status", packet.manifestReadAuthorizationStatus ?? "blocked"],
    [
      "authorization",
      packet.manifestReadAuthorized
        ? "manifestReadAuthorized=true"
        : "manifestReadAuthorized=false",
    ],
    [
      "operator scope",
      packet.operatorReadScopeGranted
        ? "operatorReadScopeGranted=true"
        : "operatorReadScopeGranted=false",
    ],
    [
      "schema binding",
      packet.schemaDefinitionBindingReady
        ? "schemaDefinitionBindingReady=true"
        : "schemaDefinitionBindingReady=false",
    ],
    ["path", packet.manifestPathAuthorized ? "manifestPathAuthorized=true" : "manifestPathAuthorized=false"],
    ["content", packet.manifestContentRead ? "manifestContentRead=true" : "manifestContentRead=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(
    header,
    metrics,
    createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationIssueList(packet),
  );
  return card;
}

function createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationIssueList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-manifest-read-authorization-issues";
  const title = document.createElement("h4");
  title.textContent = "manifest read authorization issues";
  const list = document.createElement("ul");
  const issues = packet.manifestReadAuthorizationIssues ?? [];
  for (const issue of issues) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceManifestReadAuthorizationIssue(issue);
    list.append(row);
  }
  if (issues.length === 0) {
    const row = document.createElement("li");
    row.textContent = "manifest read authorization：读取授权契约完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceManifestReadAuthorizationIssue(issue) {
  switch (issue) {
    case "operator-read-scope-missing":
      return "operator read scope：缺少 operator 显式读取授权";
    case "manifest-path-not-authorized":
      return "manifest path：manifest 本地路径尚未授权";
    case "schema-definition-binding-not-ready":
      return "schema definition binding：schema definition binding 尚未 ready";
    case "audit-artifact-not-ready":
      return "audit artifact：审计 artifact 尚未 ready";
    default:
      return `${issue ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessOpsPanel(readiness) {
  if (!readiness) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke 审计 artifact readiness";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(readiness.status)} · ${
    readiness.summary?.auditArtifactReadinessReadyCount ?? 0
  } ready`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-body";
  const intro = document.createElement("p");
  intro.textContent =
    "audit artifact readiness packets 只定义 local audit artifact contract；当前 auditArtifactReady=false，auditArtifactReadinessReady=false，manifestContentRead=false，runnerIntentUnlocked=false。";
  const packets = document.createElement("div");
  packets.className =
    "agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-packets";
  for (const packet of readiness.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-packet";
  const header = document.createElement("div");
  header.className =
    "agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.auditArtifactReadinessReady
        ? "auditArtifactReadinessReady=true"
        : "auditArtifactReadinessReady=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["mode", packet.auditArtifactReadinessMode ?? "local-audit-artifact-contract"],
    ["audit status", packet.auditArtifactReadinessStatus ?? "blocked"],
    [
      "artifact",
      packet.auditArtifactReady ? "auditArtifactReady=true" : "auditArtifactReady=false",
    ],
    [
      "write auth",
      packet.auditArtifactWriteAuthorized
        ? "auditArtifactWriteAuthorized=true"
        : "auditArtifactWriteAuthorized=false",
    ],
    ["artifact path", packet.auditArtifactPath ?? "auditArtifactPath=null"],
    [
      "read auth",
      packet.manifestReadAuthorizationReady
        ? "manifestReadAuthorizationReady=true"
        : "manifestReadAuthorizationReady=false",
    ],
    ["content", packet.manifestContentRead ? "manifestContentRead=true" : "manifestContentRead=false"],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(
    header,
    metrics,
    createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessIssueList(packet),
  );
  return card;
}

function createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessIssueList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-issues";
  const title = document.createElement("h4");
  title.textContent = "audit artifact readiness issues";
  const list = document.createElement("ul");
  const issues = packet.auditArtifactReadinessIssues ?? [];
  for (const issue of issues) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessIssue(issue);
    list.append(row);
  }
  if (issues.length === 0) {
    const row = document.createElement("li");
    row.textContent = "audit artifact readiness：审计 artifact readiness 契约完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessIssue(issue) {
  switch (issue) {
    case "audit-artifact-path-missing":
      return "audit artifact path：缺少 operator-owned 审计 artifact 路径";
    case "audit-artifact-write-not-authorized":
      return "audit artifact write：审计 artifact 写入尚未授权";
    case "manifest-read-authorization-not-ready":
      return "manifest read authorization：清单读取授权尚未 ready";
    case "manifest-content-not-read":
      return "manifest content：清单正文尚未读取";
    case "runner-intent-locked":
      return "runner intent：runner intent 仍保持锁定";
    default:
      return `${issue ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsReleaseSmokeRunnerIntentSigningRevocationOpsPanel(contract) {
  if (!contract) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-release-smoke-runner-intent-signing-revocation-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 发布 smoke runner intent 签发/撤销";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsReleaseGateStatus(contract.status)} · ${
    contract.summary?.runnerIntentSignatureReadyCount ?? 0
  } ready`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-release-smoke-runner-intent-signing-revocation-body";
  const intro = document.createElement("p");
  intro.textContent =
    "runner intent signing/revocation packets 只定义 fail-closed runner intent signing/revocation；当前 runnerIntentSigned=false，runnerIntentSignatureReady=false，runnerIntentTokenIssued=false，runnerIntentUnlocked=false。";
  const packets = document.createElement("div");
  packets.className = "agent-os-release-smoke-runner-intent-signing-revocation-packets";
  for (const packet of contract.packets ?? []) {
    packets.append(createAgentOsReleaseSmokeRunnerIntentSigningRevocationPacketCard(packet));
  }
  body.append(intro, packets);
  panel.append(header, body);
  return panel;
}

function createAgentOsReleaseSmokeRunnerIntentSigningRevocationPacketCard(packet) {
  const card = document.createElement("article");
  card.className = "agent-os-release-smoke-runner-intent-signing-revocation-packet";
  const header = document.createElement("div");
  header.className = "agent-os-release-smoke-runner-intent-signing-revocation-packet-header";
  const title = document.createElement("h4");
  title.textContent = formatAgentOsReleaseGateSkippedCheckId(packet.id);
  const status = createStatusPill(
    `${formatAgentOsReleaseGateStatus(packet.status)} · ${
      packet.runnerIntentSignatureReady
        ? "runnerIntentSignatureReady=true"
        : "runnerIntentSignatureReady=false"
    }`,
    mapReviewTone(packet.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    [
      "mode",
      packet.runnerIntentContractMode ?? "fail-closed-runner-intent-signing-revocation",
    ],
    ["signing", packet.runnerIntentSigningStatus ?? "blocked"],
    ["revocation", packet.runnerIntentRevocationStatus ?? "revoked"],
    ["signed", packet.runnerIntentSigned ? "runnerIntentSigned=true" : "runnerIntentSigned=false"],
    [
      "token",
      packet.runnerIntentTokenIssued
        ? "runnerIntentTokenIssued=true"
        : "runnerIntentTokenIssued=false",
    ],
    ["key", packet.runnerIntentSigningKeyRef ?? "runnerIntentSigningKeyRef=null"],
    [
      "audit ready",
      packet.auditArtifactReadinessReady
        ? "auditArtifactReadinessReady=true"
        : "auditArtifactReadinessReady=false",
    ],
    ["runner unlock", packet.runnerIntentUnlocked ? "unlocked" : "runnerIntentUnlocked=false"],
  ]);

  card.append(
    header,
    metrics,
    createAgentOsReleaseSmokeRunnerIntentSigningRevocationIssueList(packet),
  );
  return card;
}

function createAgentOsReleaseSmokeRunnerIntentSigningRevocationIssueList(packet) {
  const block = document.createElement("div");
  block.className = "agent-os-release-smoke-runner-intent-signing-revocation-issues";
  const title = document.createElement("h4");
  title.textContent = "runner intent signing/revocation issues";
  const list = document.createElement("ul");
  const issues = packet.runnerIntentSigningRevocationIssues ?? [];
  for (const issue of issues) {
    const row = document.createElement("li");
    row.textContent = formatAgentOsReleaseSmokeRunnerIntentSigningRevocationIssue(issue);
    list.append(row);
  }
  if (issues.length === 0) {
    const row = document.createElement("li");
    row.textContent = "runner intent signing/revocation：签发/撤销契约完整";
    list.append(row);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsReleaseSmokeRunnerIntentSigningRevocationIssue(issue) {
  switch (issue) {
    case "runner-intent-signing-key-missing":
      return "signing key：runner intent signing key 尚未配置";
    case "runner-intent-signature-not-issued":
      return "signature：runner intent signature 尚未签发";
    case "runner-intent-revocation-record-missing":
      return "revocation：runner intent revocation record 尚未落地";
    case "audit-artifact-readiness-not-ready":
      return "audit artifact readiness：审计 artifact readiness 尚未 ready";
    case "manifest-content-not-read":
      return "manifest content：清单正文尚未读取";
    case "runner-intent-locked":
      return "runner intent：runner intent 仍保持锁定";
    default:
      return `${issue ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsMemoryEvalOpsPanel(memoryEval) {
  if (!memoryEval) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-memory-eval-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 记忆评估";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsMemoryEvalStatus(memoryEval.status)} · ${
    memoryEval.summary?.qualityCaseCount ?? 0
  } cases`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-memory-eval-body";
  const overview = document.createElement("div");
  overview.className = "agent-os-memory-eval-source";
  const overviewText = document.createElement("p");
  overviewText.textContent =
    "local-only fixture 评估读取最近一次 MemPalace 本地夹具结果；它只证明 recall/NDCG、verbatim 和 provenance 门禁能工作，不读取真实用户数据。";
  const sourceMeta = document.createElement("small");
  sourceMeta.textContent = `${memoryEval.source?.name ?? "local fixture"} · ${
    memoryEval.source?.dataset ?? "local-fixture"
  } · ${memoryEval.source?.localOnly ? "localOnly=true" : "localOnly=false"} · ${
    memoryEval.fixturePath ?? memoryEval.reportPath ?? "missing fixture"
  }`;
  overview.append(overviewText, sourceMeta);

  const metrics = document.createElement("div");
  metrics.className = "agent-os-memory-eval-metrics";
  metrics.append(
    createMetricBlock(
      "recall@k",
      `${formatAgentOsMemoryEvalMetric(memoryEval.qualityAverages?.recallAtK)} / ${formatAgentOsMemoryEvalMetric(
        memoryEval.thresholds?.recallAtK,
      )}`,
    ),
    createMetricBlock(
      "recallAny@k",
      `${formatAgentOsMemoryEvalMetric(memoryEval.qualityAverages?.recallAnyAtK)} / ${formatAgentOsMemoryEvalMetric(
        memoryEval.thresholds?.recallAnyAtK,
      )}`,
    ),
    createMetricBlock(
      "NDCG@k",
      `${formatAgentOsMemoryEvalMetric(memoryEval.qualityAverages?.ndcgAtK)} / ${formatAgentOsMemoryEvalMetric(
        memoryEval.thresholds?.ndcgAtK,
      )}`,
    ),
    createMetricBlock(
      "evidence",
      `${memoryEval.thresholds?.requireVerbatimEvidence ? "verbatim" : "no-verbatim"} · ${
        memoryEval.thresholds?.requireProvenanceEvidence ? "provenance" : "no-provenance"
      }`,
    ),
    createMetricBlock(
      "diagnostic",
      `${formatAgentOsMemoryEvalStatus(memoryEval.diagnosticStatus)} · ${
        memoryEval.diagnosticFailures?.length ?? 0
      }`,
    ),
  );

  body.append(overview, metrics, createAgentOsMemoryEvalDiagnosticList(memoryEval));
  panel.append(header, body);
  return panel;
}

function createAgentOsMemoryEvalDiagnosticList(memoryEval) {
  const block = document.createElement("div");
  block.className = "agent-os-memory-eval-diagnostics";
  const title = document.createElement("h4");
  title.textContent = "diagnostic failures";
  const list = document.createElement("ul");
  const failures = memoryEval.diagnosticFailures ?? [];
  for (const failure of failures.slice(0, 6)) {
    const item = document.createElement("li");
    item.textContent = `${failure.queryId ?? "threshold"} · ${failure.detail}`;
    list.append(item);
  }
  if (failures.length === 0) {
    const item = document.createElement("li");
    item.textContent =
      "diagnostic case 未返回失败项；请确认夹具仍覆盖 missing expected IDs、verbatim 和 provenance 检测。";
    list.append(item);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsMemoryEvalMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

function formatAgentOsMemoryEvalStatus(status) {
  switch (status) {
    case "passed":
      return "通过";
    case "failed":
      return "失败";
    case "missing":
      return "缺失";
    case "degraded":
      return "降级";
    default:
      return status ?? "未知";
  }
}

function createAgentOsMemorySweepSafetyOpsPanel(memorySweepSafety) {
  if (!memorySweepSafety) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-memory-sweep-safety-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 记忆评测安全预检";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsMemoryEvalStatus(memorySweepSafety.status)} · ${
    memorySweepSafety.summary?.blockedCount ?? 0
  } blocked`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-memory-sweep-safety-body";
  const intro = document.createElement("p");
  intro.textContent =
    "live-user-memory sweep 仍然只展示安全预检；operator approval、anonymization、retention、dry-run、read-only、network disabled 全部满足前，不会读取真实用户数据。";
  const plans = document.createElement("div");
  plans.className = "agent-os-memory-sweep-safety-plans";
  for (const plan of memorySweepSafety.plans ?? []) {
    plans.append(createAgentOsMemorySweepSafetyPlanCard(plan));
  }
  body.append(intro, plans);
  panel.append(header, body);
  return panel;
}

function createAgentOsMemorySweepSafetyPlanCard(plan) {
  const card = document.createElement("article");
  card.className = "agent-os-memory-sweep-safety-card";
  const header = document.createElement("div");
  header.className = "agent-os-memory-sweep-safety-card-header";
  const title = document.createElement("h4");
  title.textContent = plan.sweepId ?? "memory sweep";
  const status = createStatusPill(
    `${formatAgentOsMemoryEvalStatus(plan.status)} · ${
      plan.canReadUserData ? "canReadUserData=true" : "canReadUserData=false"
    }`,
    mapReviewTone(plan.status),
  );
  header.append(title, status);

  const metrics = createAssetMetricGrid([
    ["source", plan.safetyEnvelope?.sourceKind ?? "unknown"],
    ["scope", plan.safetyEnvelope?.approvalScope ?? "none"],
    ["retention", `${plan.safetyEnvelope?.reportTtlDays ?? "n/a"} days`],
    [
      "mode",
      `${plan.safetyEnvelope?.dryRunOnly ? "dry-run" : "not-dry-run"} · ${
        plan.safetyEnvelope?.readOnly ? "read-only" : "write-capable"
      } · ${plan.safetyEnvelope?.allowNetwork ? "network on" : "network disabled"}`,
    ],
  ]);

  card.append(
    header,
    metrics,
    createAgentOsMemorySweepSafetyReasonList(plan),
    createAgentOsMemorySweepSafetyChecklist(plan),
  );
  return card;
}

function createAgentOsMemorySweepSafetyReasonList(plan) {
  const block = document.createElement("div");
  block.className = "agent-os-memory-sweep-safety-reasons";
  const title = document.createElement("h4");
  title.textContent = "blocked reasons";
  const list = document.createElement("ul");
  const reasons = plan.reasonCodes ?? [];
  if (reasons.length === 0) {
    const item = document.createElement("li");
    item.textContent = "ready for dry-run planning only";
    list.append(item);
  }
  for (const reason of reasons) {
    const item = document.createElement("li");
    item.textContent = formatAgentOsMemorySweepSafetyReason(reason);
    list.append(item);
  }
  block.append(title, list);
  return block;
}

function createAgentOsMemorySweepSafetyChecklist(plan) {
  const block = document.createElement("div");
  block.className = "agent-os-memory-sweep-safety-checklist";
  const title = document.createElement("h4");
  title.textContent = "operator checklist";
  const list = document.createElement("ul");
  for (const checklistItem of plan.operatorChecklist ?? []) {
    const item = document.createElement("li");
    item.textContent = checklistItem;
    list.append(item);
  }
  block.append(title, list);
  return block;
}

function formatAgentOsMemorySweepSafetyReason(reason) {
  switch (reason) {
    case "operator-approval-required":
      return "operator approval：需要人工批准";
    case "approval-scope-insufficient":
      return "operator approval：scope 必须是 live-user-memory-eval";
    case "anonymization-required":
      return "anonymization：必须先开启匿名化";
    case "irreversible-anonymization-required":
      return "anonymization：必须不可逆";
    case "direct-identifier-redaction-required":
      return "anonymization：必须移除直接标识符";
    case "raw-content-storage-forbidden":
      return "retention：禁止保存 raw content";
    case "delete-raw-content-after-eval-required":
      return "retention：评测后必须删除 raw content";
    case "retention-ttl-too-long":
      return "retention：报告 TTL 必须 <= 30 days";
    case "dry-run-required":
      return "dry-run：当前只允许 dry-run planning";
    case "network-disabled-required":
      return "network disabled：必须关闭网络";
    case "readonly-required":
      return "read-only：必须只读";
    default:
      return `${reason ?? "unknown"}：需要人工复核`;
  }
}

function createAgentOsMemoryEvalDashboardOpsPanel(memoryEvalDashboard) {
  if (!memoryEvalDashboard) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "agent-os-memory-eval-dashboard-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Agent OS 记忆评估 dashboard";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatAgentOsMemoryEvalStatus(memoryEvalDashboard.status)} · ${
    memoryEvalDashboard.localOnly ? "local-only dashboard" : "non-local dashboard"
  }`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "agent-os-memory-eval-dashboard-body";
  const intro = document.createElement("p");
  intro.textContent =
    "memoryEvalTrend 与 maintenance-due actions 聚合本地 MemPalace recall degradation、dataset loader gate 和 sweep safety 信号；该面板只读本地门禁 artifact，canReadUserData=false。";

  body.append(
    intro,
    createAgentOsMemoryEvalDashboardTrendList(memoryEvalDashboard.memoryEvalTrend ?? []),
    createAgentOsMemoryEvalMaintenanceDueList(memoryEvalDashboard.maintenanceDueActions ?? []),
  );
  panel.append(header, body);
  return panel;
}

function createAgentOsMemoryEvalDashboardTrendList(memoryEvalTrend) {
  const block = document.createElement("div");
  block.className = "agent-os-memory-eval-dashboard-trend";
  const title = document.createElement("h4");
  title.textContent = "memoryEvalTrend";
  const list = document.createElement("div");
  list.className = "agent-os-memory-eval-dashboard-trend-list";
  for (const point of memoryEvalTrend) {
    const row = document.createElement("article");
    row.className = "agent-os-memory-eval-dashboard-trend-row";
    const name = document.createElement("strong");
    name.textContent = point.label ?? point.id ?? "memory eval trend";
    const value = document.createElement("span");
    value.textContent = `${point.metric ?? "metric"} ${formatAgentOsMemoryEvalMetric(
      point.current,
    )} / ${formatAgentOsMemoryEvalMetric(point.threshold)} · ${point.status ?? "unknown"}`;
    const meta = document.createElement("small");
    meta.textContent = `${point.source ?? "local fixture"} · ${
      point.localOnly ? "localOnly=true" : "localOnly=false"
    } · ${point.canReadUserData ? "canReadUserData=true" : "canReadUserData=false"}`;
    row.append(name, value, meta);
    list.append(row);
  }
  if (memoryEvalTrend.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "memoryEvalTrend 尚无可用点；先运行本地 MemPalace real-eval fixture gate。";
    list.append(empty);
  }
  block.append(title, list);
  return block;
}

function createAgentOsMemoryEvalMaintenanceDueList(maintenanceDueActions) {
  const block = document.createElement("div");
  block.className = "agent-os-memory-eval-dashboard-maintenance";
  const title = document.createElement("h4");
  title.textContent = "maintenance-due actions";
  const list = document.createElement("div");
  list.className = "agent-os-memory-eval-dashboard-maintenance-list";
  for (const action of maintenanceDueActions) {
    const row = document.createElement("article");
    row.className = "agent-os-memory-eval-dashboard-action";
    const header = document.createElement("div");
    header.className = "agent-os-memory-eval-dashboard-action-header";
    const name = document.createElement("strong");
    name.textContent = action.title ?? action.id ?? "maintenance action";
    const status = createStatusPill(action.status ?? "due", mapReviewTone(action.status));
    header.append(name, status);
    const reason = document.createElement("p");
    reason.textContent = action.reason ?? "maintenance action needs review.";
    const command = document.createElement("small");
    command.textContent = `${action.kind ?? "maintenance-due"} · ${
      action.id === "recall-degradation-watch" ? "recall degradation" : action.id
    } · ${
      action.id === "dataset-loader-gate" ? "dataset loader gate" : "local-only dashboard"
    } · ${action.nextRecommendedCommand ?? "n/a"}`;
    row.append(header, reason, command);
    list.append(row);
  }
  if (maintenanceDueActions.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "maintenance-due actions 尚未生成。";
    list.append(empty);
  }
  block.append(title, list);
  return block;
}

function createReviewMemoryGovernancePanel(review) {
  const summary = summarizeLearningGovernanceHeartbeatItems(review?.heartbeatItems ?? []);
  if (!summary.hasGovernance) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "review-memory-governance-panel";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "记忆治理运维";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = `${formatHeartbeatSeverityLabel(summary.latestSeverity)} · ${summary.eventCount}`;
  header.append(title, status);

  const body = document.createElement("div");
  body.className = "review-memory-governance-body";
  const metrics = document.createElement("div");
  metrics.className = "asset-metric-grid";
  metrics.append(
    createMetricBlock("已接受经验积压", summary.acceptedExperienceBacklog),
    createMetricBlock("待审经验积压", summary.pendingExperienceBacklog),
    createMetricBlock("缺召回评测知识", summary.publishedKnowledgeMissingRecallEval),
    createMetricBlock("治理事件", summary.eventCount),
  );

  const latest = document.createElement("div");
  latest.className = "review-memory-governance-latest";
  const latestTitle = document.createElement("h4");
  latestTitle.textContent = "最新治理信号";
  const latestSummary = document.createElement("p");
  latestSummary.textContent = summary.latestSummary || "Heartbeat 暂无治理摘要。";
  const latestMeta = document.createElement("small");
  latestMeta.textContent = formatList([
    summary.latestCreatedAt ? `时间：${summary.latestCreatedAt}` : null,
    summary.sampleIds.length > 0 ? `样本：${summary.sampleIds.slice(0, 4).join(" / ")}` : null,
  ]);
  latest.append(latestTitle, latestSummary, latestMeta);

  const actions = document.createElement("div");
  actions.className = "review-memory-governance-actions";
  if (summary.latestEvent?.eventId) {
    actions.append(
      createAssetDirectActionButton(
        createUiSelectAssetAction("review", `heartbeat:${summary.latestEvent.eventId}`),
        "查看心跳详情",
        "secondary",
      ),
    );
  }
  actions.append(
    createAssetDirectActionButton(
      {
        type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW,
      },
      "预览维护",
      "secondary",
    ),
    createAssetDirectActionButton(
      {
        type: DESKTOP_ACTIONS.MAINTENANCE_APPLY,
      },
      "执行维护",
    ),
  );

  body.append(metrics, latest, actions);
  panel.append(header, body, createReviewMemoryEvidenceOpsPanel(summary));
  return panel;
}

function createReviewMemoryEvidenceOpsPanel(summary) {
  const panel = document.createElement("section");
  panel.className = "review-memory-evidence-ops";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "记忆与证据";
  const status = document.createElement("span");
  status.className = "count";
  status.textContent = "统一 Host API";
  header.append(title, status);

  const grid = document.createElement("div");
  grid.className = "review-memory-evidence-ops-grid";
  grid.append(
    createReviewMemoryReadCard(),
    createReviewEvidenceLookupCard(summary),
    createReviewMemoryGovernanceCard(),
  );
  panel.append(header, grid);
  return panel;
}

function createReviewMemoryReadCard() {
  const card = createReviewMemoryEvidenceOpsCard(
    "查看",
    "先看记忆是否启用、发布了多少条，以及哪些发布记忆被降权、撤回或隔离。",
  );
  const actions = createReviewMemoryEvidenceOpsActions();
  actions.append(
    createAssetDirectActionButton(createCommandRunAction("memory.status"), "记忆状态", "secondary"),
    createAssetDirectActionButton(
      createCommandRunAction("memory.publications", { limit: 20 }),
      "发布列表",
      "secondary",
    ),
  );
  card.append(actions);
  return card;
}

function createReviewEvidenceLookupCard(summary) {
  const card = createReviewMemoryEvidenceOpsCard(
    "Evidence",
    "按 run 查看证据列表；拿到 evidence id 后再查看摘要或原文预览。",
  );
  const runInput = document.createElement("input");
  runInput.type = "text";
  runInput.placeholder = "Run id";
  runInput.setAttribute("aria-label", "Evidence Run id");
  runInput.value = resolveReviewEvidenceDefaultRunId(summary);
  const evidenceInput = document.createElement("input");
  evidenceInput.type = "text";
  evidenceInput.placeholder = "Evidence id";
  evidenceInput.setAttribute("aria-label", "Evidence id");
  const actions = createReviewMemoryEvidenceOpsActions();
  actions.append(
    createReviewMemoryEvidenceInputActionButton("列表", () => {
      const runId = runInput.value.trim();
      return runId.length > 0
        ? createCommandRunAction("evidence.list", { runId, limit: 10 })
        : null;
    }),
    createReviewMemoryEvidenceInputActionButton("摘要", () => {
      const evidenceId = evidenceInput.value.trim();
      return evidenceId.length > 0 ? createCommandRunAction("evidence.view", { evidenceId }) : null;
    }),
    createReviewMemoryEvidenceInputActionButton("原文", () => {
      const evidenceId = evidenceInput.value.trim();
      return evidenceId.length > 0
        ? createCommandRunAction("evidence.content", { evidenceId, maxChars: 2000 })
        : null;
    }),
  );
  card.append(runInput, evidenceInput, actions);
  return card;
}

function createReviewMemoryGovernanceCard() {
  const card = createReviewMemoryEvidenceOpsCard(
    "治理",
    "输入运行记忆 record id 后再操作；降权保留召回但降低权重，撤回和隔离会停止召回。",
  );
  const recordInput = document.createElement("input");
  recordInput.type = "text";
  recordInput.placeholder = "运行记忆 record id";
  recordInput.setAttribute("aria-label", "运行记忆 record id");
  const actions = createReviewMemoryEvidenceOpsActions();
  actions.append(
    createReviewMemoryEvidenceInputActionButton("降权", () => {
      const recordId = recordInput.value.trim();
      return recordId.length > 0
        ? createCommandRunAction("memory.publicationDemote", {
            recordId,
            note: "desktop governance panel",
          })
        : null;
    }),
    createReviewMemoryEvidenceInputActionButton("撤回", () => {
      const recordId = recordInput.value.trim();
      return recordId.length > 0
        ? createCommandRunAction("memory.publicationRetract", {
            recordId,
            note: "desktop governance panel",
          })
        : null;
    }, "danger"),
    createReviewMemoryEvidenceInputActionButton("隔离", () => {
      const recordId = recordInput.value.trim();
      return recordId.length > 0
        ? createCommandRunAction("memory.publicationQuarantine", {
            recordId,
            note: "desktop governance panel",
          })
        : null;
    }, "danger"),
    createReviewMemoryEvidenceInputActionButton("恢复", () => {
      const recordId = recordInput.value.trim();
      return recordId.length > 0
        ? createCommandRunAction("memory.publicationRestore", {
            recordId,
            note: "desktop governance panel",
          })
        : null;
    }, "secondary"),
  );
  card.append(recordInput, actions);
  return card;
}

function createReviewMemoryEvidenceOpsCard(titleText, bodyText) {
  const card = document.createElement("article");
  card.className = "review-memory-evidence-ops-card";
  const title = document.createElement("h4");
  title.textContent = titleText;
  const body = document.createElement("p");
  body.textContent = bodyText;
  card.append(title, body);
  return card;
}

function createReviewMemoryEvidenceOpsActions() {
  const actions = document.createElement("div");
  actions.className = "review-memory-evidence-ops-actions";
  return actions;
}

function createReviewMemoryEvidenceInputActionButton(label, resolveAction, tone = "secondary") {
  const button = document.createElement("button");
  button.className =
    tone === "danger"
      ? "danger-button compact"
      : tone === "primary"
        ? "primary-button compact"
        : "secondary-button compact";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const action = resolveAction();
    if (action === null) {
      button.classList.add("needs-input");
      window.setTimeout(() => button.classList.remove("needs-input"), 900);
      return;
    }
    await executeAssetAction(action, button, label);
  });
  return button;
}

function resolveReviewEvidenceDefaultRunId(summary) {
  const target = summary.latestEvent?.target;
  if (typeof target?.runId === "string" && target.runId.trim().length > 0) {
    return target.runId.trim();
  }
  const sample = summary.sampleIds.find((item) => item.includes("run-"));
  if (!sample) {
    return "";
  }
  const match = /(run-[\w.-]+)/u.exec(sample);
  return match?.[1] ?? "";
}

function summarizeLearningGovernanceHeartbeatItems(heartbeatItems) {
  const governanceEvents = [];
  for (const event of heartbeatItems ?? []) {
    const evidence = parseLearningGovernanceEvidenceRefs(event?.evidenceRefs ?? []);
    if (event?.kind !== "maintenance-due" && evidence.length === 0) {
      continue;
    }
    if (evidence.length > 0) {
      governanceEvents.push({ event, evidence });
    }
  }

  const emptySummary = {
    hasGovernance: false,
    acceptedExperienceBacklog: 0,
    pendingExperienceBacklog: 0,
    publishedKnowledgeMissingRecallEval: 0,
    eventCount: 0,
    latestEvent: null,
    latestSeverity: "info",
    latestSummary: "",
    latestCreatedAt: "",
    sampleIds: [],
  };
  if (governanceEvents.length === 0) {
    return emptySummary;
  }

  governanceEvents.sort((left, right) =>
    String(right.event?.createdAt ?? "").localeCompare(String(left.event?.createdAt ?? "")),
  );
  const latest = governanceEvents[0];
  const summary = {
    ...emptySummary,
    hasGovernance: true,
    eventCount: governanceEvents.length,
    latestEvent: latest.event,
    latestSeverity: latest.event?.severity ?? "info",
    latestSummary: latest.event?.summary ?? "",
    latestCreatedAt: latest.event?.createdAt ?? "",
    sampleIds: [],
  };
  const sampleIds = new Set();
  for (const item of latest.evidence) {
    if (item.reason === "accepted-experience-backlog" && typeof item.count === "number") {
      summary.acceptedExperienceBacklog = item.count;
    }
    if (item.reason === "pending-experience-backlog" && typeof item.count === "number") {
      summary.pendingExperienceBacklog = item.count;
    }
    if (
      item.reason === "published-knowledge-missing-recall-eval" &&
      typeof item.count === "number"
    ) {
      summary.publishedKnowledgeMissingRecallEval = item.count;
    }
    if (item.sampleId) {
      sampleIds.add(`${formatLearningGovernanceReasonLabel(item.reason)}：${item.sampleId}`);
    }
  }
  summary.sampleIds = [...sampleIds];
  return summary;
}

function parseLearningGovernanceEvidenceRefs(evidenceRefs) {
  const items = [];
  const supportedReasons = new Set([
    "accepted-experience-backlog",
    "pending-experience-backlog",
    "published-knowledge-missing-recall-eval",
  ]);
  for (const ref of evidenceRefs ?? []) {
    if (typeof ref !== "string" || !ref.startsWith("learning-governance://")) {
      continue;
    }
    let match = /^learning-governance:\/\/([^/]+)\/count\/(\d+)$/u.exec(ref);
    if (match) {
      if (!supportedReasons.has(match[1])) {
        continue;
      }
      items.push({
        ref,
        reason: match[1],
        count: Number(match[2]),
      });
      continue;
    }
    match = /^learning-governance:\/\/([^/]+)\/(.+)$/u.exec(ref);
    if (match) {
      if (!supportedReasons.has(match[1])) {
        continue;
      }
      items.push({
        ref,
        reason: match[1],
        sampleId: match[2],
      });
    }
  }
  return items;
}

function createReviewLibraryToolbar(items) {
  const toolbar = document.createElement("section");
  toolbar.className = "review-library-toolbar";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索运行、审查项、失败原因、标签";
  search.setAttribute("aria-label", "搜索运行与审查");
  search.dataset.reviewFilter = "query";

  const lane = document.createElement("select");
  lane.setAttribute("aria-label", "板块筛选");
  lane.dataset.reviewFilter = "lane";
  for (const [value, label] of [
    ["all", "全部板块"],
    ["experience", "经验"],
    ["knowledge", "知识"],
    ["trace", "Trace"],
    ["skill-curator", "Skill Curator"],
    ["run", "运行"],
    ["report", "报告"],
    ["heartbeat", "心跳"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    lane.append(option);
  }

  const status = document.createElement("select");
  status.setAttribute("aria-label", "状态筛选");
  status.dataset.reviewFilter = "status";
  const statuses = new Set(items.map((item) => item.status).filter(Boolean));
  const allStatus = document.createElement("option");
  allStatus.value = "all";
  allStatus.textContent = "全部状态";
  status.append(allStatus);
  for (const value of [...statuses].sort()) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatReviewStatusLabel(value);
    status.append(option);
  }

  const hint = document.createElement("small");
  hint.textContent = "点击标题进入详情页；按钮直接执行本地真实 action 或 CLI 命令。";
  toolbar.addEventListener("input", applyReviewTableFilters);
  toolbar.addEventListener("change", applyReviewTableFilters);
  toolbar.append(search, lane, status, hint);
  return toolbar;
}

function applyReviewTableFilters() {
  const root = elements.commandList;
  const query =
    root.querySelector("[data-review-filter='query']")?.value?.trim().toLowerCase() ?? "";
  const lane = root.querySelector("[data-review-filter='lane']")?.value ?? "all";
  const status = root.querySelector("[data-review-filter='status']")?.value ?? "all";
  for (const row of root.querySelectorAll(".review-table tbody tr")) {
    const matchesQuery = query.length === 0 || row.dataset.searchText?.includes(query);
    const matchesLane = lane === "all" || row.dataset.lane === lane;
    const matchesStatus = status === "all" || row.dataset.status === status;
    row.hidden = !(matchesQuery && matchesLane && matchesStatus);
  }
}

function createReviewConsoleLayout(items, review) {
  const layout = document.createElement("section");
  layout.className = "review-console-layout";
  layout.append(createReviewQueueSidebar(items, review), createReviewTable(items));
  return layout;
}

function createReviewQueueSidebar(items, review) {
  const aside = document.createElement("aside");
  aside.className = "review-queue-sidebar";
  const attentionTitle = document.createElement("h3");
  attentionTitle.textContent = "优先处理";
  const attentionList = document.createElement("div");
  attentionList.className = "review-queue-list attention";
  for (const item of createReviewAttentionSummary(review, items)) {
    attentionList.append(createReviewSummaryRow(item.name, item.count));
  }

  const laneTitle = document.createElement("h3");
  laneTitle.textContent = "队列";
  const laneList = document.createElement("div");
  laneList.className = "review-queue-list";
  for (const item of createReviewLaneSummary(items)) {
    laneList.append(createReviewSummaryRow(item.name, item.count));
  }

  const statusTitle = document.createElement("h3");
  statusTitle.textContent = "状态";
  const statusList = document.createElement("div");
  statusList.className = "review-queue-list";
  for (const item of createReviewStatusSummary(items)) {
    statusList.append(createReviewSummaryRow(formatReviewStatusLabel(item.name), item.count));
  }

  const pathTitle = document.createElement("h3");
  pathTitle.textContent = "后端";
  const paths = document.createElement("div");
  paths.className = "review-queue-list";
  paths.append(
    createReviewSummaryRow("Trace", review?.traceProposalCount ?? 0),
    createReviewSummaryRow("Run", review?.executionRunCount ?? 0),
    createReviewSummaryRow("Report", review?.executionReportCount ?? 0),
    createReviewSummaryRow("Heartbeat", review?.heartbeatEventCount ?? 0),
  );
  aside.append(
    attentionTitle,
    attentionList,
    laneTitle,
    laneList,
    statusTitle,
    statusList,
    pathTitle,
    paths,
  );
  return aside;
}

function createReviewSummaryRow(label, count) {
  const row = document.createElement("div");
  row.className = "review-summary-row";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("small");
  value.textContent = String(count);
  row.append(name, value);
  return row;
}

function createReviewTable(items) {
  const section = document.createElement("section");
  section.className = "review-table-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "运行与审查列表";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(items.length);
  header.append(title, count);

  if (items.length === 0) {
    section.append(header, createAssetEmptyState("暂无运行或审查项。"));
    return section;
  }

  const scroller = document.createElement("div");
  scroller.className = "review-table-scroll";
  const table = document.createElement("table");
  table.className = "review-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["项目", "板块", "状态", "时间", "操作"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const item of items) {
    tbody.append(createReviewTableRow(item));
  }
  table.append(thead, tbody);
  scroller.append(table);
  section.append(header, scroller);
  return section;
}

function createReviewTableRow(item) {
  const row = document.createElement("tr");
  row.dataset.lane = item.lane;
  row.dataset.status = item.status ?? "unknown";
  row.dataset.searchText = [
    item.title,
    item.summary,
    item.status,
    item.lane,
    item.id,
    item.risk,
    item.meta,
    ...(item.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  row.append(
    createReviewTitleCell(item),
    createTextCell(formatReviewLaneLabel(item.lane)),
    createReviewStatusCell(item),
    createTextCell(item.updatedAt ?? "未知"),
    createReviewActionCell(item),
  );
  return row;
}

function createReviewTitleCell(item) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "review-title-link";
  button.type = "button";
  button.dataset.assetSurface = "review";
  button.dataset.assetId = item.assetId;
  button.textContent = item.title;
  const summary = document.createElement("small");
  summary.textContent = formatCompactReviewSummary(item.summary);
  const meta = document.createElement("div");
  meta.className = "review-title-meta";
  for (const value of [item.meta, item.risk, item.id]) {
    if (!value) {
      continue;
    }
    const piece = document.createElement("span");
    piece.textContent = value;
    meta.append(piece);
  }
  cell.append(button, summary, meta);
  return cell;
}

function createReviewStatusCell(item) {
  const cell = document.createElement("td");
  cell.append(createStatusPill(formatReviewStatusLabel(item.status), mapReviewTone(item.status)));
  return cell;
}

function createReviewActionCell(item) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "secondary-button compact";
  button.type = "button";
  button.dataset.assetSurface = "review";
  button.dataset.assetId = item.assetId;
  button.textContent = "查看";
  cell.append(button);
  return cell;
}

function createSkillProposalTable(proposals) {
  const section = document.createElement("section");
  section.className = "skill-proposal-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Skill 候选";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(proposals.length);
  header.append(title, count);

  if (proposals.length === 0) {
    section.append(
      header,
      createAssetEmptyState("暂无 Skill 候选；可在经验详情里从已审核经验生成。"),
    );
    return section;
  }

  const scroller = document.createElement("div");
  scroller.className = "skill-table-scroll";
  const table = document.createElement("table");
  table.className = "skill-table skill-proposal-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["候选", "状态", "风险", "证据", "操作"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const proposal of proposals) {
    tbody.append(createSkillProposalTableRow(proposal));
  }
  table.append(thead, tbody);
  scroller.append(table);
  section.append(header, scroller);
  return section;
}

function createSkillProposalTableRow(proposal) {
  const row = document.createElement("tr");
  row.dataset.status = proposal.status ?? "unknown";
  row.dataset.searchText = [
    proposal.title,
    proposal.skillId,
    proposal.status,
    proposal.evidenceSummary,
    proposal.evidenceRef,
    ...(proposal.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  row.append(
    createSkillProposalTitleCell(proposal),
    createTextCell(formatSkillProposalStatusLabel(proposal.status)),
    createTextCell(formatSkillRiskLabel(proposal.riskLevel)),
    createTextCell(formatCompactSkillSummary(proposal.evidenceSummary || proposal.evidenceRef)),
    createSkillProposalActionCell(proposal),
  );
  return row;
}

function createSkillProposalTitleCell(proposal) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "skill-title-link";
  button.type = "button";
  button.dataset.assetSurface = "skills";
  button.dataset.assetId = `proposal:${proposal.id}`;
  button.textContent = proposal.title;
  const summary = document.createElement("small");
  summary.textContent = formatCompactSkillSummary(
    proposal.description || proposal.explanation || proposal.id,
  );
  const meta = document.createElement("div");
  meta.className = "skill-title-meta";
  for (const value of [
    proposal.skillId,
    proposal.sessionId,
    formatEpochDate(proposal.updatedAtMs),
  ]) {
    const piece = document.createElement("span");
    piece.textContent = value;
    meta.append(piece);
  }
  cell.append(button, summary, meta);
  return cell;
}

function createSkillProposalActionCell(proposal) {
  const cell = document.createElement("td");
  cell.className = "skill-proposal-actions";
  const actions = createSkillProposalDirectActions(proposal);
  if (actions.length === 0 && proposal.status === "applied") {
    const button = document.createElement("button");
    button.className = "secondary-button compact";
    button.type = "button";
    button.dataset.assetSurface = "skills";
    button.dataset.assetId = proposal.skillId;
    button.textContent = "查看 Skill";
    cell.append(button);
    return cell;
  }
  for (const actionPrompt of actions) {
    cell.append(
      createAssetDirectActionButton(actionPrompt.action, actionPrompt.label, actionPrompt.tone),
    );
  }
  if (cell.childElementCount === 0) {
    const empty = document.createElement("small");
    empty.textContent = "无需操作";
    cell.append(empty);
  }
  return cell;
}

function createSkillLibraryToolbar(skills) {
  const toolbar = document.createElement("section");
  toolbar.className = "skill-library-toolbar";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索 Skill、正文、标签、工具";
  search.setAttribute("aria-label", "搜索 Skill");
  search.dataset.skillFilter = "query";

  const source = document.createElement("select");
  source.setAttribute("aria-label", "来源筛选");
  source.dataset.skillFilter = "source";
  for (const [value, label] of [
    ["all", "全部来源"],
    ["self", "自进化"],
    ["external", "外部"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    source.append(option);
  }

  const category = document.createElement("select");
  category.setAttribute("aria-label", "分类筛选");
  category.dataset.skillFilter = "category";
  const allCategory = document.createElement("option");
  allCategory.value = "all";
  allCategory.textContent = "全部分类";
  category.append(allCategory);
  for (const item of skills?.categories ?? createSkillCategorySummary(skills?.items ?? [])) {
    const categoryId = item.categoryId ?? item.id ?? item.name;
    if (categoryId === "all") {
      continue;
    }
    const option = document.createElement("option");
    option.value = categoryId;
    option.textContent = formatSkillCategoryDisplayName(item);
    category.append(option);
  }

  const hint = document.createElement("small");
  hint.textContent = "点击标题进入完整详情页；执行、预览、回滚仍通过工作台 /技能 能力。";
  const status = document.createElement("input");
  status.type = "hidden";
  status.dataset.skillFilter = "status";
  status.value = "all";
  const tag = document.createElement("input");
  tag.type = "hidden";
  tag.dataset.skillFilter = "tag";
  tag.value = "all";
  toolbar.addEventListener("input", applySkillTableFilters);
  toolbar.addEventListener("change", applySkillTableFilters);
  toolbar.append(search, source, category, status, tag, hint);
  return toolbar;
}

function applySkillTableFilters() {
  const root = elements.commandList;
  const query =
    normalizeSkillFilterText(root.querySelector("[data-skill-filter='query']")?.value ?? "");
  const source = root.querySelector("[data-skill-filter='source']")?.value ?? "all";
  const category = root.querySelector("[data-skill-filter='category']")?.value ?? "all";
  const status = root.querySelector("[data-skill-filter='status']")?.value ?? "all";
  const tag = normalizeSkillFilterText(
    root.querySelector("[data-skill-filter='tag']")?.value ?? "all",
  );
  for (const row of root.querySelectorAll(".skill-list-section [data-skill-row]")) {
    const matchesQuery = query.length === 0 || row.dataset.searchText?.includes(query);
    const matchesSource = source === "all" || row.dataset.source === source;
    const matchesCategory = category === "all" || row.dataset.categoryId === category;
    const matchesStatus =
      status === "all" || row.dataset.runtimeStatus === status || row.dataset.enabled === status;
    const matchesTag =
      tag === "all" || (row.dataset.tagNames ?? "").split("\n").includes(tag);
    row.hidden = !(matchesQuery && matchesSource && matchesCategory && matchesStatus && matchesTag);
  }
  syncSkillSidebarFilterState(root);
}

function createSkillLibraryLayout(items, skills) {
  const layout = document.createElement("section");
  layout.className = "skill-library-layout";
  layout.append(createSkillSourceSidebar(skills), createSkillTable(items));
  return layout;
}

function createSkillSourceSidebar(skills) {
  const aside = document.createElement("aside");
  aside.className = "skill-source-sidebar";
  const sourceTitle = document.createElement("h3");
  sourceTitle.textContent = "来源";
  const sources = document.createElement("div");
  sources.className = "skill-source-list";
  for (const item of createSkillSourceSummary(skills)) {
    sources.append(
      createSkillSidebarFilterButton({
        filter: "source",
        value: item.id,
        label: item.name,
        count: item.count,
      }),
    );
  }

  const statusTitle = document.createElement("h3");
  statusTitle.textContent = "状态";
  const statuses = document.createElement("div");
  statuses.className = "skill-source-list";
  for (const item of createSkillStatusSummary(skills)) {
    statuses.append(
      createSkillSidebarFilterButton({
        filter: "status",
        value: item.id,
        label: item.name,
        count: item.count,
      }),
    );
  }

  const categoryTitle = document.createElement("h3");
  categoryTitle.textContent = "分类";
  const categories = document.createElement("div");
  categories.className = "skill-source-list";
  categories.append(
    createSkillSidebarFilterButton({
      filter: "category",
      value: "all",
      label: "全部分类",
      count: skills?.items?.length ?? 0,
    }),
  );
  for (const item of skills?.categories ?? createSkillCategorySummary(skills?.items ?? [])) {
    const categoryId = item.categoryId ?? item.id ?? "uncategorized";
    categories.append(
      createSkillSidebarFilterButton({
        filter: "category",
        value: categoryId,
        label: formatSkillCategoryDisplayName(item),
        count: item.count ?? countSkillsByCategory(categoryId),
      }),
    );
  }

  const tagTitle = document.createElement("h3");
  tagTitle.textContent = "标签";
  const tags = document.createElement("div");
  tags.className = "skill-tag-cloud";
  tags.append(
    createSkillSidebarFilterButton({
      filter: "tag",
      value: "all",
      label: "全部标签",
      count: skills?.items?.length ?? 0,
      className: "skill-tag-chip",
    }),
  );
  for (const tag of createSkillTagSummary(skills?.items ?? []).slice(0, 12)) {
    tags.append(
      createSkillSidebarFilterButton({
        filter: "tag",
        value: normalizeSkillFilterText(tag.name),
        label: tag.name,
        count: tag.count,
        className: "skill-tag-chip",
      }),
    );
  }
  aside.append(sourceTitle, sources, statusTitle, statuses, categoryTitle, categories, tagTitle, tags);
  queueMicrotask(() => syncSkillSidebarFilterState());
  return aside;
}

function createSkillSidebarFilterButton({ filter, value, label, count, className = "skill-source-row" }) {
  const row = document.createElement("button");
  row.className = className;
  row.type = "button";
  row.dataset.skillSidebarFilter = filter;
  row.dataset.skillSidebarValue = value ?? "all";
  row.setAttribute("aria-pressed", "false");
  const name = document.createElement("span");
  name.textContent = label;
  const badge = document.createElement("small");
  badge.textContent = String(count ?? 0);
  row.append(name, badge);
  row.addEventListener("click", (event) => {
    event.stopPropagation();
    const root = elements.commandList;
    const control = root.querySelector(`[data-skill-filter='${filter}']`);
    if (!control) {
      return;
    }
    control.value = value ?? "all";
    applySkillTableFilters();
  });
  return row;
}

function syncSkillSidebarFilterState(root = elements.commandList) {
  for (const button of root.querySelectorAll("[data-skill-sidebar-filter]")) {
    const filter = button.dataset.skillSidebarFilter;
    const value = button.dataset.skillSidebarValue ?? "all";
    const control = root.querySelector(`[data-skill-filter='${filter}']`);
    const active = String(control?.value ?? "all") === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function createSkillTable(items) {
  const section = document.createElement("section");
  section.className = "skill-list-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "Skill 列表";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(items.length);
  header.append(title, count);

  if (items.length === 0) {
    section.append(header, createAssetEmptyState("暂无 approved Skill。"));
    return section;
  }

  const scroller = document.createElement("div");
  scroller.className = "skill-list-scroll";
  const list = document.createElement("div");
  list.className = "skill-list";
  for (const item of items) {
    list.append(createSkillTableRow(item));
  }
  scroller.append(list);
  section.append(header, scroller);
  return section;
}

function createSkillTableRow(item) {
  const row = document.createElement("article");
  row.className = "skill-list-row";
  row.dataset.skillRow = item.id;
  row.dataset.source = item.source ?? "external";
  row.dataset.categoryId = resolveSkillCategoryId(item);
  row.dataset.enabled = item.enabled === false ? "disabled" : "enabled";
  row.dataset.runtimeStatus = item.runtimeStatus ?? item.doctorStatus ?? "ready";
  row.dataset.modelVisible = item.modelVisible === false ? "hidden" : "visible";
  row.dataset.eligible = item.eligible === false ? "ineligible" : "eligible";
  row.dataset.tagNames = collectSkillTagNames(item).map(normalizeSkillFilterText).join("\n");
  row.dataset.searchText = [
    item.title,
    item.description,
    item.content,
    item.id,
    item.doctorSummary,
    ...collectSkillTagNames(item),
    ...(item.toolNames ?? []),
    ...(item.missingToolNames ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFKC");
  const main = document.createElement("div");
  main.className = "skill-list-main";
  main.append(createSkillTitleCell(item), createSkillMetaStrip(item));

  const detail = document.createElement("div");
  detail.className = "skill-list-detail";
  detail.append(
    createSkillListLine("标签", formatSkillTags(item)),
    createSkillListLine("工具", formatSkillTools(item)),
    createSkillListLine("运行", formatSkillRuntimeLine(item)),
    ...(item.doctorStatus === "needs-setup"
      ? [createSkillListLine("缺失", formatList(item.missingToolNames))]
      : []),
    createSkillExplanationSurfaceBlock(item.explanationSurface, { compact: true }),
    createSkillRuntimeDiagnostics(item, { compact: true }),
  );

  row.append(main, detail, createSkillActionCell(item));
  return row;
}

function createSkillMetaStrip(item) {
  const strip = document.createElement("div");
  strip.className = "skill-list-meta-strip";
  for (const value of [
    formatSkillSourceLabel(item.source),
    formatSkillEnablementLabel(item.enabled),
    formatSkillModelVisibility(item),
    formatSkillEligibility(item),
    formatSkillDoctorStatusLabel(item.doctorStatus ?? item.runtimeStatus),
    resolveSkillCategoryName(item),
    item.version,
    formatSkillUpdated(item),
  ]) {
    const chip = document.createElement("span");
    chip.textContent = value;
    strip.append(chip);
  }
  return strip;
}

function createSkillListLine(labelText, valueText) {
  const line = document.createElement("div");
  line.className = "skill-list-line";
  const label = document.createElement("span");
  label.textContent = labelText;
  const value = document.createElement("strong");
  value.textContent = valueText;
  line.append(label, value);
  return line;
}

function createSkillExplanationSurfaceBlock(surface, options = {}) {
  const compact = options.compact === true;
  const block = document.createElement("div");
  block.className = compact ? "skill-explanation-surface compact" : "skill-explanation-surface";
  if (!surface) {
    block.hidden = true;
    return block;
  }
  block.dataset.explanationStatus = surface.status ?? "";
  block.dataset.operatorReview = surface.operatorReviewRequired === true ? "required" : "none";

  const title = document.createElement("strong");
  title.textContent = surface.summary ?? surface.statusExplanation ?? "Skill 解释";
  block.append(title);

  const lines = [
    ["状态", surface.statusExplanation],
    ["人工审核", surface.operatorReviewExplanation],
    ["Curator", surface.curatorExplanation],
    ["下一步", formatList(surface.nextActions)],
    ["证据", formatList(surface.evidenceRefs)],
  ].filter(([, value]) => typeof value === "string" && value.trim().length > 0 && value !== "无");

  for (const [label, value] of compact ? lines.slice(0, 3) : lines) {
    block.append(createSkillListLine(label, value));
  }
  return block;
}

function createSkillRuntimeDiagnostics(skill, options = {}) {
  const compact = options.compact === true;
  const runtimeStatus = skill.runtimeStatus ?? skill.doctorStatus ?? "unknown";
  const block = document.createElement("div");
  block.className = compact ? "skill-runtime-diagnostics compact" : "skill-runtime-diagnostics";
  block.dataset.runtimeStatus = runtimeStatus;
  block.dataset.modelVisible = skill.modelVisible === false ? "hidden" : "visible";
  block.dataset.eligible = skill.eligible === false ? "ineligible" : "eligible";

  const header = document.createElement("div");
  header.className = "skill-runtime-diagnostics-header";
  header.append(
    createStatusPill(
      formatSkillDoctorStatusLabel(skill.doctorStatus ?? runtimeStatus),
      mapSkillRuntimeTone(skill),
    ),
    createStatusPill(formatSkillModelVisibility(skill), skill.modelVisible === false ? "warn" : "good"),
    createStatusPill(formatSkillEligibility(skill), skill.eligible === false ? "warn" : "good"),
  );
  block.append(header);

  const lines = [
    ["为什么", skill.statusReason || skill.disabledReason || skill.doctorSummary],
    ["诊断", skill.doctorSummary],
    ["缺失", formatList(skill.missingToolNames)],
    ["未检查", formatList(skill.uncheckedToolNames)],
    ["下一步", formatList(skill.nextActions)],
  ].filter(([, value]) => typeof value === "string" && value.trim().length > 0 && value !== "无");

  for (const [label, value] of compact ? lines.slice(0, 3) : lines) {
    block.append(createSkillListLine(label, value));
  }
  return block;
}

function mapSkillRuntimeTone(skill) {
  const status = skill.runtimeStatus ?? skill.doctorStatus;
  if (status === "ready" && skill.modelVisible !== false && skill.eligible !== false) {
    return "good";
  }
  if (status === "missing-skill" || status === "missing_skill") {
    return "bad";
  }
  if (status === "disabled" || status === "model-invocation-disabled") {
    return "warn";
  }
  if (status === "needs-setup" || skill.doctorStatus === "needs-setup") {
    return "warn";
  }
  return "warn";
}

function collectSkillTagNames(skill) {
  return [
    ...(skill.taxonomyTags?.map((tag) => tag.name ?? tag.tagId ?? tag.id) ?? []),
    ...(skill.tags ?? []),
  ].filter(Boolean);
}

function normalizeSkillFilterText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKC");
}

function createSkillTitleCell(item) {
  const cell = document.createElement("div");
  cell.className = "skill-title-cell";
  const button = document.createElement("button");
  button.className = "skill-title-link";
  button.type = "button";
  button.dataset.assetSurface = "skills";
  button.dataset.assetId = item.id;
  button.textContent = item.title;
  const summary = document.createElement("small");
  summary.textContent = formatCompactSkillSummary(item.chineseIntro || item.description || item.content || item.id);
  const meta = document.createElement("div");
  meta.className = "skill-title-meta";
  for (const value of [resolveSkillCategoryName(item), item.version, formatSkillUpdated(item)]) {
    const piece = document.createElement("span");
    piece.textContent = value;
    meta.append(piece);
  }
  cell.append(button, summary, meta);
  return cell;
}

function createSkillActionCell(item) {
  const cell = document.createElement("div");
  cell.className = "skill-list-controls";
  cell.append(createSkillEnablementSwitch(item));
  const buttons = document.createElement("div");
  buttons.className = "skill-row-actions";
  const editButton = createAssetDirectActionButton(
    { type: "ui.selectAsset", surface: "skills", assetId: item.id },
    "编辑",
    "secondary",
  );
  editButton.classList.add("compact", "skill-action-button");
  buttons.append(editButton);
  for (const actionPrompt of createSkillDirectActions(item)) {
    const button = createAssetDirectActionButton(
      actionPrompt.action,
      actionPrompt.label,
      actionPrompt.tone,
    );
    button.classList.add("compact", "skill-action-button");
    buttons.append(button);
  }
  cell.append(buttons);
  return cell;
}

function createSkillEnablementSwitch(skill) {
  const label = document.createElement("label");
  label.className = "skill-toggle-wrap";
  label.addEventListener("click", (event) => event.stopPropagation());
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "skill-toggle";
  input.checked = skill.enabled !== false;
  input.setAttribute("aria-label", `${skill.title ?? skill.id} 启用状态`);
  const stateText = document.createElement("span");
  stateText.className = "skill-toggle-state";
  stateText.textContent = formatSkillEnablementLabel(skill.enabled);
  input.addEventListener("change", async (event) => {
    event.stopPropagation();
    if (state.running || !bridge) {
      input.checked = !input.checked;
      return;
    }
    const enabled = input.checked;
    input.disabled = true;
    stateText.textContent = "同步中";
    setRunning(true);
    const result = await invokeBridge({
      type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
      skillId: skill.id,
      enabled,
    });
    await renderBridgeResult(result);
    setRunning(false);
    if (!result) {
      input.checked = !enabled;
      stateText.textContent = formatSkillEnablementLabel(!enabled);
    }
    input.disabled = false;
    stateText.textContent = formatSkillEnablementLabel(input.checked);
  });
  label.append(input, stateText);
  return label;
}

function renderToolsAssetSurface(container) {
  const tools = state.snapshot?.assets?.tools;
  const mcp = tools?.mcp ?? null;
  const toolCount = countExternalToolItems(tools);
  const busCallableCount = countExternalToolBusCallableItems(tools?.externalToolBus);
  const builtInCount = Math.max(
    0,
    (tools?.integratedToolCount ?? toolCount) - (tools?.registeredCount ?? 0),
  );
  container.append(
    createAssetMetricGrid([
      ["可管理", toolCount],
      ["总线可调用", busCallableCount],
      ["配置已启用", tools?.enabledCount ?? 0],
      ["内置", builtInCount],
      ["已注册", tools?.registeredCount ?? 0],
      ["执行类", tools?.externalCliCount ?? 0],
      ["运行时", tools?.runtimeStatus ?? "unknown"],
      ["MCP 服务", mcp?.inspection?.serverCount ?? 0],
      ["MCP 工具", mcp?.inspection?.toolCount ?? 0],
      ["状态", tools?.status ?? "unknown"],
    ]),
    createReadonlyRow("Registry", tools?.registryRoot ?? "未提供"),
    createReadonlyRow("Index", tools?.indexPath ?? "未提供"),
    createExternalToolBusList(tools?.externalToolBus),
    createAgentOsExtensionControlPlanePanel(tools?.externalToolBus, { surface: "tools" }),
    createExternalToolExecutionHistory(tools?.externalToolBus),
    createExternalToolProcessLedger(tools?.externalToolBus),
    createExternalToolList(tools),
    createMcpExternalToolList(mcp),
  );
}

function createMcpExternalToolList(mcp) {
  const section = document.createElement("section");
  section.className = "skill-list-section tool-list-section settings-mcp-tool-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "MCP 工具服务";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(mcp?.servers?.length ?? 0);
  header.append(title, count);
  const servers = mcp?.servers ?? [];
  if (servers.length === 0) {
    section.append(header, createAssetEmptyState("暂无 MCP 服务；到设置 · 外部工具添加 .mcp.json 服务。"));
    return section;
  }
  const table = document.createElement("div");
  table.className = "settings-readonly-table";
  for (const server of servers) {
    table.append(
      createReadonlyRow(
        server.name,
        `${formatMcpStatusLabel(server.status)} · ${server.enabledToolCount}/${server.toolCount} 工具 · ${server.transport}`,
      ),
    );
  }
  section.append(header, table);
  return section;
}

function createExternalToolList(tools) {
  const items = tools?.items ?? [];
  const section = document.createElement("section");
  section.className = "skill-list-section tool-list-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "外部工具列表";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(items.length);
  header.append(title, count);

  if (items.length === 0) {
    section.append(
      header,
      createAssetEmptyState("暂无外部工具；可回到工作台使用 /工具 注册，或到设置里配置内置外部工具。"),
    );
    return section;
  }

  const scroller = document.createElement("div");
  scroller.className = "skill-list-scroll tool-list-scroll";
  const list = document.createElement("div");
  list.className = "skill-list tool-list";
  for (const item of items) {
    list.append(createToolTableRow(item));
  }
  scroller.append(list);
  section.append(header, scroller);
  return section;
}

function createExternalToolBusList(externalToolBus) {
  const section = document.createElement("section");
  section.className = "skill-list-section tool-list-section external-tool-bus-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "外部工具总线";
  const subtitle = document.createElement("small");
  subtitle.textContent = "Catalog / Effective / Doctor";
  titleWrap.append(title, subtitle);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(externalToolBus?.items?.length ?? 0);
  header.append(titleWrap, count);

  if (!externalToolBus || (externalToolBus.items ?? []).length === 0) {
    section.append(header, createAssetEmptyState("暂无外部工具总线数据；请刷新桌面快照或检查后端。"));
    return section;
  }

  section.append(
    header,
    createExternalToolBusHealthPanel(externalToolBus),
  );

  const scroller = document.createElement("div");
  scroller.className = "skill-list-scroll tool-list-scroll external-tool-bus-scroll";
  const list = document.createElement("div");
  list.className = "skill-list tool-list external-tool-bus-list";
  for (const item of externalToolBus.items ?? []) {
    list.append(createExternalToolBusRow(item));
  }
  scroller.append(list);
  section.append(scroller);
  return section;
}

function createExternalToolExecutionHistory(externalToolBus) {
  const history = externalToolBus?.history ?? [];
  const section = document.createElement("section");
  section.className = "skill-list-section tool-list-section external-tool-history-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "外部工具执行";
  const subtitle = document.createElement("small");
  subtitle.textContent = "Queued / Executing / Completed";
  titleWrap.append(title, subtitle);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(externalToolBus?.executionCount ?? history.length);
  header.append(titleWrap, count);

  if (history.length === 0) {
    section.append(
      header,
      createAssetEmptyState("暂无外部工具执行记录；运行 ComfyUI、MCP 或浏览器工具后会显示在这里。"),
    );
    return section;
  }

  const scroller = document.createElement("div");
  scroller.className = "skill-list-scroll tool-list-scroll external-tool-history-scroll";
  const list = document.createElement("div");
  list.className = "skill-list tool-list external-tool-history-list";
  for (const execution of history) {
    list.append(createExternalToolExecutionRow(execution));
  }
  scroller.append(list);
  section.append(
    header,
    createAssetMetricGrid([
      ["Active", externalToolBus?.activeExecutionCount ?? 0],
      ["Completed", externalToolBus?.completedExecutionCount ?? 0],
      ["Failed", externalToolBus?.failedExecutionCount ?? 0],
      ["Latest", externalToolBus?.latestExecution?.status ?? "none"],
    ]),
    scroller,
  );
  return section;
}

function createExternalToolBusHealthPanel(externalToolBus) {
  const health = summarizeExternalToolBusHealth(externalToolBus);
  return createAssetMetricGrid([
    ["Catalog", externalToolBus.catalogCount ?? 0],
    ["Effective", externalToolBus.effectiveCount ?? 0],
    ["Unavailable", externalToolBus.unavailableCount ?? 0],
    ["可调用", health.readyCount],
    ["需登录", health.needsAuthCount],
    ["故障", health.problemCount],
    ["最近可用", health.lastKnownGoodCount],
    ["Ledger", externalToolBus.processCapabilityLedger?.totalEntries ?? 0],
    ["Host", externalToolBus.processCapabilityLedger?.riskyHostEntries ?? 0],
    ["Schema", externalToolBus.schemaVersion ?? "unknown"],
  ]);
}

function createExternalToolProviderMatrixPanel(externalToolBus) {
  const providers = externalToolBus?.providerMatrix?.providers ?? [];
  const table = document.createElement("div");
  table.className = "settings-readonly-table settings-provider-matrix";
  if (providers.length === 0) {
    table.append(createReadonlyRow("Provider Matrix", "暂无 providerMatrix；等待 Host API / runtime 快照同步。"));
    return table;
  }
  for (const provider of providers) {
    table.append(
      createReadonlyRow(
        provider.label ?? provider.providerId,
        [
          formatExternalToolBusStatus(provider.status, provider.invokableToolCount > 0),
          `${provider.invokableToolCount ?? 0}/${provider.toolCount ?? 0} 可调用`,
          formatExternalToolApprovalBoundary(provider.approvalBoundary),
          formatExternalToolLastKnownGood(provider.lastKnownGood),
        ].join(" · "),
      ),
    );
  }
  return table;
}

function createAgentOsExtensionControlPlanePanel(externalToolBus, options = {}) {
  const agentOsExtensionMatrix = externalToolBus?.agentOsExtensionMatrix ?? null;
  const section = document.createElement("section");
  section.className = `skill-list-section tool-list-section agent-os-extension-control-plane ${
    options.surface === "settings" ? "settings-agent-os-extension-control-plane" : ""
  }`;
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Agent OS 扩展控制面";
  const subtitle = document.createElement("small");
  subtitle.textContent = "Extension matrix / health / sandbox / source trust";
  titleWrap.append(title, subtitle);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(agentOsExtensionMatrix?.summary?.total ?? 0);
  header.append(titleWrap, count);

  if (!agentOsExtensionMatrix || (agentOsExtensionMatrix.entries ?? []).length === 0) {
    section.append(header, createAssetEmptyState("暂无 Agent OS extension matrix；刷新桌面快照或检查运行时投影。"));
    return section;
  }

  const summary = summarizeAgentOsExtensionMatrix(agentOsExtensionMatrix.summary);
  const scroller = document.createElement("div");
  scroller.className = "skill-list-scroll tool-list-scroll agent-os-extension-scroll";
  const list = document.createElement("div");
  list.className = "skill-list tool-list agent-os-extension-list";
  for (const entry of agentOsExtensionMatrix.entries ?? []) {
    list.append(createAgentOsExtensionControlPlaneRow(entry));
  }
  scroller.append(list);
  section.append(
    header,
    createAssetMetricGrid([
      ["Total", summary.total],
      ["Ready", summary.ready],
      ["Needs Auth", summary.needsAuth],
      ["Needs Setup", summary.needsSetup],
      ["Problem", summary.problem],
      ["Disabled", summary.disabled],
    ]),
    scroller,
  );
  return section;
}

function createAgentOsExtensionControlPlaneRow(entry) {
  const row = document.createElement("article");
  row.className = "skill-list-row tool-list-row agent-os-extension-row";
  row.dataset.agentOsExtensionId = entry.id;
  row.dataset.status = entry.health?.status ?? "";

  const main = document.createElement("div");
  main.className = "skill-list-main tool-list-main";
  const titleCell = document.createElement("div");
  titleCell.className = "skill-title-cell tool-title-cell";
  const title = document.createElement("strong");
  title.textContent = entry.displayName ?? entry.id;
  const summary = document.createElement("small");
  summary.textContent = entry.health?.message ?? entry.health?.checkFn ?? "未返回扩展健康说明";
  const meta = document.createElement("div");
  meta.className = "skill-title-meta";
  for (const value of [
    entry.id,
    entry.toolId ? `tool ${entry.toolId}` : null,
    entry.providerId ? `provider ${entry.providerId}` : null,
    entry.kind,
    formatAgentOsExtensionHealth(entry.health?.status),
  ]) {
    if (!value) {
      continue;
    }
    const piece = document.createElement("span");
    piece.textContent = value;
    meta.append(piece);
  }
  titleCell.append(title, summary, meta);
  main.append(titleCell, createAgentOsExtensionMetaStrip(entry));

  const detail = document.createElement("div");
  detail.className = "skill-list-detail tool-list-detail agent-os-extension-detail";
  detail.append(
    createSkillListLine("Health", formatAgentOsExtensionHealth(entry.health?.status)),
    createSkillListLine("Check", entry.health?.checkFn ?? "none"),
    createSkillListLine("Capabilities", formatList(entry.capabilityIds)),
    createSkillListLine(
      "Sandbox",
      formatList([
        entry.sandbox?.defaultMode,
        entry.sandbox?.networkPolicy ? `network ${entry.sandbox.networkPolicy}` : null,
        entry.sandbox?.requiresCommandPattern
          ? "requires exact command pattern"
          : "no command pattern required",
      ]),
    ),
    createSkillListLine(
      "Source",
      formatList([entry.sourceTrust?.status, entry.sourceTrust?.label, entry.sourceTrust?.reason]),
    ),
    createSkillListLine("UI", formatList(entry.uiSurfaces)),
  );

  row.append(main, detail);
  return row;
}

function createAgentOsExtensionMetaStrip(entry) {
  const strip = document.createElement("div");
  strip.className = "skill-list-meta-strip tool-list-meta-strip agent-os-extension-meta-strip";
  for (const value of [
    formatAgentOsExtensionHealth(entry.health?.status),
    `${entry.capabilityIds?.length ?? 0} capabilities`,
    entry.sandbox?.defaultMode ?? "sandbox unknown",
    entry.sandbox?.networkPolicy ? `network ${entry.sandbox.networkPolicy}` : null,
    entry.sourceTrust?.status ?? "source unknown",
  ]) {
    if (!value) {
      continue;
    }
    const chip = document.createElement("span");
    chip.textContent = value;
    strip.append(chip);
  }
  return strip;
}

function summarizeAgentOsExtensionMatrix(summary = {}) {
  return {
    total: summary.total ?? 0,
    ready: summary.ready ?? 0,
    needsAuth: summary.needsAuth ?? 0,
    needsSetup: summary.needsSetup ?? 0,
    disabled: summary.disabled ?? 0,
    problem: summary.problem ?? 0,
  };
}

function formatAgentOsExtensionHealth(status) {
  const labels = {
    disabled: "已停用",
    "needs-auth": "需要登录",
    "needs-setup": "需要安装/配置",
    problem: "异常",
    ready: "就绪",
  };
  return labels[status] ?? status ?? "unknown";
}

function createExternalToolExecutionRow(execution) {
  const row = document.createElement("article");
  row.className = "skill-list-row tool-list-row external-tool-execution-row";
  row.dataset.externalToolExecutionId = execution.id;
  row.dataset.status = execution.status ?? "";

  const main = document.createElement("div");
  main.className = "skill-list-main tool-list-main";
  const titleCell = document.createElement("div");
  titleCell.className = "skill-title-cell tool-title-cell";
  const title = document.createElement("strong");
  title.textContent = `${execution.toolId ?? "unknown"} · ${execution.operationId ?? "default"}`;
  const summary = document.createElement("small");
  summary.textContent = execution.summary ?? "外部工具执行记录";
  const meta = document.createElement("div");
  meta.className = "skill-title-meta";
  for (const value of [
    formatExternalToolExecutionStatus(execution.status),
    execution.invokeStatus ? `invoke ${execution.invokeStatus}` : null,
    execution.durationMs === null ? null : `${execution.durationMs}ms`,
    execution.artifactCount > 0 ? `${execution.artifactCount} artifacts` : null,
  ]) {
    if (!value) {
      continue;
    }
    const piece = document.createElement("span");
    piece.textContent = value;
    meta.append(piece);
  }
  titleCell.append(title, summary, meta);
  main.append(titleCell);

  const detail = document.createElement("div");
  detail.className = "skill-list-detail tool-list-detail external-tool-execution-detail";
  for (const line of execution.timeline ?? []) {
    detail.append(createSkillListLine(formatExternalToolExecutionStatus(line.status), line.detail ?? ""));
  }
  row.append(main, detail);
  return row;
}

function createExternalToolProcessLedger(externalToolBus) {
  const ledger = externalToolBus?.processCapabilityLedger ?? null;
  const section = document.createElement("section");
  section.className = "skill-list-section tool-list-section external-tool-process-ledger-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "OS / Process Ledger";
  const subtitle = document.createElement("small");
  subtitle.textContent = "Sandbox admission / argv pattern / process signal";
  titleWrap.append(title, subtitle);
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(ledger?.totalEntries ?? 0);
  header.append(titleWrap, count);

  if (!ledger || (ledger.entries ?? []).length === 0) {
    section.append(header, createAssetEmptyState("暂无 OS/process 执行证据；运行外部工具后会显示。"));
    return section;
  }

  const metrics = createAssetMetricGrid([
    ["Entries", ledger.totalEntries ?? 0],
    ["Host", ledger.riskyHostEntries ?? 0],
    ["Latest", ledger.entries[0]?.status ?? "none"],
  ]);
  const table = document.createElement("div");
  table.className = "settings-readonly-table external-tool-process-ledger";
  for (const entry of (ledger.entries ?? []).slice(0, 8)) {
    table.append(
      createReadonlyRow(
        `${entry.runnerKind ?? "other"} · ${entry.status ?? "unknown"}`,
        formatList([
          entry.backend,
          formatExternalToolLedgerCommand(entry.commandPattern, entry.command),
          entry.process?.signal ? `signal ${entry.process?.signal}` : "signal none",
          entry.exitCode === undefined ? null : `exit ${entry.exitCode}`,
        ]),
      ),
    );
  }
  section.append(header, metrics, table);
  return section;
}

function formatExternalToolLedgerCommand(commandPattern, command) {
  if (commandPattern) {
    return [
      commandPattern.executable,
      ...(Array.isArray(commandPattern.argv) ? commandPattern.argv : []),
    ].join(" ");
  }
  return command ?? "unknown command";
}

function createExternalToolBusRow(item) {
  const row = document.createElement("article");
  row.className = "skill-list-row tool-list-row external-tool-bus-row";
  row.dataset.externalToolBusRow = item.id;
  row.dataset.status = item.status ?? "";
  row.dataset.canInvoke = item.canInvoke ? "true" : "false";

  const main = document.createElement("div");
  main.className = "skill-list-main tool-list-main";
  const titleCell = document.createElement("div");
  titleCell.className = "skill-title-cell tool-title-cell";
  const title = document.createElement("strong");
  title.textContent = item.label ?? item.id;
  const summary = document.createElement("small");
  summary.textContent = item.doctor?.summary ?? "未返回 doctor 诊断";
  const meta = document.createElement("div");
  meta.className = "skill-title-meta";
  for (const value of [
    item.id,
    item.source,
    item.kind,
    formatExternalToolSourceTrust(item.sourceTrust),
    formatExternalToolBusStatus(item.status, item.canInvoke),
  ]) {
    const piece = document.createElement("span");
    piece.textContent = value ?? "unknown";
    meta.append(piece);
  }
  titleCell.append(title, summary, meta);
  main.append(titleCell, createExternalToolBusMetaStrip(item));

  const detail = document.createElement("div");
  detail.className = "skill-list-detail tool-list-detail";
  detail.append(
    createSkillListLine("Doctor", item.doctor?.summary ?? "未返回"),
    createSkillListLine("最近可用", formatExternalToolLastKnownGood(item.lastKnownGood)),
    createSkillListLine("来源", formatExternalToolSourceTrust(item.sourceTrust)),
    createSkillListLine("安装", formatExternalToolInstallPolicy(item.installPolicy)),
    createSkillListLine("审批", formatExternalToolApprovalBoundary(item.approvalBoundary)),
    createSkillListLine("能力", formatExternalToolBusCapabilities(item.capabilities)),
    createSkillListLine("下一步", formatList(item.doctor?.nextActions)),
  );

  row.append(main, detail, createExternalToolBusActionCell(item));
  return row;
}

function createExternalToolBusMetaStrip(item) {
  const strip = document.createElement("div");
  strip.className = "skill-list-meta-strip tool-list-meta-strip";
  for (const value of [
    formatExternalToolBusStatus(item.status, item.canInvoke),
    item.canInvoke ? "运行时已启用" : "运行时不可调用",
    formatExternalToolLastKnownGood(item.lastKnownGood),
    formatExternalToolInstallPolicy(item.installPolicy),
    `${item.capabilityCount ?? item.capabilities?.length ?? 0} capabilities`,
    `generation ${item.generation ?? 0}`,
  ]) {
    const chip = document.createElement("span");
    chip.textContent = value;
    strip.append(chip);
  }
  return strip;
}

function createExternalToolBusActionCell(item) {
  const cell = document.createElement("div");
  cell.className = "skill-list-controls tool-list-controls";
  const buttons = document.createElement("div");
  buttons.className = "skill-row-actions tool-row-actions";
  for (const action of createExternalToolBusRowActions(item)) {
    const button = createAssetDirectActionButton(action.action, action.label, action.tone);
    button.classList.add("compact", "skill-action-button", "tool-action-button");
    buttons.append(button);
  }
  if (buttons.childElementCount === 0) {
    const empty = document.createElement("small");
    empty.textContent = item.canInvoke ? "运行时可被模型按需调用" : "先按 Doctor 修复";
    cell.append(empty);
    return cell;
  }
  cell.append(buttons);
  return cell;
}

function createExternalToolBusRowActions(item) {
  if (item.id === "browser") {
    const disconnected = item.status === "disabled" || item.metadata?.connected === false;
    return [
      { label: "管理", tone: "secondary", action: { type: "ui.selectSettingsTab", tab: "externalTools" } },
      {
        label: disconnected ? "连接" : "断开",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
          toolId: "browser",
          operation: disconnected ? "enable" : "disable",
        },
      },
      {
        label: "清理",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
          toolId: "browser",
          operation: "delete",
          confirm: "确认清理 Browser provider 的临时会话？不会删除浏览器本体或 Angel 工作台。",
        },
      },
    ];
  }
  if (item.id === "comfyui") {
    return [
      { label: "配置", tone: "secondary", action: { type: "ui.selectSettingsTab", tab: "externalTools" } },
      { label: "测试", tone: "secondary", action: { type: DESKTOP_ACTIONS.COMFYUI_TEST } },
      {
        label: item.status === "disabled" ? "启用" : "停用",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
          toolId: "comfyui",
          operation: item.status === "disabled" ? "enable" : "disable",
        },
      },
      {
        label: "重启",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.COMFYUI_LIFECYCLE,
          action: "restart",
          confirm: "确认重启本机 ComfyUI？",
        },
      },
      {
        label: "修复依赖",
        tone: "secondary",
        action: { type: DESKTOP_ACTIONS.COMFYUI_FIX_DEPENDENCIES, dryRun: true },
      },
      {
        label: "安装计划",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
          toolId: "comfyui",
          operation: "install",
          dryRun: true,
        },
      },
      { label: "打开", tone: "primary", action: { type: DESKTOP_ACTIONS.COMFYUI_OPEN } },
    ];
  }
  if (item.source === "mcp") {
    return [
      { label: "管理", tone: "secondary", action: { type: "ui.selectSettingsTab", tab: "externalTools" } },
      { label: "刷新", tone: "secondary", action: { type: DESKTOP_ACTIONS.MCP_REFRESH } },
      {
        label: item.status === "disabled" ? "启用" : "停用",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
          toolId: item.id,
          operation: item.status === "disabled" ? "enable" : "disable",
        },
      },
      {
        label: "删除",
        tone: "danger",
        action: {
          type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
          toolId: item.id,
          operation: "delete",
          confirm: `确认移除 ${item.label ?? item.id} 配置？不会删除外部 MCP server 程序本体。`,
        },
      },
    ];
  }
  return [];
}

function formatExternalToolBusStatus(status, canInvoke) {
  const labels = {
    ready: "可调用",
    disabled: "已停用",
    failed: "失败",
    misconfigured: "配置不完整",
    missing: "未安装",
    "needs-auth": "需要登录",
    pending: "待连接",
    unreachable: "不可达",
  };
  const label = labels[status] ?? status ?? "unknown";
  return canInvoke ? label : `${label} · 不可调用`;
}

function formatExternalToolLastKnownGood(lastKnownGood) {
  if (!lastKnownGood) {
    return "最近可用：无";
  }
  const checkedAt = formatEpochDate(lastKnownGood.checkedAtMs);
  const summary = lastKnownGood.summary ? ` · ${lastKnownGood.summary}` : "";
  return `最近可用：${checkedAt}${summary}`;
}

function summarizeExternalToolBusHealth(externalToolBus) {
  const items = externalToolBus?.items ?? [];
  return {
    readyCount: items.filter((item) => item.canInvoke === true || item.status === "ready").length,
    unavailableCount: items.filter((item) => item.canInvoke !== true).length,
    needsAuthCount: items.filter((item) => item.status === "needs-auth").length,
    problemCount: items.filter((item) =>
      ["failed", "misconfigured", "missing", "unreachable"].includes(item.status),
    ).length,
    disabledCount: items.filter((item) => item.status === "disabled").length,
    lastKnownGoodCount: items.filter((item) => item.lastKnownGood !== undefined && item.lastKnownGood !== null).length,
  };
}

function formatExternalToolExecutionStatus(status) {
  const labels = {
    cancelled: "已取消",
    completed: "已完成",
    executing: "执行中",
    failed: "失败",
    queued: "排队中",
    yielded: "等待中",
  };
  return labels[status] ?? status ?? "unknown";
}

function formatExternalToolBusCapabilities(capabilities) {
  return formatList(
    (capabilities ?? []).map((capability) => {
      const guards = [];
      if (capability.requiresApproval) {
        guards.push("需确认");
      }
      if (capability.readOnly) {
        guards.push("只读");
      }
      return guards.length > 0
        ? `${capability.label ?? capability.id} (${guards.join("/")})`
        : capability.label ?? capability.id;
    }),
  );
}

function formatExternalToolSourceTrust(sourceTrust) {
  if (!sourceTrust) {
    return "来源未知";
  }
  const label = sourceTrust.label ?? formatExternalToolSourceTrustStatus(sourceTrust.status);
  return sourceTrust.reason ? `${label} · ${sourceTrust.reason}` : label;
}

function formatExternalToolSourceTrustStatus(status) {
  const labels = {
    "built-in": "内置",
    "trusted-local-config": "本机配置",
    "trusted-plugin": "可信插件",
    "user-configured": "用户配置",
    unverified: "未验证",
    unknown: "未知来源",
  };
  return labels[status] ?? status ?? "未知来源";
}

function formatExternalToolInstallPolicy(installPolicy) {
  if (!installPolicy || installPolicy.supported !== true) {
    return "安装由外部管理";
  }
  const modes = {
    execute: "可执行安装",
    manual: "手动安装",
    none: "不安装",
    plan: "先生成计划",
  };
  const pieces = [modes[installPolicy.defaultMode] ?? installPolicy.defaultMode ?? "安装策略"];
  if (installPolicy.requiresApproval) {
    pieces.push("需确认");
  }
  if (installPolicy.requiresExplicitExecute) {
    pieces.push("需显式执行");
  }
  if ((installPolicy.allowedMethods ?? []).length > 0) {
    pieces.push(`方法：${installPolicy.allowedMethods.slice(0, 3).join("/")}`);
  }
  return pieces.join(" · ");
}

function formatExternalToolApprovalBoundary(approvalBoundary) {
  if (!approvalBoundary || approvalBoundary.mode === "none") {
    return "无额外审批";
  }
  const modes = {
    "operator-confirm": "人工确认",
    "runtime-policy": "运行时策略",
    "trusted-auto": "可信自动",
  };
  const labels = (approvalBoundary.actionLabels ?? []).join("/");
  return labels
    ? `${modes[approvalBoundary.mode] ?? approvalBoundary.mode} · ${labels}`
    : modes[approvalBoundary.mode] ?? approvalBoundary.mode;
}

function createToolTableRow(item) {
  const row = document.createElement("article");
  row.className = "skill-list-row tool-list-row";
  row.dataset.toolRow = item.id;
  row.dataset.enabled = item.enabled ? "enabled" : "disabled";
  row.dataset.provider = item.provider ?? "";
  row.dataset.kind = item.kind ?? "";
  const main = document.createElement("div");
  main.className = "skill-list-main tool-list-main";
  main.append(createToolTitleCell(item), createToolMetaStrip(item));

  const detail = document.createElement("div");
  detail.className = "skill-list-detail tool-list-detail";
  detail.append(
    createSkillListLine("门禁", item.realExecutionEligible ? "真实执行可用" : "未满足真实执行门禁"),
    createSkillListLine("能力", formatList(item.supportedActionClasses)),
  );

  row.append(main, detail, createToolActionCell(item));
  return row;
}

function createToolTitleCell(item) {
  const cell = document.createElement("div");
  cell.className = "skill-title-cell tool-title-cell";
  const button = document.createElement("button");
  button.className = "skill-title-link tool-title-link";
  button.type = "button";
  button.dataset.assetSurface = "tools";
  button.dataset.assetId = item.id;
  button.textContent = item.title;
  const summary = document.createElement("small");
  summary.textContent = formatCompactToolSummary(item);
  const meta = document.createElement("div");
  meta.className = "skill-title-meta";
  for (const value of [item.id, item.provider, item.healthStatus]) {
    const piece = document.createElement("span");
    piece.textContent = value ?? "unknown";
    meta.append(piece);
  }
  cell.append(button, summary, meta);
  return cell;
}

function createToolMetaStrip(item) {
  const strip = document.createElement("div");
  strip.className = "skill-list-meta-strip tool-list-meta-strip";
  for (const value of [
    item.enabled ? "已启用" : "已停用",
    item.registered ? "已注册" : "内置工具",
    item.mockOnly ? "mock only" : "real-capable",
    item.dryRunSupported ? "dry-run" : "no dry-run",
  ]) {
    const chip = document.createElement("span");
    chip.textContent = value;
    strip.append(chip);
  }
  return strip;
}

function createToolActionCell(item) {
  const cell = document.createElement("div");
  cell.className = "skill-list-controls tool-list-controls";
  cell.append(createToolEnablementSwitch(item));
  const buttons = document.createElement("div");
  buttons.className = "skill-row-actions tool-row-actions";
  const detailButton = createAssetDirectActionButton(
    { type: "ui.selectAsset", surface: "tools", assetId: item.id },
    "详情",
    "secondary",
  );
  detailButton.classList.add("compact", "skill-action-button", "tool-action-button");
  buttons.append(detailButton);
  for (const actionPrompt of createToolRowActions(item)) {
    const button = createAssetDirectActionButton(
      actionPrompt.action,
      actionPrompt.label,
      actionPrompt.tone,
    );
    button.classList.add("compact", "skill-action-button", "tool-action-button");
    buttons.append(button);
  }
  cell.append(buttons);
  return cell;
}

function createToolEnablementSwitch(tool) {
  const label = document.createElement("label");
  label.className = "skill-toggle-wrap tool-toggle-wrap";
  label.addEventListener("click", (event) => event.stopPropagation());
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "skill-toggle tool-toggle";
  input.checked = tool.enabled === true;
  input.setAttribute("aria-label", `${tool.title ?? tool.id} 启用状态`);
  const stateText = document.createElement("span");
  stateText.className = "skill-toggle-state tool-toggle-state";
  stateText.textContent = tool.enabled ? "已启用" : "已停用";
  input.addEventListener("change", async (event) => {
    event.stopPropagation();
    if (state.running || !bridge) {
      input.checked = !input.checked;
      return;
    }
    const enabled = input.checked;
    const action = createToolEnablementAction(tool, enabled);
    if (!action) {
      input.checked = !enabled;
      return;
    }
    input.disabled = true;
    stateText.textContent = "同步中";
    setRunning(true);
    const result = await invokeBridge(action);
    await renderBridgeResult(result);
    setRunning(false);
    if (!result) {
      input.checked = !enabled;
      stateText.textContent = tool.enabled ? "已启用" : "已停用";
    }
    input.disabled = false;
    stateText.textContent = input.checked ? "已启用" : "已停用";
  });
  label.append(input, stateText);
  return label;
}

function createToolEnablementAction(tool, enabled) {
  if (tool.id === "comfyui-media") {
    return {
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: enabled ? "enable" : "disable",
    };
  }
  return createCommandRunAction(enabled ? "adapter.enable" : "adapter.disable", {
    adapterId: tool.id,
  });
}

function createToolRowActions(tool) {
  if (tool.id === "comfyui-media") {
    return [
      {
        label: "配置",
        tone: "secondary",
        action: { type: "ui.selectSettingsTab", tab: "externalTools" },
      },
      {
        label: "测试",
        tone: "secondary",
        action: { type: DESKTOP_ACTIONS.COMFYUI_TEST },
      },
    ];
  }
  return [
    {
      label: "说明",
      tone: "secondary",
      action: createCommandRunAction("adapter.explain", { adapterId: tool.id }),
    },
  ];
}

function formatCompactToolSummary(item) {
  const notes = item.notes?.find((note) => typeof note === "string" && note.length > 0);
  return formatCompactSkillSummary(
    notes ??
      `${item.kind ?? "adapter"} · ${item.provider ?? "unknown"} · ${item.auditSummary ?? ""}`,
  );
}

function createAssetMetricGrid(metrics) {
  const grid = document.createElement("div");
  grid.className = "asset-metric-grid";
  for (const [labelText, valueText] of metrics) {
    grid.append(createMetricBlock(labelText, valueText));
  }
  return grid;
}

function createAssetSection(titleText, items, options = {}) {
  const section = document.createElement("section");
  section.className = "asset-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = titleText;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(items.length);
  header.append(title, count);
  const list = document.createElement("div");
  list.className = "asset-list";
  if (items.length === 0) {
    list.append(createAssetEmptyState(options.emptyCopy ?? "暂无数据。"));
  } else {
    for (const item of items) {
      list.append((options.toCard ?? createAssetCard)(item));
    }
  }
  section.append(header, list);
  return section;
}

function createAssetCard(item) {
  const button = document.createElement("button");
  button.className = "asset-row-card";
  button.type = "button";
  if (item.assetId) {
    button.dataset.assetSurface = item.assetSurface ?? getActiveWorkflow()?.id ?? "";
    button.dataset.assetId = item.assetId;
  }
  const title = document.createElement("strong");
  title.textContent = item.label ?? item.title ?? item.id ?? "资产";
  const description = document.createElement("span");
  description.textContent = item.description ?? item.summary ?? "";
  const meta = document.createElement("small");
  meta.textContent = item.meta ?? item.status ?? "";
  button.append(title, description, meta);
  return button;
}

function createAssetNote(copy) {
  const note = document.createElement("div");
  note.className = "asset-note";
  note.textContent = copy;
  return note;
}

function createExperienceCandidateCard(item) {
  return createCompactExperienceRow({
    title: item.title,
    summary: formatCompactExperienceSummary(item.summary),
    meta: `${formatExperienceStatusLabel(item.status)} · ${formatExperienceSourceKind(
      item.sourceKind,
    )} · ${formatExperienceDistillation(item)} · ${formatExperienceQuality(item)} · ${
      item.evidenceCount ?? 0
    } 条证据`,
    pill: formatExperienceStatusLabel(item.status),
    tone: mapCandidateTone(item.status),
    assetSurface: "experience",
    assetId: `candidate:${item.id}`,
  });
}











function createTextCell(value) {
  const cell = document.createElement("td");
  cell.textContent = String(value ?? "");
  return cell;
}





function createExperienceQuarantineCard(item) {
  return createCompactExperienceRow({
    title: item.title,
    summary: formatCompactExperienceSummary(item.reason ?? item.summary),
    meta: `${formatExperienceSourceKind(item.sourceKind)} · ${formatExperienceQuality(item)}`,
    pill: "已隔离",
    tone: "warn",
    assetSurface: "experience",
    assetId: `quarantine:${item.id}`,
  });
}

function createCompactExperienceRow({ title, summary, meta, pill, tone, assetSurface, assetId }) {
  const row = document.createElement("button");
  row.className = `asset-row-card asset-review-row${isSelectedAsset(assetSurface, assetId) ? " selected" : ""}`;
  row.type = "button";
  row.dataset.assetSurface = assetSurface;
  row.dataset.assetId = assetId;

  const content = document.createElement("div");
  content.className = "asset-row-main";
  const titleNode = document.createElement("strong");
  titleNode.textContent = title ?? "未命名经验";
  const metaNode = document.createElement("small");
  metaNode.textContent = meta ?? "";
  const summaryNode = document.createElement("span");
  summaryNode.className = "asset-row-summary";
  summaryNode.textContent = summary ?? "";
  content.append(titleNode, metaNode, summaryNode);
  row.append(content, createStatusPill(pill, tone));
  return row;
}

function createKnowledgeAssetItems(knowledge) {
  const items = [...(knowledge?.candidates ?? [])];
  if (knowledge?.latestPublished) {
    items.push({ ...knowledge.latestPublished, status: "published", summary: "已发布知识包" });
  }
  return items;
}

function createKnowledgeAssetCard(item) {
  const prompt =
    item.status === "accepted"
      ? `/知识 发布 ${item.id}`
      : item.status === "published"
        ? `/知识 说明 ${item.id}`
        : `/知识 接受 ${item.id}`;
  return createDataAssetCard({
    title: item.title,
    description: item.summary ?? item.publishedAt ?? "",
    meta: `${item.status ?? "candidate"} · v${item.version ?? "none"}`,
    footer: formatList([item.id, item.operation, item.trigger, item.updatedAt ?? item.publishedAt]),
    assetSurface: "experience",
    assetId: item.status === "published" ? `published:${item.id}` : `knowledge:${item.id}`,
    prompt,
  });
}

function createReviewQueueItems(review) {
  const items = [];
  for (const candidate of state.snapshot?.candidate?.items ?? []) {
    if (!["pending", "accepted"].includes(candidate.status)) {
      continue;
    }
    items.push({
      lane: "experience",
      id: candidate.id,
      assetId: `experience:${candidate.id}`,
      title: candidate.title,
      summary: candidate.summary,
      status: candidate.status,
      updatedAt: formatEpochDate(candidate.createdAtMs),
      meta: formatExperienceDistillation(candidate),
      risk: formatExperienceQuality(candidate),
      tags: candidate.tags ?? [],
    });
  }
  for (const candidate of state.snapshot?.knowledge?.candidates ?? []) {
    if (!["pending", "accepted"].includes(candidate.status)) {
      continue;
    }
    items.push({
      lane: "knowledge",
      id: candidate.id,
      assetId: `knowledge:${candidate.id}`,
      title: candidate.title,
      summary: candidate.summary,
      status: candidate.status,
      updatedAt: candidate.updatedAt ?? "未知",
      meta: formatList([candidate.operation, candidate.trigger]),
      risk: candidate.version ? `v${candidate.version}` : "",
      tags: candidate.tags ?? [],
    });
  }
  for (const proposal of review?.traceProposalItems ?? []) {
    items.push({
      lane: "trace",
      id: proposal.id,
      assetId: `trace:${proposal.id}`,
      title: proposal.title,
      summary: proposal.summary ?? proposal.evidenceSummary ?? proposal.explanation,
      status: proposal.status,
      updatedAt: proposal.updatedAt ?? proposal.createdAt ?? "未知",
      meta: formatList([proposal.kind, proposal.runId, proposal.reportId]),
      risk: formatList([proposal.riskLevel, formatConfidence(proposal.confidence)]),
      tags: proposal.tags ?? [],
    });
  }
  for (const run of review?.executionItems ?? []) {
    items.push({
      lane: "run",
      id: run.runId,
      assetId: `run:${run.runId}`,
      title: run.goal || run.runId,
      summary: run.previewSummary,
      status: run.status,
      updatedAt: run.updatedAt ?? "未知",
      meta: formatAssignmentCounts(run.assignmentCounts),
      risk: run.sideEffectsAllowed ? "允许副作用" : "无副作用",
      tags: run.notes ?? [],
    });
  }
  const reportItems =
    review?.executionReportItems ?? (review?.latestReport ? [review.latestReport] : []);
  for (const report of reportItems) {
    items.push({
      lane: "report",
      id: report.reportId,
      assetId: `report:${report.reportId}`,
      title: report.operatorSummary || report.directorGoal || report.reportId,
      summary: report.nextAction || formatList(report.summary),
      status: report.runStatus,
      updatedAt: report.recordedAt ?? "未知",
      meta: formatList([report.bridgeVerdict, report.bridgeFailureReason]),
      risk:
        report.retryAllowed === true ? "可重试" : report.retryAllowed === false ? "不可重试" : "",
      tags: report.flags ?? [],
    });
  }
  for (const event of review?.heartbeatItems ?? []) {
    items.push({
      lane: "heartbeat",
      id: event.eventId,
      assetId: `heartbeat:${event.eventId}`,
      title: formatHeartbeatKindLabel(event.kind),
      summary: event.summary,
      status: event.severity,
      priorityStatus: event.severity,
      updatedAt: event.createdAt ?? "未知",
      meta: formatList(event.actionRefs),
      risk: formatHeartbeatSeverityLabel(event.severity),
      tags: event.evidenceRefs ?? [],
    });
  }
  for (const action of state.snapshot?.assets?.skills?.curator?.actions ?? []) {
    items.push({
      lane: "skill-curator",
      id: action.skillId,
      assetId: `skill-curator:${action.skillId}`,
      title: action.title ?? action.skillId,
      summary: action.summary ?? action.reason,
      status: action.status ?? action.kind,
      priorityStatus: mapSkillCuratorPriorityStatus(action),
      updatedAt: action.updatedAtMs ? formatEpochDate(action.updatedAtMs) : "未知",
      meta: formatSkillCuratorKindLabel(action.kind),
      risk: formatSkillCuratorSeverityLabel(action.severity),
      tags: [action.skillId, ...(action.duplicateSkillIds ?? [])],
    });
  }
  return items.sort(compareReviewQueueItems);
}

function createReviewAttentionSummary(review, items) {
  const pendingReviewCount = items.filter((item) =>
    ["pending", "accepted", "warn", "blocked"].includes(item.status),
  ).length;
  const memoryReflectionCount = (review?.heartbeatItems ?? []).filter((event) =>
    ["care", "reflection-due"].includes(event.kind),
  ).length;
  const governanceSummary = summarizeLearningGovernanceHeartbeatItems(review?.heartbeatItems ?? []);
  const skillCuratorCount = state.snapshot?.assets?.skills?.curator?.attentionCount ?? 0;
  return [
    { name: "心跳提醒", count: review?.heartbeatAttentionCount ?? 0 },
    { name: "失败运行", count: review?.failedRunCount ?? 0 },
    { name: "待审事项", count: pendingReviewCount },
    { name: "Skill Curator", count: skillCuratorCount },
    { name: "记忆/复盘提醒", count: memoryReflectionCount },
    {
      name: "记忆治理",
      count: governanceSummary.hasGovernance
        ? governanceSummary.acceptedExperienceBacklog +
          governanceSummary.pendingExperienceBacklog +
          governanceSummary.publishedKnowledgeMissingRecallEval
        : 0,
    },
  ];
}

function createReviewLaneSummary(items) {
  const labels = {
    experience: "经验",
    knowledge: "知识",
    trace: "Trace",
    run: "运行",
    report: "报告",
    heartbeat: "心跳",
    "skill-curator": "Skill Curator",
  };
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.lane) ?? { name: labels[item.lane] ?? item.lane, count: 0 };
    current.count += 1;
    groups.set(item.lane, current);
  }
  return [...groups.values()];
}

function createReviewStatusSummary(items) {
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.status) ?? { name: item.status ?? "unknown", count: 0 };
    current.count += 1;
    groups.set(item.status, current);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count);
}

function compareReviewQueueItems(left, right) {
  const priority = {
    failed: 0,
    blocked: 1,
    warn: 2,
    pending: 3,
    accepted: 4,
    paused: 5,
    running: 6,
    created: 7,
    info: 8,
    completed: 9,
  };
  const leftPriority = priority[left.priorityStatus ?? left.status] ?? 10;
  const rightPriority = priority[right.priorityStatus ?? right.status] ?? 10;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
}

function createSkillListCard(skill) {
  return createDataAssetCard({
    title: skill.title,
    description: skill.description || skill.id,
    meta: `${skill.source === "self" ? "自进化" : "外部"} · ${skill.version}`,
    footer: formatList([
      skill.id,
      formatList(skill.tags),
      formatList(skill.toolNames),
      skill.updatedAtMs,
    ]),
    assetSurface: "skills",
    assetId: skill.id,
  });
}

function createToolListCard(tool) {
  return createDataAssetCard({
    title: tool.title,
    description: `${tool.provider} · ${tool.kind}`,
    meta: `${tool.enabled ? "启用" : "停用"} · ${tool.healthStatus} · ${
      tool.realExecutionEligible ? "真实执行可用" : "未满足门禁"
    }`,
    footer: formatList([
      tool.id,
      tool.bridgeCapable ? "bridge" : "no bridge",
      tool.mockOnly ? "mock only" : "real-capable",
      tool.dryRunSupported ? "dry run" : "no dry run",
    ]),
    assetSurface: "tools",
    assetId: tool.id,
  });
}

function createDataAssetCard({ title, description, meta, footer, assetSurface, assetId, prompt }) {
  const card = document.createElement(assetId ? "button" : "article");
  card.className = `asset-row-card${assetId && isSelectedAsset(assetSurface, assetId) ? " selected" : ""}`;
  if (assetId) {
    card.type = "button";
    card.dataset.assetSurface = assetSurface;
    card.dataset.assetId = assetId;
  }
  const titleNode = document.createElement("strong");
  titleNode.textContent = title ?? "资产";
  const descriptionNode = document.createElement("span");
  descriptionNode.textContent = description ?? "";
  const metaNode = document.createElement("small");
  metaNode.textContent = meta ?? "";
  const footerNode = document.createElement("code");
  footerNode.textContent = footer ?? "";
  card.append(titleNode, descriptionNode, metaNode, footerNode);
  if (prompt) {
    const actions = document.createElement("div");
    actions.className = "asset-card-actions";
    actions.append(createWorkbenchPromptButton(prompt, "带到工作台"));
    card.append(actions);
  }
  return card;
}

function renderAssetDetailPage(container, detail, group) {
  container.replaceChildren();
  container.classList.toggle("has-source-reader", Boolean(detail?.sourceReader));
  if (!detail) {
    const title = document.createElement("h3");
    title.textContent = `${group?.title ?? "资产"}详情`;
    const empty = createAssetEmptyState(
      "选择左侧列表中的条目查看详情；经验审核可在详情页直接执行，工作台仍保留 /能力入口。",
    );
    container.append(title, empty);
    return;
  }
  const title = document.createElement("h3");
  title.textContent = detail.title;
  const summary = document.createElement("p");
  summary.textContent = detail.summary;
  const meta = document.createElement("small");
  meta.textContent = detail.meta;
  const fields = document.createElement("div");
  fields.className = "asset-detail-fields";
  for (const field of detail.fields ?? []) {
    fields.append(createReadonlyRow(field.label, field.value));
  }
  const actions = document.createElement("div");
  actions.className = "asset-detail-actions";
  if (detail.actionPrompt) {
    actions.append(createWorkbenchPromptButton(detail.actionPrompt, "带到工作台"));
  }
  for (const actionPrompt of detail.actionPrompts ?? []) {
    if (actionPrompt.action) {
      actions.append(
        createAssetDirectActionButton(actionPrompt.action, actionPrompt.label, actionPrompt.tone),
      );
      continue;
    }
    actions.append(createWorkbenchPromptButton(actionPrompt.prompt, actionPrompt.label));
  }
  container.append(title, summary, meta);
  if (actions.childElementCount > 0) {
    container.append(actions);
  }
  if (detail.sourceReader) {
    container.append(createSourceReaderBlock(detail.sourceReader));
  }
  container.append(fields);
}

function createAssetDirectActionButton(action, label, tone = "primary") {
  const button = document.createElement("button");
  button.className =
    tone === "danger"
      ? "danger-button"
      : tone === "secondary"
        ? "secondary-button"
        : "primary-button";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await executeAssetAction(action, button, label);
  });
  return button;
}

async function executeAssetAction(action, button, label) {
  if (action?.type === "ui.selectAsset") {
    selectAssetDetail(action.surface, action.assetId);
    return;
  }
  if (action?.type === "ui.selectSettingsTab") {
    selectSettingsTab(action.tab);
    return;
  }
  const confirmation = action?.confirm;
  if (
    typeof confirmation === "string" &&
    confirmation.length > 0 &&
    typeof window?.confirm === "function" &&
    !window.confirm(confirmation)
  ) {
    return;
  }
  if (state.running || !bridge) {
    return;
  }
  const bridgeAction =
    typeof confirmation === "string"
      ? Object.fromEntries(Object.entries(action).filter(([key]) => key !== "confirm"))
      : action;
  setRunning(true);
  button.disabled = true;
  button.textContent = "处理中";
  const result = await invokeBridge(bridgeAction);
  await renderBridgeResult(result);
  setRunning(false);
  button.disabled = false;
  button.textContent = label;
}

function createAssetEmptyState(copy) {
  const empty = document.createElement("div");
  empty.className = "asset-empty";
  empty.textContent = copy;
  return empty;
}

function createSourceReaderBlock(sourceReader) {
  const parsed = parseSourceReaderContent(
    sourceReader.content || "",
    sourceReader.rawContent || sourceReader.content || "",
    sourceReader.extractionReport ?? null,
    sourceReader.structuredContent ?? null,
  );
  const block = document.createElement("section");
  block.className = "asset-source-reader";
  const header = document.createElement("div");
  header.className = "asset-source-reader-header";
  const copy = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = sourceReader.title ?? "抓取完整内容";
  const meta = document.createElement("small");
  meta.textContent = sourceReader.meta ?? "";
  copy.append(title, meta);
  header.append(copy, createSourceReaderStats(parsed));
  const body = document.createElement("div");
  body.className = "asset-source-body";
  if (parsed.orderedBlocks.length > 0) {
    body.append(createSourceOrderedSection(parsed.orderedBlocks));
  } else if (parsed.readableText.length > 0) {
    body.append(createSourceTextSection(parsed.readableText));
  } else {
    body.append(createAssetEmptyState("没有可显示的抓取正文。"));
  }
  if (parsed.orderedBlocks.length === 0 && parsed.tables.length > 0) {
    body.append(createSourceTableSection(parsed.tables));
  }
  if (parsed.orderedBlocks.length === 0 && parsed.media.length > 0) {
    body.append(createSourceMediaSection(parsed.media));
  }
  if (parsed.captureNotes.length > 0) {
    body.append(createSourceNotesSection(parsed.captureNotes));
  }
  body.append(createSourceRawDetails(parsed.raw));
  block.append(header, body);
  return block;
}

function parseSourceReaderContent(
  content,
  rawContent = content,
  extractionReport = null,
  structuredContent = null,
) {
  const displayContent = String(content ?? "");
  const raw = String(rawContent ?? displayContent);
  const buckets = splitSourceReaderBuckets(displayContent);
  const structured = normalizeStructuredSourceSnapshot(structuredContent);
  const orderedBlocks =
    structured.blocks.length > 0
      ? mergeStructuredSupplementalSourceBlocks(structured)
      : extractOrderedSourceBlocks(buckets.ordered.join("\n"));
  return {
    raw,
    orderedBlocks,
    readableText: normalizeSourceTextForReading(buckets.text.join("\n")),
    tables:
      orderedBlocks.length > 0
        ? []
        : structured.tables.length > 0
          ? structured.tables
          : extractMarkdownTables(buckets.tables.length > 0 ? buckets.tables.join("\n") : raw),
    media:
      orderedBlocks.length > 0
        ? []
        : structured.media.length > 0
          ? structured.media
          : extractSourceMedia(buckets.media.length > 0 ? buckets.media.join("\n") : raw),
    captureNotes: [
      ...buckets.record.map((line) => line.trim()).filter((line) => line.length > 0),
      ...createExtractionReportNotes(extractionReport),
    ],
  };
}

function normalizeStructuredSourceSnapshot(value) {
  if (!value || typeof value !== "object") {
    return { blocks: [], tables: [], media: [] };
  }
  return {
    blocks: normalizeStructuredSourceBlocks(value.blocks),
    tables: normalizeStructuredSourceTables(value.tables),
    media: normalizeStructuredSourceMedia(value.media),
  };
}

function normalizeStructuredSourceBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") {
        return null;
      }
      if (block.kind === "heading") {
        const text = String(block.text ?? "").trim();
        return text.length === 0
          ? null
          : {
              kind: "heading",
              level: Number.isFinite(block.level) ? Math.max(1, Math.min(6, block.level)) : 3,
              text,
            };
      }
      if (block.kind === "text") {
        const text = normalizeSourceTextForReading(block.text ?? "");
        return text.length === 0 ? null : { kind: "text", text };
      }
      if (block.kind === "table") {
        const table = normalizeStructuredSourceTable(block.table ?? block);
        return table.rows.length === 0 ? null : { kind: "table", table };
      }
      if (block.kind === "media") {
        const media = normalizeStructuredSourceMediaItem(block.media ?? block);
        return media === null ? null : { kind: "media", media };
      }
      return null;
    })
    .filter((block) => block !== null);
}

function normalizeStructuredSourceTables(tables) {
  if (!Array.isArray(tables)) {
    return [];
  }
  return tables.map(normalizeStructuredSourceTable).filter((table) => table.rows.length > 0);
}

function normalizeStructuredSourceTable(table) {
  if (!table || typeof table !== "object" || !Array.isArray(table.rows)) {
    return { caption: "", rows: [] };
  }
  return {
    caption: String(table.caption ?? "").trim(),
    rows: table.rows
      .filter((row) => Array.isArray(row))
      .map((row) => row.map((cell) => String(cell ?? "").trim()))
      .filter((row) => row.some((cell) => cell.length > 0)),
  };
}

function normalizeStructuredSourceMedia(media) {
  if (!Array.isArray(media)) {
    return [];
  }
  return media.map(normalizeStructuredSourceMediaItem).filter((item) => item !== null);
}

function normalizeStructuredSourceMediaItem(item) {
  if (!item || typeof item !== "object" || typeof item.src !== "string" || item.src.length === 0) {
    return null;
  }
  return {
    kind: typeof item.kind === "string" ? item.kind : "media",
    label: String(item.alt || item.title || item.label || item.kind || "媒体").trim(),
    src: item.src,
    size: item.width && item.height ? `${item.width}x${item.height}` : "",
    poster: typeof item.poster === "string" ? item.poster : "",
  };
}

function mergeStructuredSupplementalSourceBlocks({ blocks, tables, media }) {
  const merged = [...blocks];
  const seenTables = new Set(
    merged.filter((block) => block.kind === "table").map((block) => JSON.stringify(block.table)),
  );
  const seenMedia = new Set(
    merged
      .filter((block) => block.kind === "media")
      .map((block) => `${block.media.kind}:${block.media.src}`),
  );
  for (const table of tables) {
    const signature = JSON.stringify(table);
    if (!seenTables.has(signature)) {
      seenTables.add(signature);
      merged.push({ kind: "table", table });
    }
  }
  for (const item of media) {
    const signature = `${item.kind}:${item.src}`;
    if (!seenMedia.has(signature)) {
      seenMedia.add(signature);
      merged.push({ kind: "media", media: item });
    }
  }
  return merged;
}

function createExtractionReportNotes(report) {
  if (!report || typeof report !== "object") {
    return [];
  }
  const notes = [
    report.status ? `提取状态：${report.status}` : null,
    typeof report.readableChars === "number" ? `可读正文：${report.readableChars} 字符` : null,
    typeof report.rawChars === "number" ? `原始内容：${report.rawChars} 字符` : null,
    Array.isArray(report.transformations) && report.transformations.length > 0
      ? `处理链路：${report.transformations.join(" -> ")}`
      : null,
    ...(Array.isArray(report.notes) ? report.notes.map((note) => `说明：${note}`) : []),
    ...(Array.isArray(report.unavailable)
      ? report.unavailable.map((item) => `未获取：${item}`)
      : []),
  ];
  return notes.filter((note) => typeof note === "string" && note.length > 0);
}

function splitSourceReaderBuckets(raw) {
  const buckets = {
    text: [],
    ordered: [],
    tables: [],
    media: [],
    record: [],
  };
  let current = "text";
  for (const line of raw.replace(/\r\n?/gu, "\n").split("\n")) {
    const marker = line.trim();
    if (/^##\s*页面内容(?:块)?\s*$/u.test(marker)) {
      current = "ordered";
      continue;
    }
    if (/^##\s*表格\s*$/u.test(marker)) {
      current = "tables";
      continue;
    }
    if (/^##\s*媒体资源\s*$/u.test(marker)) {
      current = "media";
      continue;
    }
    if (/^##\s*抓取记录\s*$/u.test(marker)) {
      current = "record";
      continue;
    }
    buckets[current].push(line);
  }
  return buckets;
}

function createSourceReaderStats(parsed) {
  const stats = document.createElement("div");
  stats.className = "asset-source-stats";
  const orderedText = parsed.orderedBlocks
    .filter((block) => block.kind === "text" || block.kind === "heading")
    .map((block) => block.text)
    .join("\n");
  const textLength = normalizeSourceTextForReading(orderedText || parsed.readableText).replace(
    /\s+/gu,
    "",
  ).length;
  const tableCount =
    parsed.orderedBlocks.filter((block) => block.kind === "table").length || parsed.tables.length;
  const mediaCount =
    parsed.orderedBlocks.filter((block) => block.kind === "media").length || parsed.media.length;
  stats.append(
    createSourceStat("正文", `${textLength} 字`),
    createSourceStat("表格", tableCount),
    createSourceStat("媒体", mediaCount),
  );
  return stats;
}

function createSourceStat(label, value) {
  const stat = document.createElement("span");
  stat.className = "asset-source-stat";
  stat.textContent = `${label} ${value}`;
  return stat;
}

function createSourceTextSection(text) {
  const section = createSourceSection("正文");
  const content = document.createElement("div");
  content.className = "asset-source-content";
  for (const line of createReadableSourceLines(text)) {
    if (line.length === 0) {
      continue;
    }
    if (isSourceHeadingLine(line)) {
      const heading = document.createElement("h5");
      heading.textContent = line;
      content.append(heading);
      continue;
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    content.append(paragraph);
  }
  section.append(content);
  return section;
}

function createSourceOrderedSection(blocks) {
  const section = createSourceSection("页面内容");
  const content = document.createElement("div");
  content.className = "asset-source-content asset-source-ordered";
  for (const block of blocks) {
    if (block.kind === "heading") {
      const heading = document.createElement("h5");
      heading.textContent = block.text;
      content.append(heading);
      continue;
    }
    if (block.kind === "text") {
      for (const line of createReadableSourceLines(block.text)) {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        content.append(paragraph);
      }
      continue;
    }
    if (block.kind === "media") {
      content.append(createSourceMediaCard(block.media));
      continue;
    }
    if (block.kind === "table") {
      const wrapper = document.createElement("div");
      wrapper.className = "asset-source-table-wrap";
      const caption = document.createElement("div");
      caption.className = "asset-source-table-caption";
      caption.textContent = block.table.caption || "表格";
      const table = createSourceTableNode(block.table);
      wrapper.append(caption, table);
      content.append(wrapper);
    }
  }
  section.append(content);
  return section;
}

function createSourceTableSection(tables) {
  const section = createSourceSection(`表格 ${tables.length}`);
  const stack = document.createElement("div");
  stack.className = "asset-source-table-stack";
  for (const [index, table] of tables.entries()) {
    const wrapper = document.createElement("div");
    wrapper.className = "asset-source-table-wrap";
    const caption = document.createElement("div");
    caption.className = "asset-source-table-caption";
    caption.textContent = table.caption || `表格 ${index + 1}`;
    wrapper.append(caption, createSourceTableNode(table));
    stack.append(wrapper);
  }
  section.append(stack);
  return section;
}

function createSourceTableNode(table) {
  const node = document.createElement("table");
  node.className = "asset-source-table";
  const [headerRow, ...bodyRows] = table.rows;
  if (headerRow) {
    const thead = document.createElement("thead");
    thead.append(createSourceTableRow(headerRow, "th"));
    node.append(thead);
  }
  const tbody = document.createElement("tbody");
  for (const row of bodyRows) {
    tbody.append(createSourceTableRow(row, "td"));
  }
  node.append(tbody);
  return node;
}

function createSourceTableRow(cells, tagName) {
  const row = document.createElement("tr");
  for (const cell of cells) {
    const node = document.createElement(tagName);
    node.textContent = cell;
    row.append(node);
  }
  return row;
}

function createSourceMediaSection(media) {
  const section = createSourceSection(`媒体 ${media.length}`);
  const grid = document.createElement("div");
  grid.className = "asset-media-grid";
  for (const item of media) {
    grid.append(createSourceMediaCard(item));
  }
  section.append(grid);
  return section;
}

function createSourceMediaCard(item) {
  const card = document.createElement("article");
  card.className = "asset-media-card";
  const preview = document.createElement("div");
  preview.className = "asset-media-preview";
  if (item.kind === "image" && isSafeRemoteAssetUrl(item.src)) {
    const image = document.createElement("img");
    image.loading = "lazy";
    image.src = item.src;
    image.alt = item.label || "抓取图片";
    preview.append(image);
  } else if (item.kind === "video" && isSafeRemoteAssetUrl(item.src)) {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.src = item.src;
    if (isSafeRemoteAssetUrl(item.poster)) {
      video.poster = item.poster;
    }
    preview.append(video);
  } else {
    const placeholder = document.createElement("span");
    placeholder.textContent = item.kind.toUpperCase();
    preview.append(placeholder);
  }
  const title = document.createElement("strong");
  title.textContent = item.label || item.kind;
  const link = document.createElement("a");
  link.href = item.src;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "打开源文件";
  const meta = document.createElement("small");
  meta.textContent = formatList([item.kind, item.size || null, item.poster ? "含封面" : null]);
  card.append(preview, title, meta, link);
  return card;
}

function createSourceNotesSection(notes) {
  const section = createSourceSection("抓取记录");
  const list = document.createElement("ul");
  list.className = "asset-source-notes";
  for (const note of notes) {
    const item = document.createElement("li");
    item.textContent = note.replace(/^-\s*/u, "");
    list.append(item);
  }
  section.append(list);
  return section;
}

function createSourceRawDetails(raw) {
  const details = document.createElement("details");
  details.className = "asset-source-raw";
  const summary = document.createElement("summary");
  summary.textContent = "查看原始抓取文本";
  const content = document.createElement("pre");
  content.textContent = raw || "无原始抓取文本。";
  details.append(summary, content);
  return details;
}

function createSourceSection(titleText) {
  const section = document.createElement("section");
  section.className = "asset-source-section";
  const title = document.createElement("h4");
  title.textContent = titleText;
  section.append(title);
  return section;
}

function extractOrderedSourceBlocks(value) {
  const lines = String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .split("\n");
  const blocks = [];
  const paragraph = [];
  const flushParagraph = () => {
    const text = normalizeSourceTextForReading(paragraph.join("\n"));
    paragraph.length = 0;
    if (text.length > 0) {
      blocks.push({ kind: "text", text });
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) {
      flushParagraph();
      continue;
    }
    const media = parseSourceMediaLine(line);
    if (media) {
      flushParagraph();
      blocks.push({ kind: "media", media });
      continue;
    }
    const captionMatch = /^###\s+(.+)$/u.exec(line);
    if (
      captionMatch &&
      isMarkdownTableRow(lines[index + 1] ?? "") &&
      isMarkdownTableDivider(lines[index + 2] ?? "")
    ) {
      flushParagraph();
      const rows = [parseMarkdownTableRow(lines[index + 1])];
      index += 3;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        rows.push(parseMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({
        kind: "table",
        table: {
          caption: captionMatch[1].replace(/^表格\s*\d+\s*[：:]?\s*/u, "").trim(),
          rows,
        },
      });
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      continue;
    }
    if (isMarkdownTableRow(line) && isMarkdownTableDivider(lines[index + 1] ?? "")) {
      flushParagraph();
      const rows = [parseMarkdownTableRow(line)];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        rows.push(parseMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "table", table: { caption: "", rows } });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function extractMarkdownTables(value) {
  const lines = String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .split("\n");
  const tables = [];
  let pendingCaption = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const captionMatch = /^###\s+(.+)$/u.exec(line);
    if (captionMatch) {
      pendingCaption = captionMatch[1].replace(/^表格\s*\d+\s*[：:]?\s*/u, "").trim();
      continue;
    }
    if (!isMarkdownTableRow(line) || !isMarkdownTableDivider(lines[index + 1] ?? "")) {
      continue;
    }
    const rows = [parseMarkdownTableRow(line)];
    index += 2;
    while (index < lines.length && isMarkdownTableRow(lines[index])) {
      rows.push(parseMarkdownTableRow(lines[index]));
      index += 1;
    }
    index -= 1;
    if (rows.length > 0) {
      tables.push({ caption: pendingCaption, rows });
    }
    pendingCaption = "";
  }
  return tables;
}

function extractSourceMedia(value) {
  const media = [];
  const seen = new Set();
  for (const line of String(value ?? "").split(/\r?\n/u)) {
    const item = parseSourceMediaLine(line.trim());
    if (!item || seen.has(`${item.kind}:${item.src}`)) {
      continue;
    }
    seen.add(`${item.kind}:${item.src}`);
    media.push(item);
  }
  return media;
}

function parseSourceMediaLine(line) {
  const imageMatch = /^(?:-\s*)?!\[([^\]]*)\]\(([^)]+)\)(?:\s+(\d+\s*x\s*\d+))?/iu.exec(line);
  if (imageMatch) {
    return {
      kind: "image",
      label: imageMatch[1].trim() || "抓取图片",
      src: imageMatch[2].trim(),
      size: normalizeMediaSize(imageMatch[3]),
      poster: "",
    };
  }
  const mediaMatch =
    /^(?:-\s*)?\[([^:\]]+):\s*([^\]]*)\]\(([^)]+)\)(?:\s+(\d+\s*x\s*\d+))?(?:\s+poster=(\S+))?/iu.exec(
      line,
    );
  if (!mediaMatch) {
    return null;
  }
  return {
    kind: mediaMatch[1].trim().toLowerCase(),
    label: mediaMatch[2].trim() || mediaMatch[1].trim(),
    src: mediaMatch[3].trim(),
    size: normalizeMediaSize(mediaMatch[4]),
    poster: mediaMatch[5]?.trim() ?? "",
  };
}

function normalizeMediaSize(value) {
  return value ? value.replace(/\s+/gu, "") : "";
}

function isMarkdownTableRow(line) {
  const value = String(line ?? "").trim();
  return value.startsWith("|") && value.endsWith("|") && value.includes("|");
}

function isMarkdownTableDivider(line) {
  const value = String(line ?? "").trim();
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(value);
}

function parseMarkdownTableRow(line) {
  return String(line ?? "")
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split(/\s*\|\s*/u)
    .map((cell) => cell.replace(/\\\|/gu, "|").trim());
}

function normalizeSourceTextForReading(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u200b|\u200c|\u200d|\ufeff/gu, "\n")
    .replace(/([^\n])([一二三四五六七八九十]+、)/gu, "$1\n\n$2")
    .replace(/([^\n])(\d+\.\s*)/gu, "$1\n$2")
    .replace(/([。！？；】])(?=\S)/gu, "$1\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function createReadableSourceLines(value) {
  return normalizeSourceTextForReading(value)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap(splitLongSourceLine);
}

function splitLongSourceLine(line) {
  if (line.length <= 260) {
    return [line];
  }
  return line
    .replace(/([，。；：！？])(?=\S)/gu, "$1\n")
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isSourceHeadingLine(line) {
  return /^(#{1,4}\s+|[一二三四五六七八九十]+、|\d+\.\s+.+(总览表|方式|角度|逻辑|构图|光影|风格|镜头|视角|系)$)/u.test(
    line,
  );
}

function isSafeRemoteAssetUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "data:";
  } catch {
    return false;
  }
}

function renderSettingsSurface() {
  const settings = state.snapshot?.assets?.settings;
  const providers = settings?.apiProviders ?? [];
  state.selectedApiProviderId = providers.some(
    (provider) => provider.id === state.selectedApiProviderId,
  )
    ? state.selectedApiProviderId
    : (providers[0]?.id ?? null);

  elements.commandList.replaceChildren();
  elements.commandList.className = "settings-page";

  const header = document.createElement("div");
  header.className = "settings-page-header";
  const copy = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "SETTINGS";
  const title = document.createElement("h2");
  title.textContent = "设置";
  const description = document.createElement("p");
  description.textContent =
    "集中管理 API、模型绑定、功能开关、路径和诊断；所有可写项都直接保存到本机后端配置。";
  copy.append(eyebrow, title, description);
  const backButton = document.createElement("button");
  backButton.className = "secondary-button";
  backButton.type = "button";
  backButton.textContent = "返回工作台";
  backButton.addEventListener("click", () => {
    selectGroup("workbench");
  });
  header.append(copy, backButton);

  const tabs = document.createElement("div");
  tabs.className = "settings-tabs";
  for (const tab of SETTINGS_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `settings-tab${state.selectedSettingsTab === tab.id ? " active" : ""}`;
    button.textContent = tab.label;
    button.addEventListener("click", () => {
      state.selectedSettingsTab = tab.id;
      markCommandBoardScrollResetForSurface(resolveCommandBoardSurfaceKey(getActiveWorkflow()));
      renderSettingsSurface();
      resetCommandBoardScrollIfNeeded();
    });
    tabs.append(button);
  }

  const panel = document.createElement("section");
  panel.className = "settings-panel";
  if (!settings) {
    panel.append(createSettingsEmptyState("等待后端 settings snapshot 返回。"));
  } else if (state.selectedSettingsTab === "api") {
    renderSettingsApiTab(panel, settings);
  } else if (state.selectedSettingsTab === "models") {
    renderSettingsModelBindingTab(panel, settings);
  } else if (state.selectedSettingsTab === "externalTools") {
    renderSettingsExternalToolsTab(panel, settings);
  } else if (state.selectedSettingsTab === "guardrails") {
    renderSettingsGuardrailsTab(panel, settings);
  } else if (state.selectedSettingsTab === "communications") {
    renderSettingsCommunicationTab(panel, settings);
  } else if (state.selectedSettingsTab === "switches") {
    renderSettingsSwitchesTab(panel, settings);
  } else if (state.selectedSettingsTab === "paths") {
    renderSettingsPathsTab(panel, settings);
  } else {
    renderSettingsDiagnosticsTab(panel, settings);
  }

  elements.commandList.append(header, tabs, panel);
}

function renderSettingsApiTab(container, settings) {
  const providers = settings.apiProviders ?? [];
  const provider = findSettingsProvider(providers);
  if (!provider) {
    container.append(createSettingsEmptyState("当前没有 API 供应方。"));
    return;
  }

  const form = document.createElement("div");
  form.className = "settings-form";
  form.append(
    createProviderSelectRow(providers, provider),
    createApiKeyRow("API Key", "api-key", provider.apiKeyConfigured),
    createInputRow("Base URL", "base-url", provider.baseUrl, "https://api.example.com"),
    createTextareaRow(
      "模型清单",
      "models",
      provider.models.join("\n"),
      "每行一个模型，或用逗号分隔",
    ),
    createDefaultModelRow(provider),
    createEndpointTable(provider),
  );

  const footer = createSettingsFooter({
    hint: `设置将保存到本机 ${settings.apiProviderConfigPath ?? ".director-angel/providers/providers.json"}；密钥不会明文显示。`,
    primaryLabel: "保存设置",
    secondaryLabel: "测试 Key",
    onSecondary: async () => {
      await testApiProviderSettings(provider, readApiProviderFormValue(form, provider));
    },
    tertiaryLabel: "同步模型池",
    onTertiary: async () => {
      await syncApiProviderModels(provider, readApiProviderFormValue(form, provider));
    },
    onPrimary: async () => {
      await saveApiProviderSettings(provider, readApiProviderFormValue(form, provider));
    },
  });

  container.append(createRecommendedPurchasePanel(provider), form, footer);
}

function createRecommendedPurchasePanel(provider) {
  const section = document.createElement("section");
  section.className = "settings-tool-panel settings-recommended-purchase-panel";

  const header = document.createElement("div");
  header.className = "settings-tool-panel-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "推荐开通入口";
  const copy = document.createElement("p");
  copy.textContent =
    "需要购买额度或开通 API Key 时，可从 memefast.top 进入；Director Angel 只打开外部页面，支付与账号授权由用户在外部平台完成。";
  titleWrap.append(title, copy);

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "primary-button";
  openButton.textContent = "打开 memefast.top";
  openButton.addEventListener("click", async () => {
    await openRecommendedPurchase(provider);
  });
  header.append(titleWrap, openButton);

  const detail = document.createElement("div");
  detail.className = "settings-recommended-purchase-detail";
  detail.append(
    createReadonlyRow("推荐链接", MEMEFAST_RECOMMENDED_PURCHASE_URL),
    createReadonlyRow("本机边界", "只保存 API Provider 配置，不读取、不代存外部平台支付信息。"),
  );

  section.append(header, detail);
  return section;
}

function renderSettingsModelBindingTab(container, settings) {
  const providers = settings.apiProviders ?? [];
  const provider = findSettingsProvider(providers);
  if (!provider) {
    container.append(createSettingsEmptyState("当前没有可绑定模型的 API 供应方。"));
    return;
  }

  const form = document.createElement("div");
  form.className = "settings-form";
  form.append(createProviderSelectRow(providers, provider), createDefaultModelRow(provider));

  const help = document.createElement("div");
  help.className = "settings-inline-note";
  help.textContent =
    "这里对应 Director Angel 当前真实可用的模型绑定：文本、视觉、图片、视频。后续接入更多制作平台时会继续扩展到更细的任务绑定。";

  const footer = createSettingsFooter({
    hint: "模型绑定保存后，运行时会按这些默认模型路由对应能力。",
    primaryLabel: "保存模型绑定",
    onPrimary: async () => {
      await saveApiProviderSettings(provider, {
        enabled: readProviderEnabled(form, provider),
        baseUrl: provider.baseUrl,
        apiKey: "",
        models: provider.models.join("\n"),
        defaultTextModel: form.querySelector("[data-field='defaultTextModel']").value,
        defaultVisionModel: form.querySelector("[data-field='defaultVisionModel']").value,
        defaultImageModel: form.querySelector("[data-field='defaultImageModel']").value,
        defaultVideoModel: form.querySelector("[data-field='defaultVideoModel']").value,
      });
    },
  });

  container.append(help, form, footer);
}

function renderSettingsExternalToolsTab(container, settings) {
  const comfyUi = settings.externalTools?.comfyUi ?? null;
  const mcp = settings.externalTools?.mcp ?? settings.mcp ?? null;
  const externalToolBus = state.snapshot?.assets?.tools?.externalToolBus ?? null;
  const stack = document.createElement("div");
  stack.className = "settings-external-tool-stack";
  stack.append(createSettingsExternalToolBusPanel(externalToolBus));
  stack.append(createExternalToolSetupGuidancePanel(externalToolBus, settings));
  stack.append(createExternalProviderAuthSettingsPanel(settings, externalToolBus));
  stack.append(createBrowserProviderSettingsPanel(externalToolBus));
  if (comfyUi) {
    stack.append(createComfyUiSettingsPanel(settings, comfyUi));
  }
  stack.append(createMcpSettingsPanel(mcp));
  if (!comfyUi && !mcp) {
    stack.append(createSettingsEmptyState("当前没有外部工具配置。"));
  }
  container.append(stack);
}

function createSettingsExternalToolBusPanel(externalToolBus) {
  const section = document.createElement("section");
  section.className = "settings-tool-panel settings-external-tool-bus-panel";
  const header = document.createElement("div");
  header.className = "settings-tool-panel-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "外部工具总线";
  const copy = document.createElement("p");
  copy.textContent =
    "Catalog / Effective / Doctor：这里显示当前运行时真正能看到、能调用、或需要修复的外部工具。";
  titleWrap.append(title, copy);
  header.append(titleWrap);

  if (!externalToolBus) {
    section.append(header, createSettingsEmptyState("暂无外部工具总线快照；请刷新桌面状态。"));
    return section;
  }

  const grid = document.createElement("div");
  grid.className = "settings-diagnostics";
  const health = summarizeExternalToolBusHealth(externalToolBus);
  grid.append(
    createMetricBlock("Catalog", externalToolBus.catalogCount ?? 0),
    createMetricBlock("Effective", externalToolBus.effectiveCount ?? 0),
    createMetricBlock("可调用", health.readyCount),
    createMetricBlock("Unavailable", externalToolBus.unavailableCount ?? 0),
    createMetricBlock("需登录", health.needsAuthCount),
    createMetricBlock("故障", health.problemCount),
    createMetricBlock("最近可用", health.lastKnownGoodCount),
    createMetricBlock("Executing", externalToolBus.activeExecutionCount ?? 0),
    createMetricBlock("Ledger", externalToolBus.processCapabilityLedger?.totalEntries ?? 0),
    createMetricBlock("Host", externalToolBus.processCapabilityLedger?.riskyHostEntries ?? 0),
    createMetricBlock("Schema", externalToolBus.schemaVersion ?? "unknown"),
  );

  const readonly = document.createElement("div");
  readonly.className = "settings-readonly-table";
  for (const item of externalToolBus.items ?? []) {
    const policyText = `${formatExternalToolSourceTrust(item.sourceTrust)} · ${formatExternalToolInstallPolicy(
      item.installPolicy,
    )}`;
    readonly.append(
      createReadonlyRow(
        item.label ?? item.id,
        `${formatExternalToolBusStatus(item.status, item.canInvoke)} · ${
          item.doctor?.summary ?? "未返回 doctor 诊断"
        } · ${formatExternalToolLastKnownGood(item.lastKnownGood)} · ${policyText}`,
      ),
    );
  }

  section.append(
    header,
    grid,
    createExternalToolProviderMatrixPanel(externalToolBus),
    createAgentOsExtensionControlPlanePanel(externalToolBus, { surface: "settings" }),
    readonly,
    createSettingsExternalToolExecutionTable(externalToolBus),
    createExternalToolProcessLedger(externalToolBus),
  );
  return section;
}

function createExternalToolSetupGuidancePanel(externalToolBus, settings) {
  const section = document.createElement("section");
  section.className = "settings-tool-panel settings-provider-setup-guidance";
  const header = document.createElement("div");
  header.className = "settings-tool-panel-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Provider setup guidance";
  const copy = document.createElement("p");
  copy.textContent =
    "把 needs-auth、安装计划、重连和 last-known-good 状态收束成可执行步骤；不绕过 SecretRef/Keychain policy。";
  titleWrap.append(title, copy);
  header.append(titleWrap);

  const boundary = document.createElement("p");
  boundary.className = "settings-provider-secret-boundary";
  boundary.textContent = "SecretRef/Keychain 只显示引用状态，不读取或展示密钥值。";

  if (!externalToolBus) {
    section.append(header, boundary, createSettingsEmptyState("暂无外部工具总线快照；请刷新桌面状态。"));
    return section;
  }

  const guidanceItems = resolveExternalToolSetupGuidance(externalToolBus, settings);
  if (guidanceItems.length === 0) {
    section.append(header, boundary, createSettingsEmptyState("当前没有需要处理的外部工具 setup guidance。"));
    return section;
  }

  const grid = document.createElement("div");
  grid.className = "settings-provider-setup-guidance-grid";
  for (const guidance of guidanceItems.slice(0, 10)) {
    grid.append(createExternalToolSetupGuidanceItem(guidance));
  }
  section.append(header, boundary, grid);
  return section;
}

function createExternalToolSetupGuidanceItem(guidance) {
  const item = document.createElement("div");
  item.className = "settings-provider-setup-guidance-item";
  item.dataset.state = guidance.state;

  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${guidance.label} · ${guidance.toolLabel}`;
  const summary = document.createElement("small");
  summary.textContent = guidance.summary;
  const detail = document.createElement("p");
  detail.textContent = guidance.detail;
  body.append(title, summary, detail);

  const action = document.createElement("button");
  action.type = "button";
  action.className = guidance.tone === "primary" ? "primary-button" : "secondary-button";
  action.textContent = guidance.actionLabel;
  action.addEventListener("click", async () => {
    await runExternalToolSetupGuidanceAction(guidance);
  });

  item.append(body, action);
  return item;
}

function resolveExternalToolSetupGuidance(externalToolBus, settings) {
  const guidance = [];
  const providerById = new Map(
    (settings?.externalTools?.providers ?? []).map((provider) => [provider.id, provider]),
  );
  const addGuidance = (item, state, label, summary, detail, actionLabel, tone = "secondary") => {
    const id = `${item.id}:${state}`;
    if (guidance.some((entry) => entry.id === id)) {
      return;
    }
    guidance.push({
      id,
      toolId: item.id,
      toolLabel: item.label ?? item.id,
      state,
      label,
      summary,
      detail,
      actionLabel,
      tone,
    });
  };

  for (const item of externalToolBus?.items ?? []) {
    const providerId = item.providerId ?? item.id?.replace(/^provider:/u, "");
    const provider = providerById.get(providerId) ?? item.providerStatus ?? {};
    const status = provider.status ?? item.providerStatus?.status ?? item.status;
    const secretSource = formatExternalProviderSecretSource(provider);
    const nextActions = formatList([
      ...(provider.nextActions ?? []),
      ...(item.doctor?.nextActions ?? []),
    ]);
    if (status === "needs-auth") {
      addGuidance(
        item,
        "needs-auth",
        "需要授权",
        provider.summary ?? item.doctor?.summary ?? "Provider 需要授权后才能进入运行时。",
        `凭证来源：${secretSource}。下一步：${nextActions || "在下方表单配置 SecretRef、Keychain/OAuth 或环境变量引用。"}`,
        item.source === "mcp" ? "登录/刷新" : "填写授权",
        "primary",
      );
    }
    if (status === "missing" || status === "needs-setup") {
      addGuidance(
        item,
        "install",
        "安装计划",
        item.doctor?.summary ?? "外部工具需要先完成安装或 setup。",
        `${formatExternalToolInstallPolicy(item.installPolicy)}。执行前仍需要 operator 明确确认，不会静默安装。`,
        "查看计划",
      );
    }
    if (
      status === "disabled" ||
      status === "failed" ||
      status === "unreachable" ||
      status === "pending" ||
      item.metadata?.connected === false
    ) {
      addGuidance(
        item,
        "reconnect",
        "重连",
        item.doctor?.summary ?? "外部工具当前不可调用，可以先重连或重新启用。",
        `最近诊断：${formatExternalProviderDiagnostics(provider)}。重连只调用已有 manage enable 动作，不读取凭据。`,
        "重连",
      );
    }
    if (item.lastKnownGood) {
      addGuidance(
        item,
        "last-known-good",
        "最近可用",
        formatExternalToolLastKnownGood(item.lastKnownGood),
        `上次可用结果仅作为恢复参考：${item.lastKnownGood.summary ?? "无额外摘要"}。`,
        "查看状态",
      );
    }
  }
  return guidance;
}

function createExternalProviderAuthSettingsPanel(settings, externalToolBus) {
  const providers = settings.externalTools?.providers ?? [];
  const providerTools = (externalToolBus?.items ?? []).filter((item) => item.id?.startsWith("provider:"));
  const section = document.createElement("section");
  section.className = "settings-tool-panel settings-provider-auth-panel";
  const header = document.createElement("div");
  header.className = "settings-tool-panel-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "外部 API Provider";
  const copy = document.createElement("p");
  copy.textContent =
    "外部工具的 API Key、SecretRef、状态诊断统一在这里管理；运行时只读取有效 provider，不在代码里硬写密钥。";
  titleWrap.append(title, copy);
  header.append(titleWrap);

  if (providers.length === 0 && providerTools.length === 0) {
    section.append(header, createSettingsEmptyState("当前没有外部 API provider manifest。"));
    return section;
  }

  const rows = document.createElement("div");
  rows.className = "settings-provider-auth-list";
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  for (const item of providerTools) {
    const providerId = item.providerId ?? item.id.replace(/^provider:/u, "");
    const provider = byId.get(providerId) ?? item.providerStatus ?? {
      id: providerId,
      label: item.label ?? providerId,
      status: item.status,
      summary: item.doctor?.summary ?? "",
      configuredSecret: item.metadata?.configuredSecret === true,
      configFields: item.configFields ?? [],
    };
    rows.append(createExternalProviderAuthRow(settings, item, provider));
  }
  section.append(header, rows);
  return section;
}

function createExternalProviderAuthRow(settings, item, provider) {
  const card = document.createElement("div");
  card.className = "settings-provider-auth-row";
  const head = document.createElement("div");
  head.className = "settings-provider-auth-head";
  const title = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = provider.label ?? item.label ?? provider.id;
  const meta = document.createElement("small");
  meta.textContent = [
    provider.id ?? item.providerId,
    formatExternalToolBusStatus(provider.status ?? item.status, item.canInvoke),
    provider.configuredSecret ? "Key 已配置" : "Key 未配置",
  ]
    .filter(Boolean)
    .join(" · ");
  title.append(name, meta);
  const controls = document.createElement("div");
  controls.className = "settings-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = provider.enabled === false ? "primary-button" : "secondary-button";
  toggle.textContent = provider.enabled === false ? "启用" : "停用";
  toggle.addEventListener("click", async () => {
    await manageExternalProvider(item.id, provider.enabled === false ? "enable" : "disable");
  });
  controls.append(toggle);
  head.append(title, controls);

  const form = document.createElement("div");
  form.className = "settings-form settings-provider-auth-form";
  const fields = provider.configFields ?? item.configFields ?? [];
  for (const field of fields) {
    if (field.key === "enabled") {
      continue;
    }
    form.append(
      field.kind === "secret"
        ? createApiKeyRow(field.label, `provider-${provider.id}-${field.key}`, provider.configuredSecret)
        : createInputRow(field.label, `provider-${provider.id}-${field.key}`, "", field.placeholder ?? ""),
    );
  }

  const readonly = document.createElement("div");
  readonly.className = "settings-readonly-table";
  readonly.append(
    createReadonlyRow("状态", provider.summary ?? item.doctor?.summary ?? "未返回"),
    createReadonlyRow("配置文件", settings.externalTools?.providerAuthConfigPath ?? "external-tools/providers.json"),
    createReadonlyRow("凭证来源", formatExternalProviderSecretSource(provider)),
    createReadonlyRow("生效面", provider.activeSurface === false ? "未生效：停用后不解析密钥" : "生效中"),
    createReadonlyRow("诊断", formatExternalProviderDiagnostics(provider)),
    createReadonlyRow("下一步", formatExternalProviderNextActions(provider)),
    createReadonlyRow("能力", (provider.capabilities ?? item.capabilities?.map((capability) => capability.id) ?? []).join(", ") || "无"),
  );
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary-button";
  save.textContent = "保存 Provider";
  save.addEventListener("click", async () => {
    await saveExternalProviderSettings(item.id, provider, form);
  });
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "secondary-button danger";
  reset.textContent = "重置";
  reset.addEventListener("click", async () => {
    await manageExternalProvider(item.id, "delete");
  });
  actions.append(save, reset);

  const boundary = document.createElement("p");
  boundary.className = "settings-provider-secret-boundary";
  boundary.textContent = "SecretRef/Keychain 只显示引用状态，不读取或展示密钥值。";

  card.append(head, form, readonly, boundary, actions);
  return card;
}

function createBrowserProviderSettingsPanel(externalToolBus) {
  const browser = (externalToolBus?.items ?? []).find((item) => item.id === "browser") ?? null;
  const section = document.createElement("section");
  section.className = "settings-tool-panel settings-browser-provider-panel settings-browser-function-console";
  const header = document.createElement("div");
  header.className = "settings-tool-panel-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "Browser 功能台";
  const copy = document.createElement("p");
  copy.textContent =
    "浏览器是共享外部工具运行时；这里按参考仓库的 Chrome 状态页、profile 边界和安全审计口径显示真实可用状态。";
  titleWrap.append(title, copy);
  header.append(titleWrap);

  if (!browser) {
    section.append(
      header,
      createSettingsEmptyState("当前运行时没有返回 Browser provider；客户端不能假装已经打开浏览器。"),
      createBrowserProviderGuidancePanel(browser),
    );
    return section;
  }

  const metadata = browser.metadata ?? {};
  const sessions = Array.isArray(metadata.sessions) ? metadata.sessions : [];
  const angelProfile = readBrowserProviderAngelProfile(browser);
  const userProfile = readBrowserProviderUserProfile(browser);
  const angelState = formatBrowserAngelProfileState(angelProfile);
  const chromeState = formatBrowserChromeProfileState(userProfile);
  const cdpState = formatBrowserCdpReadiness(userProfile);
  const grid = document.createElement("div");
  grid.className = "settings-diagnostics";
  grid.append(
    createMetricBlock("状态", metadata.connected === false ? "断开" : browser.status ?? "ready"),
    createMetricBlock("会话", metadata.sessionCount ?? sessions.length),
    createMetricBlock("Angel Chrome", angelState),
    createMetricBlock("Chrome 登录态", chromeState),
    createMetricBlock("CDP", cdpState),
    createMetricBlock("实现", metadata.implementation ?? "provider"),
    createMetricBlock("私网", metadata.allowPrivateUrls === true ? "允许" : "拦截"),
  );

  const readonly = document.createElement("div");
  readonly.className = "settings-readonly-table";
  readonly.append(
    createReadonlyRow("Provider", `${browser.label ?? "Browser"} · ${browser.id}`),
    createReadonlyRow("Doctor", browser.doctor?.summary ?? "未返回"),
    createReadonlyRow("边界", browser.approvalBoundary?.summary ?? "runtime policy"),
    createReadonlyRow("支持 profile", formatList(metadata.supported_profiles ?? ["angel", "user"])),
  );
  if (sessions.length === 0) {
    readonly.append(createReadonlyRow("会话", "暂无浏览器会话"));
  } else {
    for (const session of sessions.slice(0, 6)) {
      readonly.append(
        createReadonlyRow(
          session.sessionKey ?? session.id ?? "browser-session",
          `${session.title ?? ""} ${session.url ?? ""}`.trim() || "空白页",
        ),
      );
    }
  }

  section.append(
    header,
    grid,
    createBrowserProviderProfileMatrix(browser),
    createBrowserProviderSecurityAuditPanel(browser),
    readonly,
    createBrowserProviderGuidancePanel(browser),
    createBrowserProviderActionBar(browser, metadata),
  );
  return section;
}

function readBrowserProviderAngelProfile(browser) {
  const provider = browser?.metadata?.providers?.angel;
  return provider && typeof provider === "object" ? provider : null;
}

function readBrowserProviderUserProfile(browser) {
  const provider = browser?.metadata?.providers?.user;
  return provider && typeof provider === "object" ? provider : null;
}

function formatBrowserAngelProfileState(provider) {
  if (!provider) {
    return "Angel Chrome 未返回";
  }
  const status = String(provider.status ?? (provider.connected === false ? "disconnected" : "unknown"));
  if (provider.connected === true && (status === "connected" || status === "configured")) {
    return "Angel Chrome 已连接";
  }
  if (status === "launching") {
    return "Angel Chrome 正在启动";
  }
  if (status === "unavailable") {
    return "Angel Chrome 未启动";
  }
  if (status === "disconnected") {
    return "Angel Chrome 已断开";
  }
  return "Angel Chrome 未连上";
}

function formatBrowserChromeProfileState(provider) {
  if (!provider) {
    return "真实 Chrome 登录态未返回";
  }
  const status = String(provider.status ?? (provider.connected === false ? "disconnected" : "unknown"));
  if (provider.connected === true && status === "connected") {
    return "真实 Chrome 登录态已连接";
  }
  if (provider.connected === true && status === "configured") {
    return "真实 Chrome 登录态已配置但未验证";
  }
  if (status === "unavailable") {
    return "真实 Chrome 登录态不可用";
  }
  return "真实 Chrome 登录态未连上";
}

function formatBrowserCdpReadiness(provider) {
  const cdpControl = provider?.cdp_control;
  if (!cdpControl || typeof cdpControl !== "object") {
    return "CDP 未就绪";
  }
  return cdpControl.cdp_ready === true ? "CDP 已就绪" : "CDP 未就绪";
}

function createBrowserProviderProfileMatrix(browser) {
  const metadata = browser?.metadata ?? {};
  const angelProfile = readBrowserProviderAngelProfile(browser);
  const angelCapabilities = angelProfile?.capabilities ?? {};
  const angelSecurity = angelProfile?.security ?? {};
  const userProfile = readBrowserProviderUserProfile(browser);
  const userCapabilities = userProfile?.capabilities ?? {};
  const userSecurity = userProfile?.security ?? {};
  const matrix = document.createElement("div");
  matrix.className = "browser-profile-matrix";
  const profiles = [
    {
      name: "内置浏览器",
      state: metadata.connected === false ? "断开" : "可用",
      purpose: "公开网页读取、普通联网问答、无需登录态页面。",
      boundary: "不共享你的 Chrome 登录态；不要用内置浏览器冒充真实 Chrome。",
    },
    {
      name: "Angel 专用 Chrome",
      state: formatBrowserAngelProfileState(angelProfile),
      purpose: "动态站点、X/Twitter 搜索、长期学习和后续自动化默认走这里。",
      boundary: `${formatBrowserCdpReadiness(angelProfile)}；独立 profile: ${
        angelCapabilities.supports_managed_launch === true ? "可自动启动" : "未声明"
      }；remote CDP: ${angelSecurity.remote_cdp_allowed === true ? "允许" : "禁止"}`,
    },
    {
      name: "真实 Chrome 登录态",
      state: formatBrowserChromeProfileState(userProfile),
      purpose: "用户明确说 Chrome/谷歌浏览器/用我的浏览器读取时才启用。",
      boundary: `${formatBrowserCdpReadiness(userProfile)}；capability: ${
        userCapabilities.supports_existing_session === true ? "existing-session" : "未声明"
      }；remote CDP: ${userSecurity.remote_cdp_allowed === true ? "允许" : "禁止"}`,
    },
  ];
  for (const profile of profiles) {
    const row = document.createElement("div");
    row.className = "browser-profile-row";
    const title = document.createElement("strong");
    title.textContent = profile.name;
    const state = document.createElement("span");
    state.textContent = profile.state;
    const purpose = document.createElement("small");
    purpose.textContent = profile.purpose;
    const boundary = document.createElement("p");
    boundary.textContent = profile.boundary;
    row.append(title, state, purpose, boundary);
    matrix.append(row);
  }
  return matrix;
}

function createBrowserProviderSecurityAuditPanel(browser) {
  const metadata = browser?.metadata ?? {};
  const angelProfile = readBrowserProviderAngelProfile(browser);
  const userProfile = readBrowserProviderUserProfile(browser);
  const security = userProfile?.security ?? {};
  const capabilities = userProfile?.capabilities ?? {};
  const cdpControl = userProfile?.cdp_control ?? {};
  const warnings = Array.isArray(security.warnings) ? security.warnings : [];
  const panel = document.createElement("div");
  panel.className = "browser-security-audit-panel";
  const title = document.createElement("strong");
  title.textContent = "安全审计";
  const rows = document.createElement("div");
  rows.className = "settings-readonly-table";
  rows.append(
    createReadonlyRow("远程 CDP 默认禁止", security.remote_cdp_allowed === true ? "已显式允许" : "已禁止"),
    createReadonlyRow("Site-level permissions", "由 Chrome / 扩展 / 用户会话权限控制，Director Angel 只显示边界"),
    createReadonlyRow(
      "Angel profile",
      angelProfile?.capabilities?.supports_managed_launch === true ? "独立 profile，可启动" : "未验证",
    ),
    createReadonlyRow(
      "persistent profile mutation",
      capabilities.supports_persistent_profile_mutation === true ? "允许" : "禁止",
    ),
    createReadonlyRow("私网 URL", metadata.allowPrivateUrls === true ? "allowPrivateUrls=true" : "allowPrivateUrls=false"),
    createReadonlyRow("CDP target", cdpControl.target_count ?? "未知"),
    createReadonlyRow("安全提示", warnings.length > 0 ? warnings.slice(0, 3).join("；") : "无"),
  );
  panel.append(title, rows);
  return panel;
}

function createBrowserProviderGuidancePanel(browser) {
  const guidance = document.createElement("div");
  guidance.className = "browser-provider-guidance";
  const title = document.createElement("strong");
  title.textContent = "参考 Claude Code / OpenClaw / Hermes";
  const copy = document.createElement("p");
  copy.textContent =
    "Claude Code 把 Chrome 做成显式状态页和权限入口；OpenClaw 把 profile、CDP、安全审计分开；Hermes 把 browser 作为统一 toolset 和 session 生命周期管理。落到 Angel，就是能说清当前能不能读、用哪个 profile 读、失败时不要假装已经用你的 Chrome 登录态读到了。";
  guidance.append(title, copy);
  return guidance;
}

function createBrowserProviderActionBar(browser, metadata) {
  const bar = document.createElement("div");
  bar.className = "browser-provider-action-bar";
  const hint = document.createElement("small");
  hint.textContent = "默认动态站点走 Angel Chrome；真实 Chrome 只在你明确要求时走 profile=user，连不上就直接说明。";
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = metadata.connected === false ? "primary-button" : "secondary-button";
  toggle.textContent = metadata.connected === false ? "连接 Browser" : "断开 Browser";
  toggle.addEventListener("click", async () => {
    await manageBrowserProvider(metadata.connected === false ? "enable" : "disable");
  });
  const angel = document.createElement("button");
  angel.type = "button";
  angel.className = "primary-button";
  angel.textContent = "启动 Angel Chrome";
  angel.addEventListener("click", async () => {
    await manageBrowserProvider("enable", { profile: "angel" });
  });
  const chrome = document.createElement("button");
  chrome.type = "button";
  chrome.className = "secondary-button";
  chrome.textContent = "连接真实 Chrome";
  chrome.addEventListener("click", async () => {
    await manageBrowserProvider("enable", { profile: "user" });
  });
  const cleanup = document.createElement("button");
  cleanup.type = "button";
  cleanup.className = "secondary-button";
  cleanup.textContent = "清理会话";
  cleanup.addEventListener("click", async () => {
    await manageBrowserProvider("delete");
  });
  actions.append(toggle, angel, chrome, cleanup);
  bar.append(hint, actions);
  return bar;
}

function createSettingsExternalToolExecutionTable(externalToolBus) {
  const history = externalToolBus?.history ?? [];
  const table = document.createElement("div");
  table.className = "settings-readonly-table settings-external-tool-history";
  if (history.length === 0) {
    table.append(createReadonlyRow("执行历史", "暂无外部工具执行记录"));
    return table;
  }
  for (const execution of history.slice(0, 5)) {
    table.append(
      createReadonlyRow(
        `${execution.toolId} · ${execution.operationId ?? "default"}`,
        `${formatExternalToolExecutionStatus(execution.status)} · ${execution.summary ?? ""}`,
      ),
    );
  }
  return table;
}

function createComfyUiSettingsPanel(settings, comfyUi) {
  const section = document.createElement("section");
  section.className = "settings-tool-panel settings-comfyui-panel";
  const title = document.createElement("h3");
  title.textContent = "ComfyUI";
  const form = createComfyUiSettingsForm(comfyUi);
  const readonly = document.createElement("div");
  readonly.className = "settings-readonly-table";
  readonly.append(
    createReadonlyRow("Adapter", `${comfyUi.name} · ${comfyUi.id}`),
    createReadonlyRow("支持模式", (comfyUi.supportedModes ?? []).join(" / ")),
    createReadonlyRow("配置文件", settings.externalTools?.comfyUiConfigPath ?? "external-tools/comfyui.json"),
    createReadonlyRow(
      "POST 路径",
      (comfyUi.endpoints ?? [])
        .filter((endpoint) => endpoint.method === "POST")
        .map((endpoint) => endpoint.path)
        .join(", ") || "未返回",
    ),
  );
  const footer = createSettingsFooter({
    hint: "ComfyUI 是外部工具；这里只保存连接和 workflow 配置，未配置 workflow 时不会伪造生成结果。",
    primaryLabel: "保存 ComfyUI",
    secondaryLabel: "测试连接",
    onSecondary: async () => {
      await testComfyUiSettings(readComfyUiFormValue(form));
    },
    onPrimary: async () => {
      await saveComfyUiSettings(comfyUi, readComfyUiFormValue(form));
    },
  });

  section.append(title, form, readonly, footer);
  return section;
}

function createComfyUiSettingsForm(comfyUi) {
  const form = document.createElement("div");
  form.className = "settings-form";
  form.append(
    createComfyUiEnabledRow(comfyUi),
    createComfyUiModeRow(comfyUi),
    createInputRow("Base URL", "base-url", comfyUi.baseUrl, "http://127.0.0.1:8188"),
    createApiKeyRow("API Key", "api-key", comfyUi.apiKeyConfigured),
    createInputRow("ComfyUI Workflow 文件", "workflow-path", comfyUi.defaultWorkflowPath, "/path/to/workflow.json"),
    createInputRow("输出目录", "output-dir", comfyUi.outputDir, "/path/to/outputs"),
    createInputRow("正向提示词节点", "positive-node-id", comfyUi.positivePromptNodeId, "留空自动寻找"),
    createInputRow("正向提示词输入名", "positive-input-name", comfyUi.positivePromptInputName, "text"),
  );
  return form;
}

function createComfyUiEnabledRow(comfyUi) {
  const row = createSettingsRow("ComfyUI 启用");
  const label = document.createElement("label");
  label.className = "settings-check-inline";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.field = "comfyui-enabled";
  checkbox.checked = comfyUi.enabled === true;
  const copy = document.createElement("span");
  const renderCopy = () => {
    copy.textContent = checkbox.checked ? "已启用，可用 /comfyui 运行" : "已停用，只保留配置";
  };
  checkbox.addEventListener("change", renderCopy);
  renderCopy();
  label.append(checkbox, copy);
  row.append(label);
  return row;
}

function createComfyUiModeRow(comfyUi) {
  const row = createSettingsRow("运行模式");
  const select = document.createElement("select");
  select.dataset.field = "mode";
  for (const [value, labelText] of [
    ["local", "本机 ComfyUI"],
    ["cloud", "Comfy Cloud"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelText;
    select.append(option);
  }
  select.value = comfyUi.mode ?? "local";
  row.append(select);
  return row;
}

function readComfyUiFormValue(form) {
  const apiKeyField = form.querySelector("[data-field='api-key']");
  const apiKey = normalizeApiKeyList(apiKeyField?.value ?? "");
  if (apiKeyField) {
    apiKeyField.value = apiKey;
    resizeApiKeyTextarea(apiKeyField);
  }
  const fieldValue = (fieldName, fallback = "") =>
    form.querySelector(`[data-field='${fieldName}']`)?.value ?? fallback;
  return {
    enabled: form.querySelector("[data-field='comfyui-enabled']")?.checked === true,
    mode: fieldValue("mode", "local"),
    baseUrl: fieldValue("base-url", ""),
    apiKey,
    defaultWorkflowPath: fieldValue("workflow-path", ""),
    outputDir: fieldValue("output-dir", ""),
    positivePromptNodeId: fieldValue("positive-node-id", ""),
    positivePromptInputName: fieldValue("positive-input-name", "text"),
  };
}

function createMcpSettingsPanel(mcp) {
  const panel = document.createElement("section");
  panel.className = "settings-tool-panel settings-mcp-panel";
  const header = document.createElement("div");
  header.className = "settings-tool-panel-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = "MCP 工具";
  const copy = document.createElement("p");
  copy.textContent = "按 Claude Code 的 .mcp.json 管理方式加载外部 MCP 服务，工具会进入同一条对话运行时。";
  titleWrap.append(title, copy);
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "secondary-button";
  refresh.textContent = "刷新 MCP";
  refresh.addEventListener("click", refreshMcpSettings);
  header.append(titleWrap, refresh);

  const inspection = mcp?.inspection ?? {};
  const grid = document.createElement("div");
  grid.className = "settings-diagnostics";
  grid.append(
    createMetricBlock("服务", inspection.serverCount ?? 0),
    createMetricBlock("已连接", inspection.connectedCount ?? 0),
    createMetricBlock("需登录", inspection.needsAuthCount ?? 0),
    createMetricBlock("失败", inspection.failedCount ?? 0),
    createMetricBlock("工具", inspection.toolCount ?? 0),
  );

  const layout = document.createElement("div");
  layout.className = "settings-mcp-layout";
  layout.append(createMcpServerList(mcp), createMcpServerEditor(mcp));

  const readonly = document.createElement("div");
  readonly.className = "settings-readonly-table";
  readonly.append(
    createReadonlyRow("配置", mcp?.configPath ?? ".mcp.json"),
    createReadonlyRow("来源", mcp?.source ?? "project"),
    createReadonlyRow("版本", mcp?.configVersion ?? "missing"),
  );

  panel.append(
    header,
    grid,
    layout,
    readonly,
    createReadonlyList("MCP 问题", mcp?.issues ?? []),
  );
  return panel;
}

function createMcpServerList(mcp) {
  const list = document.createElement("aside");
  list.className = "settings-mcp-server-list";
  const servers = mcp?.servers ?? [];
  if (servers.length === 0) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "settings-mcp-server-row active";
    empty.textContent = "新增 MCP 服务";
    empty.addEventListener("click", () => {
      state.selectedMcpServerName = null;
      renderSettingsSurface();
    });
    list.append(empty);
    return list;
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = state.selectedMcpServerName ? "settings-mcp-server-row add" : "settings-mcp-server-row add active";
  add.textContent = "新增 MCP 服务";
  add.addEventListener("click", () => {
    state.selectedMcpServerName = null;
    renderSettingsSurface();
  });
  list.append(add);
  const selectedExists = servers.some((server) => server.name === state.selectedMcpServerName);
  if (!selectedExists && state.selectedMcpServerName !== null) {
    state.selectedMcpServerName = servers[0]?.name ?? null;
  }
  for (const server of servers) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `settings-mcp-server-row${state.selectedMcpServerName === server.name ? " active" : ""}`;
    const name = document.createElement("strong");
    name.textContent = server.name;
    const meta = document.createElement("small");
    meta.textContent = `${formatMcpStatusLabel(server.status)} · ${server.enabledToolCount ?? 0}/${server.toolCount ?? 0} 工具`;
    row.append(name, meta);
    row.addEventListener("click", () => {
      state.selectedMcpServerName = server.name;
      renderSettingsSurface();
    });
    list.append(row);
  }
  return list;
}

function createMcpServerEditor(mcp) {
  const servers = mcp?.servers ?? [];
  const selected =
    servers.find((server) => server.name === state.selectedMcpServerName) ??
    (state.selectedMcpServerName === null ? null : servers[0]) ??
    null;
  const form = document.createElement("div");
  form.className = "settings-mcp-editor settings-form";
  const heading = document.createElement("h4");
  heading.textContent = selected ? `编辑 ${selected.name}` : "新增 MCP 服务";

  form.append(
    heading,
    createInputRow("服务名", "mcp-server-name", selected?.name ?? "", "exa"),
    createMcpTransportRow(selected),
    createMcpEnabledRow(selected),
    createInputRow("命令", "mcp-command", selected?.config?.command ?? "", "npx"),
    createTextareaRow(
      "参数",
      "mcp-args",
      (selected?.config?.args ?? []).join("\n"),
      "-y\n@modelcontextprotocol/server-filesystem",
    ),
    createInputRow("URL", "mcp-url", selected?.config?.url ?? "", "https://example.com/mcp"),
    createTextareaRow(
      "环境变量",
      "mcp-env",
      formatKeyValueTextarea(selected?.config?.env),
      "KEY=value，每行一个",
    ),
    createTextareaRow(
      "HTTP Headers",
      "mcp-headers",
      formatKeyValueTextarea(selected?.config?.headers),
      "Authorization=Bearer ...",
    ),
    createMcpAuthRow(selected),
    createInputRow("超时毫秒", "mcp-timeout-ms", selected?.config?.timeoutMs ?? "", "120000"),
    createMcpToolsSelection(selected),
  );

  const actions = document.createElement("div");
  actions.className = "settings-actions settings-mcp-actions";
  const save = createMcpActionButton(selected ? "保存 MCP" : "添加 MCP", "primary-button", async () => {
    await saveMcpServerSettings(form, selected);
  });
  const saveTools = createMcpActionButton("保存工具选择", "secondary-button", async () => {
    await saveMcpToolSelectionSettings(form, selected);
  });
  saveTools.disabled = !selected || (selected?.tools ?? []).length === 0;
  const test = createMcpActionButton("测试", "secondary-button", async () => {
    await testMcpServerSettings(readMcpServerFormValue(form, selected).serverName);
  });
  test.disabled = !selected;
  const remove = createMcpActionButton("删除", "secondary-button danger", async () => {
    await deleteMcpServerSettings(selected?.name);
  });
  remove.disabled = !selected;
  const login = createMcpActionButton("登录", "secondary-button", async () => {
    await loginMcpServerSettings(selected?.name);
  });
  login.disabled = !selected || selected?.status !== "needs-auth";
  const revoke = createMcpActionButton("清除授权", "secondary-button", async () => {
    await revokeMcpServerSettings(selected?.name);
  });
  revoke.disabled = !selected || selected?.auth?.mode !== "oauth";
  actions.append(save, saveTools, test, login, revoke, remove);
  form.append(actions);

  if (selected?.error) {
    const error = document.createElement("p");
    error.className = "settings-mcp-error";
    error.textContent = selected.error;
    form.append(error);
  }

  return form;
}

function createMcpTransportRow(selected) {
  const row = createSettingsRow("传输");
  const select = document.createElement("select");
  select.dataset.field = "mcp-transport";
  for (const [value, labelText] of [
    ["stdio", "stdio 命令"],
    ["http", "Streamable HTTP"],
    ["sse", "SSE"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelText;
    select.append(option);
  }
  select.value = selected?.transport ?? "stdio";
  row.append(select);
  return row;
}

function createMcpEnabledRow(selected) {
  const row = createSettingsRow("启用");
  const label = document.createElement("label");
  label.className = "settings-check-inline";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.field = "mcp-enabled";
  input.checked = selected?.enabled !== false;
  const copy = document.createElement("span");
  copy.textContent = selected?.enabled === false ? "已禁用，不进入工具列表" : "已启用，可进入模型工具列表";
  label.append(input, copy);
  row.append(label);
  return row;
}

function createMcpAuthRow(selected) {
  const row = createSettingsRow("认证");
  const select = document.createElement("select");
  select.dataset.field = "mcp-auth";
  for (const [value, labelText] of [
    ["none", "无"],
    ["header", "Header / Token"],
    ["oauth", "OAuth（needs-auth 状态）"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelText;
    select.append(option);
  }
  select.value = selected?.auth?.mode ?? selected?.config?.auth ?? "none";
  row.append(select);
  return row;
}

function createMcpToolsSelection(selected) {
  const row = createSettingsRow("工具选择");
  const block = document.createElement("div");
  block.className = "settings-mcp-tool-select";
  const tools = selected?.tools ?? [];
  if (tools.length === 0) {
    const hint = document.createElement("small");
    hint.textContent = selected ? "测试连接后会显示工具清单。" : "保存并测试后选择启用哪些工具。";
    block.append(hint);
  } else {
    for (const tool of tools) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = tool.name;
      input.checked = tool.enabled !== false;
      input.dataset.mcpToolName = tool.name;
      const text = document.createElement("span");
      text.textContent = `${tool.name}${tool.readOnly ? " · 只读" : ""}${tool.destructive ? " · 需审批" : ""}`;
      label.title = tool.description ?? tool.name;
      label.append(input, text);
      block.append(label);
    }
  }
  row.append(block);
  return row;
}

function createMcpActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderSettingsGuardrailsTab(container, settings) {
  const guardrails = settings.guardrails ?? {};
  const costBudget = settings.costBudget ?? {};
  const grid = document.createElement("div");
  grid.className = "settings-diagnostics";
  grid.append(
    createMetricBlock("预算状态", formatGuardrailStatus(guardrails.costBudgetStatus)),
    createMetricBlock("Skill 信任", formatGuardrailStatus(guardrails.skillTrustStatus)),
    createMetricBlock("沙箱", formatGuardrailStatus(guardrails.sandboxStatus)),
    createMetricBlock("工具确认", formatToolApprovalMode(guardrails.toolApprovalMode)),
    createMetricBlock("高风险动作", String(guardrails.highRiskAdapterActionCount ?? 0)),
    createMetricBlock("工具审批", String(guardrails.operatorApprovalAdapterActionCount ?? 0)),
    createMetricBlock("待审批", String(guardrails.pendingApprovals ?? 0)),
  );

  const form = createCostBudgetForm(costBudget);
  const guardrailActions = createGuardrailActionRow(guardrails);
  const notes = createReadonlyList("护栏说明", guardrails.notes ?? []);
  const footer = createSettingsFooter({
    hint: `成本预算保存到 ${costBudget.path ?? guardrails.costBudgetPath ?? "runtime/cost-budget.json"}；阻断开启后真实模型调用会被护栏拦截。`,
    primaryLabel: "保存预算",
    onPrimary: async () => {
      await saveCostBudgetSettings(readCostBudgetFormValue(form));
    },
  });
  container.append(grid, form, guardrailActions, notes, footer);
}

function createGuardrailActionRow(guardrails) {
  const row = document.createElement("div");
  row.className = "settings-actions settings-guardrail-actions";
  row.append(
    createGuardrailNavigationButton("打开 Skill 库", () => selectWorkflowPanel("skills")),
    createGuardrailNavigationButton("打开外部工具", () => selectWorkflowPanel("tools")),
    createGuardrailNavigationButton("处理运行审批", () => selectWorkflowPanel("review")),
    createGuardrailNavigationButton("刷新护栏状态", refreshSnapshot),
  );

  const hint = document.createElement("small");
  hint.textContent = [
    `Skill=${formatGuardrailStatus(guardrails.skillTrustStatus)}`,
    `沙箱=${formatGuardrailStatus(guardrails.sandboxStatus)}`,
    `工具确认=${formatToolApprovalMode(guardrails.toolApprovalMode)}`,
    `待审批=${guardrails.pendingApprovals ?? 0}`,
  ].join(" · ");
  row.append(hint);
  return row;
}

function createGuardrailNavigationButton(label, onClick) {
  const button = document.createElement("button");
  button.className = "secondary-button";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    await onClick();
  });
  return button;
}

function renderSettingsCommunicationTab(container, settings) {
  const gateway = settings.weixinGateway ?? settings.communications?.weixinGateway ?? null;
  if (!gateway) {
    container.append(createSettingsEmptyState("当前没有通信网关 snapshot。"));
    return;
  }

  const grid = document.createElement("div");
  grid.className = "settings-diagnostics";
  grid.append(
    createMetricBlock("微信网关", formatWeixinGatewayStatus(gateway)),
    createMetricBlock("常驻运行", gateway.enabled ? "开启" : "关闭"),
    createMetricBlock("微信登录", gateway.account?.loggedIn ? "已登录" : "未登录"),
    createMetricBlock("远端工具确认", String(gateway.runtimeToolApprovals?.pendingCount ?? 0)),
    createMetricBlock("通道契约", formatWeixinChannelContractStatus(gateway.channelContract)),
    createMetricBlock("管理器", gateway.manager ?? "unknown"),
  );
  const loginPanel = createWeixinLoginPanel(gateway);
  const accountPicker = createWeixinAccountPicker(gateway);
  const channelContractPanel = createWeixinChannelContractPanel(gateway.channelContract);
  const runtimeApprovalPanel = createWeixinRuntimeApprovalPanel(gateway.runtimeToolApprovals);

  const parameter = (settings.parameters ?? []).find((item) => item.id === gateway.parameterId);
  const table = document.createElement("div");
  table.className = "settings-switch-table";
  if (parameter) {
    table.append(createSettingsBooleanRow(parameter));
  }

  const actions = document.createElement("div");
  actions.className = "settings-actions settings-gateway-actions";
  actions.append(
    createWeixinGatewayActionButton("查看状态", "status"),
    createWeixinGatewayActionButton("启动", "start"),
    createWeixinGatewayActionButton("停止", "stop"),
    createWeixinGatewayActionButton("重启", "restart"),
  );

  const accountLabel = gateway.account?.loggedIn
    ? `${gateway.account.primaryId ?? "已登录"}${gateway.account.primaryUserId ? ` · ${gateway.account.primaryUserId}` : ""}`
    : "未登录，需要先扫码登录";
  const readonly = document.createElement("div");
  readonly.className = "settings-readonly-table";
  readonly.append(
    createReadonlyRow("账号", accountLabel),
    createReadonlyRow("服务", gateway.serviceLabel ?? "com.directorangel.weixin-gateway"),
    createReadonlyRow("Host API", gateway.hostApiUrl ?? "http://127.0.0.1:3201"),
    createReadonlyRow("配置", gateway.configPath ?? "runtime/gateway-service/weixin-gateway.json"),
    createReadonlyRow("LaunchAgent", gateway.plistPath ?? "未生成"),
    createReadonlyRow("日志", gateway.stdoutPath ?? "runtime/logs/weixin-gateway.out.log"),
  );

  const logPreview = document.createElement("pre");
  logPreview.className = "settings-log-preview";
  const lines = gateway.logs?.combined ?? [];
  logPreview.textContent = lines.length > 0 ? lines.slice(-32).join("\n") : "暂无网关日志。";

  const footer = createSettingsFooter({
    hint: "这个开关绑定本机 LaunchAgent 服务；开启后微信消息会持续进入 Angel，关闭后停止后台收发。",
    primaryLabel: "保存常驻开关",
    secondaryLabel: "刷新状态",
    onSecondary: refreshSnapshot,
    onPrimary: async () => {
      await saveSettingsSwitchRows(table);
    },
  });

  container.append(
    grid,
    loginPanel,
    accountPicker,
    channelContractPanel,
    runtimeApprovalPanel,
    table,
    actions,
    readonly,
    logPreview,
    footer,
  );
}

function createWeixinChannelContractPanel(contract) {
  const panel = document.createElement("section");
  panel.className = "settings-weixin-channel-contract";
  const title = document.createElement("h4");
  title.textContent = "通道契约";
  const body = document.createElement("p");
  const missingCount =
    (contract?.requiredMissing?.length ?? 0) + (contract?.recommendedMissing?.length ?? 0);
  body.textContent = contract?.ready
    ? "已对齐统一运行时。"
    : missingCount > 0
      ? `缺少 ${missingCount} 项通道能力。`
      : "暂未读取到通道契约状态。";
  panel.append(title, body);

  const table = document.createElement("div");
  table.className = "settings-readonly-table";
  const missingItems = [
    ...(contract?.requiredMissing ?? []),
    ...(contract?.recommendedMissing ?? []),
  ];
  table.append(
    createReadonlyRow("状态", contract?.ready ? "可用" : "需处理"),
    createReadonlyRow("风险", formatWeixinChannelContractRisk(contract?.riskLevel)),
    createReadonlyRow("缺失项", missingItems.length > 0 ? missingItems.slice(0, 3).join("；") : "无"),
  );
  panel.append(table);
  return panel;
}

function formatWeixinChannelContractStatus(contract) {
  if (!contract) {
    return "未读取";
  }
  const missingCount =
    (contract.requiredMissing?.length ?? 0) + (contract.recommendedMissing?.length ?? 0);
  if (contract.ready && missingCount === 0) {
    return "已对齐";
  }
  return `缺少 ${missingCount} 项`;
}

function formatWeixinChannelContractRisk(riskLevel) {
  if (riskLevel === "low") {
    return "低";
  }
  if (riskLevel === "medium") {
    return "中";
  }
  if (riskLevel === "high") {
    return "高";
  }
  return "未知";
}

function createWeixinRuntimeApprovalPanel(approvals) {
  const panel = document.createElement("section");
  panel.className = "settings-weixin-runtime-approval";
  const pendingCount = approvals?.pendingCount ?? 0;
  const latest = approvals?.latest ?? null;
  const title = document.createElement("h4");
  title.textContent = "远端工具确认";
  const body = document.createElement("p");
  body.textContent =
    pendingCount > 0
      ? `有 ${pendingCount} 个微信端工具操作等待确认；发起人可在微信回复「确认/拒绝」，可信操作员也可代为处理。`
      : "没有微信端待确认工具操作。";
  panel.append(title, body);
  if (latest) {
    const table = document.createElement("div");
    table.className = "settings-readonly-table";
    table.append(
      createReadonlyRow("最近工具", latest.toolName ?? "受控工具"),
      createReadonlyRow("状态", formatWeixinRuntimeApprovalStatus(latest.status)),
      createReadonlyRow("请求人", latest.requestedByPeerId ?? latest.peerId ?? "未知"),
      createReadonlyRow("说明", latest.summary ?? latest.title ?? "等待确认"),
    );
    panel.append(table);
  }
  return panel;
}

function createWeixinAccountPicker(gateway) {
  const accounts = Array.isArray(gateway.account?.accounts) ? gateway.account.accounts : [];
  const section = document.createElement("section");
  section.className = "settings-weixin-account-picker";
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = "通信账号";
  const select = document.createElement("select");
  select.disabled = accounts.length === 0;
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent = [
      account.id,
      account.userId ? `微信：${account.userId}` : null,
      account.selected ? "当前" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    select.append(option);
  }
  select.value = gateway.account?.selectedAccountId ?? gateway.account?.primaryId ?? "";
  select.addEventListener("change", async () => {
    await selectWeixinGatewayAccount(select.value);
  });
  label.append(title, select);
  const hint = document.createElement("small");
  hint.textContent =
    accounts.length > 1
      ? "扫码会默认切到新账号；也可以在这里手动切回旧账号。"
      : "扫码成功后会保存为当前通信账号。";
  section.append(label, hint);
  return section;
}

function createWeixinLoginPanel(gateway) {
  const panel = document.createElement("section");
  panel.className = "settings-weixin-login-panel";

  const header = document.createElement("div");
  header.className = "settings-weixin-login-header";
  const title = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = "微信连接";
  const caption = document.createElement("p");
  caption.textContent = gateway.account?.loggedIn
    ? "当前个人微信账号已保存，可以启动网关收发消息。"
    : "未连接时先扫码登录；如果微信要求验证码，会在这里输入。";
  title.append(heading, caption);

  const actions = document.createElement("div");
  actions.className = "settings-weixin-login-actions";
  const connectButton = document.createElement("button");
  connectButton.type = "button";
  connectButton.className = gateway.account?.loggedIn ? "secondary-button" : "primary-button";
  connectButton.textContent = gateway.account?.loggedIn ? "重新连接微信" : "连接微信";
  connectButton.addEventListener("click", startWeixinGatewayLogin);
  actions.append(connectButton);
  header.append(title, actions);
  panel.append(header);

  const status = document.createElement("div");
  status.className = `settings-weixin-login-status ${gateway.login?.status ?? "idle"}`;
  status.textContent = formatWeixinLoginStatus(gateway.login, gateway.account);
  panel.append(status);

  if (gateway.login?.pending) {
    const qrWrap = document.createElement("div");
    qrWrap.className = "settings-weixin-qr-wrap";
    const qrMedia = document.createElement("div");
    qrMedia.className = "settings-weixin-qr-media";
    if (gateway.login.qrcodeImageSrc) {
      const image = document.createElement("img");
      image.alt = "微信登录二维码";
      image.src = gateway.login.qrcodeImageSrc;
      qrMedia.append(image);
    } else {
      const code = document.createElement("code");
      code.textContent = gateway.login.qrcodeUrl || "二维码内容暂不可显示，请重新连接。";
      qrMedia.append(code);
    }
    const qrMeta = document.createElement("div");
    qrMeta.className = "settings-weixin-qr-meta";
    const qrTitle = document.createElement("strong");
    qrTitle.textContent = "用手机微信扫码";
    const qrBody = document.createElement("p");
    qrBody.textContent =
      gateway.login.status === "scaned"
        ? "已扫码，继续在手机微信确认。"
        : gateway.login.needVerifyCode
          ? "手机端显示数字验证码时，在下方输入后提交。"
          : "扫码确认后会自动保存账号并启动网关。";
    qrMeta.append(qrTitle, qrBody);
    qrWrap.append(qrMedia, qrMeta);
    panel.append(qrWrap);

    if (gateway.login.needVerifyCode) {
      clearWeixinLoginPolling();
      panel.append(createWeixinVerifyCodeForm());
    } else {
      ensureWeixinLoginPolling(gateway.login);
    }
  } else {
    clearWeixinLoginPolling();
  }

  return panel;
}

function createWeixinVerifyCodeForm() {
  const form = document.createElement("form");
  form.className = "settings-weixin-verify-form";
  const label = document.createElement("label");
  label.textContent = "验证码";
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "one-time-code";
  input.placeholder = "输入手机微信显示的数字验证码";
  const button = document.createElement("button");
  button.type = "submit";
  button.className = "primary-button";
  button.textContent = "提交验证码";
  form.append(label, input, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await pollWeixinGatewayLogin(input.value.trim());
  });
  return form;
}

function createSettingsBooleanRow(parameter) {
  const row = document.createElement("label");
  row.className = "settings-switch-row";
  const text = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = parameter.label;
  const description = document.createElement("small");
  description.textContent = `${formatSettingCategory(parameter.category)} · ${formatSettingParameterDescription(parameter)}`;
  text.append(name, description);
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = parameter.value === true;
  input.dataset.parameterId = parameter.id;
  input.dataset.originalValue = String(parameter.value === true);
  row.append(text, input);
  return row;
}

function createWeixinGatewayActionButton(label, operation) {
  const button = document.createElement("button");
  button.className = operation === "start" ? "primary-button" : "secondary-button";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    await runWeixinGatewayOperation(operation);
  });
  return button;
}

function renderSettingsSwitchesTab(container, settings) {
  const runtimeNumbers = (settings.parameters ?? []).filter(
    (parameter) =>
      parameter.writable && parameter.type === "number" && parameter.category === "runtime",
  );
  const writable = (settings.parameters ?? []).filter(
    (parameter) =>
      parameter.writable &&
      parameter.type === "boolean" &&
      ["features", "roles", "adapterOverrides"].includes(parameter.category),
  );
  if (writable.length === 0 && runtimeNumbers.length === 0) {
    container.append(createSettingsEmptyState("当前没有可写功能开关。"));
    return;
  }

  if (runtimeNumbers.length > 0) {
    const runtimeTable = document.createElement("div");
    runtimeTable.className = "settings-readonly-table";
    for (const parameter of runtimeNumbers) {
      runtimeTable.append(createSettingsNumberRow(parameter));
    }
    container.append(
      runtimeTable,
      createSettingsFooter({
        hint: `运行参数保存到 ${settings.heartbeatSettingsPath ?? "runtime/heartbeat-settings.json"}。`,
        primaryLabel: "保存运行参数",
        onPrimary: async () => {
          await saveSettingsNumberRows(runtimeTable);
        },
      }),
    );
  }

  if (writable.length > 0) {
    const table = document.createElement("div");
    table.className = "settings-switch-table";
    for (const parameter of writable) {
      table.append(createSettingsBooleanRow(parameter));
    }

    const footer = createSettingsFooter({
      hint: `功能开关保存到 ${settings.switchPath ?? "runtime switches.json"}。`,
      primaryLabel: "保存开关",
      onPrimary: async () => {
        await saveSettingsSwitchRows(table);
      },
    });
    container.append(table, footer);
  }
}

function createSettingsNumberRow(parameter) {
  const row = document.createElement("label");
  row.className = "settings-number-row";
  const text = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = parameter.label;
  const description = document.createElement("small");
  description.textContent = `${parameter.description ?? ""} 默认 ${parameter.defaultLabel ?? "未设置"}`;
  text.append(name, description);
  const input = document.createElement("input");
  input.type = "number";
  input.dataset.parameterId = parameter.id;
  input.dataset.originalValue = String(parameter.value ?? "");
  input.value = String(parameter.value ?? "");
  if (parameter.min !== undefined) {
    input.min = String(parameter.min);
  }
  if (parameter.max !== undefined) {
    input.max = String(parameter.max);
  }
  if (parameter.step !== undefined) {
    input.step = String(parameter.step);
  }
  row.append(text, input);
  return row;
}

function renderSettingsPathsTab(container, settings) {
  const paths = (settings.parameters ?? []).filter((parameter) => parameter.category === "paths");
  const table = document.createElement("div");
  table.className = "settings-readonly-table";
  for (const parameter of paths) {
    table.append(createReadonlyRow(parameter.label, parameter.valueLabel ?? parameter.value));
  }
  container.append(
    table,
    createSettingsFooter({
      hint: "路径参数由当前工作区和环境变量决定，只读展示。",
      primaryLabel: "刷新状态",
      onPrimary: refreshSnapshot,
    }),
  );
}

function renderSettingsDiagnosticsTab(container, settings) {
  const grid = document.createElement("div");
  grid.className = "settings-diagnostics";
  grid.append(
    createMetricBlock("状态", settings.status ?? "unknown"),
    createMetricBlock("功能", `${settings.enabledCount ?? 0}/${settings.featureCount ?? 0} 开启`),
    createMetricBlock("角色", `${settings.enabledRoleCount ?? 0}/${settings.roleCount ?? 0} 开启`),
    createMetricBlock(
      "API",
      `${settings.configuredApiProviderCount ?? 0}/${settings.apiProviderCount ?? 0} 已配置`,
    ),
  );

  const guardrails = settings.guardrails ?? null;
  const guardrailGrid = document.createElement("div");
  guardrailGrid.className = "settings-diagnostics";
  if (guardrails) {
    guardrailGrid.append(
      createMetricBlock("API/预算", formatGuardrailStatus(guardrails.costBudgetStatus)),
      createMetricBlock("Skill 信任", formatGuardrailStatus(guardrails.skillTrustStatus)),
      createMetricBlock("沙箱", formatGuardrailStatus(guardrails.sandboxStatus)),
      createMetricBlock("工具确认", formatToolApprovalMode(guardrails.toolApprovalMode)),
      createMetricBlock("高风险动作", String(guardrails.highRiskAdapterActionCount ?? 0)),
      createMetricBlock("工具审批", String(guardrails.operatorApprovalAdapterActionCount ?? 0)),
      createMetricBlock("待审批", String(guardrails.pendingApprovals ?? 0)),
      createMetricBlock("最近审计", guardrails.lastAuditEventId ?? "无"),
    );
  }

  const issues = createReadonlyList("问题", settings.issues ?? []);
  const guardrailNotes = createReadonlyList("护栏说明", guardrails?.notes ?? []);
  const notes = createReadonlyList("记录", settings.notes ?? []);
  const footer = createSettingsFooter({
    hint: "诊断页只展示后端 snapshot 状态；刷新会重新读取本机配置。",
    primaryLabel: "刷新诊断",
    onPrimary: refreshSnapshot,
  });
  container.append(grid, guardrailGrid, guardrailNotes, issues, notes, footer);
}

function createProviderSelectRow(providers, provider) {
  const row = createSettingsRow("供应方");
  const controls = document.createElement("div");
  controls.className = "settings-provider-controls";
  const select = document.createElement("select");
  select.dataset.field = "provider-id";
  for (const item of providers) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name}（${item.id}）`;
    select.append(option);
  }
  select.value = provider.id;
  select.addEventListener("change", () => {
    state.selectedApiProviderId = select.value;
    renderSettingsSurface();
  });
  const enabled = document.createElement("label");
  enabled.className = "settings-check-inline";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.field = "provider-enabled";
  checkbox.checked = provider.enabled === true;
  const status = document.createElement("span");
  const renderStatus = () => {
    const enabledText = checkbox.checked ? "已启用" : "已停用";
    const keyText = provider.apiKeyConfigured ? "Key 已配置" : "Key 未配置";
    status.textContent = `${enabledText} / ${keyText}`;
  };
  checkbox.addEventListener("change", renderStatus);
  renderStatus();
  enabled.append(checkbox, status);
  controls.append(select, enabled);
  row.append(controls);
  return row;
}

function createCostBudgetForm(costBudget) {
  const form = document.createElement("div");
  form.className = "settings-form";
  form.append(
    createCostBudgetNumberRow("预算上限 USD", "cost-limit", costBudget.limitUsd, "例如 20"),
    createCostBudgetNumberRow("当前已用 USD", "cost-spent", costBudget.spentUsd, "例如 4"),
    createCostBudgetBlockedRow(costBudget),
    createReadonlyRow("剩余预算", formatMoneyValue(costBudget.remainingUsd)),
    createReadonlyRow("预算文件", costBudget.path ?? "尚未创建"),
    createReadonlyRow("状态原因", costBudget.reason ?? "未返回"),
  );
  return form;
}

function createCostBudgetNumberRow(labelText, fieldName, value, placeholder) {
  const row = createSettingsRow(labelText);
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.01";
  input.setAttribute("data-field", fieldName);
  input.value = typeof value === "number" ? String(value) : "";
  input.placeholder = placeholder;
  row.append(input);
  return row;
}

function createCostBudgetBlockedRow(costBudget) {
  const row = createSettingsRow("手动阻断");
  const label = document.createElement("label");
  label.className = "settings-check-inline";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("data-field", "cost-blocked");
  input.checked = costBudget.blocked === true || costBudget.status === "blocked";
  const copy = document.createElement("span");
  copy.textContent = "开启后暂停真实模型调用，直到解除阻断并保存。";
  label.append(input, copy);
  row.append(label);
  return row;
}

function readCostBudgetFormValue(form) {
  return {
    limitUsd: readCostBudgetNumber(form, "cost-limit"),
    spentUsd: readCostBudgetNumber(form, "cost-spent"),
    blocked: form.querySelector("[data-field='cost-blocked']")?.checked === true,
  };
}

function readCostBudgetNumber(form, fieldName) {
  const value = form.querySelector(`[data-field='${fieldName}']`)?.value ?? "";
  const numberValue = Number.parseFloat(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function readProviderEnabled(form, provider) {
  return form.querySelector("[data-field='provider-enabled']")?.checked ?? provider.enabled;
}

function readApiProviderFormValue(form, provider) {
  const apiKeyField = form.querySelector("[data-field='api-key']");
  const apiKey = normalizeApiKeyList(apiKeyField?.value ?? "");
  if (apiKeyField) {
    apiKeyField.value = apiKey;
    resizeApiKeyTextarea(apiKeyField);
  }
  const fieldValue = (fieldName, fallback = "") =>
    form.querySelector(`[data-field='${fieldName}']`)?.value ?? fallback;
  return {
    enabled: readProviderEnabled(form, provider),
    baseUrl: fieldValue("base-url", provider.baseUrl),
    apiKey,
    models: fieldValue("models", provider.models.join("\n")),
    defaultTextModel: fieldValue(
      "defaultTextModel",
      resolveProviderDefaultModel(provider, "defaultTextModel"),
    ),
    defaultVisionModel: fieldValue(
      "defaultVisionModel",
      resolveProviderDefaultModel(provider, "defaultVisionModel"),
    ),
    defaultImageModel: fieldValue(
      "defaultImageModel",
      resolveProviderDefaultModel(provider, "defaultImageModel"),
    ),
    defaultVideoModel: fieldValue(
      "defaultVideoModel",
      resolveProviderDefaultModel(provider, "defaultVideoModel"),
    ),
  };
}

function createApiKeyRow(labelText, fieldName, configured) {
  const row = createSettingsRow(labelText);
  const wrap = document.createElement("div");
  wrap.className = "settings-password-wrap";
  const textarea = document.createElement("textarea");
  textarea.className = "settings-secret-textarea masked";
  textarea.dataset.field = fieldName;
  textarea.rows = 3;
  textarea.placeholder = configured
    ? "已配置；粘贴新 Key 会替换，留空不改"
    : "粘贴 API Key，多个 Key 可用逗号或换行";
  textarea.autocomplete = "off";
  textarea.spellcheck = false;
  textarea.addEventListener("paste", (event) => {
    event.preventDefault();
    const pasted = event.clipboardData?.getData("text") ?? "";
    textarea.setRangeText(
      normalizeApiKeyList(pasted),
      textarea.selectionStart,
      textarea.selectionEnd,
      "end",
    );
    textarea.value = normalizeApiKeyList(textarea.value);
    resizeApiKeyTextarea(textarea);
  });
  textarea.addEventListener("input", () => {
    resizeApiKeyTextarea(textarea);
  });
  textarea.addEventListener("blur", () => {
    textarea.value = normalizeApiKeyList(textarea.value);
    resizeApiKeyTextarea(textarea);
  });
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "secondary-button";
  toggle.textContent = "显示";
  toggle.addEventListener("click", () => {
    textarea.classList.toggle("masked");
    toggle.textContent = textarea.classList.contains("masked") ? "显示" : "隐藏";
  });
  wrap.append(textarea, toggle);
  row.append(wrap);
  return row;
}

function normalizeApiKeyList(value) {
  return String(value ?? "")
    .split(/[,\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

function resizeApiKeyTextarea(textarea) {
  const lines = Math.max(3, Math.min(12, textarea.value.split("\n").length));
  textarea.rows = lines;
}

function formatExternalProviderSecretSource(provider) {
  if (provider.configuredSecretRefSource) {
    const providerText = provider.configuredSecretRefProvider
      ? ` · ${provider.configuredSecretRefProvider}`
      : "";
    if (provider.configuredSecretRefSource === "env") {
      return provider.configuredSecretEnvVar
        ? `SecretRef env:${provider.configuredSecretEnvVar}${providerText}`
        : `SecretRef env${providerText}`;
    }
    if (provider.configuredSecretRefSource === "file") {
      return `SecretRef file${providerText}`;
    }
    if (provider.configuredSecretRefSource === "exec") {
      return `SecretRef exec${providerText}`;
    }
    if (provider.configuredSecretRefSource === "inline") {
      return `本机配置${providerText}`;
    }
  }
  if (provider.configuredSecret !== true) {
    const missing = provider.missingEnvVars ?? [];
    return missing.length > 0 ? `未配置：${missing.join(" / ")}` : "未配置";
  }
  if (provider.configuredSecretSource === "env") {
    return provider.configuredSecretEnvVar ? `环境变量 ${provider.configuredSecretEnvVar}` : "环境变量";
  }
  if (provider.configuredSecretSource === "config") {
    return "本机配置";
  }
  return "已配置";
}

function formatExternalProviderDiagnostics(provider) {
  const diagnostics = Array.isArray(provider.diagnostics) ? provider.diagnostics : [];
  if (diagnostics.length === 0) {
    return provider.status === "ready" ? "无异常" : "暂无诊断";
  }
  return diagnostics.slice(0, 3).join("；");
}

function formatExternalProviderNextActions(provider) {
  const nextActions = Array.isArray(provider.nextActions) ? provider.nextActions : [];
  if (nextActions.length === 0) {
    return provider.status === "ready" ? "可直接被运行时调用" : "查看状态后重试";
  }
  return nextActions.slice(0, 3).join("；");
}

function createInputRow(labelText, fieldName, value, placeholder = "") {
  const row = createSettingsRow(labelText);
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.field = fieldName;
  input.value = value ?? "";
  input.placeholder = placeholder;
  row.append(input);
  return row;
}

function createTextareaRow(labelText, fieldName, value, placeholder = "") {
  const row = createSettingsRow(labelText);
  const textarea = document.createElement("textarea");
  textarea.dataset.field = fieldName;
  textarea.value = value ?? "";
  textarea.placeholder = placeholder;
  row.append(textarea);
  return row;
}

function createDefaultModelRow(provider) {
  const row = createSettingsRow("默认模型");
  const grid = document.createElement("div");
  grid.className = "settings-model-grid";
  const modelFields = [
    ["文本", "defaultTextModel", provider.defaultModels?.text, "text"],
    ["视觉", "defaultVisionModel", provider.defaultModels?.vision, "vision"],
    ["图片", "defaultImageModel", provider.defaultModels?.image_generation, "image_generation"],
    ["视频", "defaultVideoModel", provider.defaultModels?.video_generation, "video_generation"],
  ];
  for (const [labelText, fieldName, value, capability] of modelFields) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = labelText;
    label.append(
      caption,
      createBrandedModelSelect(provider, {
        fieldName,
        value,
        capability,
      }),
    );
    grid.append(label);
  }
  row.append(grid);
  return row;
}

function createBrandedModelSelect(provider, { fieldName, value, capability }) {
  const wrap = document.createElement("div");
  wrap.className = "settings-model-select-wrap";
  const select = document.createElement("select");
  select.dataset.field = fieldName;
  const options = getProviderModelOptions(provider, value, capability);
  const groups = groupModelOptionsByBrand(options);
  for (const group of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.logoText;
    for (const optionModel of group.models) {
      const option = document.createElement("option");
      option.value = optionModel.model;
      option.textContent = optionModel.model;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  select.value = value ?? options[0]?.model ?? "";
  const preview = createSelectedModelPreview(provider, select.value, capability);
  select.addEventListener("change", () => {
    preview.replaceChildren(...createSelectedModelPreviewChildren(provider, select.value, capability));
  });
  wrap.append(select, preview);
  return wrap;
}

function getProviderModelOptions(provider, selectedModel, capability) {
  const metadataByModel = new Map((provider.modelMetadata ?? []).map((item) => [item.model, item]));
  return Array.from(new Set([selectedModel, ...(provider.models ?? [])].filter(Boolean)))
    .map((model) => ({
      model,
      metadata: metadataByModel.get(model) ?? resolveModelBrandMetadata(model),
    }))
    .filter((entry) => {
      const capabilities = entry.metadata.capabilities ?? [];
      if (entry.model === selectedModel) {
        return true;
      }
      if (capability === "vision") {
        return capabilities.includes("vision") || capabilities.includes("text");
      }
      return capabilities.length === 0 || capabilities.includes(capability);
    });
}

function groupModelOptionsByBrand(options) {
  const byBrand = new Map();
  for (const option of options) {
    const brandId = option.metadata?.brandId ?? "other";
    if (!byBrand.has(brandId)) {
      byBrand.set(brandId, {
        brandId,
        logoText: getModelBrandLogoText(brandId),
        models: [],
      });
    }
    byBrand.get(brandId).models.push(option);
  }
  return [...byBrand.values()].sort((left, right) => {
    const leftOther = left.brandId === "other" ? 1 : 0;
    const rightOther = right.brandId === "other" ? 1 : 0;
    if (leftOther !== rightOther) {
      return leftOther - rightOther;
    }
    return left.brandId.localeCompare(right.brandId);
  });
}

function createSelectedModelPreview(provider, model, capability) {
  const preview = document.createElement("div");
  preview.className = "settings-selected-model";
  preview.replaceChildren(...createSelectedModelPreviewChildren(provider, model, capability));
  return preview;
}

function createSelectedModelPreviewChildren(provider, model, capability) {
  const metadata = resolveProviderModelMetadata(provider, model);
  const modelText = document.createElement("span");
  modelText.className = "settings-selected-model-name";
  modelText.textContent = model || "未选择";
  const badge = document.createElement("span");
  badge.className = "settings-model-capability";
  badge.textContent = formatModelCapabilityLabel(capability);
  return [createModelBrandLogo(metadata), modelText, badge];
}

function resolveProviderModelMetadata(provider, model) {
  return (
    (provider.modelMetadata ?? []).find((metadata) => metadata.model === model) ??
    resolveModelBrandMetadata(model)
  );
}

function resolveModelBrandMetadata(model) {
  const brandId = inferModelBrandId(model);
  return {
    model,
    brandId,
    modelFamily: inferModelFamily(model),
    capabilities: [],
  };
}

function createModelBrandLogo(metadata) {
  const mark = document.createElement("span");
  mark.className = `settings-model-brand-mark brand-${metadata.brandId ?? "other"}`;
  mark.title = metadata.modelFamily ?? "";
  mark.setAttribute("aria-label", metadata.modelFamily ?? "model brand");
  const svg = createModelBrandLogoSvg(metadata.brandId ?? "other");
  if (svg) {
    mark.append(svg);
  } else {
    mark.textContent = getModelBrandLogoText(metadata.brandId ?? "other");
  }
  return mark;
}

function createModelBrandLogoSvg(brandId) {
  const svgByBrand = {
    openai:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.55 10a5.42 5.42 0 0 0-.48-4.5 5.55 5.55 0 0 0-6.05-2.66A5.59 5.59 0 0 0 10.83 1a5.55 5.55 0 0 0-5.36 3.84A5.55 5.55 0 0 0 1.76 7.5a5.49 5.49 0 0 0 .69 6.5 5.42 5.42 0 0 0 .48 4.5 5.55 5.55 0 0 0 6.05 2.66A5.59 5.59 0 0 0 13.17 23a5.55 5.55 0 0 0 5.36-3.84 5.55 5.55 0 0 0 3.71-2.66 5.49 5.49 0 0 0-.69-6.5ZM9.59 10.63 12 9.25l2.41 1.38v2.74L12 14.75l-2.41-1.38Z"/></svg>',
    google:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#1C7DFF" d="M12 24A14.3 14.3 0 0 0 0 12 14.3 14.3 0 0 0 12 0a14.3 14.3 0 0 0 12 12 14.3 14.3 0 0 0-12 12Z"/></svg>',
    anthropic:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="M4.71 15.96 9.43 13.3l.08-.23-.08-.13H9.2l-8.66-.46L0 11.78l.54-.67.69.06 8.28.61.05-.16-.13-.1-7.44-5.3-.16-1 .66-.73.88.06 5.88 4.35.15-.1.02-.07-3.79-6.27-.17-1.35L6.28.13 6.7 0l1 .13.42.36 3.63 7.58.24.83h.16l.49-6.39.08-.76.38-.91.74-.49.59.28.48.68-.07.45-.92 4.76-.36 1.94h.21l3.61-4.43.85-.9.55-.43h1.03l.76 1.13-.34 1.17-3.94 5.59.07.11.19-.02 5.72-1.2.83.39.1.39-.33.8-7.75 1.82-.04.03.05.06 5.85.37.79.52.47.64-.08.49-1.21.62-6.78-1.63h-.18v.11l5.61 5.2.13.58-.32.46-.34-.05-5.99-5.02h-.13v.17l2.91 4.17.12 1.08-.17.35-.61.21-.67-.12-3.93-6.03-.14.08-.67 7.25-.32.37-.73.28-.6-.46-.33-.75.78-3.64.29-1.9.17-.63-.02-.04-.14.02-5.34 7.4-.41.16-.72-.37.07-.66.4-.59 4.76-6 .93-1.09-.01-.16h-.06l-5.3 3.15-1.13.15-.48-.46.06-.75.23-.24Z"/></svg>',
    doubao:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#1E37FC" d="M5.31 15.76c.17-3.75 1.88-6 2.55-6.74-3.26 2.06-5.43 5.66-6.36 8.31v1.12C1.5 21.51 4.23 24 7.59 24c1.12 0 2.2-.27 3.24-.75.91-.9 1.65-1.91 2.24-2.99-4.88 2.43-7.97.07-7.76-4.5Z"/><path fill="#37E1BE" d="M22.57 10.28c-1.21-.9-4.1-2.4-7.4-2.8.3 3.79.1 8.77-2.1 12.77-.6 1.09-1.33 2.1-2.24 2.99 3.76-1.45 6.75-3.45 8.6-5.21 2.82-2.68 3.35-5.18 3.36-6.66 0-.38-.08-.74-.22-1.09Z"/><path fill="#A569FF" d="M14.3 1.87A7.45 7.45 0 0 0 9.39 0 7.45 7.45 0 0 0 4.55 1.8C2.79 3.29 1.63 5.56 1.5 8.13v9.2c.93-2.65 3.1-6.25 6.36-8.31.5-.32 1.02-.6 1.57-.83 1.88-.8 3.88-.93 5.75-.7-.22-2.83-.72-5-.87-5.62Z"/></svg>',
    kling:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#04A6F0" d="M5.41 13.78A23.2 23.2 0 0 1 7.41 9.32C10.58 3.83 15.2.56 17.74 2.03 12.04-1.27 4.6.94 1.12 6.96.7 7.69.35 8.45.09 9.22c-.26.74.09 1.53.77 1.93l4.56 2.63Z"/><path fill="#0DF35E" d="M18.59 10.16a23.2 23.2 0 0 1-2 4.46C13.42 20.11 8.79 23.38 6.26 21.91c5.7 3.29 13.14 1.08 16.62-4.94.42-.73.77-1.49 1.04-2.25.26-.74-.1-1.53-.77-1.93l-4.56-2.63Z"/><path fill="#003EFF" d="M16.59 14.62c3.17-5.49 3.69-11.13 1.15-12.59C15.21.56 10.58 3.83 7.41 9.32c2.07-3.59 5.81-5.31 8.34-3.85 2.53 1.46 2.91 5.56.84 9.15Z"/></svg>',
    alibaba:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF6A00" d="M14.75 4.64h5.28C22.24 4.64 24 6.48 24 8.69v7.11a3.95 3.95 0 0 1-3.97 3.97h-5.28l1.3-1.83 3.82-1.22c.69-.23 1.15-.92 1.15-1.6V9.3c0-.69-.46-1.38-1.15-1.6l-3.82-1.22-1.3-1.84ZM2.98 15.11c0 .69.46 1.38 1.15 1.61l3.82 1.15 1.3 1.83H3.97A3.95 3.95 0 0 1 0 15.72V8.69c0-2.21 1.76-4.05 3.98-4.05h5.27L7.95 6.47 4.13 7.7c-.69.23-1.15.91-1.15 1.6v5.81Z"/><path fill="#FF6A00" d="M16.05 11.21H8.03v1.84h8.02v-1.84Z"/></svg>',
    deepseek:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4D6BFE" d="M23.75 4.48c-.25-.12-.36.11-.51.23-.05.04-.1.09-.14.14-.37.4-.8.66-1.37.63-.83-.05-1.54.21-2.16.85-.14-.78-.58-1.25-1.25-1.55-.35-.16-.71-.31-.96-.65-.17-.24-.22-.51-.3-.78-.06-.16-.11-.32-.3-.35-.2-.03-.28.14-.35.28-.32.57-.44 1.2-.43 1.84.03 1.44.63 2.58 1.84 3.39.14.1.17.19.13.33-.08.28-.18.55-.27.83-.05.18-.14.22-.33.14a5.53 5.53 0 0 1-1.74-1.18c-.85-.83-1.63-1.74-2.6-2.46a11.4 11.4 0 0 0-.68-.47c-.99-.96.13-1.74.39-1.84.27-.1.09-.43-.78-.43s-1.67.3-2.69.69c-.16.06-.31.1-.46.14a9.6 9.6 0 0 0-2.88-.1C3.92 4.39 2.42 5.28 1.3 6.8.08 8.6-.23 10.68.15 12.85c.4 2.28 1.57 4.18 3.36 5.65 1.86 1.53 4 2.28 6.44 2.14 1.48-.08 3.13-.28 4.99-1.86.47.23.96.33 1.78.4.63.06 1.24-.03 1.7-.13.74-.16.69-.84.42-.96-2.15-1-1.68-.6-2.11-.93 1.1-1.3 2.75-2.64 3.4-7 .05-.35 0-.57 0-.85 0-.17.03-.24.23-.26a4.17 4.17 0 0 0 1.54-.47c1.4-.76 1.96-2.02 2.09-3.52.02-.23 0-.47-.24-.59Z"/></svg>',
    zhipu:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="glm-logo-fill" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#504AF4"/><stop offset="1" stop-color="#3485FF"/></linearGradient></defs><path fill="url(#glm-logo-fill)" d="M9.92 2c4.9 0 10.18 3.95 8.93 10.58-.08-3-1.54-9-8.93-9-3.4 0-8.14 3.05-7.93 8.16-.04 4.78 3.56 8.4 7.95 8.33 1.2-.03 2.76-.43 3.1-1.66.16.05.37.69.46.93 1-.35 2.36-1.25 2.02-2.37-.18-.61-1.78-.15-1.92-.35.42-.98 2.23-.93 3.15-.72.44.1.66.38 1.01.44.29.05.98-.2.96.24C17.22 19.63 13.83 22 9.92 22 3.65 22 0 16.57 0 11.74 0 5.95 4.96 2 9.92 2Zm-.02 3.3c.48 0 1.12.23 1.38.59 3.67.15 4.31 2.69 4.69 5.44.25 1.84.32 2.3.18 1.39l.09.59c.07.45.55.74.98.51.14-.07.25-.23.33-.47l.88.32c-.09.36-.27.66-.5.9-.88.92-2.76.66-3.08-.62-.14-.56-.06-.63-.35-1.24-.29-.63-1.24-.71-1.69-.3-.35.32-.41.81-.41 1.29l.08 2.2c0 .5-.4.9-.9.9h-1.4c-.5 0-.9-.4-.9-.9v-.65a1.15 1.15 0 1 0-2.3 0v.65c0 .5-.4.9-.9.9h-1.4c-.5 0-.9-.4-.9-.9l.04-3.24c.01-1.88.36-3.66 2.47-4.13.2-.05.25.13.29.34.7 3.06 1.75 4.3 3.14 3.72l.66-.33c.36-.18.52-.28.53-.3-.01-.04-.91-1-1.21-1.31-.05-.04-.12.07-.21.31-.08.16-.25.25-.27.33-.01.06.11.3.36.72.16.29.22.51-.31.34-1.04-.8-1.52-2.27-1.68-3.72-.01-.04-.17-1.91-.17-1.91A1.2 1.2 0 0 1 8.3 5.3H9.9Z"/></svg>',
    grok:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m9.27 15.29 7.98-5.9c.39-.29.95-.18 1.14.28.98 2.36.54 5.21-1.41 7.16-1.95 1.96-4.67 2.38-7.15 1.41l-2.71 1.26c3.89 2.66 8.61 2 11.56-.96 2.34-2.34 3.07-5.54 2.39-8.42-.98-4.23.24-5.92 2.75-9.37L20.7 3.8 9.27 15.29Zm-1.65 1.43c-2.79-2.67-2.31-6.8.07-9.18 1.76-1.77 4.65-2.49 7.17-1.43l2.71-1.25a7.8 7.8 0 0 0-1.83-1A8.98 8.98 0 0 0 5.98 5.83c-2.53 2.54-3.33 6.44-1.96 9.76 1.02 2.49-.65 4.25-2.34 6.03-.6.63-1.2 1.26-1.68 1.92l7.62-6.82Z"/></svg>',
    minimax:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="minimax-logo-fill" x1="0" x2="1" y1=".5" y2=".5"><stop offset="0" stop-color="#E2167E"/><stop offset="1" stop-color="#FE603C"/></linearGradient></defs><path fill="url(#minimax-logo-fill)" d="M16.28 2c1.15 0 2.09.93 2.09 2.07v12.5c0 .4.34.71.74.71.41 0 .75-.32.75-.71V9.1c0-1.13.93-2.05 2.07-2.05S24 7.97 24 9.1v6.56a.65.65 0 0 1-1.3 0V9.1a.77.77 0 0 0-1.54 0v7.47a2.04 2.04 0 0 1-4.09 0V4.07a.79.79 0 0 0-1.58 0v15.9A2.04 2.04 0 0 1 13.44 22a2.04 2.04 0 0 1-2.05-2.03V18.04a.65.65 0 0 1 1.31 0v1.93c0 .26.14.51.37.64.23.13.51.13.74 0a.73.73 0 0 0 .37-.64V4.07c0-1.14.94-2.07 2.1-2.07Zm-5.68 0c1.16 0 2.1.93 2.1 2.07v11.52a.65.65 0 0 1-1.31 0V4.07a.79.79 0 0 0-1.58 0v14.01a2.07 2.07 0 0 1-4.14 0V9.1a.77.77 0 0 0-1.53 0v3.8a2.07 2.07 0 0 1-4.14 0v-1.38a.65.65 0 0 1 1.3 0v1.38a.77.77 0 0 0 1.54 0V9.1a2.07 2.07 0 0 1 4.14 0v8.98a.77.77 0 0 0 1.53 0V4.07C8.51 2.93 9.45 2 10.6 2Z"/></svg>',
    luma:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="luma-logo-fill-0" x1="2" x2="22.8" y1="18" y2="18" gradientUnits="userSpaceOnUse"><stop stop-color="#00A"/><stop offset="1" stop-color="#A78DFF"/></linearGradient><linearGradient id="luma-logo-fill-1" x1="13.7" x2="4.7" y1="22.6" y2="3.7" gradientUnits="userSpaceOnUse"><stop stop-color="#004EFF"/><stop offset="1" stop-color="#0FF"/></linearGradient></defs><path fill="#000" d="M2 6 12.39 0v24L2 18V6Z"/><path fill="url(#luma-logo-fill-0)" d="M12.39 24 2 18l10.39-6 10.4 6-10.4 6Z"/><path fill="url(#luma-logo-fill-1)" d="M2 6 12.39 0v24L2 18V6Z"/></svg>',
    runway:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.86 22.99c-2.67.25-4.89-2.87-6.6-4.45C10.4 24.76 1 24.18 1 17.86V6.15c0-.92.24-1.86.73-2.65C2.64 1.98 4.38.98 6.15 1h11.71c6.32 0 6.92 9.4.68 10.24l2.97 2.95c3.25 3.07.81 8.93-3.65 8.8Zm-1.43-3.72c1.84 1.9 4.78-1.03 2.88-2.88l-5.13-5.13H11.3v2.88l4.44 4.43.7.7ZM4.12 17.84c-.04 2.63 4.12 2.63 4.06 0V6.13c.04-1.32-1.35-2.35-2.61-1.95-.06.02-.11.03-.15.05-.79.3-1.34 1.09-1.32 1.94v11.67h.02Zm13.74-9.68c2.63.04 2.63-4.1 0-4.06h-6.97c.53 1.11.39 2.86.41 4.06h6.56Z"/></svg>',
    vidu:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.61 2.25c-2.92-.97-5.43 1.08-6.01 2.96l-3 9.58c-.43 1.35-1.5 3.55-3.49 3.55-1.63 0-2.47-1.53-2.82-2.44L2.87 9.43c-.28-.68.01-2.04 1.14-2.45 1.2-.43 1.98.58 2.18 1.11l3.02 7.74c.72-.93 1.17-2.44 1.47-3.5L8.7 7.12C7.76 4.69 5.27 3.58 2.96 4.43 1.1 5.12-.7 7.47.28 10.44l2.5 6.44c.38.97 1.88 4.16 5.28 4.16 4.07 0 5.6-3.47 6.45-6.22.42-1.37 2.75-8.8 2.75-8.8.34-1.1 1.71-1.43 2.56-1.14.61.2 1.7 1.03 1.35 2.32-.07.24-1.92 6.21-2.6 8.03-.36.95-1.27 3-3.33 2.72-.63 1.39-1.15 2.2-1.94 2.92 2.57 1.22 6.32 0 7.9-4.78.59-1.77 2.64-8.16 2.64-8.16.6-1.96-.47-4.77-3.23-5.68Z"/></svg>',
    mistral:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="gold" d="M3.43 3.4h3.43v3.43H3.43V3.4Zm13.71 0h3.43v3.43h-3.43V3.4Z"/><path fill="#FFAF00" d="M3.43 6.83h6.86v3.43H3.43V6.83Zm10.28 0h6.86v3.43h-6.86V6.83Z"/><path fill="#FF8205" d="M3.43 10.26h17.14v3.43H3.43v-3.43Z"/><path fill="#FA500F" d="M3.43 13.69h3.43v3.42H3.43v-3.42Zm6.86 0h3.42v3.42h-3.42v-3.42Zm6.85 0h3.43v3.42h-3.43v-3.42Z"/><path fill="#E10500" d="M0 17.11h10.29v3.43H0v-3.43Zm13.71 0H24v3.43H13.71v-3.43Z"/></svg>',
    hunyuan:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#0055E9"/><path fill="#A8DFF5" d="M12 0c.52 0 1.03.03 1.53.1A6.19 6.19 0 0 1 12.12 12.28H12c-2.99 0-5.24 2.18-5.55 5.11-.23 2.09.35 4.41 2.24 6.15A12.01 12.01 0 0 1 0 12C0 5.37 5.37 0 12 0Z"/><path fill="#00BCFF" d="M12.98.04c.27.02.54.05.81.09.58.11 1.12.25 1.54.44 6.64 2.93 8.07 10.05 1.75 15.65a4.13 4.13 0 0 1-5.82-.36c-1.51-1.71-1.3-4.19.36-5.83.85-.85 3.1-1.22 4.04-2.44C16.92 5.96 17.78 1.58 13.13.09l-.15-.05Z"/></svg>',
    wenxin:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="wenxin-logo-fill" x1=".1" x2=".9" y1=".8" y2=".2"><stop offset="0" stop-color="#0A51C3"/><stop offset="1" stop-color="#23A4FB"/></linearGradient></defs><path fill="url(#wenxin-logo-fill)" d="M11.32 1.18a1.4 1.4 0 0 1 1.36 0l8.64 4.84c.42.23.68.67.68 1.14v9.68c0 .47-.26.91-.68 1.14l-8.64 4.84a1.4 1.4 0 0 1-1.36 0l-8.64-4.84A1.31 1.31 0 0 1 2 16.84V7.16c0-.47.26-.91.68-1.14l8.64-4.84Zm7.42 13.84V8.23L12 12v7.55l6.06-3.39c.42-.24.68-.67.68-1.14ZM12.68 4.83a1.39 1.39 0 0 0-1.36 0L5.94 7.85c-.42.23-.68.67-.68 1.14v6.03c0 .47.26.9.68 1.14l2.8 1.56v-6.63a1.55 1.55 0 0 1 .87-.6l5.87-3.29-2.8-1.57Z"/><path fill="#012F8D" d="M12 11.09c0-.88-.73-1.59-1.63-1.59-.3 0-.59.08-.86.24-.24.14-.43.32-.57.55-.13.2-.2.43-.2.66a1.53 1.53 0 0 0 .21.93c.3.5.85.79 1.41.79.28 0 .56-.07.81-.22l.82-.46v-.9Z"/></svg>',
    siliconcloud:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#7C3AED" d="M20.66 0h-1.74c-5.57 0-8.79 3.56-8.79 9.02v.94a7.16 7.16 0 1 0 5.05 5.45h5.48a2.62 2.62 0 1 0 0-5.25h-5.45V8.79c0-2.09 1.5-3.6 3.71-3.6h1.74a2.59 2.59 0 1 0 0-5.19ZM10.29 16.84a2.13 2.13 0 1 1-4.26-.1 2.13 2.13 0 0 1 4.26.1Z"/></svg>',
    spark:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#3DC8F9" d="M2 13.08c0-3.9 2.77-6.71 7.32-10.96-.65 7.88 6.41 8.27 5.02 12.21-.99 2.82-4.24 1.95-4.59 1.35 0 0 1.21.34 1.39-.87.17-1.21-2.25-1.86-3.81-4.94-2.6 2.99-.96 9.01 4.2 9.01 4.76 0 6.58-4.94 4.89-8.1 0 0 4.07.7 4.42 3.82.35 3.12-3.64 8.53-9.1 8.4C6.29 22.87 2 18.84 2 13.08Z"/><path fill="#EA0100" d="M17.85 6.11 11.62 0c-.52 5.93.86 8.37 4.89 9.49 2.73.75 3.3 1.04 4.5 2.77-.34-2.41-.78-3.81-3.16-6.15Z"/><path fill="#1652D8" d="M9.03 18.32c.71.36 1.55.56 2.5.56 4.76 0 6.58-4.94 4.89-8.1 0 0 4.07.7 4.42 3.82.16 1.4-.56 3.27-1.9 4.88-3.46 1.58-7.29.85-9.91-1.16Z"/></svg>',
    fal:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.48 0c.41 0 .75.34.79.75a7.78 7.78 0 0 0 6.98 6.99c.41.04.75.37.75.78v6.96c0 .41-.34.75-.75.78a7.78 7.78 0 0 0-6.98 6.99c-.04.41-.38.75-.79.75H8.52c-.41 0-.75-.34-.78-.75a7.78 7.78 0 0 0-6.99-6.99.8.8 0 0 1-.75-.78V8.52c0-.41.34-.74.75-.78A7.78 7.78 0 0 0 7.74.75c.03-.41.37-.75.78-.75h6.96ZM4.82 11.98a7.22 7.22 0 1 0 14.45 0 7.22 7.22 0 0 0-14.45 0Z"/></svg>',
    flux:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M0 20.68 12.01 2.5 24 20.68h-2.23L12.01 5.88 3.47 18.81h12.12l1.24 1.87H0Z"/><path fill="currentColor" d="m8.07 16.72 2.07-3.11 2.08 3.11H8.07Zm10.17 3.96-5.67-8.7h2.18l5.69 8.7h-2.2Zm1.5-9.01 2.13-3.18L24 11.67h-4.26Z"/></svg>',
    suno:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 0C20.64 0 24 5.37 24 12h-9c0 6.63-3.36 12-7.5 12S0 18.63 0 12h9c0-6.63 3.36-12 7.5-12Z"/></svg>',
    replicate:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 10.55v2.26h-7.93V22h-2.53V10.55H22ZM22 2v2.26H4.53V22H2V2h20Zm0 4.28v2.26H9.3V22H6.77V6.28H22Z"/></svg>',
    ideogram:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.77 1.48a6.4 6.4 0 0 1 2.99 3.78c.19.07.38.15.55.26a3.38 3.38 0 0 1 .6 5.41 3.38 3.38 0 0 1-.22 5.16l-.04.03.02.03a3.38 3.38 0 0 1-4.13 4.95 3.38 3.38 0 0 1-5.85.97c-.5.25-1.05.39-1.63.4-.04 0-.08.01-.13.01h-.9c-1.16-.07-1.09-1.78.01-1.78h.8a2.3 2.3 0 0 0 .09-4.6H2.81a.89.89 0 0 1 0-1.78h7.03a2.3 2.3 0 0 0 .47-4.59 2.2 2.2 0 0 0-.37-.04H2.81a.89.89 0 0 1 0-1.78h7.03a2.3 2.3 0 0 0 .09-4.6h-.9C7.87 3.24 7.94 1.55 9.04 1.55h.8c.44-.01.87.05 1.25.16a6.4 6.4 0 0 1 6.68-.23Zm-8.15 16.08a.89.89 0 0 1 0 1.78H5.94a.89.89 0 0 1 0-1.78h3.68Zm0-6.42a.89.89 0 1 1 0 1.78H.89a.89.89 0 0 1 0-1.78h8.73Zm-.01-6.43a.89.89 0 1 1 0 1.77H5.94a.89.89 0 1 1 0-1.77h3.67Z"/></svg>',
    midjourney:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.65 2.03C6.07 3.06 8.69 4.94 10.8 7.26c2.46 2.7 4.11 5.83 4.64 9.15.04.25-.21.43-.42.33-2.35-.94-4.54-1.25-6.59-1.02-1.74.2-3.34.8-4.82 1.7-.29.19-.62-.18-.4-.45 1.85-2.35 2.58-4.99 2.34-7.79-.2-2.3-1.04-4.61-2.29-6.71a.31.31 0 0 1 .39-.44ZM10.04 4.45c1.78.54 3.89 2.1 5.78 4.24 1.99 2.25 3.55 4.94 4.35 7.59.08.24-.18.45-.4.37-.85-.34-1.42-.57-2.66-.38a.31.31 0 0 1-.38-.22C15.38 11.12 13.07 7.28 9.78 5c-.3-.2-.07-.65.26-.55Z"/></svg>',
  };
  const raw = svgByBrand[brandId];
  if (!raw) {
    return null;
  }
  const template = document.createElement("template");
  template.innerHTML = raw.trim();
  return template.content.firstElementChild;
}

function getModelBrandLogoText(brandId) {
  const textByBrand = {
    openai: "◎",
    anthropic: "A",
    google: "✦",
    deepseek: "D",
    zhipu: "Z",
    doubao: "豆",
    kling: "K",
    midjourney: "M",
    flux: "F",
    grok: "𝕏",
    alibaba: "Q",
    moonshot: "月",
    minimax: "M",
    ollama: "O",
    mistral: "M",
    hunyuan: "混",
    vidu: "V",
    replicate: "R",
    wenxin: "文",
    siliconcloud: "S",
    spark: "星",
    fal: "F",
    luma: "L",
    runway: "R",
    ideogram: "I",
    suno: "S",
  };
  return textByBrand[brandId] ?? "•";
}

function formatModelCapabilityLabel(capability) {
  const labels = {
    text: "文本",
    vision: "视觉",
    image_generation: "图片",
    video_generation: "视频",
  };
  return labels[capability] ?? "模型";
}

function inferModelBrandId(modelName) {
  const name = String(modelName ?? "");
  const patterns = [
    [/^(gpt-|o[1-9]|dall-e|dalle|chatgpt|sora|codex)/iu, "openai"],
    [/^gpt[-_]?image/iu, "openai"],
    [/^(text-(embedding|babbage|curie|davinci|search)|davinci-|tts-|whisper)/iu, "openai"],
    [/^claude/iu, "anthropic"],
    [/^(gemini|gemma|veo|palm|bard)/iu, "google"],
    [/^google\//iu, "google"],
    [/^deepseek/iu, "deepseek"],
    [/^(glm|cogview|cogvideo|chatglm)/iu, "zhipu"],
    [/^(doubao|seed[- ]?oss)/iu, "doubao"],
    [/^(doubao-)?seed(ance|dream)/iu, "doubao"],
    [/^kling/iu, "kling"],
    [/^(mj_|midjourney|niji)/iu, "midjourney"],
    [/^(flux[-_.]|black-forest)/iu, "flux"],
    [/^grok/iu, "grok"],
    [/^(qwen|wan|tongyi|alibaba|bailian|qvq|qwq)/iu, "alibaba"],
    [/^(moonshot|kimi)/iu, "moonshot"],
    [/^(minimax|hailuo|speech-|audio[0-9]|mimo)/iu, "minimax"],
    [/^(ollama|llama|meta-llama)/iu, "ollama"],
    [/^(mistral|mixtral|dolphin)/iu, "mistral"],
    [/^hunyuan/iu, "hunyuan"],
    [/^luma/iu, "luma"],
    [/^(runway|runwayml)/iu, "runway"],
    [/^vidu/iu, "vidu"],
    [/^(replicate|andreasjansson|stability-ai|cjwbw|lucataco|recraft-ai|riffusion|sujaykhandekar|prunaai)/iu, "replicate"],
    [/^(ernie|wenxin|Embedding-V)/u, "wenxin"],
    [/^(silicon|BAAI|Pro\/BAAI)/u, "siliconcloud"],
    [/^(spark|sparkdesk)/iu, "spark"],
    [/^fal[-_]ai\//iu, "fal"],
    [/^ideogram/iu, "ideogram"],
    [/^suno/iu, "suno"],
  ];
  return patterns.find(([pattern]) => pattern.test(name))?.[1] ?? "other";
}

function inferModelFamily(modelName) {
  const name = String(modelName ?? "").toLowerCase();
  if (name.includes("seedance")) return "Seedance";
  if (name.includes("seedream")) return "Seedream";
  if (name.startsWith("gpt-image")) return "GPT Image";
  if (name.startsWith("gemini")) return "Gemini";
  if (name.startsWith("sora")) return "Sora";
  if (name.startsWith("wan")) return "Wan";
  if (name.startsWith("kling")) return "Kling";
  if (name.startsWith("grok")) return "Grok";
  return String(modelName ?? "Model").split(/[/-]/u)[0] || "Model";
}

function createEndpointTable(provider) {
  const row = createSettingsRow("POST 路径");
  const table = document.createElement("table");
  table.className = "settings-endpoint-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>用途</th><th>方法</th><th>路径</th></tr>";
  const body = document.createElement("tbody");
  const endpoints = (provider.endpoints ?? []).filter((endpoint) => endpoint.method === "POST");
  for (const endpoint of endpoints) {
    const tr = document.createElement("tr");
    for (const value of [endpoint.label, endpoint.method, endpoint.path]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  row.append(table);
  return row;
}

function createSettingsRow(labelText) {
  const row = document.createElement("div");
  row.className = "settings-form-row";
  const label = document.createElement("label");
  label.textContent = labelText;
  row.append(label);
  return row;
}

function createSettingsFooter({
  hint,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  tertiaryLabel,
  onTertiary,
}) {
  const footer = document.createElement("div");
  footer.className = "settings-savebar";
  const left = document.createElement("div");
  const hintText = document.createElement("small");
  hintText.textContent = hint;
  const feedback = document.createElement("small");
  feedback.className = "settings-feedback";
  feedback.dataset.settingsFeedback = "";
  left.append(hintText, feedback);
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const cancel = document.createElement("button");
  cancel.className = "secondary-button";
  cancel.type = "button";
  cancel.textContent = "取消更改";
  cancel.addEventListener("click", renderSettingsSurface);
  const save = document.createElement("button");
  save.className = "primary-button";
  save.type = "button";
  save.textContent = primaryLabel;
  save.addEventListener("click", async () => {
    await onPrimary();
  });
  actions.append(cancel);
  if (secondaryLabel && onSecondary) {
    const secondary = document.createElement("button");
    secondary.className = "secondary-button";
    secondary.type = "button";
    secondary.textContent = secondaryLabel;
    secondary.addEventListener("click", async () => {
      await onSecondary();
    });
    actions.append(secondary);
  }
  if (tertiaryLabel && onTertiary) {
    const tertiary = document.createElement("button");
    tertiary.className = "secondary-button";
    tertiary.type = "button";
    tertiary.textContent = tertiaryLabel;
    tertiary.addEventListener("click", async () => {
      await onTertiary();
    });
    actions.append(tertiary);
  }
  actions.append(save);
  footer.append(left, actions);
  return footer;
}

function createSettingsEmptyState(copy) {
  const empty = document.createElement("div");
  empty.className = "settings-empty";
  empty.textContent = copy;
  return empty;
}

function findSettingsProvider(providers) {
  return (
    providers.find((provider) => provider.id === state.selectedApiProviderId) ??
    providers[0] ??
    null
  );
}

async function saveSettingsSwitchRows(table) {
  const changes = Array.from(table.querySelectorAll("input[data-parameter-id]")).filter(
    (input) => String(input.checked) !== input.dataset.originalValue,
  );
  if (changes.length === 0) {
    setSettingsFeedback("没有需要保存的开关变化。");
    return;
  }

  setRunning(true);
  let lastResult = null;
  for (const input of changes) {
    lastResult = await invokeBridge({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: input.dataset.parameterId,
      value: input.checked,
    });
    if (!lastResult) {
      break;
    }
  }
  setRunning(false);
  if (lastResult) {
    await renderBridgeResult(lastResult);
    setSettingsFeedback(`已保存 ${changes.length} 个开关。`);
  }
}

async function saveSettingsNumberRows(table) {
  const changes = Array.from(table.querySelectorAll("input[data-parameter-id]")).filter(
    (input) => String(input.value) !== input.dataset.originalValue,
  );
  if (changes.length === 0) {
    setSettingsFeedback("没有需要保存的运行参数变化。");
    return;
  }

  setRunning(true);
  let lastResult = null;
  for (const input of changes) {
    lastResult = await invokeBridge({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: input.dataset.parameterId,
      value: Number.parseFloat(input.value),
    });
    if (!lastResult) {
      break;
    }
  }
  setRunning(false);
  if (lastResult) {
    await renderBridgeResult(lastResult);
    setSettingsFeedback(`已保存 ${changes.length} 个运行参数。`);
  }
}

async function saveMcpServerSettings(form, previous) {
  const value = readMcpServerFormValue(form, previous);
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.MCP_SERVER_UPSERT,
    ...value,
  });
  setRunning(false);
  if (result) {
    state.selectedMcpServerName = value.serverName;
    await renderBridgeResult(result);
    setSettingsFeedback(`${value.serverName} 已保存；下一轮对话会重新加载 MCP 配置。`);
  }
}

async function saveMcpToolSelectionSettings(form, previous) {
  const value = readMcpServerFormValue(form, previous);
  if (!value.serverName) {
    return;
  }
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.MCP_SERVER_TOOL_SELECTION_SET,
    serverName: value.serverName,
    ...(value.include === undefined ? {} : { include: value.include }),
    ...(value.exclude === undefined ? {} : { exclude: value.exclude }),
  });
  setRunning(false);
  if (result) {
    state.selectedMcpServerName = value.serverName;
    await renderBridgeResult(result);
    setSettingsFeedback(`${value.serverName} 的 MCP 工具选择已保存；下一轮对话刷新后生效。`);
  }
}

async function testMcpServerSettings(serverName) {
  if (!serverName) {
    return;
  }
  setRunning(true);
  setSettingsFeedback(`${serverName} 正在测试 MCP 连接...`);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.MCP_SERVER_TEST,
    serverName,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    const test = result.mcpTest;
    setSettingsFeedback(test?.message ?? `${serverName} 测试完成。`);
  }
}

async function deleteMcpServerSettings(serverName) {
  if (!serverName) {
    return;
  }
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.MCP_SERVER_DELETE,
    serverName,
  });
  setRunning(false);
  if (result) {
    state.selectedMcpServerName = null;
    await renderBridgeResult(result);
    setSettingsFeedback(`${serverName} 已删除。`);
  }
}

async function loginMcpServerSettings(serverName) {
  if (!serverName) {
    return;
  }
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.MCP_LOGIN,
    serverName,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback(result.mcpLogin?.message ?? `${serverName} 需要登录授权。`);
  }
}

async function revokeMcpServerSettings(serverName) {
  if (!serverName) {
    return;
  }
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.MCP_REVOKE,
    serverName,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback(result.mcpRevoke?.message ?? `${serverName} 授权已清理。`);
  }
}

async function refreshMcpSettings() {
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.MCP_REFRESH,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback("MCP 状态已刷新。");
  }
}

function readMcpServerFormValue(form, previous) {
  const readField = (field) => form.querySelector(`[data-field='${field}']`)?.value ?? "";
  const enabled = form.querySelector("[data-field='mcp-enabled']")?.checked === true;
  const toolCheckboxes = Array.from(form.querySelectorAll("input[data-mcp-tool-name]"));
  const include =
    toolCheckboxes.length === 0
      ? previous?.selection?.include
      : toolCheckboxes.filter((input) => input.checked).map((input) => input.value);
  const serverName = readField("mcp-server-name").trim();
  return {
    serverName,
    transport: readField("mcp-transport") || "stdio",
    enabled,
    command: readField("mcp-command").trim(),
    args: parseDelimitedList(readField("mcp-args")),
    url: readField("mcp-url").trim(),
    env: parseKeyValueTextarea(readField("mcp-env")),
    headers: parseKeyValueTextarea(readField("mcp-headers")),
    auth: readField("mcp-auth") || "none",
    ...(readField("mcp-timeout-ms").trim()
      ? { timeoutMs: Number.parseInt(readField("mcp-timeout-ms"), 10) }
      : {}),
    ...(include === undefined ? {} : { include }),
  };
}

function parseKeyValueTextarea(value) {
  const entries = {};
  for (const line of String(value ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    if (key.trim()) {
      entries[key.trim()] = rest.join("=").trim();
    }
  }
  return entries;
}

function formatKeyValueTextarea(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  return Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
    .map(([key, entry]) => `${key}=${entry}`)
    .join("\n");
}

function formatMcpStatusLabel(status) {
  const labels = {
    connected: "已连接",
    failed: "失败",
    "needs-auth": "需登录",
    disabled: "已禁用",
  };
  return labels[status] ?? status ?? "未知";
}

async function runWeixinGatewayOperation(operation) {
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
    operation,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    const labels = {
      status: "已刷新微信网关状态。",
      start: "已请求启动微信网关。",
      stop: "已请求停止微信网关。",
      restart: "已请求重启微信网关。",
    };
    const control = result.weixinGatewayControl;
    if (control?.ok === false) {
      setSettingsFeedback(control.message ?? "微信网关操作失败，请查看状态和日志。");
    } else {
      setSettingsFeedback(control?.message ?? labels[operation] ?? "微信网关操作已完成。");
    }
  }
}

async function startWeixinGatewayLogin() {
  clearWeixinLoginPolling();
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_START,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    const login = result.weixinLogin ?? result.snapshot?.assets?.settings?.weixinGateway?.login;
    setSettingsFeedback(login?.message ?? "微信二维码已生成，请用手机微信扫码。");
  }
}

async function selectWeixinGatewayAccount(accountId) {
  if (!accountId) {
    return;
  }
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_ACCOUNT_SELECT,
    accountId,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback("微信通信账号已切换。");
  }
}

async function pollWeixinGatewayLogin(verifyCode = "", options = {}) {
  if (!options.silent) {
    setRunning(true);
  }
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_POLL,
    ...(verifyCode ? { verifyCode } : {}),
  });
  if (!options.silent) {
    setRunning(false);
  }
  if (!result) {
    return;
  }
  await renderBridgeResult(result);
  const login = result.weixinLogin ?? result.snapshot?.assets?.settings?.weixinGateway?.login;
  if (login?.status === "confirmed") {
    clearWeixinLoginPolling();
    setSettingsFeedback("微信已连接，网关已启动。");
  } else if (login?.needVerifyCode) {
    clearWeixinLoginPolling();
    setSettingsFeedback("微信要求验证码，请输入手机微信显示的数字验证码。");
  } else if (login?.pending === false) {
    clearWeixinLoginPolling();
    setSettingsFeedback(login.message ?? "微信登录已结束。");
  }
}

function ensureWeixinLoginPolling(login) {
  if (!login?.pending || login.needVerifyCode) {
    clearWeixinLoginPolling();
    return;
  }
  if (
    state.weixinLoginPollTimerId !== null &&
    state.weixinLoginPollSessionKey === login.sessionKey
  ) {
    return;
  }
  clearWeixinLoginPolling();
  state.weixinLoginPollSessionKey = login.sessionKey;
  state.weixinLoginPollTimerId = window.setInterval(async () => {
    if (state.selectedSettingsTab !== "communications" || state.running) {
      return;
    }
    await pollWeixinGatewayLogin("", { silent: true });
  }, 1800);
}

function clearWeixinLoginPolling() {
  if (state.weixinLoginPollTimerId !== null) {
    window.clearInterval(state.weixinLoginPollTimerId);
    state.weixinLoginPollTimerId = null;
  }
  state.weixinLoginPollSessionKey = null;
}

function formatWeixinLoginStatus(login, account) {
  if (login && login.status !== "idle") {
    return login.message ?? "等待微信登录状态更新。";
  }
  if (account?.loggedIn) {
    const id = account.primaryId ?? "已登录账号";
    return `已连接：${id}`;
  }
  return "未连接微信。点击“连接微信”后会显示二维码。";
}

async function saveCostBudgetSettings(value) {
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.COST_BUDGET_SET,
    ...value,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback("成本预算已保存。");
  }
}

function createReadonlyRow(labelText, valueText) {
  const row = document.createElement("div");
  row.className = "settings-readonly-row";
  const label = document.createElement("span");
  label.textContent = labelText;
  const value = document.createElement("code");
  value.textContent = String(valueText ?? "");
  row.append(label, value);
  return row;
}

function createReadonlyList(titleText, items) {
  const block = document.createElement("div");
  block.className = "settings-readonly-list";
  const title = document.createElement("strong");
  title.textContent = titleText;
  block.append(title);
  if (items.length === 0) {
    const empty = document.createElement("small");
    empty.textContent = "无";
    block.append(empty);
    return block;
  }
  for (const item of items) {
    const row = document.createElement("small");
    row.textContent = item;
    block.append(row);
  }
  return block;
}

function createMetricBlock(labelText, valueText) {
  const block = document.createElement("div");
  block.className = "settings-metric";
  const label = document.createElement("span");
  label.textContent = labelText;
  const value = document.createElement("strong");
  value.textContent = String(valueText);
  block.append(label, value);
  return block;
}

async function saveApiProviderSettings(provider, formValue) {
  const updates = [];
  if (formValue.enabled !== provider.enabled) {
    updates.push({ key: "enabled", value: formValue.enabled });
  }
  const baseUrl = formValue.baseUrl.trim();
  if (baseUrl && baseUrl !== provider.baseUrl) {
    updates.push({ key: "baseUrl", value: baseUrl });
  }
  const apiKey = normalizeApiKeyList(formValue.apiKey);
  if (apiKey) {
    updates.push({ key: "apiKey", value: apiKey });
  }
  const models = parseDelimitedList(formValue.models);
  if (models.length > 0 && models.join("\n") !== provider.models.join("\n")) {
    updates.push({ key: "models", value: models.join("\n") });
  }
  for (const [key, value] of [
    ["defaultTextModel", formValue.defaultTextModel],
    ["defaultVisionModel", formValue.defaultVisionModel],
    ["defaultImageModel", formValue.defaultImageModel],
    ["defaultVideoModel", formValue.defaultVideoModel],
  ]) {
    const nextValue = value.trim();
    if (nextValue && nextValue !== resolveProviderDefaultModel(provider, key)) {
      updates.push({ key, value: nextValue });
    }
  }

  if (updates.length === 0) {
    setResultOutput(`${provider.name} 没有需要保存的变化。`);
    setSettingsFeedback(`${provider.name} 没有需要保存的变化。`);
    if (getActiveWorkflow()?.id !== "settings") {
      selectInspectorPanel("result");
    }
    return;
  }

  setRunning(true);
  let lastResult = null;
  for (const update of updates) {
    lastResult = await invokeBridge({
      type: DESKTOP_ACTIONS.API_PROVIDER_SET,
      providerId: provider.id,
      key: update.key,
      value: update.value,
    });
    if (!lastResult) {
      break;
    }
  }
  setRunning(false);

  if (lastResult) {
    await renderBridgeResult(lastResult);
    setResultOutput(`${provider.name} 已保存 ${updates.length} 项设置。`);
    setSettingsFeedback(`${provider.name} 已保存 ${updates.length} 项设置。`);
    if (getActiveWorkflow()?.id !== "settings") {
      selectInspectorPanel("result");
    }
  }
}

async function testApiProviderSettings(provider, formValue) {
  const apiKey = normalizeApiKeyList(formValue.apiKey);
  const baseUrl = formValue.baseUrl.trim();
  setRunning(true);
  setSettingsFeedback(`${provider.name} 正在测试 API Key...`);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.API_PROVIDER_TEST,
    providerId: provider.id,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
  setRunning(false);
  if (!result) {
    return;
  }

  for (const event of result.events ?? []) {
    appendTimelineMessage(event);
  }
  const testResult = result.apiProviderTest;
  if (!testResult) {
    setSettingsFeedback(`${provider.name} 测试完成，但后端没有返回测试结果。`);
    return;
  }
  const feedback = formatApiProviderTestFeedback(testResult);
  setSettingsFeedback(feedback);
  setResultOutput(`${provider.name} ${feedback}\n接口：${testResult.endpoint}`);
}

async function syncApiProviderModels(provider, formValue) {
  const apiKey = normalizeApiKeyList(formValue.apiKey);
  const baseUrl = formValue.baseUrl.trim();
  setRunning(true);
  setSettingsFeedback(`${provider.name} 正在同步模型池...`);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.API_PROVIDER_SYNC_MODELS,
    providerId: provider.id,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
  setRunning(false);
  if (!result) {
    return;
  }

  for (const event of result.events ?? []) {
    appendTimelineMessage(event);
  }
  const syncResult = result.apiProviderModelSync;
  if (!syncResult) {
    setSettingsFeedback(`${provider.name} 同步完成，但后端没有返回模型池结果。`);
    return;
  }
  const feedback = syncResult.ok
    ? `模型池已同步：${syncResult.count} 个模型，${syncResult.metadataCount} 个动态元数据。`
    : syncResult.message;
  setSettingsFeedback(feedback);
  renderApiProviderModelSyncResult(syncResult);
  if (result.snapshot) {
    renderSnapshot(result.snapshot);
    renderSettingsSurface();
  }
}

async function openRecommendedPurchase(provider) {
  setRunning(true);
  setSettingsFeedback("正在打开 memefast.top 推荐开通入口...");
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.SETTINGS_OPEN_RECOMMENDED_PURCHASE,
  });
  setRunning(false);
  if (!result) {
    return;
  }
  for (const event of result.events ?? []) {
    appendTimelineMessage(event);
  }
  const purchaseResult = result.recommendedPurchase;
  const providerName = provider?.name ?? "API Provider";
  if (purchaseResult?.ok) {
    setSettingsFeedback(`${providerName} 推荐开通入口已打开：${purchaseResult.url}`);
    setResultOutput(
      `${providerName} 推荐开通入口已打开。\n链接：${purchaseResult.url}\n边界：Director Angel 只打开外部页面，不代存支付信息。`,
    );
  } else {
    setSettingsFeedback(purchaseResult?.message ?? "推荐开通入口打开失败。");
  }
}

async function saveComfyUiSettings(comfyUi, formValue) {
  const updates = [];
  if (formValue.enabled !== comfyUi.enabled) {
    updates.push({ key: "enabled", value: formValue.enabled });
  }
  for (const key of [
    "mode",
    "baseUrl",
    "defaultWorkflowPath",
    "outputDir",
    "positivePromptNodeId",
    "positivePromptInputName",
  ]) {
    const nextValue = String(formValue[key] ?? "").trim();
    const previousValue = String(comfyUi[key] ?? "").trim();
    if (nextValue !== previousValue) {
      updates.push({ key, value: nextValue });
    }
  }
  const apiKey = normalizeApiKeyList(formValue.apiKey);
  if (apiKey) {
    updates.push({ key: "apiKey", value: apiKey });
  }

  if (updates.length === 0) {
    setSettingsFeedback("ComfyUI 没有需要保存的变化。");
    return;
  }

  setRunning(true);
  let lastResult = null;
  for (const update of updates) {
    lastResult = await invokeBridge({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: "comfyui",
      operation: "update",
      settings: {
        [update.key]: update.value,
      },
    });
    if (!lastResult) {
      break;
    }
  }
  setRunning(false);

  if (lastResult) {
    await renderBridgeResult(lastResult);
    setSettingsFeedback(`ComfyUI 已保存 ${updates.length} 项设置。`);
  }
}

async function manageExternalProvider(toolId, operation) {
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
    toolId,
    operation,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback(`Provider ${operation} 已处理。`);
  }
}

async function runExternalToolSetupGuidanceAction(guidance) {
  if (guidance.state === "needs-auth") {
    setSettingsFeedback(`provider.setup.needs-auth：${guidance.toolLabel} 请在下方 Provider/MCP 表单完成授权。`);
    if (guidance.toolId.startsWith("mcp:")) {
      await refreshMcpSettings();
    }
    return;
  }
  if (guidance.state === "install") {
    setRunning(true);
    setSettingsFeedback(`provider.setup.install：正在生成 ${guidance.toolLabel} 安装计划...`);
    const result = await invokeBridge({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: guidance.toolId,
      operation: "install",
      dryRun: true,
    });
    setRunning(false);
    if (result) {
      await renderBridgeResult(result);
      setSettingsFeedback(`${guidance.toolLabel} 安装计划已生成，执行前仍需要 operator 确认。`);
    }
    return;
  }
  if (guidance.state === "reconnect") {
    setRunning(true);
    setSettingsFeedback(`provider.setup.reconnect：正在重连 ${guidance.toolLabel}...`);
    const result = await invokeBridge({
      type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
      toolId: guidance.toolId,
      operation: "enable",
    });
    setRunning(false);
    if (result) {
      await renderBridgeResult(result);
      setSettingsFeedback(`${guidance.toolLabel} 已发送重连请求。`);
    }
    return;
  }
  if (guidance.state === "last-known-good") {
    setSettingsFeedback(`provider.setup.last-known-good：${guidance.detail}`);
  }
}

async function saveExternalProviderSettings(toolId, provider, form) {
  const settings = {};
  for (const field of provider.configFields ?? []) {
    if (field.key === "enabled") {
      continue;
    }
    const input = form.querySelector(`[data-field='provider-${provider.id}-${field.key}']`);
    const raw = input?.value ?? "";
    const value = field.kind === "secret" ? normalizeApiKeyList(raw) : String(raw).trim();
    if (value.length > 0) {
      settings[field.key] = value;
    }
  }
  if (Object.keys(settings).length === 0) {
    setSettingsFeedback("Provider 没有需要保存的变化。");
    return;
  }
  setRunning(true);
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
    toolId,
    operation: "update",
    settings,
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback(`${provider.label ?? provider.id} Provider 已保存。`);
  }
}

async function manageBrowserProvider(operation, settings = {}) {
  setRunning(true);
  setSettingsFeedback(
    operation === "delete"
      ? "Browser 正在清理会话..."
      : operation === "disable"
        ? "Browser 正在断开..."
        : settings.profile === "angel"
          ? "Angel Chrome 正在启动..."
          : settings.profile === "user"
            ? "真实 Chrome 正在连接..."
            : "Browser 正在连接...",
  );
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE,
    toolId: "browser",
    operation,
    ...(Object.keys(settings).length === 0 ? {} : { settings }),
  });
  setRunning(false);
  if (result) {
    await renderBridgeResult(result);
    setSettingsFeedback(
      operation === "delete"
        ? "Browser 会话已清理。"
        : operation === "disable"
          ? "Browser 已断开。"
          : settings.profile === "angel"
            ? "Angel Chrome 启动动作已完成，请查看功能台状态。"
            : settings.profile === "user"
              ? "真实 Chrome 连接动作已完成，请查看功能台状态。"
              : "Browser 已连接。",
    );
  }
}

async function testComfyUiSettings(formValue) {
  const apiKey = normalizeApiKeyList(formValue.apiKey);
  const baseUrl = formValue.baseUrl.trim();
  setRunning(true);
  setSettingsFeedback("ComfyUI 正在测试连接...");
  const result = await invokeBridge({
    type: DESKTOP_ACTIONS.COMFYUI_TEST,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
  setRunning(false);
  if (!result) {
    return;
  }
  for (const event of result.events ?? []) {
    appendTimelineMessage(event);
  }
  const testResult = result.comfyUiTest;
  if (!testResult) {
    setSettingsFeedback("ComfyUI 测试完成，但后端没有返回测试结果。");
    return;
  }
  const feedback = testResult.ok
    ? "ComfyUI 测试通过。"
    : testResult.message || "ComfyUI 测试失败，请检查地址、Key 或服务状态。";
  setSettingsFeedback(feedback);
  setResultOutput(`${feedback}\n接口：${testResult.endpoint}`);
}

function formatApiProviderTestFeedback(testResult) {
  if (testResult.ok) {
    const modelCopy =
      typeof testResult.modelCount === "number" ? `，返回 ${testResult.modelCount} 个模型` : "";
    return `测试通过${modelCopy}。`;
  }
  return testResult.message || "测试失败，请检查 API Key、Base URL 或网络。";
}

function resolveProviderDefaultModel(provider, key) {
  const defaults = provider.defaultModels ?? {};
  const map = {
    defaultTextModel: defaults.text,
    defaultVisionModel: defaults.vision,
    defaultImageModel: defaults.image_generation,
    defaultVideoModel: defaults.video_generation,
  };
  return map[key] ?? "";
}

function parseDelimitedList(value) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/[,\n]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  if (state.selectedGroupId === "experience") {
    state.selectedCommandId = resolveRecommendedCommandId() ?? state.selectedCommandId;
  }
  const experienceItems = snapshot.candidate.items ?? [];
  const knowledgeCandidates = snapshot.knowledge.candidates ?? [];
  const latestPublished = snapshot.knowledge.latestPublished;
  setHealth(snapshot.health.label, mapHealthTone(snapshot.health.state));
  setText(elements.workspacePath, snapshot.workspaceRoot ?? "");
  setText(elements.candidateCount, String(snapshot.candidate.count ?? 0));
  setText(elements.knowledgeCount, String(snapshot.knowledge.count ?? 0));
  setText(elements.recallState, snapshot.recall.state ?? "miss");
  setText(elements.candidateState, snapshot.candidate.status ?? "none");
  setText(elements.knowledgeState, snapshot.knowledge.candidateStatus ?? "none");
  elements.candidateState.className = `status-pill ${mapCandidateTone(snapshot.candidate.status)}`;
  elements.knowledgeState.className = `status-pill ${mapCandidateTone(snapshot.knowledge.candidateStatus)}`;
  renderStatusList(snapshot);
  renderBackgroundLearningList(snapshot.assets?.learning);
  renderExperienceList(experienceItems);
  renderKnowledgeList(knowledgeCandidates, latestPublished);
  renderSkillList(snapshot.assets?.skills?.items ?? []);
  renderToolList(snapshot.assets?.tools?.items ?? []);
  renderSettingsList(snapshot.assets?.settings?.parameters ?? [], snapshot.assets?.settings);
  renderRecallList(snapshot.recall.hits ?? [], snapshot.recall.copy);
  state.directorConsole.projection = resolveDirectorConsoleProjection(snapshot);
  renderDirectorConsole();
  if (snapshot.assets?.tools?.taskRuntime) {
    applyTaskRuntimeSnapshot(snapshot.assets.tools.taskRuntime);
  } else {
    scheduleRunCenterRender();
  }
  renderCatalog();
  renderQuickActions();
  renderSelectedCommand();
  syncHeartbeatAutoScan(snapshot);
  if (snapshot.activePanel) {
    selectInspectorPanel(snapshot.activePanel);
  }
}

function resolveDirectorConsoleProjection(snapshot) {
  return (
    snapshot?.directorConsole?.projection ??
    snapshot?.assets?.directorConsole?.projection ??
    snapshot?.assets?.review?.directorConsole?.projection ??
    snapshot?.assets?.tools?.directorConsole?.projection ??
    null
  );
}

function syncHeartbeatAutoScan(snapshot) {
  const enabled = findSettingsParameter(snapshot, "feature:heartbeat.enabled")?.value === true;
  if (!enabled || !bridge) {
    stopHeartbeatAutoScan();
    return;
  }

  const intervalMs = resolveHeartbeatAutoScanIntervalMs(snapshot);
  if (state.heartbeatTimerId !== null && state.heartbeatIntervalMs === intervalMs) {
    return;
  }

  stopHeartbeatAutoScan();
  state.heartbeatIntervalMs = intervalMs;
  state.heartbeatTimerId = window.setInterval(runHeartbeatAutoScan, intervalMs);
  window.setTimeout(runHeartbeatAutoScan, 500);
}

function stopHeartbeatAutoScan() {
  if (state.heartbeatTimerId === null) {
    return;
  }
  window.clearInterval(state.heartbeatTimerId);
  state.heartbeatTimerId = null;
}

function resolveHeartbeatAutoScanIntervalMs(snapshot) {
  const parameter = findSettingsParameter(snapshot, "runtime:heartbeat.intervalMs");
  const value = Number(parameter?.value);
  if (Number.isFinite(value)) {
    return Math.min(300000, Math.max(15000, Math.trunc(value)));
  }
  return 60000;
}

function findSettingsParameter(snapshot, parameterId) {
  return (snapshot?.assets?.settings?.parameters ?? []).find(
    (parameter) => parameter.id === parameterId,
  );
}

async function runHeartbeatAutoScan() {
  if (!bridge || state.heartbeatRunning || state.running) {
    return;
  }
  state.heartbeatRunning = true;
  try {
    const action = resolveHeartbeatBackgroundAction(state.snapshot);
    const result = await bridge.invoke(action);
    if (result?.snapshot) {
      renderSnapshot(result.snapshot);
    }
    if (action.type === DESKTOP_ACTIONS.SELF_REFLECTION_DAILY && result?.selfReflectionReport) {
      state.lastSelfReflectionDate = result.selfReflectionReport.window?.date ?? action.date;
    }
  } catch {
    stopHeartbeatAutoScan();
  } finally {
    state.heartbeatRunning = false;
  }
}

function resolveHeartbeatBackgroundAction(snapshot) {
  const date = todayKey();
  const selfReflectionEnabled =
    findSettingsParameter(snapshot, "feature:selfReflection.enabled")?.value === true;
  if (selfReflectionEnabled && state.lastSelfReflectionDate !== date) {
    return {
      type: DESKTOP_ACTIONS.SELF_REFLECTION_DAILY,
      background: true,
      date,
    };
  }
  return {
    type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
    background: true,
  };
}

function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderStatusList(snapshot) {
  const assets = snapshot.assets ?? {};
  const pendingLearningConfirmations = assets.learning?.pendingConfirmationCount ?? 0;
  const rows = [
    {
      label: "经验库",
      meta: `${assets.experience?.total ?? snapshot.candidate.count ?? 0} 条经验 · ${
        assets.experience?.publishedCount ?? snapshot.knowledge.publishedCount ?? 0
      } 已发布 · ${assets.experience?.quarantineCount ?? 0} 隔离 · 待确认经验 ${pendingLearningConfirmations}`,
    },
    {
      label: "Skills",
      meta: `${assets.skills?.selfCount ?? 0} 自进化 · ${assets.skills?.externalCount ?? 0} 外部`,
    },
    {
      label: "外部工具",
      meta: `${countExternalToolItems(assets.tools)} 个工具 · ${countExternalToolBusCallableItems(
        assets.tools?.externalToolBus,
      )} 可调用 · ${assets.tools?.enabledCount ?? 0} 配置已启用 · ${
        assets.tools?.registeredCount ?? 0
      } 已注册`,
    },
    {
      label: "运行与审查",
      meta: `${assets.review?.pendingCount ?? 0} 待处理 · 待确认经验 ${pendingLearningConfirmations} · ${
        snapshot.recall.state ?? "miss"
      }`,
    },
    ...createAngelRoleStatusRows(assets.settings),
    ...createBackgroundLearningStatusRows(assets.learning),
  ];
  setText(elements.statusCount, String(rows.length));
  replaceChildren(elements.statusList, rows, (row) => {
    const item = document.createElement("div");
    item.className = "session-row active-session";
    const label = document.createElement("span");
    label.textContent = row.label;
    const meta = document.createElement("small");
    meta.textContent = row.meta;
    item.append(label, meta);
    return item;
  });
}

function createAngelRoleStatusRows(settings) {
  const role = settings?.angelRoleProfile;
  if (!role) {
    return [];
  }
  const roleName = role.title ?? role.roleId ?? "岗位 Angel";
  const sourceLabel = formatAngelRoleSourceLabel(role);
  const scope = Array.isArray(role.learningScope) && role.learningScope.length > 0
    ? role.learningScope.slice(0, 3).join("、")
    : (role.domain ?? "岗位范围");
  return [
    {
      label: "岗位配置",
      meta: `当前岗位 ${roleName} · 来源 ${sourceLabel} · ${scope}`,
    },
  ];
}

function formatAngelRoleSourceLabel(role) {
  if (typeof role?.sourceLabel === "string" && role.sourceLabel.trim().length > 0) {
    return role.sourceLabel.trim();
  }
  if (role?.source === "default") {
    return "内置默认";
  }
  return "未标注";
}

function createBackgroundLearningStatusRows(learning) {
  const backgroundItems = resolveBackgroundLearningItems(learning);
  if (backgroundItems.length === 0) {
    return [];
  }
  const latest = backgroundItems[0];
  const roleName = latest.roleName ?? "岗位 Angel";
  const focus = Array.isArray(latest.learningScope) && latest.learningScope.length > 0
    ? latest.learningScope.join("、")
    : latest.roleDomain ?? "岗位范围";
  const trigger = formatBackgroundLearningTrigger(latest.triggerReason);
  return [
    {
      label: "后台学习",
      meta: `${backgroundItems.length} 条待审 · ${roleName} · ${focus} · ${trigger} · 只生成候选`,
    },
  ];
}

function renderBackgroundLearningList(learning) {
  const items = resolveBackgroundLearningItems(learning);
  replaceChildren(elements.backgroundLearningList, items, createBackgroundLearningCard);
}

function resolveBackgroundLearningItems(learning) {
  const pending = Array.isArray(learning?.pendingConfirmations)
    ? learning.pendingConfirmations
    : [];
  return [
    ...pending.filter(isBackgroundLearningItem),
    ...state.backgroundLearningEvents,
  ];
}

function rememberBackgroundLearningRuntimeEvent(event) {
  const item = createBackgroundLearningItemFromRuntimeEvent(event);
  if (item === null) {
    return;
  }
  state.backgroundLearningEvents = [item, ...state.backgroundLearningEvents]
    .filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.backgroundEventId === entry.backgroundEventId) ===
        index,
    )
    .slice(0, 6);
  renderBackgroundLearningList(state.snapshot?.assets?.learning);
  if (state.snapshot) {
    renderStatusList(state.snapshot);
  }
}

function createBackgroundLearningItemFromRuntimeEvent(event) {
  const jobIds = Array.isArray(event.backgroundWorker?.jobIds)
    ? event.backgroundWorker.jobIds
    : Array.isArray(event.backgroundScheduler?.applyReport?.upsertedJobIds)
      ? event.backgroundScheduler.applyReport.upsertedJobIds
      : [];
  const isLearningEvent = jobIds.some((jobId) => String(jobId).includes("role-learning"));
  if (!isLearningEvent) {
    return null;
  }
  const completed = Number(event.backgroundWorker?.completedCount ?? 0);
  const dispatched = Number(event.backgroundScheduler?.dispatchedCount ?? 0);
  return {
    backgroundEventId: `${event.actionType}:${jobIds.join(",")}:${completed}:${dispatched}`,
    roleName: "导演 Angel",
    roleDomain: "影视制作与 AI 工作流",
    learningScope: ["短剧制作", "AI 分镜"],
    triggerReason: "schedule:role-learning",
    candidateOnly: true,
    autoPublish: false,
    summary:
      completed > 0
        ? `后台学习执行完成：${completed} 个任务已收口。`
        : `后台学习已调度：${dispatched} 个任务进入队列。`,
  };
}

function isBackgroundLearningItem(item) {
  return (
    item?.roleScopedScheduledLearning === true ||
    typeof item?.triggerReason === "string" ||
    item?.candidateOnly === true ||
    item?.autoPublish === false
  );
}

function createBackgroundLearningCard(item) {
  const card = document.createElement("article");
  card.className = "background-learning-card";
  card.setAttribute("aria-label", "后台学习队列");
  const title = document.createElement("strong");
  title.textContent = item.roleName ?? "岗位 Angel";
  const summary = document.createElement("p");
  summary.textContent = item.summary ?? item.title ?? "后台学习已生成待审候选。";
  const meta = document.createElement("small");
  meta.className = "background-learning-meta";
  const focus = Array.isArray(item.learningScope) && item.learningScope.length > 0
    ? item.learningScope.join("、")
    : item.roleDomain ?? "岗位范围";
  meta.textContent = `${focus} · ${formatBackgroundLearningTrigger(item.triggerReason)} · 只生成候选`;
  card.append(title, summary, meta);
  return card;
}

function formatBackgroundLearningTrigger(triggerReason) {
  if (typeof triggerReason !== "string" || triggerReason.trim().length === 0) {
    return "触发原因待记录";
  }
  const value = triggerReason.trim();
  if (value.startsWith("schedule:")) {
    return "定时触发";
  }
  if (value.startsWith("manual:")) {
    return "手动触发";
  }
  return value;
}

function renderExperienceList(items) {
  replaceChildren(elements.experienceList, items, (item) => {
    const row = document.createElement("button");
    row.className = "candidate-row";
    row.type = "button";
    row.dataset.candidateId = item.id;
    row.dataset.status = item.status;
    row.append(
      createRowContent(
        item.title,
        `${formatExperienceStatusLabel(item.status)} · ${formatExperienceSourceKind(
          item.sourceKind,
        )} · ${formatExperienceQuality(item)}`,
        formatCompactExperienceSummary(item.summary),
      ),
    );
    row.append(createStatusPill(item.status, mapCandidateTone(item.status)));
    return row;
  });
}

function renderKnowledgeList(candidates, latestPublished) {
  const items =
    latestPublished === null || latestPublished === undefined
      ? candidates
      : [
          ...candidates,
          {
            id: latestPublished.id,
            title: latestPublished.title,
            summary: `version ${latestPublished.version}`,
            status: "published",
            tags: latestPublished.tags,
          },
        ];

  replaceChildren(elements.knowledgeList, items, (item) => {
    const row = document.createElement("button");
    row.className = "candidate-row";
    row.type = "button";
    row.dataset.knowledgeId = item.id;
    row.dataset.status = item.status;
    row.append(createRowContent(item.title, `${item.status} · ${item.id}`, item.summary ?? ""));
    row.append(createStatusPill(item.status, mapCandidateTone(item.status)));
    return row;
  });
}

function renderSkillList(items) {
  replaceChildren(elements.skillList, items, (item) => {
    const row = document.createElement("button");
    row.className = `candidate-row${isSelectedAsset("skills", item.id) ? " selected" : ""}`;
    row.type = "button";
    row.dataset.skillId = item.id;
    row.append(
      createRowContent(
        item.title,
        `${item.source === "self" ? "自进化" : "外部"} · ${item.version}`,
        item.description || item.id,
      ),
    );
    row.append(createStatusPill(item.source === "self" ? "self" : "external", "good"));
    return row;
  });
}

function renderToolList(items) {
  replaceChildren(elements.toolList, items, (item) => {
    const row = document.createElement("button");
    row.className = `candidate-row${isSelectedAsset("tools", item.id) ? " selected" : ""}`;
    row.type = "button";
    row.dataset.toolId = item.id;
    const bridgeState = item.realExecutionEligible
      ? "真实执行可用"
      : item.bridgeCapable
        ? "桥接已登记"
        : "无桥接";
    const safetyState = `${item.mockOnly ? "mock" : "real"} · ${
      item.dryRunSupported ? "dry-run" : "no dry-run"
    }`;
    row.append(
      createRowContent(
        item.title,
        `${item.kind} · ${item.provider}`,
        `health=${item.healthStatus} · ${bridgeState} · ${safetyState}`,
      ),
    );
    row.append(
      createStatusPill(item.enabled ? "enabled" : "disabled", item.enabled ? "good" : "warn"),
    );
    return row;
  });
}

function renderSettingsList(parameters, settings) {
  const rows =
    parameters.length > 0
      ? parameters
      : [
          {
            id: "settings-empty",
            label: "设置参数未返回",
            category: "diagnostics",
            valueLabel: settings?.status ?? "unknown",
            source: settings?.source ?? "defaults",
            writable: false,
          },
        ];

  replaceChildren(elements.settingsList, rows, (item) => {
    const row = document.createElement("button");
    row.className = `candidate-row${isSelectedAsset("settings", item.id) ? " selected" : ""}`;
    row.type = "button";
    row.setAttribute("data-setting-id", item.id);
    row.append(
      createRowContent(
        item.label,
        `${formatSettingCategory(item.category)} · ${item.source}`,
        formatSettingParameterDescription(item),
      ),
    );
    row.append(createStatusPill(item.valueLabel ?? "参数", resolveSettingParameterTone(item)));
    return row;
  });
}

function renderRecallList(hits, fallbackCopy) {
  const items =
    hits.length > 0
      ? hits
      : [
          {
            id: "recall-empty",
            title: "暂无召回命中",
            summary: fallbackCopy ?? "执行召回预览后会显示结果。",
            score: 0,
            tags: [],
          },
        ];

  replaceChildren(elements.recallList, items, (hit) => {
    const card = document.createElement("article");
    card.className = "recall-card";
    const title = document.createElement("p");
    title.className = "recall-title";
    title.textContent = hit.title;
    const summary = document.createElement("p");
    summary.textContent = hit.summary;
    const score = document.createElement("div");
    score.className = "score-row";
    const id = document.createElement("span");
    id.textContent = hit.id;
    const value = document.createElement("strong");
    value.textContent = String(hit.score);
    score.append(id, value);
    card.append(title, summary, score, createTagStrip(hit.tags ?? []));
    return card;
  });
}

function renderCommandResult(commandResult) {
  const lines = [
    `动作: ${commandResult.command?.label ?? "Angel action"}`,
    `状态: ${commandResult.status}`,
    `退出码: ${commandResult.exitCode ?? "native"}`,
  ];
  if (commandResult.stdout) {
    lines.push("", "输出：", commandResult.stdout.trimEnd());
  }
  if (commandResult.stderr) {
    lines.push("", "错误输出：", commandResult.stderr.trimEnd());
  }
  setResultOutput(lines.join("\n"));
}

function renderQuickActions() {
  if (!isWorkbenchActive()) {
    state.quickActionsOpen = false;
    elements.quickActions?.classList.toggle("open", state.quickActionsOpen);
    elements.quickActions?.replaceChildren();
    return;
  }
  const actions = getQuickActionsForSurface(getActiveWorkflow()?.id);
  if (actions.length === 0 && getQuickActionComposerQuery().length === 0) {
    state.quickActionsOpen = false;
    elements.quickActions?.classList.toggle("open", state.quickActionsOpen);
    elements.quickActions?.replaceChildren();
    return;
  }
  elements.quickActions?.classList.toggle("open", state.quickActionsOpen);
  if (!elements.quickActions) {
    return;
  }

  const toggle = document.createElement("button");
  toggle.className = "slash-command-toggle";
  toggle.type = "button";
  toggle.textContent = "/";
  toggle.title = "打开命令菜单";
  toggle.setAttribute("aria-label", "打开命令菜单");
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-controls", "slash-command-menu");
  toggle.setAttribute("aria-expanded", String(state.quickActionsOpen));
  toggle.dataset.slashCommandToggle = "true";

  const menu = document.createElement("div");
  menu.className = "slash-command-menu";
  menu.id = "slash-command-menu";
  menu.role = "menu";
  menu.setAttribute("aria-orientation", "vertical");
  menu.hidden = !state.quickActionsOpen;
  replaceChildren(menu, actions, (action, index) => {
    const button = document.createElement("button");
    button.className = `slash-command-item${index === 0 ? " active" : ""}`;
    button.type = "button";
    button.role = "menuitem";
    button.setAttribute("aria-selected", String(index === 0));
    button.dataset.quickActionIndex = String(index);
    const icon = document.createElement("span");
    icon.className = "slash-command-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "/";
    const label = document.createElement("span");
    label.className = "slash-command-label";
    label.textContent = action.label.replace(/^\/+/u, "");
    button.append(icon, label);
    return button;
  });
  elements.quickActions.replaceChildren(toggle, menu);
}

function applyQuickAction(action) {
  setInputValue(action.prompt);
  state.quickActionsOpen = false;
  renderQuickActions();
  elements.angelInput?.focus();
}

function getQuickActionsForSurface(surfaceId) {
  if (surfaceId !== "workbench") {
    return [];
  }
  return filterQuickActionsForComposerInput(
    dedupeQuickActions([...getBaseQuickActions(), ...buildSnapshotQuickActions(state.snapshot)]),
  );
}

function getBaseQuickActions() {
  return [
    { label: "/制作", prompt: "/制作 " },
    { label: "/学习", prompt: "/学习 " },
    { label: "/经验", prompt: "/经验 " },
    { label: "/技能", prompt: "/技能" },
    { label: "/工具", prompt: "/工具" },
    { label: "/图片", prompt: "/图片 " },
    { label: "/ComfyUI", prompt: "/comfyui ", actionType: DESKTOP_ACTIONS.COMFYUI_RUN },
    { label: "/审查", prompt: "/审查" },
    { label: "/灵魂", prompt: "/灵魂 " },
    { label: "/心跳", prompt: "/心跳 状态" },
    { label: "/设置", prompt: "/设置" },
    { label: "/记忆", prompt: "/记忆" },
    { label: "/诊断", prompt: "/诊断" },
  ];
}

function buildSnapshotQuickActions(snapshot) {
  if (!snapshot) {
    return [];
  }
  return [
    ...buildExperienceQuickActions(snapshot?.candidate?.items ?? []),
    ...buildKnowledgeQuickActions(snapshot?.knowledge?.candidates ?? []),
    ...buildSkillQuickActions(snapshot?.assets?.skills),
    ...buildToolQuickActions(snapshot?.assets?.tools),
  ];
}

function buildExperienceQuickActions(candidates) {
  const actions = [];
  for (const candidate of candidates) {
    if (!candidate?.id) {
      continue;
    }
    const title = formatQuickActionTitle(candidate.title || candidate.summary, candidate.id);
    const lifecycleStatus = resolveExperienceLifecycleStatus(candidate);
    if (lifecycleStatus === "harvested") {
      actions.push(
        { label: `/经验 接受 · ${title}`, prompt: `/经验 接受 ${candidate.id}` },
        { label: `/经验 拒绝 · ${title}`, prompt: `/经验 拒绝 ${candidate.id}` },
      );
      continue;
    }
    if (lifecycleStatus === "reviewed") {
      actions.push(
        { label: `/经验 晋升 · ${title}`, prompt: `/经验 晋升 ${candidate.id}` },
        { label: `/技能 从经验 · ${title}`, prompt: `/技能 从经验 ${candidate.id}` },
      );
      continue;
    }
    if (lifecycleStatus === "publish-ready" || lifecycleStatus === "promoted") {
      actions.push({ label: `/技能 从经验 · ${title}`, prompt: `/技能 从经验 ${candidate.id}` });
    }
  }
  return actions.slice(0, SNAPSHOT_QUICK_ACTION_LIMITS.experience);
}

function buildKnowledgeQuickActions(candidates) {
  const actions = [];
  for (const candidate of candidates) {
    if (!candidate?.id) {
      continue;
    }
    const title = formatQuickActionTitle(candidate.title || candidate.summary, candidate.id);
    if (candidate.status === "pending") {
      actions.push({ label: `/知识 接受 · ${title}`, prompt: `/知识 接受 ${candidate.id}` });
      continue;
    }
    if (candidate.status === "accepted") {
      actions.push({ label: `/知识 发布 · ${title}`, prompt: `/知识 发布 ${candidate.id}` });
    }
  }
  return actions.slice(0, SNAPSHOT_QUICK_ACTION_LIMITS.knowledge);
}

function buildSkillQuickActions(skills) {
  if (!skills) {
    return [];
  }
  const proposalActions = (skills.proposals ?? [])
    .filter((proposal) => proposal?.id)
    .flatMap((proposal) => {
      const title = formatQuickActionTitle(proposal.title || proposal.skillId, proposal.id);
      if (proposal.status === "pending") {
        return [
          { label: `/技能 接受 · ${title}`, prompt: `/技能 接受 ${proposal.id}` },
          { label: `/技能 拒绝 · ${title}`, prompt: `/技能 拒绝 ${proposal.id}` },
        ];
      }
      if (proposal.status === "accepted") {
        return [{ label: `/技能 应用 · ${title}`, prompt: `/技能 应用 ${proposal.id}` }];
      }
      return [];
    })
    .slice(0, SNAPSHOT_QUICK_ACTION_LIMITS.skillProposals);
  const skillActions = sortQuickActionSkills(skills.items ?? [])
    .filter((skill) => skill?.id)
    .map((skill) => {
      const title = formatQuickActionTitle(skill.title || skill.chineseIntro, skill.id);
      return {
        label: `/技能 ${skill.enabled === false ? "开启" : "关闭"} · ${title}`,
        prompt: `/技能 ${skill.enabled === false ? "开启" : "关闭"} ${skill.id}`,
      };
    })
    .slice(0, SNAPSHOT_QUICK_ACTION_LIMITS.skills);
  return [...proposalActions, ...skillActions];
}

function buildToolQuickActions(tools) {
  return (tools?.items ?? [])
    .filter((adapter) => adapter?.id)
    .flatMap((adapter) => {
      const title = formatQuickActionTitle(adapter.title || adapter.provider, adapter.id);
      const actions = [{ label: `/工具 说明 · ${title}`, prompt: `/工具 说明 ${adapter.id}` }];
      if (adapter.enabled === false) {
        actions.push({ label: `/工具 启用 · ${title}`, prompt: `/工具 启用 ${adapter.id}` });
      }
      return actions;
    })
    .slice(0, SNAPSHOT_QUICK_ACTION_LIMITS.tools);
}

function sortQuickActionSkills(skills) {
  return [...skills].sort((left, right) => {
    const enabledDelta = Number(right.enabled !== false) - Number(left.enabled !== false);
    if (enabledDelta !== 0) {
      return enabledDelta;
    }
    return Number(right.priority ?? right.updatedAtMs ?? 0) - Number(left.priority ?? left.updatedAtMs ?? 0);
  });
}

function formatQuickActionTitle(value, fallback) {
  const text = String(value || fallback || "").replace(/\s+/gu, " ").trim();
  if (text.length <= 30) {
    return text;
  }
  return `${text.slice(0, 29)}…`;
}

function dedupeQuickActions(actions) {
  const seen = new Set();
  const result = [];
  for (const action of actions) {
    if (!action?.prompt || seen.has(action.prompt)) {
      continue;
    }
    seen.add(action.prompt);
    result.push(action);
  }
  return result;
}

function filterQuickActionsForComposerInput(actions) {
  const query = getQuickActionComposerQuery();
  if (query.length === 0) {
    return actions;
  }
  return actions.filter((action) => {
    const label = action.label.toLowerCase();
    const prompt = action.prompt.toLowerCase();
    return label.includes(query) || prompt.includes(query);
  });
}

function getQuickActionComposerQuery() {
  const value = elements.angelInput?.value ?? "";
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("/")) {
    return "";
  }
  return trimmed.replace(/^\/+/u, "").trim().toLowerCase();
}

function syncQuickActionsFromComposerInput() {
  if (!isWorkbenchActive() || state.running) {
    return;
  }
  const shouldOpen = (elements.angelInput?.value ?? "").trimStart().startsWith("/");
  if (state.quickActionsOpen !== shouldOpen) {
    state.quickActionsOpen = shouldOpen;
  }
  renderQuickActions();
}

function syncComposerStateFromInput() {
  state.chat.composer.setInput(elements.angelInput?.value ?? "");
  persistDesktopUiState();
}

function maybeAttachComposerPath(value) {
  const text = String(value ?? "").trim();
  if (!looksLikeDroppedPath(text)) {
    return false;
  }
  addComposerAttachmentFromPath(text);
  return true;
}

function addComposerAttachmentFromPath(path) {
  const attachment = addComposerAttachment(state.chat.composer, {
    path,
  });
  if (!attachment) {
    return null;
  }
  renderComposerAttachments();
  persistDesktopUiState();
  return attachment;
}

function removeComposerAttachmentById(attachmentId) {
  const attachment = state.chat.composer.attachments?.find((item) => item.id === attachmentId);
  if (!removeComposerAttachment(state.chat.composer, attachmentId)) {
    return false;
  }
  releaseDesktopAttachmentPayloads(attachment ? [attachment] : []);
  renderComposerAttachments();
  persistDesktopUiState();
  return true;
}

async function handleComposerDrop(event) {
  const files = event.dataTransfer?.files;
  if (!files?.length) {
    return false;
  }
  event.preventDefault();
  elements.composer?.classList.remove("drag-over");
  const attachments = await createComposerAttachmentsFromFiles(files, { includePayloads: true });
  for (const attachment of attachments) {
    const registered = attachment.dataUrl
      ? registerDesktopAttachmentPayload({
          attachment,
          dataUrl: attachment.dataUrl,
          file: Array.from(files).find((file) => file?.path === attachment.path),
        })
      : attachment;
    addComposerAttachment(state.chat.composer, registered ?? attachment);
  }
  renderComposerAttachments();
  persistDesktopUiState();
  return attachments.length > 0;
}

async function handleComposerPaste(event) {
  const files = readComposerClipboardFiles(event.clipboardData);
  if (files.length === 0) {
    return false;
  }
  event.preventDefault();
  const attachments = await createComposerAttachmentsFromPastedFiles(files);
  for (const attachment of attachments) {
    const registered = registerDesktopAttachmentPayload({
      attachment,
      dataUrl: attachment.dataUrl,
      file: files.find((file) => file?.name === attachment.fileName),
    });
    addComposerAttachment(state.chat.composer, registered ?? attachment);
  }
  renderComposerAttachments();
  persistDesktopUiState();
  return attachments.length > 0;
}

function readComposerClipboardFiles(clipboardData) {
  const items = Array.from(clipboardData?.items ?? []);
  const files = items
    .filter((item) => item?.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  if (files.length > 0) {
    return files;
  }
  return Array.from(clipboardData?.files ?? []).filter(Boolean);
}

function renderComposerAttachments() {
  if (!elements.composerAttachments) {
    return;
  }
  const attachments = Array.isArray(state.chat.composer.attachments)
    ? state.chat.composer.attachments
    : [];
  elements.composerAttachments.hidden = attachments.length === 0;
  if (attachments.length === 0) {
    elements.composerAttachments.replaceChildren();
    return;
  }
  replaceChildren(elements.composerAttachments, attachments, (attachment) => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = attachment.fileName ?? attachment.path ?? "attachment";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "移除附件";
    remove.textContent = "×";
    remove.setAttribute("data-composer-attachment-remove", attachment.id);
    chip.append(label, remove);
    return chip;
  });
}

function normalizeComposerSubmitAttachments(attachments) {
  return Array.isArray(attachments)
    ? attachments.map((attachment) => ({ ...attachment })).filter(isSendableComposerAttachment)
    : [];
}

function isSendableComposerAttachment(attachment) {
  return Boolean(
    attachment?.path ||
      attachment?.dataUrl ||
      attachment?.content ||
      attachment?.previewUrl ||
      attachment?.fileName,
  );
}

function formatComposerUserMessageBody(input, attachments) {
  const text = input.length === 0 ? "让 Angel 按当前板块继续。" : input;
  if (!attachments.length) {
    return text;
  }
  const names = attachments.map((attachment) => attachment.fileName ?? attachment.path).join("、");
  return `${text}\n附件：${names}`;
}

function handleComposerHistoryNavigation(event) {
  if (event.isComposing || state.quickActionsOpen) {
    return false;
  }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
    return false;
  }
  const input = elements.angelInput;
  if (!input || input.selectionStart !== input.selectionEnd) {
    return false;
  }
  if (event.key === "ArrowUp" && input.selectionStart !== 0) {
    return false;
  }
  if (event.key === "ArrowDown" && input.selectionStart !== input.value.length) {
    return false;
  }
  syncComposerStateFromInput();
  const direction = event.key === "ArrowUp" ? "up" : "down";
  if (!state.chat.composer.navigateHistory(direction)) {
    return false;
  }
  event.preventDefault();
  setInputValue(state.chat.composer.input);
  return true;
}

function renderWorkbenchSurfaceVisibility() {
  const visible = isWorkbenchActive();
  const workflowId = getActiveWorkflow()?.id;
  if (!visible) {
    state.quickActionsOpen = false;
    elements.quickActions?.classList.toggle("open", state.quickActionsOpen);
  }
  const settingsMode = workflowId === "settings";
  const assetMode = !visible && isAssetSurfaceWorkflow(workflowId);
  if (elements.desktopShell) {
    elements.desktopShell.classList.toggle("workbench-mode", visible);
    elements.desktopShell.classList.toggle("settings-mode", settingsMode);
    elements.desktopShell.classList.toggle("asset-mode", assetMode);
  }
  if (elements.workbenchSurface) {
    elements.workbenchSurface.classList.toggle("asset-view", !visible);
  }
  if (elements.timeline) {
    elements.timeline.hidden = !visible;
    elements.timeline.classList.toggle("hidden", !visible);
  }
  if (elements.composer) {
    elements.composer.hidden = !visible;
    elements.composer.classList.toggle("hidden", !visible);
  }
}

function resetCommandBoardScroll() {
  if (elements.commandBoard) {
    elements.commandBoard.scrollTop = 0;
  }
}

function resetCommandBoardScrollIfNeeded() {
  if (!state.pendingScrollReset) {
    return;
  }
  state.pendingScrollReset = false;
  resetCommandBoardScroll();
  requestAnimationFrame(() => resetCommandBoardScroll());
}

function selectGroup(groupId) {
  state.selectedGroupId = groupId;
  state.selectedAsset = null;
  state.quickActionsOpen = false;
  const recommended = resolveRecommendedCommandId();
  const commands = getWorkflowCommands(getActiveWorkflow());
  state.selectedCommandId = commands.some((command) => command.id === recommended)
    ? recommended
    : (commands[0]?.id ?? null);
  setInputValue("");
  updateComposerPlaceholder();
  resetCommandBoardScroll();
  renderQuickActions();
  renderCatalog();
  renderSelectedCommand();
}

function selectCommand(commandId) {
  const command = findCommand(commandId);
  if (!command) {
    return;
  }
  setSelectedCommand(commandId);
}

function setSelectedCommand(commandId) {
  const command = findCommand(commandId);
  if (!command) {
    return;
  }
  state.selectedCommandId = commandId;
  state.selectedAsset = null;
  state.selectedGroupId = resolveWorkflowIdForCommandSelection({
    workflows: WORKFLOWS,
    activeWorkflowId: state.selectedGroupId,
    commandId,
  });
  state.quickActionsOpen = false;
  setInputValue("");
  resetCommandBoardScroll();
  renderCatalog();
  renderSelectedCommand();
}

function selectAssetDetail(surface, assetId) {
  if (!surface || !assetId) {
    return;
  }
  if (surface === "settings" && assetId === "settings-overview") {
    state.selectedAsset = null;
    state.selectedCommandId = null;
    selectInspectorPanel("state");
    renderCatalog();
    renderSelectedCommand();
    return;
  }
  if (isAssetSurfaceWorkflow(surface)) {
    state.selectedGroupId = surface;
  }
  state.selectedAsset = { surface, assetId };
  state.selectedCommandId = null;
  selectInspectorPanel("state");
  resetCommandBoardScroll();
  renderCatalog();
  renderSelectedCommand();
}

function selectWorkflowPanel(surfaceId) {
  if (!surfaceId) {
    return;
  }
  state.selectedGroupId = surfaceId;
  state.selectedAsset = null;
  state.quickActionsOpen = false;
  state.selectedCommandId = getWorkflowCommands(getActiveWorkflow())[0]?.id ?? null;
  selectInspectorPanel("state");
  renderCatalog();
  renderQuickActions();
  renderSelectedCommand();
}

function selectSettingsTab(tabId) {
  if (!SETTINGS_TABS.some((tab) => tab.id === tabId)) {
    return;
  }
  state.selectedGroupId = "settings";
  state.selectedSettingsTab = tabId;
  state.selectedAsset = null;
  state.selectedCommandId = null;
  selectInspectorPanel("state");
  resetCommandBoardScroll();
  renderCatalog();
  renderSelectedCommand();
  persistDesktopUiState();
}

function openWorkbenchPrompt(prompt) {
  state.selectedGroupId = "workbench";
  state.selectedAsset = null;
  state.quickActionsOpen = false;
  const commands = getWorkflowCommands(getActiveWorkflow());
  state.selectedCommandId = commands[0]?.id ?? null;
  renderCatalog();
  renderQuickActions();
  renderSelectedCommand();
  setInputValue(prompt);
  elements.angelInput?.focus();
}

function findAssetDetail(selection) {
  if (!selection || !state.snapshot) {
    return null;
  }
  if (selection.surface === "experience") {
    return createExperienceAssetDetail(selection.assetId);
  }
  if (selection.surface === "skills") {
    return createSkillAssetDetail(selection.assetId);
  }
  if (selection.surface === "tools") {
    return createToolAssetDetail(selection.assetId);
  }
  if (selection.surface === "review") {
    return createReviewAssetDetail(selection.assetId);
  }
  return null;
}

function createExperienceAssetDetail(assetId) {
  if (!state.snapshot) {
    return null;
  }
  if (assetId.startsWith("candidate:")) {
    const candidateId = assetId.replace("candidate:", "");
    const candidate = state.snapshot.candidate?.items?.find((item) => item.id === candidateId);
    if (!candidate) {
      return null;
    }
    return {
      kind: "experience-candidate",
      candidate,
      title: candidate.title,
      summary: createExperienceReviewSummary(candidate),
      meta: `${formatExperienceStatusLabel(candidate.status)} · ${formatExperienceSourceKind(
        candidate.sourceKind,
      )} · ${formatExperienceQuality(candidate)}`,
      actionPrompts: createExperienceReviewPrompts(candidate),
      sourceReader: createExperienceSourceReader(candidate),
      fields: [
        { label: "审核目标", value: "确认这条总结是否值得保存为 Director Angel 可复用经验。" },
        { label: "要保存的经验", value: candidate.summary },
        { label: "提炼方式", value: formatExperienceDistillation(candidate) },
        { label: "适用场景", value: candidate.applicability ?? "未返回" },
        { label: "需要留意的风险", value: formatList(candidate.risks) },
        { label: "来源", value: candidate.sourceRef },
        {
          label: "质量门禁",
          value: formatExperienceQuality(candidate),
        },
        {
          label: "质量原因",
          value: formatList(candidate.quality?.reasons ?? candidate.qualityReasons),
        },
        { label: "证据引用", value: formatExperienceEvidenceDetail(candidate.evidence) },
        { label: "标签", value: formatList(candidate.tags) },
        { label: "记录 ID", value: candidate.id },
      ],
    };
  }
  if (assetId.startsWith("quarantine:")) {
    const quarantineId = assetId.replace("quarantine:", "");
    const record = state.snapshot.assets?.experience?.quarantineItems?.find(
      (item) => item.id === quarantineId,
    );
    if (!record) {
      return null;
    }
    return {
      title: record.title,
      summary: "这条来源没有进入经验审核。它保留在隔离区，用来说明为什么没有沉淀为经验。",
      meta: `${formatExperienceSourceKind(record.sourceKind)} · 已隔离 · ${formatExperienceQuality(record)}`,
      actionPrompts: [],
      sourceReader: createExperienceSourceReader(record),
      fields: [
        { label: "隔离原因", value: record.reason ?? record.summary ?? "未返回" },
        { label: "来源", value: record.sourceRef },
        { label: "质量门禁", value: formatExperienceQuality(record) },
        { label: "质量原因", value: formatList(record.quality?.reasons ?? record.qualityReasons) },
        { label: "备注", value: formatList(record.notes) },
        { label: "记录 ID", value: record.id },
      ],
    };
  }
  if (assetId.startsWith("knowledge:")) {
    const packId = assetId.replace("knowledge:", "");
    const candidate = state.snapshot.knowledge?.candidates?.find((item) => item.id === packId);
    if (!candidate) {
      return null;
    }
    return {
      title: candidate.title,
      summary: candidate.summary,
      meta: `${candidate.status} · v${candidate.version ?? "none"}`,
      actionPrompts: createKnowledgeReviewActions(candidate),
      fields: [
        { label: "Knowledge ID", value: candidate.id },
        { label: "状态", value: candidate.status },
        { label: "操作", value: candidate.operation },
        { label: "版本", value: candidate.version },
        { label: "触发", value: candidate.trigger },
        { label: "更新时间", value: candidate.updatedAt },
        { label: "标签", value: formatList(candidate.tags) },
      ],
    };
  }
  if (assetId.startsWith("published:")) {
    const packId = assetId.replace("published:", "");
    const published = state.snapshot.knowledge?.latestPublished;
    if (published?.id !== packId) {
      return null;
    }
    return {
      title: published.title,
      summary: "已发布知识包，可进入运行时召回。",
      meta: `published · v${published.version ?? "none"}`,
      actionPrompt: `/知识 说明 ${published.id}`,
      actionPrompts: [
        {
          label: "召回预览",
          prompt: "/知识 召回",
          action: {
            type: DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW,
            ...(published.projectId ? { projectId: published.projectId } : {}),
            ...(published.groupId ? { groupId: published.groupId } : {}),
            ...(Array.isArray(published.anchorIds) && published.anchorIds.length > 0
              ? { anchorIds: published.anchorIds }
              : {}),
            ...(Array.isArray(published.preferredAdapters) && published.preferredAdapters.length > 0
              ? { preferredAdapters: published.preferredAdapters }
              : {}),
            ...(Array.isArray(published.tags) && published.tags.length > 0
              ? { tags: published.tags }
              : {}),
            ...(published.generationType ? { generationType: published.generationType } : {}),
            ...(published.generationStyle ? { generationStyle: published.generationStyle } : {}),
            includeGlobalExperience: true,
          },
        },
      ],
      fields: [
        { label: "Knowledge ID", value: published.id },
        { label: "版本", value: published.version },
        { label: "发布时间", value: published.publishedAt },
        { label: "标签", value: formatList(published.tags) },
      ],
    };
  }
  return null;
}

function createSkillAssetDetail(assetId) {
  const skills = state.snapshot?.assets?.skills;
  if (!skills) {
    return null;
  }
  if (assetId.startsWith("proposal:")) {
    const proposalId = assetId.replace("proposal:", "");
    const proposal = skills.proposals?.find((item) => item.id === proposalId);
    if (!proposal) {
      return null;
    }
    return {
      kind: "skill-proposal",
      proposal,
      title: proposal.title,
      summary: proposal.explanation || proposal.evidenceSummary || "待审核 Skill 候选。",
      meta: `${formatSkillProposalStatusLabel(proposal.status)} · ${formatSkillRiskLabel(
        proposal.riskLevel,
      )}`,
      actionPrompts: createSkillProposalDirectActions(proposal),
      fields: [
        { label: "Proposal ID", value: proposal.id },
        { label: "目标 Skill", value: proposal.skillId },
        { label: "状态", value: formatSkillProposalStatusLabel(proposal.status) },
        { label: "审查结论", value: formatSkillProposalReviewVerdict(proposal.reviewVerdict) },
        { label: "证据", value: proposal.evidenceRef || proposal.evidenceSummary },
      ],
    };
  }
  const skill = skills.items?.find((item) => item.id === assetId);
  if (!skill) {
    return null;
  }
  return {
    kind: "skill",
    skill,
    snapshotPath: skills.snapshotPath ?? "未提供",
    title: skill.title,
    summary: skill.chineseIntro || skill.description || "Skill 记录来自后端 approved skills snapshot。",
    meta: skill.source === "self" ? "自进化 Skill" : "外部 Skill",
    actionPrompt: "/技能",
    fields: [
      { label: "Skill ID", value: skill.id },
      { label: "版本", value: skill.version },
      { label: "启用状态", value: formatSkillEnablementLabel(skill.enabled) },
      { label: "模型可见", value: formatSkillModelVisibility(skill) },
      { label: "召回资格", value: formatSkillEligibility(skill) },
      { label: "依赖诊断", value: formatSkillDoctorStatusLabel(skill.doctorStatus ?? skill.runtimeStatus) },
      { label: "缺失工具", value: formatList(skill.missingToolNames) },
      { label: "未检查工具", value: formatList(skill.uncheckedToolNames) },
      { label: "诊断说明", value: skill.doctorSummary ?? "未返回" },
      { label: "下一步", value: formatList(skill.nextActions) },
      { label: "权限状态", value: formatSkillPermissionStatus(skill) },
      { label: "状态说明", value: skill.statusReason ?? "未返回" },
      { label: "快照版本", value: formatSkillSnapshotVersion(skill) },
      { label: "中文简介", value: skill.chineseIntro ?? "未返回" },
      { label: "来源", value: skill.source === "self" ? "自进化" : "外部" },
      { label: "风险等级", value: formatSkillRiskLabel(skill.riskLevel) },
      { label: "权限", value: formatSkillPermissionDetail(skill) },
      { label: "审计状态", value: formatSkillAuditStatusLabel(skill.auditStatus) },
      { label: "信任状态", value: formatSkillTrustLabel(skill.trustStatus) },
      { label: "审计说明", value: skill.auditSummary ?? "未返回" },
      { label: "更新时间", value: skill.updatedAtMs ?? "unknown" },
      { label: "标签", value: formatList(skill.tags) },
      { label: "工具", value: formatList(skill.toolNames) },
      { label: "正文", value: skill.content ?? "当前后端 snapshot 未返回正文。" },
      { label: "快照路径", value: skills.snapshotPath ?? "未提供" },
    ],
  };
}

function createToolAssetDetail(assetId) {
  const tools = state.snapshot?.assets?.tools;
  if (!tools) {
    return null;
  }
  const adapter = tools.items?.find((item) => item.id === assetId);
  if (!adapter) {
    return null;
  }
  return {
    kind: "tool",
    title: adapter.title,
    adapter,
    registryRoot: tools.registryRoot,
    indexPath: tools.indexPath,
    runtimeStatus: tools.runtimeStatus,
    summary: `health=${adapter.healthStatus} · ${
      adapter.realExecutionEligible ? "真实执行可用" : "未满足真实执行门禁"
    }。`,
    meta: `${adapter.kind} · ${adapter.provider}`,
    actionPrompts: createToolActionPrompts(adapter),
    fields: [
      { label: "Adapter ID", value: adapter.id },
      { label: "类型", value: adapter.kind },
      { label: "Provider", value: adapter.provider },
      { label: "版本", value: adapter.version ?? "unknown" },
      { label: "启用", value: formatBoolean(adapter.enabled) },
      { label: "健康", value: adapter.healthStatus },
      { label: "桥接", value: formatBoolean(adapter.bridgeCapable) },
      { label: "真实执行", value: formatBoolean(adapter.realExecutionEligible) },
      { label: "风险等级", value: formatSkillRiskLabel(adapter.riskLevel) },
      { label: "审批要求", value: formatAdapterApprovalMode(adapter.approvalMode) },
      { label: "权限范围", value: formatList(adapter.permissionScopes) },
      { label: "数据保留", value: adapter.dataRetentionPolicy ?? "未声明" },
      { label: "限流策略", value: adapter.rateLimitPolicy ?? "未声明" },
      { label: "预算策略", value: adapter.budgetPolicy ?? "未声明" },
      { label: "审计摘要", value: adapter.auditSummary ?? "未返回" },
      { label: "Mock only", value: formatBoolean(adapter.mockOnly) },
      { label: "Dry run", value: formatBoolean(adapter.dryRunSupported) },
      { label: "动作类别", value: formatList(adapter.supportedActionClasses) },
      { label: "动作清单", value: formatAdapterActionCatalog(adapter.actions) },
      { label: "动作契约", value: formatAdapterActionContracts(adapter.actions) },
      {
        label: "高风险动作",
        value:
          adapter.highRiskActionCount ?? countAdapterActions(adapter.actions, "riskLevel", "high"),
      },
      {
        label: "需审批动作",
        value:
          adapter.operatorApprovalActionCount ??
          countAdapterActions(adapter.actions, "approvalMode", "operator_approve"),
      },
      { label: "备注", value: formatList(adapter.notes) },
    ],
  };
}

function createToolActionPrompts(adapter) {
  if (adapter.id === "comfyui-media") {
    return [
      {
        label: "配置",
        tone: "secondary",
        action: { type: "ui.selectSettingsTab", tab: "externalTools" },
      },
      {
        label: "测试连接",
        tone: "secondary",
        action: { type: DESKTOP_ACTIONS.COMFYUI_TEST },
      },
      {
        label: "打开界面",
        tone: "primary",
        action: { type: DESKTOP_ACTIONS.COMFYUI_OPEN },
      },
    ];
  }
  return [
    {
      label: "说明",
      action: createCommandRunAction("adapter.explain", { adapterId: adapter.id }),
    },
  ];
}

function createReviewRunOperatorSections(run, report = null) {
  const assignments = run.assignments ?? [];
  const blocked = assignments.filter((assignment) =>
    ["failed", "blocked", "aborted"].includes(assignment.status),
  );
  const approvalRequired = assignments.filter(
    (assignment) =>
      assignment.status === "pending" && assignment.approvalMode === "operator_approve",
  );
  const autoContinue = assignments.filter(
    (assignment) => assignment.status === "pending" && assignment.approvalMode === "auto_allow",
  );
  const ready = assignments.filter((assignment) => assignment.status === "ready");
  const completed = assignments.filter((assignment) => assignment.status === "completed");
  const delegationSummary = run.delegationSnapshot
    ? formatReviewDelegationSummary(run.delegationSnapshot)
    : null;
  return [
    {
      title: "这是什么",
      body: formatList([
        "这是一个 Director 制作运行项目",
        run.goal ? `目标：${run.goal}` : null,
        run.blueprintId ? `蓝图：${run.blueprintId}` : null,
        "它把工作台里的制作目标拆成可审查、可追踪的执行任务。",
      ]),
    },
    {
      title: "输入与召回",
      body: formatReviewRunRecallSummary(run),
    },
    {
      title: "当前状态",
      body: formatList([
        `运行状态：${formatReviewStatusLabel(run.status)}`,
        `任务统计：${formatAssignmentCounts(run.assignmentCounts)}`,
        delegationSummary ? `协作：${delegationSummary}` : null,
        `已完成：${completed.length}`,
        ready.length > 0 ? `可推进：${ready.map(formatReviewAssignmentBrief).join("；")}` : null,
        run.previewSummary ? `摘要：${run.previewSummary}` : null,
        report?.reportId ? `报告：${report.reportId}` : null,
      ]),
    },
    {
      title: "卡点与处理",
      body: formatList([
        createReviewRunHoldingReason({
          run,
          approvalRequired,
          autoContinue,
          ready,
          blocked,
        }),
        approvalRequired.length > 0
          ? `待你确认：${approvalRequired.map(formatReviewAssignmentBrief).join("；")}`
          : null,
        blocked.length > 0
          ? `异常任务：${blocked.map(formatReviewAssignmentBrief).join("；")}`
          : null,
        autoContinue.length > 0
          ? `自动任务：${autoContinue.length} 个，等依赖满足后会继续。`
          : null,
      ]),
    },
    {
      title: "产物与复盘",
      body: formatReviewRunArtifactSummary(run, report),
    },
    {
      title: "系统证据",
      body: formatList([
        run.runId ? `Run：${run.runId}` : null,
        run.runtimeId ? `Runtime：${run.runtimeId}` : null,
        run.actionGraphId ? `Action Graph：${run.actionGraphId}` : null,
        report?.reportId ? `Report：${report.reportId}` : null,
        run.eventCount !== undefined ? `事件数：${run.eventCount}` : null,
        run.sideEffectsAllowed ? "允许副作用：是" : "允许副作用：否",
        formatReviewEvents(run.events),
      ]),
    },
  ];
}

function formatReviewRunRecallSummary(run) {
  const notes = Array.isArray(run.notes) ? run.notes : [];
  const knowledgeStatus = findReviewRunNoteValue(notes, "published-knowledge") ?? "未记录";
  const skillStatus = findReviewRunNoteValue(notes, "skills") ?? "未记录";
  const memoryStatus = findReviewRunNoteValue(notes, "memory") ?? null;
  const publishedPacks = findReviewRunNoteValues(notes, "published-pack");
  const skillHits = findReviewRunNoteValues(notes, "skill-hit");
  return formatList([
    run.goal ? `输入目标：${run.goal}` : null,
    `经验召回：${knowledgeStatus}`,
    publishedPacks.length > 0 ? `命中经验：${publishedPacks.join("；")}` : "命中经验：无",
    `Skill：${skillStatus}`,
    skillHits.length > 0 ? `命中 Skill：${skillHits.join("；")}` : "命中 Skill：无",
    memoryStatus === null ? null : `运行记忆：${memoryStatus}`,
  ]);
}

function formatReviewRunArtifactSummary(run, report) {
  const completedAssignments = (run.assignments ?? []).filter(
    (assignment) => assignment.status === "completed",
  );
  const notes = Array.isArray(run.notes) ? run.notes : [];
  const draftArtifact = findReviewRunNoteValue(notes, "draft-artifact");
  const draftSource = findReviewRunNoteValue(notes, "draft-source");
  return formatList([
    report?.operatorSummary ? `报告摘要：${report.operatorSummary}` : null,
    report?.deliverable ? `主要产物：${report.deliverable}` : null,
    draftArtifact ? `制作草案：${draftArtifact}` : null,
    draftSource ? `草案来源：${draftSource}` : null,
    completedAssignments.length > 0
      ? `已产出任务：${completedAssignments.map(formatReviewAssignmentBrief).join("；")}`
      : null,
    report?.nextAction ? `下一步：${report.nextAction}` : null,
    run.runId ? `复盘入口：在工作台输入 /反思 ${run.runId}` : null,
  ]);
}

function findReviewRunNoteValue(notes, key) {
  return findReviewRunNoteValues(notes, key)[0] ?? null;
}

function findReviewRunNoteValues(notes, key) {
  const prefix = `${key}=`;
  return notes
    .filter((note) => typeof note === "string" && note.startsWith(prefix))
    .map((note) => note.slice(prefix.length))
    .filter((value) => value.length > 0);
}

function createReviewReportOperatorSections(report) {
  const failedAssignments = (report.assignments ?? []).filter((assignment) =>
    ["failed", "blocked", "aborted"].includes(assignment.status),
  );
  return [
    {
      title: "这是什么",
      body: formatList([
        "这是一次 Director run 的执行报告",
        report.directorGoal ? `导演目标：${report.directorGoal}` : null,
        report.runId ? `关联 Run：${report.runId}` : null,
        "它用于判断这次制作运行是否完成、失败在哪里、下一步该怎么处理。",
      ]),
    },
    {
      title: "当前结果",
      body: formatList([
        `运行状态：${formatReviewStatusLabel(report.runStatus)}`,
        report.operatorSummary ? `摘要：${report.operatorSummary}` : null,
        report.summary?.length > 0 ? `系统摘要：${formatList(report.summary)}` : null,
        report.bridgeVerdict
          ? `Bridge 判断：${formatReviewBridgeVerdict(report.bridgeVerdict)}`
          : null,
        `任务统计：${formatAssignmentCounts(report.assignmentCounts)}`,
      ]),
    },
    {
      title: "失败原因",
      body: createReviewReportFailureReason(report, failedAssignments),
    },
    {
      title: "建议动作",
      body: createReviewReportNextAction(report, failedAssignments),
    },
    {
      title: "系统证据",
      body: formatList([
        report.reportId ? `Report：${report.reportId}` : null,
        report.recordedAt ? `记录时间：${report.recordedAt}` : null,
        report.adapterRoute ? `Adapter route：${report.adapterRoute}` : null,
        report.lastBridgeRoute ? `Last route：${report.lastBridgeRoute}` : null,
        report.requestId ? `Request：${report.requestId}` : null,
        report.flags?.length > 0 ? `Flags：${report.flags.join(" / ")}` : null,
        formatReviewEvents(report.events),
      ]),
    },
  ];
}

function createReviewHeartbeatOperatorSections(event) {
  const actions = createHeartbeatDirectActions(event);
  return [
    {
      title: "这是什么",
      body: formatList([
        "这是 Heartbeat 安全扫描发现的工作区事件。",
        `类型：${formatHeartbeatKindLabel(event.kind)}`,
        `严重度：${formatHeartbeatSeverityLabel(event.severity)}`,
        "它只提示、归档和引导审查，不会自动接受经验、发布知识或调用外部制作工具。",
      ]),
    },
    {
      title: "发现的问题",
      body: event.summary || "Heartbeat 没有返回摘要。",
    },
    {
      title: "证据与动作",
      body: formatList([
        event.actionRefs?.length > 0 ? `建议动作：${formatList(event.actionRefs)}` : null,
        event.evidenceRefs?.length > 0 ? `证据：${formatList(event.evidenceRefs)}` : null,
        event.target ? `目标：${formatHeartbeatTarget(event.target)}` : null,
        event.kind === "reflection-due" ? "建议先进入关联 run 详情执行复盘。" : null,
        event.kind === "stale-review" ? "建议处理对应候选的审核队列。" : null,
        event.kind === "knowledge-ready" ? "建议审核并发布已接受知识候选。" : null,
        event.kind === "adapter-risk"
          ? "高风险 Adapter 动作只能查看、解释或调整设置，不能由 Heartbeat 自动触发。"
          : null,
        event.kind === "care" && event.target?.kind === "run-report"
          ? "这个运行结果还没有进入长期记忆，后续制作可能无法召回这次经验。"
          : null,
        event.kind === "care" && event.target?.kind !== "run-report"
          ? "这是导演化牵挂提醒：已通过的内容还没有变成制作可召回能力。"
          : null,
        event.kind === "skill-proposal-due"
          ? "这条经验已经通过审核，但还没有进入 Skill 候选审查链路。"
          : null,
        event.kind === "skill-proposal-review"
          ? "Skill 候选需要你审核后，才允许进入应用步骤。"
          : null,
        event.kind === "skill-apply-ready"
          ? "Skill 候选已经通过审核，可以安全应用为可召回 Skill。"
          : null,
        event.kind === "maintenance-due"
          ? "这是记忆治理维护提醒：优先预览 accepted/pending 积压和缺召回评测知识，再决定是否执行维护。"
          : null,
      ]),
    },
    {
      title: "可执行处理",
      body:
        actions.length > 0
          ? formatList(actions.map((action) => action.label))
          : "当前事件没有可安全直连的按钮，请按建议动作处理。",
    },
  ];
}

function createReviewRunHoldingReason({ run, approvalRequired, autoContinue, ready, blocked }) {
  if (blocked.length > 0) {
    return `运行遇到异常：${blocked.map(formatReviewAssignmentWithReason).join("；")}`;
  }
  if (approvalRequired.length > 0) {
    return formatList([
      "运行已经完成前置安全预览，但后续制作任务需要人工批准。",
      `待批准：${approvalRequired.map(formatReviewAssignmentBrief).join("；")}`,
      autoContinue.length > 0
        ? `自动任务在等依赖：${autoContinue.map(formatReviewAssignmentBrief).join("；")}`
        : null,
    ]);
  }
  if (ready.length > 0) {
    return `有 ${ready.length} 个任务已经 ready，等待本地 worker 推进。`;
  }
  if (run.status === "completed") {
    return "运行已经完成，没有卡点。";
  }
  if (run.status === "created") {
    return "运行已经创建，但还没有启动。";
  }
  return run.previewSummary ?? "后端没有返回明确卡点，请查看审计或报告。";
}

function createReviewReportFailureReason(report, failedAssignments) {
  if (report.bridgeFailureMessage || report.bridgeFailureReason) {
    return formatList([
      report.bridgeFailureReason ? `原因：${report.bridgeFailureReason}` : null,
      report.bridgeFailureMessage ? `说明：${report.bridgeFailureMessage}` : null,
      report.bridgeStatus ? `状态码：${report.bridgeStatus}` : null,
      report.retryable !== null && report.retryable !== undefined
        ? `是否可重试：${formatBoolean(report.retryable)}`
        : null,
    ]);
  }
  if (failedAssignments.length > 0) {
    return failedAssignments.map(formatReviewAssignmentWithReason).join("\n");
  }
  return "未发现失败原因。";
}

function createReviewReportNextAction(report, failedAssignments) {
  if (report.nextAction) {
    return report.nextAction;
  }
  const rerouteable = failedAssignments.find(
    (assignment) => assignment.rerouteCandidates?.length > 0,
  );
  if (rerouteable) {
    return `建议先把 ${formatReviewAssignmentBrief(rerouteable)} 切换到 ${rerouteable.rerouteCandidates[0]}，再重试。`;
  }
  const retryable = failedAssignments.find((assignment) => assignment.retryAllowed !== false);
  if (retryable && report.retryAllowed !== false) {
    return `建议重试 ${formatReviewAssignmentBrief(retryable)}。`;
  }
  if (report.runStatus === "completed") {
    return "运行已完成，可以回到工作台继续制作或沉淀经验。";
  }
  return "先查看审计/解释，再决定是否重试、切换 Adapter 或重新制作。";
}

function formatReviewAssignmentBrief(assignment) {
  return formatList([assignment.role, assignment.assignmentId]);
}

function formatReviewAssignmentWithReason(assignment) {
  return `${formatReviewAssignmentBrief(assignment)}：${formatReviewAssignmentReason(assignment)}`;
}

function formatReviewBridgeVerdict(verdict) {
  const labels = {
    accepted: "已接受",
    responded: "已响应",
    failed: "失败",
    skipped: "跳过",
  };
  return labels[verdict] ?? verdict;
}

function formatHeartbeatKindLabel(kind) {
  const labels = {
    "stale-review": "心跳：待审查积压",
    "failed-run": "心跳：失败运行",
    "knowledge-ready": "心跳：知识待发布",
    "maintenance-due": "心跳：记忆治理维护",
    "adapter-degraded": "心跳：Adapter 降级",
    "adapter-risk": "心跳：Adapter 风险",
    "reflection-due": "心跳：需要复盘",
    "soul-candidate": "心跳：Soul 候选待审",
    care: "心跳：牵挂提醒",
    "cost-budget-warn": "心跳：成本预算告警",
    "skill-untrusted": "心跳：Skill 信任风险",
    "skill-proposal-due": "心跳：经验可转 Skill",
    "skill-proposal-review": "心跳：Skill 候选待审",
    "skill-apply-ready": "心跳：Skill 可应用",
  };
  return labels[kind] ?? kind ?? "心跳事件";
}

function formatHeartbeatSeverityLabel(severity) {
  const labels = {
    info: "提示",
    warn: "警告",
    blocked: "阻断",
  };
  return labels[severity] ?? severity ?? "未知严重度";
}

function formatHeartbeatTarget(target) {
  if (!target) {
    return "未解析到目标";
  }
  if (target.kind === "run-report") {
    return formatList([`run=${target.runId}`, `report=${target.reportId}`]);
  }
  if (target.kind === "experience") {
    return `经验候选：${target.candidateId}`;
  }
  if (target.kind === "knowledge") {
    return `知识候选：${target.packId}`;
  }
  if (target.kind === "soul") {
    return `Soul 候选：${target.candidateId}`;
  }
  if (target.kind === "adapter") {
    return `Adapter：${target.adapterId}`;
  }
  if (target.kind === "skill") {
    return `Skill：${target.skillId}`;
  }
  if (target.kind === "skill-proposal") {
    return `Skill 候选：${target.proposalId}`;
  }
  if (target.kind === "learning-governance") {
    return formatList([
      `记忆治理：${formatLearningGovernanceReasonLabel(target.reason)}`,
      target.count === null || target.count === undefined ? null : `数量=${target.count}`,
      target.sampleId ? `样本=${target.sampleId}` : null,
    ]);
  }
  if (target.kind === "path") {
    return target.path;
  }
  return target.kind ?? "未知目标";
}

function formatLearningGovernanceReasonLabel(reason) {
  const labels = {
    "accepted-experience-backlog": "已接受经验积压",
    "pending-experience-backlog": "待审经验积压",
    "published-knowledge-missing-recall-eval": "缺召回评测知识",
  };
  return labels[reason] ?? reason ?? "学习治理";
}

function createReviewAssetDetail(assetId) {
  const review = state.snapshot?.assets?.review;
  if (assetId.startsWith("experience:")) {
    const candidateId = assetId.replace("experience:", "");
    const base = createExperienceAssetDetail(`candidate:${candidateId}`);
    const candidate = state.snapshot?.candidate?.items?.find((item) => item.id === candidateId);
    if (!base || !candidate) {
      return null;
    }
    const sourceReader = createExperienceSourceReader(candidate);
    return {
      kind: "review-experience",
      lane: "experience",
      status: candidate.status,
      title: base.title,
      summary: base.summary,
      meta: base.meta,
      actionPrompts: base.actionPrompts?.filter((action) => action.action) ?? [],
      sections: [
        { title: "审核目标", body: "确认这条学习结果是否值得保存为 Director Angel 可复用经验。" },
        { title: "要保存的经验", body: candidate.summary },
        { title: "适用场景", body: candidate.applicability ?? "未返回" },
        {
          title: "风险与质量",
          body: formatList([formatExperienceQuality(candidate), formatList(candidate.risks)]),
        },
        { title: "证据引用", body: formatExperienceEvidenceDetail(candidate.evidence) },
        { title: "抓取原文", body: sourceReader.content || "未返回原文内容" },
      ],
      fields: [
        { label: "经验 ID", value: candidate.id },
        { label: "状态", value: formatExperienceStatusLabel(candidate.status) },
        { label: "来源", value: candidate.sourceRef },
        { label: "来源类型", value: formatExperienceSourceKind(candidate.sourceKind) },
        { label: "提炼方式", value: formatExperienceDistillation(candidate) },
        { label: "标签", value: formatList(candidate.tags) },
        { label: "原文", value: sourceReader.meta },
      ],
    };
  }
  if (assetId.startsWith("knowledge:")) {
    const packId = assetId.replace("knowledge:", "");
    const candidate = state.snapshot?.knowledge?.candidates?.find((item) => item.id === packId);
    if (!candidate) {
      return null;
    }
    return {
      kind: "review-knowledge",
      lane: "knowledge",
      status: candidate.status,
      title: candidate.title,
      summary: candidate.summary,
      meta: `${formatReviewStatusLabel(candidate.status)} · v${candidate.version ?? "none"}`,
      actionPrompts: createKnowledgeReviewActions(candidate),
      sections: [
        { title: "审核目标", body: "确认这份知识候选是否可以进入可发布知识包。" },
        { title: "知识摘要", body: candidate.summary },
        { title: "操作来源", body: formatList([candidate.operation, candidate.trigger]) },
        { title: "标签", body: formatList(candidate.tags) },
      ],
      fields: [
        { label: "Knowledge ID", value: candidate.id },
        { label: "状态", value: formatReviewStatusLabel(candidate.status) },
        { label: "版本", value: candidate.version ?? "none" },
        { label: "操作", value: candidate.operation },
        { label: "触发", value: candidate.trigger },
        { label: "更新时间", value: candidate.updatedAt },
      ],
    };
  }
  if (!review) {
    return null;
  }
  if (assetId.startsWith("trace:")) {
    const proposalId = assetId.replace("trace:", "");
    const proposal = review.traceProposalItems?.find((item) => item.id === proposalId);
    if (!proposal) {
      return null;
    }
    return {
      kind: "review-trace",
      lane: "trace",
      status: proposal.status,
      title: proposal.title,
      summary: proposal.summary ?? proposal.evidenceSummary ?? "Trace proposal 来自运行轨迹。",
      meta: `${formatReviewStatusLabel(proposal.status)} · ${proposal.riskLevel ?? "risk unknown"} · ${formatConfidence(
        proposal.confidence,
      )}`,
      actionPrompts: createTraceProposalDirectActions(proposal),
      sections: [
        { title: "审核目标", body: "判断这条运行轨迹提案是否值得沉淀为可复用经验。" },
        { title: "提案摘要", body: proposal.summary ?? "无" },
        { title: "证据", body: proposal.evidenceSummary ?? "无" },
        { title: "解释", body: proposal.explanation ?? "无" },
        {
          title: "来源",
          body: formatList([
            proposal.provenance,
            proposal.projectId ? `project=${proposal.projectId}` : null,
            proposal.groupId ? `group=${proposal.groupId}` : null,
            proposal.runId ? `run=${proposal.runId}` : null,
            proposal.reportId ? `report=${proposal.reportId}` : null,
          ]),
        },
      ],
      fields: [
        { label: "Proposal ID", value: proposal.id },
        { label: "状态", value: formatReviewStatusLabel(proposal.status) },
        { label: "类型", value: proposal.kind },
        { label: "触发", value: proposal.trigger },
        { label: "风险", value: proposal.riskLevel },
        { label: "置信度", value: formatConfidence(proposal.confidence) },
        { label: "Project", value: proposal.projectId ?? "none" },
        { label: "Group", value: proposal.groupId ?? "none" },
        { label: "Run", value: proposal.runId ?? "none" },
        { label: "Report", value: proposal.reportId ?? "none" },
        { label: "Record", value: proposal.recordId ?? "none" },
        { label: "Digest", value: proposal.digestId ?? "none" },
        { label: "角色", value: formatList(proposal.roles) },
        { label: "Adapter", value: formatList(proposal.selectedAdapters) },
        { label: "标签", value: formatList(proposal.tags) },
        { label: "创建时间", value: proposal.createdAt ?? "unknown" },
        { label: "更新时间", value: proposal.updatedAt ?? "unknown" },
      ],
    };
  }
  if (assetId.startsWith("run:")) {
    const runId = assetId.replace("run:", "");
    const run = review.executionItems?.find((item) => item.runId === runId);
    if (!run) {
      return null;
    }
    const report = findReviewReportForRun(review, run.runId);
    return {
      kind: "review-run",
      lane: "run",
      runId: run.runId,
      status: run.status,
      title: run.goal || run.runId,
      summary: run.previewSummary || "Director execution run summary。",
      meta: `${formatReviewStatusLabel(run.status)} · ${formatAssignmentCounts(run.assignmentCounts)}`,
      actionPrompts: createRunDirectActions(run),
      assignmentTable: run.assignments ?? [],
      delegationSnapshot: run.delegationSnapshot ?? null,
      sections: createReviewRunOperatorSections(run, report),
      fields: [
        { label: "Run ID", value: run.runId },
        { label: "Report ID", value: report?.reportId ?? "none" },
        { label: "状态", value: formatReviewStatusLabel(run.status) },
        { label: "Assignment", value: formatAssignmentCounts(run.assignmentCounts) },
        {
          label: "协作角色",
          value: formatReviewDelegationSummary(run.delegationSnapshot ?? {}),
        },
        { label: "事件数", value: run.eventCount ?? 0 },
        { label: "允许副作用", value: formatBoolean(run.sideEffectsAllowed) },
        { label: "创建时间", value: run.createdAt ?? "unknown" },
        { label: "开始时间", value: run.startedAt ?? "unknown" },
        { label: "更新时间", value: run.updatedAt ?? "unknown" },
        { label: "完成时间", value: run.completedAt ?? "unknown" },
      ],
    };
  }
  if (assetId.startsWith("report:")) {
    const reportId = assetId.replace("report:", "");
    const report =
      review.executionReportItems?.find((item) => item.reportId === reportId) ??
      (review.latestReport?.reportId === reportId ? review.latestReport : null);
    if (!report) {
      return null;
    }
    return {
      kind: "review-report",
      lane: "report",
      runId: report.runId,
      status: report.runStatus,
      title: report.operatorSummary || report.directorGoal || report.reportId,
      summary: report.nextAction || "执行报告来自后端 run report。",
      meta: `${formatReviewStatusLabel(report.runStatus)} · ${report.bridgeVerdict ?? "no verdict"}`,
      actionPrompts: createReportDirectActions(report),
      assignmentTable: report.assignments ?? [],
      sections: createReviewReportOperatorSections(report),
      fields: [
        { label: "Report ID", value: report.reportId },
        { label: "Run ID", value: report.runId },
        { label: "记录时间", value: report.recordedAt ?? "unknown" },
        { label: "运行状态", value: formatReviewStatusLabel(report.runStatus) },
        { label: "Bridge verdict", value: report.bridgeVerdict ?? "none" },
        { label: "Adapter route", value: report.adapterRoute ?? "none" },
        { label: "Last route", value: report.lastBridgeRoute ?? "none" },
        { label: "失败原因", value: report.bridgeFailureReason ?? "none" },
        { label: "可重试", value: formatBoolean(report.retryable) },
        { label: "允许重试", value: formatBoolean(report.retryAllowed) },
        { label: "可切换 Adapter", value: formatList(report.rerouteCandidates) },
        { label: "Assignment", value: formatAssignmentCounts(report.assignmentCounts) },
        { label: "Flags", value: formatList(report.flags) },
      ],
    };
  }
  if (assetId.startsWith("heartbeat:")) {
    const eventId = assetId.replace("heartbeat:", "");
    const event = review.heartbeatItems?.find((item) => item.eventId === eventId);
    if (!event) {
      return null;
    }
    return {
      kind: "review-heartbeat",
      lane: "heartbeat",
      status: event.severity,
      title: formatHeartbeatKindLabel(event.kind),
      summary: event.summary,
      meta: `${formatHeartbeatSeverityLabel(event.severity)} · ${event.createdAt ?? "unknown"}`,
      actionPrompts: createHeartbeatDirectActions(event),
      sections: createReviewHeartbeatOperatorSections(event),
      fields: [
        { label: "Event ID", value: event.eventId },
        { label: "类型", value: formatHeartbeatKindLabel(event.kind) },
        { label: "严重度", value: formatHeartbeatSeverityLabel(event.severity) },
        { label: "创建时间", value: event.createdAt ?? "unknown" },
        { label: "目标", value: formatHeartbeatTarget(event.target) },
        { label: "Action refs", value: formatList(event.actionRefs) },
        { label: "Evidence refs", value: formatList(event.evidenceRefs) },
      ],
    };
  }
  if (assetId.startsWith("skill-curator:")) {
    const skillId = assetId.replace("skill-curator:", "");
    const action = state.snapshot?.assets?.skills?.curator?.actions?.find(
      (item) => item.skillId === skillId,
    );
    if (!action) {
      return null;
    }
    return {
      kind: "review-skill-curator",
      lane: "skill-curator",
      status: action.status ?? action.kind,
      title: action.title ?? action.skillId,
      summary: action.summary ?? action.reason,
      meta: `${formatSkillCuratorKindLabel(action.kind)} · ${formatSkillCuratorSeverityLabel(
        action.severity,
      )}`,
      actionPrompts: createSkillCuratorDirectActions(action),
      sections: [
        {
          title: "Curator 建议",
          body: formatList([
            `建议：${formatSkillCuratorKindLabel(action.kind)}`,
            `严重度：${formatSkillCuratorSeverityLabel(action.severity)}`,
            action.reason,
          ]),
        },
        {
          title: "使用证据",
          body: formatSkillCuratorEvidence(action.evidence),
        },
        {
          title: "重复关系",
          body: formatList([
            action.canonicalSkillId ? `canonical=${action.canonicalSkillId}` : null,
            ...(action.duplicateSkillIds ?? []).map((duplicateId) => `duplicate=${duplicateId}`),
          ]),
        },
        {
          title: "执行边界",
          body: formatList([
            action.explanationSurface?.curatorExplanation,
            formatList(action.explanationSurface?.nextActions),
            "Patch editor 需要 diff confirmation 和本地 skills.curator.write scope；bounded file scope 只允许写当前 approved Skill snapshot，remote curator write execution remains disabled。",
            "这些按钮只执行人工确认后的本地 snapshot/usage 维护：修补会清失败计数并保留 patch evidence，归档/合并会写新 approved snapshot 版本；不会让模型自动改写 Skill。",
          ]),
        },
        action.kind === "patch"
          ? {
              title: "Patch editor",
              body: "请回到 Skills 面板的 patch editor 修改 bounded Skill patch，并勾选 diff confirmation 后应用。",
            }
          : null,
        {
          title: "解释证据",
          body: formatList(action.explanationSurface?.evidenceRefs),
        },
      ].filter(Boolean),
      fields: [
        { label: "Skill ID", value: action.skillId },
        { label: "建议", value: formatSkillCuratorKindLabel(action.kind) },
        { label: "状态", value: formatReviewStatusLabel(action.status ?? action.kind) },
        { label: "严重度", value: formatSkillCuratorSeverityLabel(action.severity) },
        { label: "Canonical", value: action.canonicalSkillId ?? "none" },
        { label: "Duplicates", value: formatList(action.duplicateSkillIds) },
        { label: "证据", value: formatSkillCuratorEvidence(action.evidence) },
      ],
    };
  }
  return null;
}

function findReviewReportForRun(review, runId) {
  if (!review || !runId) {
    return null;
  }
  return (
    review.executionReportItems?.find((item) => item.runId === runId) ??
    (review.latestReport?.runId === runId ? review.latestReport : null)
  );
}

function createKnowledgeReviewActions(candidate) {
  if (candidate.status === "accepted") {
    return [
      {
        label: "发布知识",
        action: {
          type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
          packId: candidate.id,
        },
      },
    ];
  }
  if (candidate.status === "pending") {
    return [
      {
        label: "接受知识",
        action: {
          type: DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
          packId: candidate.id,
        },
      },
    ];
  }
  return [];
}

function createTraceProposalDirectActions(proposal) {
  const actions = [
    {
      label: "解释",
      tone: "secondary",
      action: createCommandRunAction("traceProposal.explain", { proposalId: proposal.id }),
    },
    {
      label: "预览",
      tone: "secondary",
      action: createCommandRunAction("traceProposal.preview", { proposalId: proposal.id }),
    },
    {
      label: proposal.riskLevel === "high" ? "记录教训" : "沉淀经验",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL,
        proposalId: proposal.id,
        intent: proposal.riskLevel === "high" ? "failure-lesson" : "positive-experience",
      },
    },
  ];
  if (proposal.status === "pending") {
    actions.push(
      {
        label: "接受",
        action: createCommandRunAction("traceProposal.accept", { proposalId: proposal.id }),
      },
      {
        label: "拒绝",
        tone: "danger",
        action: createCommandRunAction("traceProposal.reject", { proposalId: proposal.id }),
      },
    );
  }
  return actions;
}

function createRunDirectActions(run) {
  const actions = [];
  const approvalCount = countApprovableAssignments(run.assignments);
  if (["created", "running", "paused"].includes(run.status) || approvalCount > 0) {
    actions.push({
      label: approvalCount > 0 ? `继续推进 (${approvalCount} 个待审)` : "继续推进",
      action: {
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: run.runId,
      },
    });
  }
  if (approvalCount > 0) {
    actions.push({
      label: `批准全部待审任务 (${approvalCount})`,
      action: {
        type: DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS,
        runId: run.runId,
      },
    });
  }
  if (run.status === "completed" || run.status === "failed" || run.status === "aborted") {
    actions.push({
      label: "复盘",
      action: {
        type: DESKTOP_ACTIONS.RUN_REFLECT,
        runId: run.runId,
      },
    });
  }
  if (run.status === "completed" || run.status === "failed" || run.status === "aborted") {
    actions.push({
      label: run.status === "completed" ? "沉淀经验" : "记录教训",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
        runId: run.runId,
        intent: run.status === "completed" ? "positive-experience" : "failure-lesson",
      },
    });
  }
  if (run.delegationSnapshot) {
    actions.push({
      label: "协作角色",
      tone: "secondary",
      action: {
        type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
        runId: run.runId,
      },
    });
  }
  if (approvalCount === 0 && run.status === "created") {
    actions.push({
      label: "启动",
      action: createCommandRunAction("run.start", { runId: run.runId }),
    });
  }
  if (run.status === "paused") {
    actions.push({
      label: "恢复",
      action: createCommandRunAction("run.resume", { runId: run.runId }),
    });
  }
  if (
    (run.status === "running" || run.status === "created") &&
    approvalCount === 0 &&
    run.assignments?.some((assignment) => assignment.status === "ready")
  ) {
    actions.push({
      label: "推进一次",
      action: createCommandRunAction("run.once", { runId: run.runId }),
    });
  }
  actions.push(
    {
      label: "状态",
      tone: "secondary",
      action: createCommandRunAction("run.status", { runId: run.runId }),
    },
    {
      label: "审计",
      tone: "secondary",
      action: createCommandRunAction("run.audit", { runId: run.runId }),
    },
    {
      label: "报告",
      tone: "secondary",
      action: createCommandRunAction("run.report", { runId: run.runId }),
    },
  );
  const retryable = findRetryableAssignment(run.assignments);
  if (retryable) {
    actions.push({
      label: "重试失败任务",
      action: createCommandRunAction("run.retry", {
        runId: run.runId,
        assignmentId: retryable.assignmentId,
      }),
    });
  }
  const rerouteable = findRerouteableAssignment(run.assignments);
  if (rerouteable) {
    actions.push({
      label: "切换 Adapter",
      action: createCommandRunAction("run.reroute", {
        runId: run.runId,
        assignmentId: rerouteable.assignment.assignmentId,
        adapterId: rerouteable.adapterId,
      }),
    });
  }
  return actions;
}

function createReportDirectActions(report) {
  const actions = [
    ...(["created", "running", "paused"].includes(report.runStatus)
      ? [
          {
            label: "继续推进",
            action: {
              type: DESKTOP_ACTIONS.RUN_CONTINUE,
              runId: report.runId,
            },
          },
        ]
      : []),
    {
      label: "复盘",
      action: {
        type: DESKTOP_ACTIONS.RUN_REFLECT,
        runId: report.runId,
      },
    },
    {
      label: report.runStatus === "completed" ? "沉淀经验" : "记录教训",
      action: {
        type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
        runId: report.runId,
        intent: report.runStatus === "completed" ? "positive-experience" : "failure-lesson",
      },
    },
    {
      label: "审计",
      tone: "secondary",
      action: createCommandRunAction("run.audit", { runId: report.runId }),
    },
    {
      label: "重新生成报告",
      tone: "secondary",
      action: createCommandRunAction("run.report", { runId: report.runId }),
    },
  ];
  const approvalCount = countApprovableAssignments(report.assignments);
  if (approvalCount > 0) {
    actions.unshift({
      label: `批准全部待审任务 (${approvalCount})`,
      action: {
        type: DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS,
        runId: report.runId,
      },
    });
  }
  const retryable = findRetryableAssignment(report.assignments);
  if (retryable && report.retryAllowed !== false) {
    actions.push({
      label: "重试失败任务",
      action: createCommandRunAction("run.retry", {
        runId: report.runId,
        assignmentId: retryable.assignmentId,
      }),
    });
  }
  const rerouteable = findRerouteableAssignment(report.assignments);
  if (rerouteable) {
    actions.push({
      label: "切换 Adapter",
      action: createCommandRunAction("run.reroute", {
        runId: report.runId,
        assignmentId: rerouteable.assignment.assignmentId,
        adapterId: rerouteable.adapterId,
      }),
    });
  }
  return actions;
}

function createHeartbeatDirectActions(event) {
  const target = event.target ?? {};
  const actions = [];
  if (target.runId) {
    actions.push({
      label: "查看报告",
      tone: "secondary",
      action: createCommandRunAction("run.report", { runId: target.runId }),
    });
    if (event.kind === "failed-run" || event.kind === "reflection-due") {
      actions.push({
        label: "复盘",
        action: {
          type: DESKTOP_ACTIONS.RUN_REFLECT,
          runId: target.runId,
        },
      });
    }
    if (event.kind === "failed-run") {
      actions.push({
        label: "记录教训",
        action: {
          type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
          runId: target.runId,
          intent: "failure-lesson",
        },
      });
    }
    if (event.kind === "care") {
      actions.push(
        {
          label: "查看记忆状态",
          tone: "secondary",
          action: createCommandRunAction("memory.status"),
        },
        {
          label: "复盘",
          action: {
            type: DESKTOP_ACTIONS.RUN_REFLECT,
            runId: target.runId,
          },
        },
      );
    }
  }
  if (target.kind === "experience" && target.candidateId) {
    actions.push({
      label: "打开经验",
      tone: "secondary",
      action: createUiSelectAssetAction("review", `experience:${target.candidateId}`),
    });
    if (event.kind === "care") {
      actions.push({
        label: "晋升经验",
        action: {
          type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
          candidateId: target.candidateId,
        },
      });
    }
    if (event.kind === "skill-proposal-due") {
      actions.push({
        label: "生成 Skill 候选",
        action: {
          type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
          candidateId: target.candidateId,
        },
      });
    }
  }
  if (target.kind === "knowledge" && target.packId) {
    actions.push({
      label: "打开知识",
      tone: "secondary",
      action: createUiSelectAssetAction("review", `knowledge:${target.packId}`),
    });
    if (event.kind === "knowledge-ready") {
      actions.push({
        label: "接受知识",
        action: {
          type: DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
          packId: target.packId,
        },
      });
    }
    if (event.kind === "care") {
      actions.push({
        label: "发布知识",
        action: {
          type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
          packId: target.packId,
        },
      });
    }
  }
  if (target.kind === "soul" && target.candidateId) {
    actions.push({
      label: "解释 Soul",
      tone: "secondary",
      action: {
        type: DESKTOP_ACTIONS.SOUL_EXPLAIN,
        candidateId: target.candidateId,
      },
    });
  }
  if (target.kind === "adapter" && target.adapterId) {
    actions.push({
      label: "查看 Adapter",
      tone: "secondary",
      action: createUiSelectAssetAction("tools", target.adapterId),
    });
    actions.push({
      label: "解释 Adapter",
      tone: "secondary",
      action: createCommandRunAction("adapter.explain", { adapterId: target.adapterId }),
    });
  }
  if (target.kind === "skill" && target.skillId) {
    actions.push({
      label: "打开 Skill",
      tone: "secondary",
      action: createUiSelectAssetAction("skills", target.skillId),
    });
  }
  if (target.kind === "skill-proposal" && target.proposalId) {
    actions.push({
      label: "打开 Skill 候选",
      tone: "secondary",
      action: createUiSelectAssetAction("skills", `proposal:${target.proposalId}`),
    });
    if (event.kind === "skill-proposal-review") {
      actions.push(
        {
          label: "接受 Skill 候选",
          action: {
            type: DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
            proposalId: target.proposalId,
          },
        },
        {
          label: "拒绝 Skill 候选",
          tone: "danger",
          action: {
            type: DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
            proposalId: target.proposalId,
          },
        },
      );
    }
    if (event.kind === "skill-apply-ready") {
      actions.push({
        label: "应用为 Skill",
        action: {
          type: DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
          proposalId: target.proposalId,
        },
      });
    }
  }
  if (event.kind === "cost-budget-warn") {
    actions.push({
      label: "查看开关",
      tone: "secondary",
      action: createCommandRunAction("workspace.switches"),
    });
  }
  if (event.kind === "maintenance-due") {
    actions.push(
      {
        label: "预览维护",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW,
        },
      },
      {
        label: "执行维护",
        action: {
          type: DESKTOP_ACTIONS.MAINTENANCE_APPLY,
        },
      },
    );
  }
  return actions;
}

function createUiSelectAssetAction(surface, assetId) {
  return {
    type: "ui.selectAsset",
    surface,
    assetId,
  };
}

function createAssignmentDirectActions(detail, assignment) {
  const runId = detail.runId ?? assignment.runId;
  if (!runId || !assignment.assignmentId) {
    return [];
  }
  const actions = [];
  if (isRetryableAssignment(assignment)) {
    actions.push({
      label: "重试",
      action: createCommandRunAction("run.retry", {
        runId,
        assignmentId: assignment.assignmentId,
      }),
    });
  }
  if (assignment.status === "ready") {
    actions.push({
      label: "推进一次",
      action: createCommandRunAction("run.once", { runId }),
    });
  }
  if (isApprovableAssignment(assignment)) {
    actions.push({
      label: "批准",
      action: {
        type: DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT,
        runId,
        assignmentId: assignment.assignmentId,
      },
    });
  }
  const adapterId = assignment.rerouteCandidates?.[0];
  if (adapterId) {
    actions.push({
      label: "切换",
      tone: "secondary",
      action: createCommandRunAction("run.reroute", {
        runId,
        assignmentId: assignment.assignmentId,
        adapterId,
      }),
    });
  }
  return actions;
}

function createCommandRunAction(commandId, args = {}) {
  return {
    type: DESKTOP_ACTIONS.COMMAND_RUN,
    commandId,
    args: compactObject(args),
  };
}

function compactObject(value) {
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null && entry !== "") {
      result[key] = entry;
    }
  }
  return result;
}

function findRetryableAssignment(assignments = []) {
  return assignments.find(isRetryableAssignment) ?? null;
}

function findApprovableAssignment(assignments = []) {
  return assignments.find(isApprovableAssignment) ?? null;
}

function countApprovableAssignments(assignments = []) {
  return assignments.filter(isApprovableAssignment).length;
}

function findRerouteableAssignment(assignments = []) {
  const assignment = assignments.find((item) => item.rerouteCandidates?.length > 0);
  if (!assignment) {
    return null;
  }
  return { assignment, adapterId: assignment.rerouteCandidates[0] };
}

function isRetryableAssignment(assignment) {
  return (
    ["failed", "blocked"].includes(assignment.status) &&
    assignment.retryAllowed !== false &&
    assignment.assignmentId
  );
}

function isApprovableAssignment(assignment) {
  return (
    assignment?.status === "pending" &&
    assignment.approvalMode === "operator_approve" &&
    assignment.assignmentId
  );
}

function createCommandActionPrompt(command) {
  const prompts = {
    "workspace.status": "/状态",
    "workspace.doctor": "/诊断",
    "workspace.runtime": "/工具 平台",
    "workspace.switches": "/设置",
    "heartbeat.status": "/心跳 状态",
    "settings.set": "/设置 ",
    "apiProvider.set": "/供应方 ",
    "apiProvider.image": "/图片 ",
    "apiProvider.video": "/视频 ",
    "production.start": "/制作 ",
    "learning.directory": "/学习 ",
    "learning.query": "/学习 ",
    "learning.url": "/学习 https://",
    "learning.text": "/学习 ",
    "experience.list": "/经验 列表",
    "experience.accept": "/经验 接受",
    "experience.reject": "/经验 拒绝",
    "experience.promote": "/经验 晋升",
    "knowledge.candidates": "/知识 列表",
    "knowledge.accept": "/知识 接受",
    "knowledge.explain": "/知识 说明 ",
    "knowledge.publish": "/知识 发布",
    "knowledge.recallPreview": "/知识 召回",
    "task.proposalList": "/技能",
    "task.proposal-get": "/技能 查看 ",
    "task.proposal-review": "/技能 审查 ",
    "task.proposal-accept": "/技能 接受 ",
    "task.proposal-reject": "/技能 拒绝 ",
    "task.proposal-explain": "/技能 解释 ",
    "task.proposal-preview": "/技能 预览 ",
    "task.proposal-apply": "/技能 应用 ",
    "task.proposalRollback": "/技能 回滚 ",
    "adapter.list": "/工具",
    "adapter.register": "/工具 注册 ",
    "adapter.enable": "/工具 启用 ",
    "adapter.disable": "/工具 禁用 ",
    "adapter.explain": "/工具 说明 ",
    "platform.capabilities": "/工具 平台",
    "traceProposal.list": "/审查",
    "traceProposal.status": "/审查 状态",
    "traceProposal.explain": "/审查 解释 ",
    "traceProposal.review": "/审查 审查 ",
    "traceProposal.preview": "/审查 预览 ",
    "traceProposal.accept": "/审查 接受 ",
    "traceProposal.reject": "/审查 拒绝 ",
    "traceProposal.replay": "/审查 重放 ",
    "run.status": "/运行 状态 ",
    "run.start": "/运行 启动 ",
    "run.continue": "/运行 继续 ",
    "run.delegations": "/运行 协作 ",
    "run.once": "/运行 推进 ",
    "run.pause": "/运行 暂停 ",
    "run.resume": "/运行 恢复 ",
    "run.abort": "/运行 中止 ",
    "run.audit": "/运行 审计 ",
    "run.explain": "/运行 解释 ",
    "run.retry": "/运行 重试 ",
    "run.approve": "/运行 批准 ",
    "run.approvePending": "/运行 批准全部 ",
    "run.reroute": "/运行 切换 ",
    "run.report": "/运行 报告 ",
    "memory.status": "/记忆 状态",
    "control.memoryInspect": "/记忆 查看 ",
    "control.memoryClear": "/记忆 清理 ",
  };
  return prompts[command.id] ?? null;
}

function resolveAssetCommandHint(commandId) {
  if (!commandId) {
    return "只读浏览";
  }
  const command = findCommand(commandId);
  return command ? `工作台 /能力 · ${command.label}` : `工作台 /能力 · ${commandId}`;
}

function isSelectedAsset(surface, assetId) {
  return state.selectedAsset?.surface === surface && state.selectedAsset?.assetId === assetId;
}

function selectExperienceAction(_candidateId, status) {
  const candidateId = _candidateId?.trim();
  if (!candidateId) {
    return;
  }
  const prompt = status === "accepted" ? `/经验 晋升 ${candidateId}` : `/经验 接受 ${candidateId}`;
  openWorkbenchPrompt(prompt);
  selectInspectorPanel("state");
}

function selectKnowledgeAction(_packId, status) {
  const packId = _packId?.trim();
  if (!packId) {
    return;
  }
  const prompt =
    status === "accepted"
      ? `/知识 发布 ${packId}`
      : status === "published"
        ? `/知识 说明 ${packId}`
        : `/知识 接受 ${packId}`;
  openWorkbenchPrompt(prompt);
  selectInspectorPanel("state");
}

function getActiveWorkflow() {
  return WORKFLOWS.find((workflow) => workflow.id === state.selectedGroupId) ?? WORKFLOWS[0];
}

function isWorkbenchActive() {
  return getActiveWorkflow()?.id === "workbench";
}

function isAssetSurfaceWorkflow(workflowId) {
  return ASSET_WORKFLOW_IDS.has(workflowId);
}

function getWorkflowCommands(workflow) {
  if (!workflow) {
    return [];
  }
  return workflow.commandIds.map(findCommand).filter(Boolean);
}

function getWorkflowItems(workflow) {
  if (!workflow) {
    return [];
  }
  if (workflow.id === "settings") {
    return [];
  }
  if (workflow.id === "workbench") {
    return getWorkflowCommands(workflow);
  }
  return getWorkflowCommands(workflow);
}

function getWorkflowCount(workflow) {
  const assets = state.snapshot?.assets;
  switch (workflow.id) {
    case "workbench":
      return getWorkflowCommands(workflow).length;
    case "experience":
      return (
        (assets?.experience?.total ?? 0) +
        (assets?.experience?.knowledgeCandidateCount ?? 0) +
        (assets?.experience?.publishedCount ?? 0)
      );
    case "skills":
      return assets?.skills?.total ?? 0;
    case "tools":
      return countExternalToolItems(assets?.tools);
    case "review":
      return assets?.review?.pendingCount ?? 0;
    case "settings":
      return SETTINGS_TABS.length;
    default:
      return getWorkflowItems(workflow).length;
  }
}

function countExternalToolItems(tools) {
  return (
    tools?.externalToolBus?.catalogCount ??
    tools?.items?.length ??
    tools?.integratedToolCount ??
    tools?.registeredCount ??
    0
  );
}

function countExternalToolBusCallableItems(externalToolBus) {
  return externalToolBus?.items?.filter((item) => item.canInvoke === true).length ?? 0;
}

function formatSettingCategory(category) {
  const labels = {
    paths: "路径",
    features: "功能开关",
    roles: "角色",
    adapterOverrides: "工具覆盖",
    apiProviders: "API 供应方",
    communications: "通信网关",
    externalTools: "外部工具",
    mcp: "MCP",
    diagnostics: "诊断",
  };
  return labels[category] ?? category ?? "设置";
}

function formatWeixinGatewayStatus(gateway) {
  if (gateway.running) {
    return "运行中";
  }
  const labels = {
    "not-installed": "未安装",
    stopped: "已停止",
    unknown: "未知",
  };
  return labels[gateway.status] ?? gateway.status ?? "未知";
}

function formatWeixinRuntimeApprovalStatus(status) {
  const labels = {
    pending: "待确认",
    approved: "已确认",
    rejected: "已拒绝",
    expired: "已过期",
  };
  return labels[status] ?? status ?? "未知";
}

function formatGuardrailStatus(status) {
  const labels = {
    ok: "正常",
    warn: "注意",
    blocked: "阻断",
    trusted: "可信",
    mixed: "混合",
    untrusted: "不可信",
    enabled: "沙箱内",
    partial: "部分沙箱",
    disabled: "真实执行",
  };
  return labels[status] ?? status ?? "未知";
}

function formatToolApprovalMode(mode) {
  const labels = {
    "auto-allow-trusted-desktop": "可信桌面自动确认",
    ask: "每次确认",
    deny: "阻断",
  };
  return labels[mode] ?? mode ?? "未知";
}

function formatList(items) {
  const values = Array.isArray(items)
    ? items.filter((item) => item !== undefined && item !== null)
    : [];
  return values.length > 0 ? values.join(", ") : "无";
}

function formatEpochDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "未知";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCompactExperienceSummary(value) {
  const summary = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (summary.length === 0) {
    return "暂无摘要，点开查看详情。";
  }
  return summary.length > 160 ? `${summary.slice(0, 160)}...` : summary;
}

function formatCompactSkillSummary(value) {
  const summary = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (summary.length === 0) {
    return "暂无说明，点开查看 Skill 正文。";
  }
  return summary.length > 140 ? `${summary.slice(0, 140)}...` : summary;
}

function formatCompactReviewSummary(value) {
  const summary = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (summary.length === 0) {
    return "暂无摘要，点开查看后端详情。";
  }
  return summary.length > 150 ? `${summary.slice(0, 150)}...` : summary;
}

function formatReviewLaneLabel(lane) {
  const labels = {
    experience: "经验审查",
    knowledge: "知识审查",
    trace: "Trace 提案",
    run: "运行",
    report: "运行报告",
    heartbeat: "心跳",
    "skill-curator": "Skill Curator",
  };
  return labels[lane] ?? lane ?? "未知板块";
}

function formatReviewStatusLabel(status) {
  const labels = {
    pending: "待审核",
    accepted: "已接受",
    promoted: "已晋升",
    published: "已发布",
    rejected: "已拒绝",
    created: "已创建",
    ready: "就绪",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    blocked: "阻塞",
    warn: "警告",
    "needs-patch": "待修补",
    "archive-candidate": "归档候选",
    "merge-candidate": "合并候选",
    info: "提示",
    skipped: "跳过",
    aborted: "已中止",
    ok: "正常",
    degraded: "降级",
    unknown: "未知",
  };
  return labels[status] ?? status ?? "未知状态";
}

function formatReviewApprovalMode(approvalMode, status = null) {
  switch (approvalMode) {
    case "operator_approve":
      return "需人工批准";
    case "auto_allow":
      return status === "pending" ? "等待依赖完成后自动允许" : "自动允许";
    case "forbidden_in_beta1":
      return "Beta-1 禁止执行";
    default:
      return approvalMode ?? "未知审批模式";
  }
}

function formatReviewAssignmentTitle(assignment) {
  const role = assignment.role ?? assignment.actionClass ?? "";
  if (role.length === 0) {
    return assignment.assignmentId ?? "未命名任务";
  }
  return `${role} · ${formatReviewActionClassLabel(assignment.actionClass)}`;
}

function formatReviewAssignmentHumanState(assignment) {
  return formatList([
    formatReviewStatusLabel(assignment.status),
    formatReviewApprovalMode(assignment.approvalMode, assignment.status),
    assignment.selectedAdapter || assignment.adapterId
      ? `当前 Adapter：${assignment.selectedAdapter ?? assignment.adapterId}`
      : null,
    assignment.rerouteCandidates?.length > 0
      ? `可切换：${assignment.rerouteCandidates.join(" / ")}`
      : null,
  ]);
}

function formatReviewAssignmentReason(assignment) {
  if (assignment.bridgeFailureMessage || assignment.bridgeFailureReason) {
    return formatList([
      "外部桥接失败",
      assignment.bridgeFailureReason,
      assignment.bridgeFailureMessage,
      assignment.bridgeStatus ? `HTTP ${assignment.bridgeStatus}` : null,
    ]);
  }
  if (assignment.blockingReason) {
    return `被阻塞：${assignment.blockingReason}`;
  }
  if (assignment.status === "pending" && assignment.approvalMode === "operator_approve") {
    return "系统已经拆出这一步，但不会自动执行，需要操作者先确认目标、产物和风险。";
  }
  if (assignment.status === "pending" && assignment.approvalMode === "auto_allow") {
    return formatList([
      "依赖任务还没有完成",
      assignment.dependsOn?.length > 0 ? `依赖：${assignment.dependsOn.join(" / ")}` : null,
    ]);
  }
  if (assignment.status === "ready") {
    return "依赖已经满足，等待本地 worker 推进。";
  }
  if (assignment.status === "completed") {
    return assignment.resultSummary ?? "这一步已经完成。";
  }
  if (assignment.status === "running") {
    return "本地 worker 正在执行这一步。";
  }
  if (assignment.status === "failed") {
    return assignment.resultSummary ?? "这一步执行失败，需要先看报告或重试。";
  }
  if (assignment.status === "blocked") {
    return "这一步被安全策略、依赖或外部桥接阻塞。";
  }
  return formatList([assignment.resultSummary, formatList(assignment.notes)]) || "暂无额外原因。";
}

function formatReviewAssignmentNextStep(assignment) {
  if (assignment.status === "pending" && assignment.approvalMode === "operator_approve") {
    return "需要人工批准：先核对这一步是否符合目标，确认后再通过后续批准/推进入口执行。";
  }
  if (assignment.status === "pending" && assignment.approvalMode === "auto_allow") {
    return "等待依赖完成后自动继续。";
  }
  if (assignment.status === "ready") {
    return "可用「推进一次」让本地 worker 执行 ready 任务。";
  }
  if (assignment.status === "failed" && assignment.rerouteCandidates?.length > 0) {
    return `可切换到 ${assignment.rerouteCandidates[0]} 后重试。`;
  }
  if (assignment.status === "failed" && assignment.retryAllowed !== false) {
    return "可点击重试；如果继续失败，先看审计或报告。";
  }
  if (assignment.status === "blocked" && assignment.rerouteCandidates?.length > 0) {
    return `切换到 ${assignment.rerouteCandidates[0]}，再重试。`;
  }
  if (assignment.status === "completed") {
    return "无需处理，后续依赖会继续。";
  }
  if (assignment.status === "running") {
    return "等待执行结果，然后刷新报告。";
  }
  return "先查看状态、审计或报告，再决定是否重试、切换或重新制作。";
}

function formatReviewActionClassLabel(actionClass) {
  const labels = {
    analyze: "分析",
    generate: "生成",
    transform: "转换",
    validate: "校验",
    route: "路由",
    review: "审查",
  };
  return labels[actionClass] ?? actionClass ?? "任务";
}

function mapReviewTone(status) {
  if (["accepted", "promoted", "published", "completed", "ok", "ready"].includes(status)) {
    return "good";
  }
  if (["failed", "blocked", "aborted", "rejected", "degraded"].includes(status)) {
    return "bad";
  }
  return "warn";
}

function formatConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "置信度未知";
  }
  return value >= 0 && value <= 1 ? `置信度 ${Math.round(value * 100)}%` : `置信度 ${value}`;
}

function formatAssignmentCounts(counts) {
  if (!counts || typeof counts !== "object") {
    return "无 assignment";
  }
  const labels = {
    ready: "就绪",
    pending: "待处理",
    running: "运行中",
    completed: "完成",
    failed: "失败",
    blocked: "阻塞",
    skipped: "跳过",
    aborted: "中止",
  };
  const parts = Object.entries(labels)
    .map(([key, label]) => {
      const count = counts[key] ?? 0;
      return count > 0 ? `${label} ${count}` : null;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "0 assignment";
}

function formatReviewEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return "无事件";
  }
  return events
    .map((event) =>
      formatList([
        event.at ?? event.createdAt,
        event.assignmentId ? `assignment=${event.assignmentId}` : null,
        event.type,
        event.summary ?? event.message,
      ]),
    )
    .join("\n");
}

function formatSkillSourceLabel(source) {
  return source === "self" ? "自进化" : "外部";
}

function formatSkillEnablementLabel(enabled) {
  return enabled === false ? "已关闭" : "已开启";
}

function countSkillsByRuntimeStatus(items, field) {
  return (items ?? []).filter((item) => item?.[field] !== false).length;
}

function countSkillsByDoctorStatus(items, status) {
  return (items ?? []).filter((item) => (item?.doctorStatus ?? item?.runtimeStatus) === status).length;
}

function formatSkillDoctorStatusLabel(status) {
  const labels = {
    ready: "依赖可用",
    "needs-setup": "需配置",
    disabled: "已关闭",
    "model-invocation-disabled": "模型调用关闭",
    "missing-skill": "Skill 已移除",
    missing_skill: "Skill 已移除",
  };
  return labels[status] ?? status ?? "依赖未知";
}

function formatSkillModelVisibility(skill) {
  if (skill.modelInvocable === false || skill.runtimeStatus === "model-invocation-disabled") {
    return "模型不可调用";
  }
  if (skill.runtimeStatus === "needs-setup" || skill.doctorStatus === "needs-setup") {
    return "模型暂不可见";
  }
  return skill.modelVisible === false ? "模型不可见" : "模型可见";
}

function formatSkillEligibility(skill) {
  if (skill.modelInvocable === false || skill.runtimeStatus === "model-invocation-disabled") {
    return "不可召回：模型调用已关闭";
  }
  if (skill.runtimeStatus === "needs-setup" || skill.doctorStatus === "needs-setup") {
    return "不可召回：依赖未就绪";
  }
  return skill.eligible === false ? "不可召回" : "可召回";
}

function formatSkillPermissionStatus(skill) {
  const labels = {
    allowed: "允许直接使用",
    "approval-required": "需要确认",
    "model-invocation-disabled": "模型调用关闭",
    "needs-setup": "需要配置",
    denied: "已拒绝",
    disabled: "已关闭",
  };
  return labels[skill.permissionStatus] ?? skill.permissionStatus ?? "未知";
}

function formatSkillSnapshotVersion(skill) {
  return formatEpochDate(skill.snapshotVersion);
}

function formatSkillRuntimeLine(skill) {
  return formatList([
    formatSkillModelVisibility(skill),
    formatSkillEligibility(skill),
    formatSkillDoctorStatusLabel(skill.doctorStatus ?? skill.runtimeStatus),
    formatSkillPermissionStatus(skill),
  ]);
}

function resolveSkillCategoryId(skill) {
  const categoryId =
    skill.category?.categoryId ??
    skill.categoryId ??
    skill.metadata?.categoryId ??
    inferSkillCategoryId(skill);
  return String(categoryId || "uncategorized");
}

function resolveSkillCategoryName(skill) {
  if (typeof skill.category?.name === "string" && skill.category.name.length > 0) {
    return formatSkillCategoryDisplayName(skill.category);
  }
  const categoryId = resolveSkillCategoryId(skill);
  return formatSkillCategoryDisplayName({ categoryId, id: categoryId, name: categoryId });
}

function formatSkillCategoryDisplayName(category) {
  const categoryId = String(category?.categoryId ?? category?.id ?? category ?? "uncategorized");
  const labels = {
    all: "全部 Skill",
    workflow: "工作流",
    coding: "编码能力",
    research: "研究能力",
    backend: "后端能力",
    frontend: "前端能力",
    testing: "测试验证",
    documentation: "文档能力",
    security: "安全能力",
    delivery: "交付部署",
    agent: "智能体能力",
    review: "审查能力",
    general: "通用能力",
    "self-evolved": "自进化",
    external: "外部导入",
    production: "制作能力",
    learning: "学习能力",
    tools: "工具调用",
    uncategorized: "未分类",
  };
  const rawName = typeof category?.name === "string" ? category.name : "";
  const defaultEnglishNames = new Set([
    "All skills",
    "Workflow",
    "Coding",
    "Research",
    "Uncategorized",
    categoryId,
  ]);
  if (rawName.length > 0 && !defaultEnglishNames.has(rawName)) {
    return rawName;
  }
  return labels[categoryId] ?? rawName ?? categoryId;
}

function inferSkillCategoryId(skill) {
  const haystack = [
    skill.title,
    skill.description,
    skill.content,
    ...(skill.tags ?? []),
    ...(skill.toolNames ?? []),
  ]
    .join(" ")
    .toLowerCase();
  if (skill.source === "self") {
    return "self-evolved";
  }
  if (/learn|learning|experience|知识|经验|学习/u.test(haystack)) {
    return "learning";
  }
  if (/tool|cli|adapter|工具|适配/u.test(haystack)) {
    return "tools";
  }
  if (/video|image|production|director|镜头|制作|短剧|图片|视频/u.test(haystack)) {
    return "production";
  }
  return skill.source === "external" ? "external" : "uncategorized";
}

function formatSkillTags(skill) {
  const taxonomyTags = skill.taxonomyTags?.map((tag) => tag.name) ?? [];
  const tags = taxonomyTags.length > 0 ? taxonomyTags : (skill.tags ?? []);
  return formatList(tags.slice(0, 5));
}

function formatSkillTools(skill) {
  return formatList((skill.toolNames ?? []).slice(0, 4));
}

function formatSkillPermissionDetail(skill) {
  const permissions = Array.isArray(skill.permissions) ? skill.permissions : [];
  if (permissions.length === 0) {
    return skill.permissionSummary ?? "未声明工具权限";
  }
  return permissions
    .map((permission) =>
      formatList([
        permission.label ?? permission.kind,
        permission.toolName ? `tool=${permission.toolName}` : null,
        permission.riskLevel ? `risk=${formatSkillRiskLabel(permission.riskLevel)}` : null,
      ]),
    )
    .join("；");
}

function formatSkillRiskLabel(riskLevel) {
  const labels = {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
  };
  return labels[riskLevel] ?? riskLevel ?? "未知";
}

function formatSkillProposalStatusLabel(status) {
  const labels = {
    pending: "待审核",
    accepted: "已接受",
    rejected: "已拒绝",
    applied: "已应用",
    expired: "已过期",
  };
  return labels[status] ?? status ?? "未知";
}

function formatSkillProposalReviewVerdict(verdict) {
  const labels = {
    accepted: "可接受",
    rejected: "拒绝",
    operator_review: "需要人工审核",
  };
  return labels[verdict] ?? verdict ?? "未审查";
}

function formatSkillProposalReviewIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return "未发现阻断问题。";
  }
  return issues
    .map(
      (issue) =>
        `${issue.severity ?? "info"}:${issue.field ?? "proposal"} ${issue.message ?? issue.code}`,
    )
    .join("；");
}

function createSkillProposalDirectActions(proposal) {
  if (proposal.status === "pending") {
    return [
      {
        label: "接受候选",
        action: {
          type: DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
          proposalId: proposal.id,
        },
      },
      {
        label: "拒绝候选",
        tone: "danger",
        action: {
          type: DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
          proposalId: proposal.id,
        },
      },
    ];
  }
  if (proposal.status === "accepted") {
    return [
      {
        label: "应用为 Skill",
        action: {
          type: DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
          proposalId: proposal.id,
        },
      },
    ];
  }
  return [];
}

function createSkillDirectActions(skill) {
  const actions = [];
  const curatorAction = state.snapshot?.assets?.skills?.curator?.actions?.find(
    (action) => action.skillId === skill.id,
  );
  if (curatorAction) {
    actions.push(...createSkillCuratorDirectActions(curatorAction));
  }
  actions.push(
    {
      label: "删除",
      tone: "danger",
      action: {
        type: DESKTOP_ACTIONS.SKILL_DELETE,
        skillId: skill.id,
        confirm: `确定删除 Skill「${skill.title ?? skill.id}」吗？\n\n这会从本地 approved Skill 快照移除，并记录为已删除；后续制作不会再召回它。`,
      },
    },
  );
  return actions;
}

function createSkillCuratorDirectActions(action) {
  if (!action?.kind || !action?.skillId) {
    return [];
  }
  if (action.kind === "patch") {
    return [
      {
        label: "标记已修补",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.SKILL_CURATOR_MARK_PATCHED,
          skillId: action.skillId,
          note: action.reason,
        },
      },
    ];
  }
  if (action.kind === "archive") {
    return [
      {
        label: "归档 Skill",
        tone: "danger",
        action: {
          type: DESKTOP_ACTIONS.SKILL_CURATOR_ARCHIVE,
          skillId: action.skillId,
          note: action.reason,
          confirm: `确定归档 Skill「${action.title ?? action.skillId}」吗？\n\n这会从 approved Skill snapshot 移除它，并保留 curator archive evidence。`,
        },
      },
    ];
  }
  if (action.kind === "merge") {
    return [
      {
        label: "合并重复项",
        tone: "secondary",
        action: {
          type: DESKTOP_ACTIONS.SKILL_CURATOR_MERGE,
          canonicalSkillId: action.canonicalSkillId ?? action.skillId,
          duplicateSkillIds: action.duplicateSkillIds ?? [],
          note: action.reason,
          confirm: `确定把重复 Skill 合并进「${action.canonicalSkillId ?? action.skillId}」吗？\n\n重复项会从 approved snapshot 移除，正文/标签/工具会并入 canonical。`,
        },
      },
    ];
  }
  return [];
}

function createSkillCuratorPatchEditor(action) {
  const currentSkill = findSkillSnapshotForCuratorPatch(action.skillId);
  const form = document.createElement("form");
  form.className = "skill-curator-patch-editor";
  form.dataset.skillId = action.skillId;
  const title = document.createElement("h4");
  title.textContent = "Patch editor";
  const summary = document.createElement("p");
  summary.textContent =
    "bounded file scope: only this approved Skill snapshot can change; remote curator write execution remains disabled.";
  const version = createSkillCuratorPatchField(
    "version",
    "版本",
    bumpPatchVersion(currentSkill?.version ?? ""),
    "input",
  );
  const content = createSkillCuratorPatchField(
    "content",
    "Skill 正文",
    currentSkill?.content ?? "",
    "textarea",
  );
  const tags = createSkillCuratorPatchField(
    "tags",
    "标签",
    (currentSkill?.tags ?? []).join(", "),
    "input",
  );
  const toolNames = createSkillCuratorPatchField(
    "toolNames",
    "工具",
    (currentSkill?.toolNames ?? []).join(", "),
    "input",
  );
  const note = createSkillCuratorPatchField(
    "note",
    "operator note",
    action.reason ?? "desktop patch editor diff confirmation",
    "textarea",
  );
  const confirmation = document.createElement("label");
  confirmation.className = "skill-curator-diff-confirmation";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("data-skill-curator-patch-field", "diffConfirmationAccepted");
  const confirmationText = document.createElement("span");
  confirmationText.textContent =
    "我已核对 diff，只应用上方 bounded Skill patch；diff confirmation 通过后才写入。";
  confirmation.append(checkbox, confirmationText);
  const submit = document.createElement("button");
  submit.className = "primary-button compact";
  submit.type = "submit";
  submit.textContent = "应用 patch";
  form.append(
    title,
    summary,
    createSkillCuratorPatchDiffPreview(action, currentSkill),
    version,
    content,
    tags,
    toolNames,
    note,
    confirmation,
    submit,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = readSkillCuratorPatchEditorPayload(form);
    if (!payload.diffConfirmationAccepted) {
      checkbox.focus();
      return;
    }
    await executeAssetAction(
      {
        type: DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH,
        skillId: action.skillId,
        operatorScope: "skills.curator.write",
        patchEditorPayload: payload.patchEditorPayload,
        diffConfirmationAccepted: payload.diffConfirmationAccepted,
        note: payload.note || action.reason,
      },
      submit,
      "应用 patch",
    );
  });
  return form;
}

function createSkillCuratorPatchDiffPreview(action, currentSkill) {
  const block = document.createElement("div");
  block.className = "skill-curator-patch-diff-preview";
  const title = document.createElement("strong");
  title.textContent = "diff preview";
  const list = document.createElement("ul");
  for (const line of [
    `skillId: ${action.skillId}`,
    `reason: ${action.reason ?? "curator patch"}`,
    `current version: ${currentSkill?.version ?? "unknown"}`,
    `next version: ${bumpPatchVersion(currentSkill?.version ?? "")}`,
    "editable fields: version, content, tags, toolNames",
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  block.append(title, list);
  return block;
}

function createSkillCuratorPatchField(field, labelText, value, kind) {
  const label = document.createElement("label");
  label.className = "skill-curator-patch-field";
  const title = document.createElement("span");
  title.textContent = labelText;
  const input =
    kind === "textarea" ? document.createElement("textarea") : document.createElement("input");
  input.setAttribute("data-skill-curator-patch-field", field);
  input.value = String(value ?? "");
  if (kind === "textarea") {
    input.rows = field === "content" ? 6 : 3;
  } else {
    input.type = "text";
  }
  label.append(title, input);
  return label;
}

function readSkillCuratorPatchEditorPayload(form) {
  const read = (field) =>
    form.querySelector(`[data-skill-curator-patch-field="${field}"]`)?.value?.trim() ?? "";
  const patchEditorPayload = {
    version: read("version"),
    content: read("content"),
    tags: parseSkillListField(read("tags")),
    toolNames: parseSkillListField(read("toolNames")),
  };
  return {
    patchEditorPayload,
    note: read("note"),
    diffConfirmationAccepted:
      form.querySelector('[data-skill-curator-patch-field="diffConfirmationAccepted"]')
        ?.checked === true,
  };
}

function findSkillSnapshotForCuratorPatch(skillId) {
  return state.snapshot?.assets?.skills?.items?.find((skill) => skill.id === skillId) ?? null;
}

function bumpPatchVersion(version) {
  const match = String(version ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (!match) {
    return String(version ?? "").trim() || "1.0.1";
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function mapSkillCuratorPriorityStatus(action) {
  if (action.kind === "patch") {
    return "blocked";
  }
  if (action.severity === "risky") {
    return "failed";
  }
  if (action.kind === "archive" || action.kind === "merge") {
    return "warn";
  }
  return "info";
}

function formatSkillCuratorKindLabel(kind) {
  const labels = {
    patch: "建议修补",
    archive: "建议归档",
    merge: "建议合并",
    keep: "保持",
  };
  return labels[kind] ?? kind ?? "未知";
}

function formatSkillCuratorSeverityLabel(severity) {
  const labels = {
    info: "提示",
    warning: "警告",
    risky: "高风险",
  };
  return labels[severity] ?? severity ?? "未知";
}

function formatSkillCuratorEvidence(evidence = {}) {
  return formatList([
    `use=${evidence.useCount ?? 0}`,
    `failure=${evidence.failureCount ?? 0}`,
    `patch=${evidence.patchCount ?? 0}`,
    evidence.lastUsedAtMs ? `lastUse=${formatEpochDate(evidence.lastUsedAtMs)}` : null,
    evidence.lastFailedAtMs ? `lastFail=${formatEpochDate(evidence.lastFailedAtMs)}` : null,
    evidence.lastActivityAtMs ? `lastActivity=${formatEpochDate(evidence.lastActivityAtMs)}` : null,
  ]);
}

function formatSkillTrustLabel(trustStatus) {
  const labels = {
    trusted: "可信",
    untrusted: "不可信",
  };
  return labels[trustStatus] ?? trustStatus ?? "未知";
}

function formatSkillAuditStatusLabel(auditStatus) {
  const labels = {
    "self-evolved": "自进化来源",
    reviewed: "已审核",
    untrusted: "未信任",
  };
  return labels[auditStatus] ?? auditStatus ?? "未知";
}

function formatAdapterApprovalMode(approvalMode) {
  const labels = {
    auto_allow: "自动允许",
    operator_approve: "需要人工批准",
    forbidden_in_beta1: "当前禁止",
  };
  return labels[approvalMode] ?? approvalMode ?? "未知";
}

function formatAdapterActionCatalog(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return "无";
  }
  return actions
    .map((action) =>
      formatList([
        action.label ?? formatAdapterActionClass(action.actionClass),
        formatSkillRiskLabel(action.riskLevel),
        formatAdapterApprovalMode(action.approvalMode),
        formatAdapterExecutionMode(action.executionMode),
        action.sideEffect ? "有副作用" : "只读",
        action.reason,
      ]),
    )
    .join("；");
}

function formatAdapterActionContracts(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return "无";
  }
  return actions
    .map((action) =>
      formatList([
        `${action.label ?? formatAdapterActionClass(action.actionClass)} 输入=${formatList(action.inputs)}`,
        `输出=${formatList(action.outputs)}`,
        `成本=${action.costClass ?? "未知"}`,
        `重试=${formatAdapterRetryPolicy(action.retryPolicy)}`,
        `超时=${action.timeoutMs ?? "未声明"}`,
        action.auditTrailRequired ? "必须审计" : "低风险审计",
      ]),
    )
    .join("；");
}

function countAdapterActions(actions, key, value) {
  return Array.isArray(actions) ? actions.filter((action) => action?.[key] === value).length : 0;
}

function formatAdapterActionClass(actionClass) {
  const labels = {
    read: "读取",
    generate: "生成",
    write: "写入",
    publish: "发布",
  };
  return labels[actionClass] ?? actionClass ?? "未知";
}

function formatAdapterExecutionMode(executionMode) {
  const labels = {
    blocked: "阻断",
    "dry-run-required": "先 dry-run",
    "mock-only": "仅模拟",
    "operator-approved-real": "审批后真实执行",
    "read-only": "只读",
  };
  return labels[executionMode] ?? executionMode ?? "未知";
}

function formatAdapterRetryPolicy(retryPolicy) {
  const labels = {
    "auto-retry-allowed": "允许自动重试",
    "manual-on-failure": "失败后人工判断",
    "manual-review-required": "先人工审查",
    "safe-repeat": "可重复模拟",
  };
  return labels[retryPolicy] ?? retryPolicy ?? "未知";
}

function formatSkillUpdated(skill) {
  return formatEpochDate(skill.updatedAtMs);
}

function formatSkillOrigin(skill) {
  const metadata = skill.metadata ?? {};
  return formatList([
    skill.source === "self" ? "由 Angel 自进化产生" : "外部导入或手动登记",
    metadata.sourceSessionId ? `session=${metadata.sourceSessionId}` : null,
    metadata.sourceTurnId ? `turn=${metadata.sourceTurnId}` : null,
    metadata.trajectoryRef,
    metadata.candidateId ? `experience=${metadata.candidateId}` : null,
  ]);
}

function mergeSkillCategoryOptions(categories, skill) {
  const options = new Map();
  for (const item of categories ?? []) {
    const categoryId = item.categoryId ?? item.id;
    if (!categoryId || categoryId === "all") {
      continue;
    }
    options.set(categoryId, {
      categoryId,
      id: categoryId,
      name: formatSkillCategoryDisplayName(item),
    });
  }
  const currentCategoryId = resolveSkillCategoryId(skill);
  if (!options.has(currentCategoryId) && currentCategoryId !== "all") {
    options.set(currentCategoryId, {
      categoryId: currentCategoryId,
      id: currentCategoryId,
      name: resolveSkillCategoryName(skill),
    });
  }
  return [...options.values()];
}

function mergeSkillTagOptions(tags, skill) {
  const options = new Map();
  for (const tag of tags ?? []) {
    const tagId = tag.tagId ?? tag.id;
    if (!tagId) {
      continue;
    }
    options.set(tagId, { tagId, id: tagId, name: tag.name ?? tagId });
  }
  for (const tag of skill.taxonomyTags ?? []) {
    const tagId = tag.tagId ?? tag.id;
    if (!tagId || options.has(tagId)) {
      continue;
    }
    options.set(tagId, { tagId, id: tagId, name: tag.name ?? tagId });
  }
  return [...options.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function createSkillLifecycleBlock(skill) {
  const block = document.createElement("div");
  block.className = "experience-lifecycle";
  const title = document.createElement("strong");
  title.textContent = "Skill 生命周期";
  const steps = [
    ["已收录", true],
    [
      "已分类",
      Boolean(resolveSkillCategoryId(skill) && resolveSkillCategoryId(skill) !== "uncategorized"),
    ],
    ["有标签", (skill.taxonomyTags?.length ?? 0) + (skill.tags?.length ?? 0) > 0],
    ["可召回", true],
  ];
  block.append(title);
  for (const [label, active] of steps) {
    const row = document.createElement("span");
    row.className = active ? "active" : "";
    row.textContent = label;
    block.append(row);
  }
  return block;
}

function createSkillSourceSummary(skills) {
  return [
    { id: "all", name: "全部 Skill", count: skills?.total ?? skills?.items?.length ?? 0 },
    { id: "self", name: "自进化", count: skills?.selfCount ?? 0 },
    { id: "external", name: "外部", count: skills?.externalCount ?? 0 },
  ];
}

function createSkillStatusSummary(skills) {
  const items = skills?.items ?? [];
  const summary = skills?.runtimeSummary ?? {};
  return [
    { id: "all", name: "全部状态", count: items.length },
    {
      id: "ready",
      name: "可用",
      count: summary.readyCount ?? skills?.readyCount ?? countSkillsByDoctorStatus(items, "ready"),
    },
    {
      id: "needs-setup",
      name: "需配置",
      count:
        summary.needsSetupCount ??
        skills?.needsSetupCount ??
        countSkillsByDoctorStatus(items, "needs-setup"),
    },
    {
      id: "disabled",
      name: "已关闭",
      count:
        summary.disabledCount ??
        skills?.disabledRuntimeCount ??
        countSkillsByDoctorStatus(items, "disabled"),
    },
    {
      id: "model-invocation-disabled",
      name: "模型关闭",
      count:
        summary.modelInvocationDisabledCount ??
        skills?.modelInvocationDisabledCount ??
        countSkillsByDoctorStatus(items, "model-invocation-disabled"),
    },
    {
      id: "missing-skill",
      name: "已移除",
      count: summary.missingSkillCount ?? skills?.missingSkillCount ?? 0,
    },
  ];
}

function createSkillCategorySummary(items) {
  const groups = new Map();
  for (const item of items ?? []) {
    const categoryId = resolveSkillCategoryId(item);
    const current = groups.get(categoryId) ?? {
      categoryId,
      name: resolveSkillCategoryName(item),
      count: 0,
    };
    current.count += 1;
    groups.set(categoryId, current);
  }
  if (groups.size === 0) {
    return [
      { categoryId: "self-evolved", name: "自进化", count: 0 },
      { categoryId: "external", name: "外部导入", count: 0 },
      { categoryId: "production", name: "制作能力", count: 0 },
      { categoryId: "learning", name: "学习能力", count: 0 },
      { categoryId: "tools", name: "工具调用", count: 0 },
      { categoryId: "uncategorized", name: "未分类", count: 0 },
    ];
  }
  return [...groups.values()].sort((left, right) => right.count - left.count);
}

function createSkillTagSummary(items) {
  const tags = new Map();
  for (const item of items ?? []) {
    for (const name of [
      ...(item.taxonomyTags?.map((tag) => tag.name) ?? []),
      ...(item.tags ?? []),
    ]) {
      const current = tags.get(name) ?? { name, count: 0 };
      current.count += 1;
      tags.set(name, current);
    }
  }
  return [...tags.values()].sort((left, right) => right.count - left.count);
}

function countSkillsByCategory(categoryId) {
  return (state.snapshot?.assets?.skills?.items ?? []).filter(
    (skill) => resolveSkillCategoryId(skill) === categoryId,
  ).length;
}

function formatExperienceStatusLabel(status) {
  const labels = {
    harvested: "已采集",
    reviewed: "已审核",
    "publish-ready": "发布就绪",
    pending: "待审核",
    accepted: "已接受",
    promoted: "已晋升",
    published: "已发布",
    rejected: "已拒绝",
  };
  return labels[status] ?? status ?? "未知状态";
}

function resolveExperienceLifecycleStatus(candidate) {
  const stage = typeof candidate?.stage === "string" ? candidate.stage : "";
  if (["harvested", "reviewed", "publish-ready", "promoted"].includes(stage)) {
    return stage;
  }
  const status = typeof candidate?.status === "string" ? candidate.status : "";
  if (["harvested", "reviewed", "publish-ready", "promoted"].includes(status)) {
    return status;
  }
  if (status === "pending") {
    return "harvested";
  }
  if (status === "accepted") {
    return "reviewed";
  }
  if (status === "published") {
    return "promoted";
  }
  return status || "harvested";
}

function formatExperienceSourceKind(sourceKind) {
  const labels = {
    "web-page": "网页",
    "web-search": "网页主题",
    "pasted-text": "粘贴文本",
    "local-directory": "本地目录",
    "local-file": "本地文件",
    repository: "参考仓库",
  };
  return labels[sourceKind] ?? sourceKind ?? "未知来源";
}

function formatExperienceQuality(item) {
  const score = item.quality?.score ?? item.qualityScore ?? null;
  const verdict = item.quality?.verdict ?? item.qualityVerdict ?? "unknown";
  const labels = {
    usable: "可用",
    quarantine: "不收录",
    rejected: "不收录",
    unknown: "质量未知",
  };
  const label = labels[verdict] ?? verdict;
  if (typeof score !== "number") {
    return label;
  }
  return score >= 0 && score <= 1 ? `${label} ${Math.round(score * 100)}%` : `${label} ${score}`;
}

function formatExperienceDistillation(item) {
  const label = item.distillation?.label;
  if (typeof label === "string" && label.length > 0) {
    return label;
  }

  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.includes("distillation:model")) {
    return "API 模型提炼";
  }
  if (tags.includes("distillation:model-fallback")) {
    return "模型失败，规则兜底";
  }
  if (tags.includes("distillation:high")) {
    return "规则提炼 · 高置信";
  }
  if (tags.includes("distillation:medium")) {
    return "规则提炼 · 中置信";
  }
  if (tags.includes("distillation:low")) {
    return "规则提炼 · 低置信";
  }
  return "未标记提炼方式";
}

function createExperienceReviewSummary(candidate) {
  const lifecycleStatus = resolveExperienceLifecycleStatus(candidate);
  if (lifecycleStatus === "reviewed") {
    return "这条经验已通过人工审核。下一步是晋升为知识候选，之后仍要再审查发布。";
  }
  if (lifecycleStatus === "publish-ready") {
    return "这条经验已标记为发布就绪。下一步是晋升到知识候选链路，仍不会自动发布。";
  }
  if (lifecycleStatus === "promoted") {
    return "这条经验已晋升到知识候选链路。这里保留原始经验、风险和证据，方便回看。";
  }
  if (lifecycleStatus === "rejected") {
    return "这条经验已被拒绝，不会进入知识发布链路。";
  }
  return "审核这条经验是否值得让 Angel 记住：看摘要、适用场景、风险和证据，不满意就拒绝。";
}

function createExperienceReviewPrompts(candidate) {
  const lifecycleStatus = resolveExperienceLifecycleStatus(candidate);
  if (lifecycleStatus === "reviewed" || lifecycleStatus === "publish-ready") {
    return [
      {
        label: "晋升为知识候选",
        prompt: `/经验 晋升 ${candidate.id}`,
        action: {
          type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
          candidateId: candidate.id,
        },
      },
      {
        label: "生成 Skill 候选",
        prompt: `/技能 从经验 ${candidate.id}`,
        action: {
          type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
          candidateId: candidate.id,
        },
      },
    ];
  }
  if (lifecycleStatus === "promoted") {
    const actions = [];
    if (candidate.knowledgeCandidateId) {
      actions.push({
        label: "查看知识候选",
        action: createUiSelectAssetAction(
          "experience",
          `knowledge:${candidate.knowledgeCandidateId}`,
        ),
      });
    }
    actions.push(
      {
        label: "生成 Skill 候选",
        prompt: `/技能 从经验 ${candidate.id}`,
        action: {
          type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
          candidateId: candidate.id,
        },
      },
      { label: "查看知识列表", prompt: "/知识 列表" },
    );
    return actions;
  }
  if (lifecycleStatus === "harvested") {
    return [
      {
        label: "通过审核",
        prompt: `/经验 接受 ${candidate.id}`,
        action: {
          type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
          candidateId: candidate.id,
        },
      },
      {
        label: "拒绝收录",
        prompt: `/经验 拒绝 ${candidate.id}`,
        tone: "danger",
        action: {
          type: DESKTOP_ACTIONS.EXPERIENCE_REJECT,
          candidateId: candidate.id,
        },
      },
    ];
  }
  return [{ label: "查看经验列表", prompt: "/经验 列表" }];
}

function createExperienceSourceReader(item) {
  const sourceDocument = item.sourceDocument ?? {};
  const content =
    typeof sourceDocument.content === "string" && sourceDocument.content.length > 0
      ? sourceDocument.content
      : item.evidencePreview || item.textPreview || item.summary || "";
  const rawContent =
    typeof sourceDocument.rawContent === "string" && sourceDocument.rawContent.length > 0
      ? sourceDocument.rawContent
      : content;
  const sizeCopy =
    typeof sourceDocument.bytes === "number"
      ? `${sourceDocument.bytes} bytes`
      : `${content.length} 字符`;
  const fullCopy = sourceDocument.isFullContent === false ? "预览内容" : "完整内容";
  const truncatedCopy = sourceDocument.truncated ? " · 已截断" : "";
  return {
    title: "抓取完整内容",
    meta: `${fullCopy} · ${formatExperienceSourceKind(
      sourceDocument.sourceKind ?? item.sourceKind,
    )} · ${sizeCopy}${truncatedCopy}`,
    content,
    rawContent,
    structuredContent: sourceDocument.structuredContent ?? null,
    extractionReport: sourceDocument.extractionReport ?? null,
  };
}

function formatExperienceEvidenceDetail(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "无";
  }
  return items
    .map((item) =>
      formatList([item.id, item.path ?? item.sourceRef, item.span, item.preview || item.summary]),
    )
    .join(" | ");
}

function formatBoolean(value) {
  if (typeof value !== "boolean") {
    return "unknown";
  }
  return value ? "是" : "否";
}

function formatMoneyValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value} USD` : "未设置";
}

function formatSettingParameterDescription(parameter) {
  const descriptionParts = [
    parameter.description,
    resolveSettingParameterEffect(parameter),
    parameter.risk === undefined ? null : `影响：${parameter.risk}`,
    parameter.storage === undefined ? null : `保存：${parameter.storage}`,
    parameter.writable ? "可在设置页直接保存" : "只读",
  ];
  return descriptionParts.filter((part) => typeof part === "string" && part.length > 0).join(" · ");
}

function resolveSettingParameterEffect(parameter) {
  if (typeof parameter.value !== "boolean") {
    return parameter.enabledEffect ?? null;
  }
  return parameter.value ? parameter.enabledEffect : parameter.disabledEffect;
}

function resolveSettingParameterTone(parameter) {
  if (parameter.category === "paths") {
    return "good";
  }
  if (typeof parameter.value === "boolean") {
    return parameter.value ? "good" : "warn";
  }
  return parameter.writable ? "good" : "warn";
}

function formatCardKicker(group, command, index, stepState) {
  if (group?.id === "experience" && command) {
    return `步骤 ${index + 1} · ${formatStepState(stepState)}`;
  }
  return group?.label ?? command?.domain ?? "Angel";
}

function resolveCardMeta(group, command) {
  if (group?.id === "experience") {
    return "工作台 /能力";
  }
  if (command?.handler?.type === "desktopAction") {
    return "本地原生能力";
  }
  if (command?.handler?.type === "cliCommand") {
    return "本地 CLI 能力";
  }
  return "资产视图";
}

function findWorkflowForCommand(commandId) {
  return WORKFLOWS.find((workflow) => workflow.commandIds.includes(commandId)) ?? null;
}

function findCommand(commandId) {
  return flattenCommands().find((command) => command.id === commandId);
}

function flattenCommands() {
  return state.catalog.flatMap((group) => group.commands);
}

function resolveRecommendedCommandId() {
  if (state.selectedGroupId !== "experience" || !state.snapshot) {
    return null;
  }
  const snapshot = state.snapshot;
  const candidateLifecycleStatus = resolveExperienceLifecycleStatus(snapshot.candidate);
  if ((snapshot.knowledge.publishedCount ?? 0) > 0) {
    return "knowledge.recallPreview";
  }
  if (snapshot.knowledge.candidateStatus === "accepted") {
    return "knowledge.publish";
  }
  if (snapshot.knowledge.candidateStatus === "pending") {
    return "knowledge.accept";
  }
  if (candidateLifecycleStatus === "reviewed" || candidateLifecycleStatus === "publish-ready") {
    return "experience.promote";
  }
  if (candidateLifecycleStatus === "harvested") {
    return "experience.accept";
  }
  return "learning.directory";
}

function resolveStepState(commandId) {
  if (!state.snapshot || state.selectedGroupId !== "experience") {
    return commandId === state.selectedCommandId ? "active" : "";
  }
  const snapshot = state.snapshot;
  const hasExperience = (snapshot.candidate.count ?? 0) > 0;
  const hasKnowledgeCandidate = (snapshot.knowledge.candidateCount ?? 0) > 0;
  const hasPublished = (snapshot.knowledge.publishedCount ?? 0) > 0;
  const candidateStatus = resolveExperienceLifecycleStatus(snapshot.candidate);
  const knowledgeStatus = snapshot.knowledge.candidateStatus;

  if (
    ["learning.directory", "learning.query", "learning.url", "learning.text"].includes(commandId)
  ) {
    return hasExperience ? "done" : commandId === state.selectedCommandId ? "active" : "";
  }
  if (commandId === "experience.accept") {
    if (["reviewed", "publish-ready", "promoted"].includes(candidateStatus) || hasKnowledgeCandidate) {
      return "done";
    }
    return candidateStatus === "harvested" || commandId === state.selectedCommandId ? "active" : "";
  }
  if (commandId === "experience.promote") {
    if (hasKnowledgeCandidate || hasPublished) {
      return "done";
    }
    return ["reviewed", "publish-ready"].includes(candidateStatus) || commandId === state.selectedCommandId ? "active" : "";
  }
  if (commandId === "knowledge.accept") {
    if (knowledgeStatus === "accepted" || hasPublished) {
      return "done";
    }
    return knowledgeStatus === "pending" || commandId === state.selectedCommandId ? "active" : "";
  }
  if (commandId === "knowledge.publish") {
    if (hasPublished) {
      return "done";
    }
    return knowledgeStatus === "accepted" || commandId === state.selectedCommandId ? "active" : "";
  }
  if (commandId === "knowledge.recallPreview") {
    return hasPublished || commandId === state.selectedCommandId ? "active" : "";
  }
  return commandId === state.selectedCommandId ? "active" : "";
}

function formatStepState(stepState) {
  if (stepState === "done") {
    return "已完成";
  }
  if (stepState === "active") {
    return "当前";
  }
  return "待处理";
}

function resolveLearningStepCopy(commandId) {
  if (commandId === "settings.set") {
    return "修改设置请在工作台输入 /设置 参数 开启/关闭，例如 /设置 feature:learning.enabled 开启。";
  }
  if (commandId === "workspace.switches") {
    return "查看设置请在工作台输入 /设置；修改具体参数用 /设置 参数 开启/关闭。";
  }
  if (commandId === "control.memoryInspect") {
    return "查看会话记忆请在工作台输入 /记忆 查看 <sessionId>。";
  }
  if (commandId === "control.memoryClear") {
    return "清理会话记忆请在工作台输入 /记忆 清理 <sessionId>。";
  }
  if (
    ["learning.directory", "learning.query", "learning.url", "learning.text"].includes(commandId)
  ) {
    return "输入 /学习 后接目录、文件、URL、长文本或学习主题。";
  }
  if (commandId === "experience.accept") {
    return "确认经验候选可用时，在工作台输入 /经验 接受。";
  }
  if (commandId === "experience.promote") {
    return "经验被接受后，在工作台输入 /经验 晋升。";
  }
  if (commandId === "knowledge.accept") {
    return "确认知识候选可用时，在工作台输入 /知识 接受。";
  }
  if (commandId === "knowledge.publish") {
    return "知识候选被接受后，在工作台输入 /知识 发布。";
  }
  if (commandId === "knowledge.recallPreview") {
    return "发布后在工作台输入 /知识 召回，检查 Angel 是否能取回经验。";
  }
  return "直接在底部输入框用 /能力 调用真实功能。";
}

function resolveSurfaceComposerCopy(surfaceId) {
  if (surfaceId === "workbench") {
    return "输入制作目标、问题、链接、文件或目录；也可以用 /制作、/学习、/工具、/设置 精确调用。";
  }
  return "这里只查看资产、分类和状态；执行请回到工作台底部输入 /能力。";
}

function updateComposerPlaceholder() {
  if (!elements.angelInput) {
    return;
  }
  elements.angelInput.placeholder =
    "用 / 调用能力，例如 /制作 短剧目标、/学习 链接、/灵魂、/心跳、/图片、/视频、/设置";
}

function setRunning(running) {
  state.running = running;
  if (running) {
    state.quickActionsOpen = false;
    renderQuickActions();
  }
  setButtonDisabled(elements.runCommand, false);
  setButtonDisabled(elements.runImage, running);
  setButtonDisabled(elements.runVideo, running);
  setButtonDisabled(elements.pickDirectory, running);
  setButtonDisabled(
    elements.liveAudioToggle,
    state.liveAudio.busy || (running && state.liveAudio.active !== true),
  );
  if (elements.runCommand) {
    elements.runCommand.textContent = running ? "停止" : "发送";
    elements.runCommand.dataset.mode = running ? "stop" : "send";
    elements.runCommand.classList.toggle("stop-button", running);
    elements.runCommand.setAttribute("aria-label", running ? "停止当前请求" : "发送");
  }
  scheduleRunCenterRender({ force: true });
}

function setControlsDisabled(disabled) {
  setButtonDisabled(elements.runCommand, disabled);
  setButtonDisabled(elements.runImage, disabled);
  setButtonDisabled(elements.runVideo, disabled);
  setButtonDisabled(elements.pickDirectory, disabled);
  setButtonDisabled(elements.liveAudioToggle, disabled);
  setButtonDisabled(elements.refreshSnapshot, disabled);
  setButtonDisabled(elements.refreshCatalog, disabled);
}

function setButtonDisabled(button, disabled) {
  if (button) {
    button.disabled = disabled;
  }
}

function setHealth(label, tone = "good") {
  if (!elements.healthPill) {
    return;
  }
  elements.healthPill.textContent = label;
  elements.healthPill.className = `status-pill ${tone}`;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setInputValue(value, options = {}) {
  if (elements.angelInput) {
    elements.angelInput.value = value;
  }
  state.chat.composer.setInput(value);
  renderComposerAttachments();
  if (options.persist !== false) {
    persistDesktopUiState();
  }
}

function setResultOutput(value) {
  if (elements.resultOutput) {
    elements.resultOutput.textContent = value;
  }
}

function attachTimelineRunTranscript(handle, controller, options = {}) {
  if (!handle?.bubble || !controller) {
    return null;
  }
  handle.article.classList.add("run-transcript-message");
  controller.startedAtMs ??= Date.now();
  const transcript = document.createElement("section");
  transcript.className = "run-transcript";
  transcript.setAttribute("aria-label", "运行过程");

  const header = document.createElement("div");
  header.className = "run-transcript-header";
  const elapsed = document.createElement("span");
  elapsed.className = "run-transcript-elapsed";
  elapsed.textContent = formatRunTranscriptElapsed(controller.startedAtMs);
  const title = document.createElement("span");
  title.className = "run-transcript-label";
  title.textContent = "运行过程";
  header.append(elapsed, title);

  const list = document.createElement("div");
  list.className = "run-transcript-list";
  transcript.append(header, list);
  handle.bubble.insertBefore(transcript, handle.body);
  handle.runTranscript = {
    element: transcript,
    list,
    elapsed,
    seenKeys: new Set(),
    startedAtMs: controller.startedAtMs,
    timerId: window.setInterval(() => {
      updateTimelineRunTranscriptElapsed(handle);
    }, 1000),
  };
  handle.article.__runTranscript = handle.runTranscript;
  updateTimelineRunTranscriptElapsed(handle);
  appendTimelineRunTranscriptStep(handle, {
    key: `turn-start:${controller.turnId}`,
    label: options.initialLabel ?? "正在处理请求",
    state: "active",
  });
  return handle.runTranscript;
}

function updateTimelineRunTranscriptElapsed(handle, endedAtMs) {
  if (!handle?.runTranscript?.elapsed) {
    return;
  }
  handle.runTranscript.elapsed.textContent = formatRunTranscriptElapsed(
    handle.runTranscript.startedAtMs,
    endedAtMs,
  );
}

function appendTimelineRunTranscriptPromptSteps(handle, input) {
  const text = String(input ?? "").trim();
  if (!handle?.runTranscript || text.length === 0) {
    return;
  }
  if (/^\s*\//u.test(text)) {
    appendTimelineRunTranscriptStep(handle, {
      key: "prompt-command",
      kind: "command",
      state: "active",
      label: `准备执行命令 ${text.split(/\s+/u)[0]}`,
    });
  }
}

function appendTimelineRunTranscriptFromNativeBridgeEvent(event) {
  const handle = state.activeStreamHandle;
  if (!handle?.runTranscript || !shouldAppendNativeBridgeStreamEvent(event)) {
    return;
  }
  const step =
    event?.type === "external-tool.timeline"
      ? formatExternalToolTranscriptStep(event)
      : event?.type === "conversation.model.delta"
        ? {
            key: "model-stream-start",
            kind: "command",
            state: "active",
            label: "正在生成回复",
          }
        : null;
  appendTimelineRunTranscriptStep(handle, step);
}

async function renderTimelineRunTranscriptFromResult(result, options = {}) {
  const handle = options.timelineHandle;
  if (!handle?.runTranscript) {
    return;
  }
  stopTimelineRunTranscriptTimer(handle);
  const steps = [
    ...extractRuntimeEventTranscriptSteps(selectConversationRuntimeEventsForDisplay(result)),
    ...extractOperatorTraceTranscriptSteps(result.operatorTrace),
  ];
  for (const step of steps) {
    appendTimelineRunTranscriptStep(handle, step);
    await sleep(35);
  }
  appendTimelineRunTranscriptStep(handle, {
    key: "turn-final",
    label: "已整理最终回复",
    state: "done",
  });
  updateTimelineRunTranscriptElapsed(handle, Date.now());
}

function stopTimelineRunTranscriptTimer(handle) {
  const runTranscript = handle?.runTranscript ?? handle?.__runTranscript ?? null;
  if (!runTranscript) {
    return;
  }
  updateTimelineRunTranscriptElapsed({ runTranscript }, Date.now());
  const timerId = runTranscript.timerId;
  if (timerId !== undefined && timerId !== null) {
    window.clearInterval(timerId);
    runTranscript.timerId = null;
  }
  if (handle?.__runTranscript) {
    handle.__runTranscript = null;
  }
}

function markTimelineMessageAsStale(handleOrArticle, titleText = "等待已结束") {
  const article = handleOrArticle?.article ?? handleOrArticle;
  const body = handleOrArticle?.body ?? article?.querySelector(".message-body");
  const title = handleOrArticle?.title ?? article?.querySelector(".message-title");
  if (!article || !body || !title) {
    return;
  }
  stopTimelineRunTranscriptTimer(handleOrArticle);
  article.classList.remove("streaming");
  article.classList.add("stale");
  body.classList.remove("streaming-text");
  title.textContent = titleText;
  article.querySelector(".thinking-indicator")?.remove();
}

function appendTimelineRunTranscriptStep(handle, step) {
  if (!handle?.runTranscript || !step?.label) {
    return;
  }
  const key = step.key ?? step.label;
  if (handle.runTranscript.seenKeys.has(key)) {
    return;
  }
  handle.runTranscript.seenKeys.add(key);
  const row = document.createElement("div");
  row.className = "run-transcript-step";
  row.dataset.state = step.state ?? "done";
  const icon = document.createElement("span");
  icon.className = "run-transcript-icon";
  icon.textContent = step.icon ?? mapRunTranscriptIcon(step.kind, step.state);
  const label = document.createElement("span");
  label.className = "run-transcript-step-label";
  label.textContent = step.label;
  row.append(icon, label);
  handle.runTranscript.list.append(row);
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
}

function extractRuntimeEventTranscriptSteps(events) {
  if (!Array.isArray(events)) {
    return [];
  }
  return events
    .map((event, index) => formatRuntimeEventTranscriptStep(event, index))
    .filter(Boolean);
}

function selectConversationRuntimeEventsForDisplay(result) {
  if (Array.isArray(result?.runtimeEventsV1) && result.runtimeEventsV1.length > 0) {
    return result.runtimeEventsV1;
  }
  if (
    Array.isArray(result?.conversationRuntime?.runtimeEventsV1) &&
    result.conversationRuntime.runtimeEventsV1.length > 0
  ) {
    return result.conversationRuntime.runtimeEventsV1;
  }
  if (Array.isArray(result?.runtimeEvents)) {
    return result.runtimeEvents;
  }
  return [];
}

function extractOperatorTraceTranscriptSteps(trace) {
  if (!Array.isArray(trace)) {
    return [];
  }
  return trace
    .map((item, index) => formatOperatorTraceTranscriptStep(item, index))
    .filter(Boolean);
}

function formatRuntimeEventTranscriptStep(event, index = 0) {
  if (!event?.kind) {
    return null;
  }
  if (event.schemaVersion === "conversation-runtime.event.v1") {
    return formatUnifiedRuntimeEventTranscriptStep(event, index);
  }
  if (event.kind === "runtime.tool") {
    const tool = event.payload?.tool ?? {};
    const phase = tool.phase ?? "requested";
    return {
      key: `runtime-tool:${tool.id ?? index}:${phase}`,
      kind: "tool",
      state: phase === "requested" ? "active" : phase === "failed" ? "failed" : "done",
      label: formatRuntimeToolTranscriptLabel(tool),
    };
  }
  if (event.kind === "runtime.artifact") {
    const artifact = event.payload?.artifact ?? {};
    return {
      key: `runtime-artifact:${artifact.id ?? index}`,
      kind: "artifact",
      state: "done",
      label: `已生成 ${artifact.title ?? artifact.kind ?? "结果产物"}`,
    };
  }
  if (event.kind === "runtime.approval") {
    const approval = event.payload?.approval ?? {};
    return {
      key: `runtime-approval:${approval.id ?? index}:${approval.status ?? "pending"}`,
      kind: "approval",
      state: approval.status === "pending" ? "active" : "done",
      label: approval.summary ?? approval.title ?? "等待人工确认",
    };
  }
  if (event.kind === "runtime.error") {
    return {
      key: `runtime-error:${event.id ?? index}`,
      kind: "error",
      state: "failed",
      label: event.payload?.message ?? "执行失败",
    };
  }
  return null;
}

function formatUnifiedRuntimeEventTranscriptStep(event, index = 0) {
  if (event.kind === "turn.started") {
    return {
      key: `runtime-v1:${event.eventId ?? index}`,
      kind: "command",
      state: "active",
      label: "正在发送请求",
    };
  }
  if (event.kind === "intent.classified") {
    return {
      key: `runtime-v1:${event.eventId ?? index}`,
      kind: "command",
      state: "done",
      label: formatUnifiedRuntimeIntentLabel(event.payload ?? {}),
    };
  }
  if (event.kind === "tool.started" || event.kind === "tool.completed" || event.kind === "tool.failed") {
    return {
      key: `runtime-v1:${event.eventId ?? index}`,
      kind: "tool",
      state: event.kind === "tool.started" ? "active" : event.kind === "tool.failed" ? "failed" : "done",
      label: formatUnifiedRuntimeToolLabel(event),
    };
  }
  if (event.kind === "evidence.read") {
    return {
      key: `runtime-v1:${event.eventId ?? index}`,
      kind: "read",
      state: "done",
      label: formatUnifiedRuntimeEvidenceLabel(event.payload ?? {}),
    };
  }
  if (event.kind === "candidate.created" || event.kind === "candidate.promoted") {
    return {
      key: `runtime-v1:${event.eventId ?? index}`,
      kind: "artifact",
      state: "done",
      label: event.kind === "candidate.created" ? "已生成学习候选" : "已晋升知识",
    };
  }
  if (event.kind === "model.final") {
    return {
      key: `runtime-v1:${event.eventId ?? index}`,
      kind: "model",
      state: "done",
      label: "已整理最终回复",
    };
  }
  if (event.kind === "turn.failed") {
    return {
      key: `runtime-v1:${event.eventId ?? index}`,
      kind: "error",
      state: "failed",
      label: event.payload?.message ?? "执行失败",
    };
  }
  return null;
}

function formatUnifiedRuntimeIntentLabel(payload) {
  const intentKind = payload.intentKind ?? "unknown";
  if (intentKind === "learning-admit") {
    return "运行时意图：学习资料";
  }
  if (intentKind === "learning-confirmation") {
    return "运行时意图：学习确认";
  }
  if (intentKind === "chat") {
    return "运行时意图：普通对话";
  }
  return `运行时意图：${intentKind}`;
}

function formatUnifiedRuntimeToolLabel(event) {
  const payload = event.payload ?? {};
  const name = payload.toolName ?? "受控工具";
  const readable = formatRuntimeToolName(name);
  if (event.kind === "tool.started") {
    return `正在执行 ${readable}`;
  }
  if (event.kind === "tool.failed") {
    return `${readable} 执行失败`;
  }
  if (String(name).includes("web_extract") || String(name).includes("browser") || String(name).includes("x_")) {
    return `已读取 ${readable}`;
  }
  return `已执行 ${readable}`;
}

function formatUnifiedRuntimeEvidenceLabel(payload) {
  const sourceUrl = readNonEmptyTimelineText(payload.sourceUrl);
  if (sourceUrl) {
    return `已读取 ${sourceUrl}`;
  }
  return "已读取证据来源";
}

function formatRuntimeToolTranscriptLabel(tool) {
  const name = tool.name ?? "受控工具";
  const readable = formatRuntimeToolName(name);
  if (tool.phase === "requested") {
    return `正在执行 ${readable}`;
  }
  if (tool.phase === "failed") {
    return `${readable} 执行失败`;
  }
  if (name.includes("web_extract") || name.includes("browser") || name.includes("x_")) {
    return `已读取 ${readable}`;
  }
  return `已执行 ${readable}`;
}

function formatOperatorTraceTranscriptStep(item, index = 0) {
  const stage = String(item?.stage ?? "");
  if (!stage) {
    return null;
  }
  if (stage === "model.loop.completed") {
    const count = item?.metadata?.eventCount;
    return {
      key: `trace:${stage}:${index}`,
      kind: "model",
      state: "done",
      label: `模型/工具循环完成${count ? `，事件 ${count} 个` : ""}`,
    };
  }
  if (stage.startsWith("channel.")) {
    return {
      key: `trace:${stage}:${item?.detail ?? index}`,
      kind: "command",
      state: "done",
      label: `通道执行 ${item?.detail ?? stage}`,
    };
  }
  if (stage.includes("recall")) {
    return {
      key: `trace:${stage}:${index}`,
      kind: "search",
      state: "done",
      label: `已召回上下文 ${formatOperatorTraceMetadataValue(item?.metadata?.status)}`,
    };
  }
  return null;
}

function formatExternalToolTranscriptStep(event) {
  const execution = event?.externalToolExecution ?? {};
  const entry = event?.externalToolTimelineEntry ?? {};
  const status = entry.status ?? execution.status ?? "";
  const toolName = formatRuntimeToolName(execution.toolId ?? entry.toolId ?? "外部工具");
  const detail = String(entry.detail ?? execution.summary ?? "").trim();
  return {
    key: `external-tool:${execution.id ?? toolName}:${status}:${detail}`,
    kind: "tool",
    state: status === "failed" ? "failed" : status === "completed" ? "done" : "active",
    label: formatExternalToolTranscriptLabel(toolName, status, detail),
  };
}

function formatExternalToolTranscriptLabel(toolName, status, detail) {
  if (status === "completed") {
    return detail || `已完成 ${toolName}`;
  }
  if (status === "failed") {
    return detail || `${toolName} 执行失败`;
  }
  if (/read|extract|browser|search|读取|搜索/iu.test(`${toolName} ${detail}`)) {
    return detail || `正在读取 ${toolName}`;
  }
  return detail || `正在执行 ${toolName}`;
}

function formatRuntimeToolName(name) {
  const labels = {
    browser_navigate: "打开网页",
    browser_snapshot: "读取页面",
    "director.opencli.invoke": "OpenCLI",
    "director.experience.candidates.list": "经验候选列表",
    web_extract: "网页正文提取",
    web_extract_artifact_read: "读取网页正文",
    web_search: "网页搜索",
    x_search: "X 搜索",
  };
  return labels[name] ?? name ?? "受控工具";
}

function mapRunTranscriptIcon(kind, state) {
  if (state === "failed") return "!";
  if (state === "active") return "○";
  if (kind === "search") return "⌕";
  if (kind === "artifact") return "□";
  if (kind === "command") return "›";
  return "✓";
}

function formatRunTranscriptElapsed(startedAtMs, endedAtMs = Date.now()) {
  const elapsedMs = Math.max(0, Number(endedAtMs) - Number(startedAtMs || endedAtMs));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `已处理 ${minutes}m ${seconds}s` : `已处理 ${seconds}s`;
}

function setSettingsFeedback(value) {
  const feedback = document.querySelector(".settings-page [data-settings-feedback]");
  if (feedback) {
    feedback.textContent = value;
  }
}

function appendTimelineMessage(message, options = {}) {
  if (!elements.timeline) {
    return null;
  }
  const article = document.createElement("article");
  article.className = `message ${mapEventRoleClass(message.role)}`;
  if (options.streaming === true) {
    article.classList.add("streaming");
    article.dataset.streamingStartedAtMs = String(Date.now());
  }

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = mapEventRoleAvatar(message.role);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const title = document.createElement("p");
  title.className = "message-title";
  title.textContent = message.title ?? "Director Angel";
  const body = document.createElement("p");
  body.className = "message-body";
  setTimelineMessageBodyText(body, options.emptyBody === true ? "" : (message.body ?? ""));
  if (options.streaming === true) {
    bubble.append(title, body, createThinkingIndicator());
  } else {
    bubble.append(title, body);
    const evidence = createEvidenceDisclosureDetails(message.evidenceDisclosure, {
      onAuthorizeMedia: executeMediaAuthorization,
    });
    if (evidence) {
      bubble.append(evidence);
    }
  }
  article.append(avatar, bubble);
  elements.timeline.append(article);
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  const handle = { article, body, bubble, title };
  handle.__timelineMessage = createPersistableTimelineMessage(message);
  persistTimelineHandleToActiveSession(handle, options);
  return handle;
}

function updateTimelineMessage(handle, message) {
  if (!handle) {
    return null;
  }
  stopTimelineRunTranscriptTimer(handle);
  handle.article.className = `message ${mapEventRoleClass(message.role)}`;
  handle.article.classList.remove("streaming");
  delete handle.article.dataset.streamTextStarted;
  handle.title.textContent = message.title ?? "Director Angel";
  setTimelineMessageBodyText(handle.body, message.body ?? "");
  delete handle.body.dataset.modelDeltaStarted;
  handle.body.classList.remove("streaming-text");
  handle.bubble.querySelector(".thinking-indicator")?.remove();
  handle.bubble.querySelector(".timeline-actions")?.remove();
  handle.bubble.querySelector(".result-evidence-disclosure")?.remove();
  const evidence = createEvidenceDisclosureDetails(message.evidenceDisclosure, {
    onAuthorizeMedia: executeMediaAuthorization,
  });
  if (evidence) {
    handle.bubble.append(evidence);
  }
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  handle.__timelineMessage = createPersistableTimelineMessage(message);
  persistTimelineHandleToActiveSession(handle);
  return handle;
}

function persistTimelineHandleToActiveSession(handle, options = {}) {
  if (options.persistToSession === false || !handle?.article) {
    return;
  }
  persistCurrentDesktopSessionTranscript();
}

function persistCurrentDesktopSessionTranscript() {
  if (!elements.timeline || !state.chat?.sessionKey) {
    return;
  }
  const messages = readPersistableTimelineMessagesFromDom();
  if (messages.length === 0) {
    return;
  }
  const transcripts = ensureDesktopSessionTranscripts();
  transcripts[state.chat.sessionKey] = messages.slice(-DESKTOP_SESSION_TRANSCRIPT_LIMIT);
  persistDesktopUiState();
}

function readPersistableTimelineMessagesFromDom() {
  const articles = [...elements.timeline.querySelectorAll(".message")];
  return articles.map(readPersistableTimelineMessageFromArticle).filter(Boolean);
}

function readPersistableTimelineMessageFromArticle(article) {
  const role = readTimelineArticleRole(article);
  if (role === null || role === DESKTOP_EVENT_ROLES.SYSTEM) {
    return null;
  }
  const title = article.querySelector(".message-title")?.textContent?.trim() ?? "";
  const body = article.querySelector(".message-body")?.textContent ?? "";
  return createPersistableTimelineMessage({ role, title, body });
}

function readTimelineArticleRole(article) {
  if (article.classList.contains("user")) {
    return DESKTOP_EVENT_ROLES.USER;
  }
  if (article.classList.contains("angel")) {
    return DESKTOP_EVENT_ROLES.ANGEL;
  }
  return DESKTOP_EVENT_ROLES.SYSTEM;
}

function createPersistableTimelineMessage(message) {
  const role = message?.role ?? DESKTOP_EVENT_ROLES.SYSTEM;
  const title = String(message?.title ?? "").slice(0, 160);
  const body = String(message?.body ?? "").slice(0, DESKTOP_SESSION_TRANSCRIPT_BODY_LIMIT);
  return { role, title, body };
}

async function completeTimelineMessageStreaming(handle, message) {
  if (!handle) {
    return null;
  }
  const hasLiveModelStream = handle.article.dataset.streamTextStarted === "1";
  stopTimelineRunTranscriptTimer(handle);
  handle.article.className = `message ${mapEventRoleClass(message.role)}`;
  handle.article.classList.add("streaming");
  handle.title.textContent = message.title ?? "Director Angel";
  if (hasLiveModelStream) {
    setTimelineMessageBodyText(handle.body, message.body ?? "");
  } else {
    handle.body.textContent = "";
    handle.body.classList.add("message-body", "streaming-text");
  }
  handle.bubble.querySelector(".thinking-indicator")?.remove();
  handle.bubble.querySelector(".timeline-actions")?.remove();
  handle.bubble.querySelector(".result-evidence-disclosure")?.remove();
  if (!hasLiveModelStream) {
    appendNonStreamingModelReplyTranscriptStep(handle);
    await streamTimelineMessageBody(handle, message.body ?? "");
  }
  delete handle.article.dataset.streamTextStarted;
  delete handle.body.dataset.modelDeltaStarted;
  handle.body.classList.remove("streaming-text");
  handle.article.classList.remove("streaming");
  const evidence = createEvidenceDisclosureDetails(message.evidenceDisclosure, {
    onAuthorizeMedia: executeMediaAuthorization,
  });
  if (evidence) {
    handle.bubble.append(evidence);
  }
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  handle.__timelineMessage = createPersistableTimelineMessage(message);
  persistTimelineHandleToActiveSession(handle);
  return handle;
}

function appendNonStreamingModelReplyTranscriptStep(handle) {
  appendTimelineRunTranscriptStep(handle, {
    key: "model-non-streaming-final",
    kind: "model",
    state: "done",
    label: "模型一次性回包，已显示最终回复",
  });
}

async function streamTimelineMessageBody(handle, value) {
  const chunks = createTimelineTextChunks(value);
  let text = "";
  for (const chunk of chunks) {
    text += chunk;
    setTimelineMessageBodyText(handle.body, text);
    handle.body.classList.add("streaming-text");
    elements.timeline.scrollTop = elements.timeline.scrollHeight;
    await sleep(resolveTimelineStreamDelay(chunk));
  }
}

function appendTimelineMessageChunk(handle, message) {
  if (!handle) {
    return;
  }
  handle.article.className = `message ${mapEventRoleClass(message.role)}`;
  handle.article.classList.add("streaming");
  handle.title.textContent = message.title ?? "Angel 正在执行";
  handle.body.classList.add("streaming-text");
  handle.bubble.querySelector(".thinking-indicator")?.remove();
  const previous = handle.body.textContent.trimEnd();
  const chunk = String(message.body ?? "");
  setTimelineMessageBodyText(
    handle.body,
    previous.length === 0 ? chunk : `${previous}\n${chunk}`,
  );
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  persistTimelineHandleToActiveSession(handle);
}

function appendTimelineMessageTextDelta(handle, message) {
  if (!handle) {
    return;
  }
  const chunk = String(message.body ?? "");
  if (chunk.length === 0) {
    return;
  }
  handle.article.className = `message ${mapEventRoleClass(message.role)}`;
  handle.article.classList.add("streaming");
  handle.article.dataset.streamTextStarted = "1";
  handle.title.textContent = message.title ?? "Angel 正在处理";
  handle.body.classList.add("streaming-text");
  handle.bubble.querySelector(".thinking-indicator")?.remove();
  const previous =
    handle.body.dataset.modelDeltaStarted === "1" ? handle.body.textContent : "";
  handle.body.dataset.modelDeltaStarted = "1";
  const text = `${previous}${chunk}`;
  const frame = createTimelineStreamingMarkdownFrame(
    text,
    (handle.__streamingMarkdownFrame ??= {}),
  );
  handle.body.dataset.stableMarkdownPrefixLength = String(frame.stablePrefix.length);
  handle.body.dataset.unstableMarkdownSuffixLength = String(frame.unstableSuffix.length);
  renderTimelineStreamingMarkdownFrame(handle.body, frame);
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  persistTimelineHandleToActiveSession(handle);
}



function removeTimelineMessage(handle) {
  handle?.article?.remove();
}



async function appendStreamingTimelineMessage(message) {
  const handle = appendTimelineMessage(message, {
    emptyBody: true,
    streaming: true,
  });
  if (!handle) {
    return;
  }
  handle.body.classList.add("streaming-text");
  handle.bubble.querySelector(".thinking-indicator")?.remove();
  await streamTimelineMessageBody(handle, message.body ?? "");
  handle.body.classList.remove("streaming-text");
  handle.article.classList.remove("streaming");
}





function waitForTimelineStep() {
  return sleep(120);
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function replaceChildren(container, items, renderItem) {
  if (!container) {
    return;
  }
  container.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无内容";
    container.append(empty);
    return;
  }
  for (const [index, item] of items.entries()) {
    container.append(renderItem(item, index));
  }
}

function createRowContent(titleText, metaText, summaryText) {
  const content = document.createElement("div");
  const title = document.createElement("p");
  title.textContent = titleText;
  const meta = document.createElement("small");
  meta.textContent = metaText;
  const summary = document.createElement("small");
  summary.className = "row-summary";
  summary.textContent = summaryText;
  content.append(title, meta, summary);
  return content;
}

function createDetailField(labelText, valueText) {
  const field = document.createElement("div");
  field.className = "arg-field";
  const label = document.createElement("span");
  label.textContent = labelText;
  const value = document.createElement("small");
  value.textContent = String(valueText ?? "");
  field.append(label, value);
  return field;
}

function createStatusPill(label, tone) {
  const pill = document.createElement("span");
  pill.className = `status-pill ${tone}`;
  pill.textContent = label ?? "none";
  return pill;
}

function createTagStrip(tags) {
  const strip = document.createElement("div");
  strip.className = "tag-strip";
  for (const tag of tags.slice(0, 3)) {
    const item = document.createElement("span");
    item.textContent = tag;
    strip.append(item);
  }
  return strip;
}

function selectInspectorPanel(panelName) {
  const resolvedPanelName = resolveInspectorPanelName(panelName);
  for (const tab of elements.inspectorTabs) {
    tab.classList.toggle("active", tab.dataset.panel === resolvedPanelName);
  }
  for (const panel of elements.inspectorPanels) {
    panel.classList.toggle("active", panel.dataset.panel === resolvedPanelName);
  }
  persistDesktopUiState();
}

function resolveInspectorPanelName(panelName) {
  return elements.inspectorPanels.some((panel) => panel.dataset.panel === panelName)
    ? panelName
    : "state";
}

function mapHealthTone(stateName) {
  return stateName === DESKTOP_HEALTH_STATES.OK ? "good" : "warn";
}

function mapCandidateTone(status) {
  return ["accepted", "promoted", "published", "ready", "hit"].includes(status) ? "good" : "warn";
}

function mapEventRoleClass(role) {
  switch (role) {
    case DESKTOP_EVENT_ROLES.USER:
      return "user";
    case DESKTOP_EVENT_ROLES.ANGEL:
      return "angel";
    default:
      return "system";
  }
}

function mapEventRoleAvatar(role) {
  switch (role) {
    case DESKTOP_EVENT_ROLES.USER:
      return "U";
    case DESKTOP_EVENT_ROLES.ANGEL:
      return "A";
    default:
      return "S";
  }
}
