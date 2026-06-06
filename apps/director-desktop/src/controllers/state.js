import { createDesktopChatState } from "../ui/chat.js";

export function createDesktopAppState() {
  return {
    catalog: [],
    selectedGroupId: null,
    selectedCommandId: null,
    selectedAsset: null,
    renderedSurfaceKey: null,
    pendingScrollReset: false,
    selectedSettingsTab: "api",
    selectedApiProviderId: null,
    selectedMcpServerName: null,
    snapshot: null,
    running: false,
    activeComposerTurn: null,
    composerTurnSequence: 0,
    taskRuntime: createTaskRuntimeState(),
    directorConsole: createDirectorConsoleState(),
    composerStopClickArmedUntilMs: 0,
    lastComposerTurnFinishedAtMs: 0,
    lastComposerStopRequestAtMs: 0,
    quickActionsOpen: false,
    activeStreamHandle: null,
    bridgeEventUnsubscribe: null,
    staleTimelineMonitorTimerId: null,
    rendererBridgeTraceSequence: 0,
    uiStateHydrated: false,
    uiStatePersistTimerId: null,
    uiStatePersisting: false,
    uiStatePersistAgain: false,
    heartbeatTimerId: null,
    heartbeatRunning: false,
    heartbeatIntervalMs: 60000,
    lastSelfReflectionDate: null,
    backgroundLearningEvents: [],
    weixinLoginPollTimerId: null,
    weixinLoginPollSessionKey: null,
    liveAudio: createLiveAudioState(),
    chat: createDesktopChatState(),
  };
}

function createDirectorConsoleState() {
  return {
    projection: null,
  };
}

function createTaskRuntimeState() {
  return {
    tasks: [],
    optimisticTasks: new Map(),
    completedComposerTurns: new Set(),
    activeComposerTask: null,
    activePanel: "active",
    lastUpdatedAt: 0,
    refreshTimerId: null,
    refreshPromise: null,
    refreshLastStartedAt: 0,
    refreshLastCompletedAt: 0,
    renderScheduler: null,
    toastState: null,
  };
}

function createLiveAudioState() {
  return {
    active: false,
    status: "idle",
    reason: "语音未运行",
    busy: false,
    lastUpdatedAt: 0,
  };
}
