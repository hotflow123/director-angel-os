import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { listDirectorDesktopCommandCatalog } from "./desktop-command-catalog.js";
import { DESKTOP_ACTIONS, DESKTOP_PANELS } from "./desktop-contract.js";

describe("desktop app surface structure", () => {
  it("enforces a single Electron desktop instance before starting bridge services", async () => {
    const mainSource = await readElectronMainSource();

    expect(mainSource).toContain('app.setName("Director Angel");');
    expect(mainSource).toContain('app.setPath("userData"');
    expect(mainSource).toContain("app.requestSingleInstanceLock()");
    expect(mainSource).toContain("app.quit();");
    expect(mainSource).toContain('app.on("second-instance"');
    expect(mainSource).toContain("focusMainWindow()");
    expect(mainSource).toContain("let bridgePromise = null;");
    expect(mainSource).toContain("let mainWindowPromise = null;");
    expect(mainSource).toContain("let mainWindow = null;");
    expect(mainSource).toContain("function getBridgePromise()");
    expect(mainSource).toContain("return (bridgePromise ??= createBridge());");
    expect(mainSource).toContain("async function ensureMainWindow()");
    expect(mainSource).toContain("if (mainWindowPromise !== null)");
    expect(mainSource).toContain("mainWindowPromise = createWindow();");
    expect(mainSource).toContain("mainWindowPromise = null;");
    const singleInstanceLockIndex = mainSource.indexOf("app.requestSingleInstanceLock()");
    expect(singleInstanceLockIndex).toBeGreaterThan(-1);
    expect(singleInstanceLockIndex).toBeLessThan(
      mainSource.indexOf("ipcMain.handle"),
    );
    expect(mainSource.indexOf('app.setName("Director Angel");')).toBeLessThan(
      singleInstanceLockIndex,
    );
    expect(mainSource.indexOf('app.setPath("userData"')).toBeLessThan(
      singleInstanceLockIndex,
    );
    expect(singleInstanceLockIndex).toBeLessThan(
      mainSource.indexOf("function getBridgePromise()"),
    );
    expect(mainSource).not.toContain("const bridgePromise = createBridge();");
    expect(mainSource).not.toContain("await createWindow();\n  }\n\n  app.on(\"activate\"");
    expect(mainSource).toContain("function warmBridgeInBackground()");
    expect(mainSource.indexOf("await ensureMainWindow();")).toBeLessThan(
      mainSource.indexOf("warmBridgeInBackground();"),
    );
    expect(mainSource).not.toContain("await getBridgePromise();\n  await ensureMainWindow();");
    expect(mainSource).toContain('visible: process.env.DIRECTOR_BROWSER_TOOL_VISIBLE === "1",');
    expect(mainSource).not.toContain("visible: !smokeMode,");
    expect(mainSource).toContain("attachMainWindowNavigationGuard(window);");
    expect(mainSource).toContain("mainWindow = window;");
    expect(mainSource).toContain('window.on("closed"');
    expect(mainSource).toContain("mainWindow = null;");
    expect(mainSource).toContain("function attachMainWindowNavigationGuard(window)");
    expect(mainSource).toContain("window.webContents.setWindowOpenHandler");
    expect(mainSource).toContain('window.webContents.on("will-navigate"');
    expect(mainSource).toContain("function isAllowedDirectorMainWindowUrl(url)");
    expect(mainSource).toContain("function openExternalUrlOutsideMainWindow(url)");
    expect(mainSource).toContain("shell.openExternal(url)");
    expect(mainSource).toContain('return ["http:", "https:", "mailto:"].includes');
    expect(mainSource).toContain('await window.loadFile(join(__dirname, "index.html")');
    expect(mainSource).not.toContain("window.loadURL(");
  });

  it("starts and stops the desktop background scheduler with the Electron lifecycle", async () => {
    const mainSource = await readElectronMainSource();
    const nativeBridgeSource = await readFile(new URL("./desktop-native-bridge.js", import.meta.url), "utf8");
    const bridgeFacadeSource = await readFile(new URL("./desktop-bridge-facade.js", import.meta.url), "utf8");
    const handlerSource = await readDesktopSystemHandlersSource();

    expect(mainSource).toContain(
      'const { createDesktopBackgroundRuntime } = require("./desktop-background-runtime.cjs");',
    );
    expect(mainSource).toContain("let backgroundRuntime = null;");
    expect(mainSource).toContain("let backgroundRuntimeRunTurn = null;");
    expect(mainSource).toContain("function getBackgroundRuntime()");
    expect(mainSource).toContain("backgroundRuntime ??= createDesktopBackgroundRuntime");
    expect(mainSource).toContain("runTurn: (input, context) => getBackgroundRuntimeRunTurn()(input, context)");
    expect(mainSource).toContain("function getBackgroundRuntimeRunTurn()");
    expect(mainSource).toContain("bridge.backgroundRuntime?.runTurn");
    expect(mainSource).toContain("backgroundRuntimeRunTurn = bridge.backgroundRuntime.runTurn;");
    expect(mainSource).toContain("function startBackgroundRuntimeInBackground()");
    expect(mainSource).toContain("getBackgroundRuntime().start()");
    expect(mainSource).toContain("function stopBackgroundRuntime()");
    expect(mainSource).toContain("backgroundRuntime?.stop();");
    expect(mainSource.indexOf("startBackgroundRuntimeInBackground();")).toBeGreaterThan(
      mainSource.indexOf("warmBridgeInBackground();"),
    );
    expect(mainSource).toContain('app.on("before-quit", stopBackgroundRuntime);');
    expect(nativeBridgeSource).toContain("backgroundRuntime: systemHandlers.backgroundRuntime");
    expect(bridgeFacadeSource).toContain("backgroundRuntime,");
    expect(bridgeFacadeSource).toContain("...(backgroundRuntime === undefined ? {} : { backgroundRuntime })");
    expect(handlerSource).toContain("backgroundRuntime: {");
    expect(handlerSource).toContain("runDesktopBackgroundConversationRuntimeTurn");
    expect(handlerSource).toContain("filterDesktopBackgroundRuntimeTools");
    expect(handlerSource).toContain("assertDesktopBackgroundRuntimeToolAllowed");
  });

  it("smoke-tests role-scoped scheduled learning dispatch and worker completion", async () => {
    const mainSource = await readElectronMainSource();

    expect(mainSource).toContain("DIRECTOR_DESKTOP_SMOKE_BACKGROUND_LEARNING === \"1\"");
    expect(mainSource).toContain("runSmokeBackgroundLearningAcceptance");
    expect(mainSource).toContain("writeSmokeBackgroundLearningArtifact");
    expect(mainSource).toContain("director.desktop.background-learning-smoke.v1");
    expect(mainSource).toContain("role-learning:director:smoke");
    expect(mainSource).toContain("candidateOnly: true");
    expect(mainSource).toContain("autoPublish: false");
    expect(mainSource).toContain("memorySync: \"skip-auto-write\"");
    expect(mainSource).toContain("smoke background learning did not dispatch a scheduled job");
    expect(mainSource).toContain("smoke background learning did not complete a worker job");
    expect(mainSource).toContain("smoke background learning lost candidate-only boundary");
  });

  it("keeps all external web links out of the Electron main window", async () => {
    const mainSource = await readElectronMainSource();
    const attachGuard = extractFunctionSource(mainSource, "attachMainWindowNavigationGuard");
    const allowMainWindowUrl = extractFunctionSource(mainSource, "isAllowedDirectorMainWindowUrl");
    const openExternal = extractFunctionSource(mainSource, "openExternalUrlOutsideMainWindow");
    const shouldOpenExternally = extractFunctionSource(
      mainSource,
      "shouldOpenExternallyFromMainWindow",
    );

    expect(attachGuard).toContain("window.webContents.setWindowOpenHandler");
    expect(attachGuard).toContain('window.webContents.on("will-navigate"');
    expect(attachGuard).toContain('return { action: "deny" };');
    expect(attachGuard).toContain("event.preventDefault();");
    expect(attachGuard).toContain("openExternalUrlOutsideMainWindow(url)");
    expect(allowMainWindowUrl).toContain('parsed.protocol !== "file:"');
    expect(allowMainWindowUrl).toContain("mainWindowHtmlPath");
    expect(openExternal).toContain("shouldOpenExternallyFromMainWindow(url)");
    expect(openExternal).toContain("shell.openExternal(url)");
    expect(shouldOpenExternally).toContain('["http:", "https:", "mailto:"]');
    expect(shouldOpenExternally).toContain("new URL(url).protocol");
    expect(mainSource).toContain("DIRECTOR_DESKTOP_SMOKE_EXTERNAL_NAVIGATION === \"1\"");
    expect(mainSource).toContain("runSmokeExternalNavigationAcceptance(window)");
    expect(mainSource).toContain("https://x.com/hotflow/status/1");
    expect(mainSource).toContain("https://mp.weixin.qq.com/s/director-angel-smoke");
    expect(mainSource).toContain("https://example.com/director-angel-smoke");
    expect(mainSource).toContain("DIRECTOR_DESKTOP_SMOKE_CAPTURE_EXTERNAL === \"1\"");
    expect(mainSource).toContain("smokeExternalOpenUrls.push(url)");
    expect(mainSource).toContain("DIRECTOR_DESKTOP_SMOKE_ARTIFACT_PATH");
    expect(mainSource).toContain("writeSmokeExternalNavigationArtifact");
    expect(mainSource).toContain("director.desktop.external-navigation-smoke.v1");
    expect(mainSource).toContain("externalHandoffUrls");
    expect(mainSource).toContain("mainWindowStayedOnApp");
    expect(mainSource).toContain("window.webContents.executeJavaScript");
    expect(mainSource).toContain("window.location.href");
    expect(mainSource).toContain("window.open");
    expect(mainSource).toContain("did-navigate");
    expect(mainSource).toContain("mainWindowHtmlPath");

    for (const hardcodedDomain of ["x.com", "twitter.com", "mp.weixin.qq.com", "example.com"]) {
      expect(mainSource).not.toContain(`hostname === "${hardcodedDomain}"`);
      expect(mainSource).not.toContain(`includes("${hardcodedDomain}")`);
    }
  });

  it("fails composer smoke when the result inspector keeps the initial placeholder", async () => {
    const mainSource = await readElectronMainSource();
    const assertSmokeComposerResult = extractFunctionSource(mainSource, "assertSmokeComposerResult");
    const smokeComposer = extractFunctionSource(mainSource, "runSmokeComposerInRenderer");

    expect(assertSmokeComposerResult).toContain("composer smoke left result inspector on placeholder");
    expect(assertSmokeComposerResult).toContain("result?.timelineText");
    expect(assertSmokeComposerResult).toContain("result?.resultText");
    expect(assertSmokeComposerResult).toContain("尚未执行命令");
    expect(smokeComposer).toContain('last.resultText.includes("URL 学习")');
    expect(smokeComposer).toContain('last.timelineText.includes("URL 学习")');
  });

  it("pins desktop Electron launches to the Director Angel app path", async () => {
    const mainSource = await readElectronMainSource();
    const launchSource = await readFile(new URL("../scripts/launch-electron.mjs", import.meta.url), "utf8");
    const visibleLaunchSource = await readFile(
      new URL("../scripts/launch-visible-electron.mjs", import.meta.url),
      "utf8",
    );
    const launchGuard = extractFunctionSource(mainSource, "assertDirectorDesktopLaunchContext");

    expect(launchSource).toContain("DIRECTOR_DESKTOP_EXPECT_APP_PATH");
    expect(launchSource).toContain("DIRECTOR_DESKTOP_LAUNCHED_BY");
    expect(launchSource).toContain("electron-main.cjs");
    expect(launchSource).toContain("existsSync");
    expect(launchSource).toContain("spawn(electronBin, [appDir]");
    expect(launchSource).not.toContain("spawn(electronBin, []");
    expect(visibleLaunchSource).toContain("DIRECTOR_DESKTOP_EXPECT_APP_PATH");
    expect(visibleLaunchSource).toContain("director-angel-visible-launcher");
    expect(visibleLaunchSource).toContain("SingletonLock");
    expect(visibleLaunchSource).toContain("director-desktop-stale-singleton");
    expect(visibleLaunchSource).toContain("Electron.app");
    expect(visibleLaunchSource).toContain("Contents");
    expect(visibleLaunchSource).toContain("MacOS");
    expect(visibleLaunchSource).toContain("Electron");
    expect(visibleLaunchSource).toContain("spawn(electronExecutable, [appDir]");
    expect(visibleLaunchSource).not.toContain("/usr/bin/open");
    expect(visibleLaunchSource).toContain("waitForVisibleDirectorWindow");
    expect(visibleLaunchSource).toContain("Director Angel");

    expect(launchGuard).toContain("DIRECTOR_DESKTOP_EXPECT_APP_PATH");
    expect(launchGuard).toContain("app.getAppPath()");
    expect(launchGuard).toContain("default_app.asar");
    expect(launchGuard).toContain("Director Angel desktop refused unsafe Electron launch");
    expect(launchGuard).toContain("app.exit(1)");
  });

  it("keeps the workbench composer stoppable while a native bridge turn is running", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();
    const submitComposerSource = extractFunctionSource(source, "submitComposerToBridge");

    expect(source).toContain("requestStopActiveComposerTurn");
    expect(source).toContain("createComposerTurnController");
    expect(source).toContain("isComposerTurnActive");
    expect(source).toContain("COMPOSER_STOP_CLICK_GRACE_MS");
    expect(source).toContain("COMPOSER_BRIDGE_TIMEOUT_MS");
    expect(source).toContain("COMPOSER_BRIDGE_WAITING_NOTICE_MS");
    expect(source).toContain("COMPOSER_BRIDGE_WATCHDOG_TIMEOUT_MS");
    expect(source).toContain("invokeBridgeWithTimeout");
    expect(source).toContain("startComposerBridgeWatchdog");
    expect(source).toContain("clearComposerBridgeWatchdog");
    expect(source).toContain("composerStopClickArmedUntilMs");
    expect(source).toContain("shouldTreatComposerSubmitAsStop");
    expect(source).toContain("cancelActiveComposerTask");
    expect(source).toContain("activeTaskId");
    expect(source).toContain("startTaskRuntimePolling();");
    expect(source).toContain("function applyBridgeTaskRuntimeSnapshot");
    expect(source).toContain("function registerOptimisticComposerTask");
    expect(source).toContain("function tryRenderRunCenter");
    expect(source).toContain("function reportNonFatalUiError");
    expect(source).toContain("function markTaskRuntimeTaskCancelledLocally");
    expect(source).toContain("releaseComposerTurnRunning");
    expect(source).toContain("composerTurn,");
    expect(source).toContain("options.composerTurn && !isComposerTurnActive(options.composerTurn)");
    expect(submitComposerSource).toContain("invokeBridgeWithTimeout");
    expect(submitComposerSource).toContain("COMPOSER_BRIDGE_TIMEOUT_MS");
    expect(submitComposerSource).toContain("startComposerBridgeWatchdog(composerTurn, pendingMessage)");
    expect(submitComposerSource.indexOf("finishComposerTurn(composerTurn)")).toBeLessThan(
      submitComposerSource.indexOf("await refreshTaskRuntime({ activeOnly: false }).catch"),
    );
    expect(submitComposerSource).toContain('finalizeOptimisticComposerTask(composerTurn, "failed"');
    expect(submitComposerSource).toContain("releaseComposerTurnRunning(composerTurn)");
    expect(source).toContain("STALE_STREAMING_TIMELINE_TIMEOUT_MS");
    expect(source).toContain("TASK_RUNTIME_REFRESH_TIMEOUT_MS");
    expect(source).toContain("startStaleTimelineMonitor");
    expect(source).toContain("finalizeStaleStreamingTimelineMessages");
    expect(source).toContain("dataset.streamingStartedAtMs");
    expect(source).toContain("silentTimeout");
    expect(source).toContain("正在等待工具或模型结果");
    expect(source).toContain("bridge-watchdog-timeout");
    expect(source).toContain('DESKTOP_ACTIONS.COMPOSER_CANCEL');
    expect(source).toContain('DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL');
    expect(source).toContain('elements.runCommand.textContent = running ? "停止" : "发送"');
    expect(source).toContain('elements.runCommand.dataset.mode = running ? "stop" : "send"');
    expect(source).toContain(
      'elements.runCommand.setAttribute("aria-label", running ? "停止当前请求" : "发送")',
    );
    expect(source).toContain('elements.runCommand?.addEventListener("pointerdown"');
    expect(source).toContain("state.lastComposerTurnFinishedAtMs = Date.now()");
    expect(source).not.toContain('elements.runCommand.textContent = running ? "运行中" : "发送"');
    expect(source).not.toContain('"发送给 Angel"');
    expect(styles).toContain(".send-button.stop-button");
  });

  it("keeps desktop runtime session keys and transport labels client-neutral", async () => {
    const source = await readAppSource();
    const runtimeSource = extractFunctionSource(
      await readDesktopSystemHandlersSource(),
      "runDesktopApiProviderTextViaConversationRuntime",
    );

    expect(source).not.toContain("Native Bridge 已连接");
    expect(source).not.toContain("Native Bridge 没有返回结果");
    expect(source).not.toContain("Native Bridge 在 ${Math.round");
    expect(runtimeSource).toContain("resolveDesktopConversationRuntimeSessionKey(action)");
    expect(runtimeSource).not.toContain('sessionKey: "desktop:workbench"');
  });

  it("logs native bridge invokes and enforces a main-process timeout", async () => {
    const mainSource = await readElectronMainSource();
    const appSource = await readAppSource();
    const rendererLogger = extractFunctionSource(appSource, "logRendererBridgeInvoke");

    expect(mainSource).toContain("appendFileSync");
    expect(mainSource).toContain("nativeBridgeInvokeTimeoutMs");
    expect(mainSource).toContain("director-desktop.log");
    expect(mainSource).toContain("logDesktopBridgeInvoke(\"start\"");
    expect(mainSource).toContain("logDesktopBridgeInvoke(\"finish\"");
    expect(mainSource).toContain("logDesktopBridgeInvoke(\"error\"");
    expect(mainSource).toContain("withTimeout(");
    expect(extractFunctionSource(mainSource, "withTimeout")).toContain("Promise.race");
    expect(extractFunctionSource(mainSource, "logDesktopBridgeInvoke")).toContain("appendFileSync");
    expect(rendererLogger).toContain('console.info("[Director Angel renderer bridge] " + JSON.stringify');
    expect(rendererLogger).not.toContain('console.info("[Director Angel renderer bridge]",');
  });

  it("wires global keyboard shortcuts for composer focus, navigation, settings, and stop", async () => {
    const source = await readAppSource();
    const installGlobalKeyboardShortcuts = extractFunctionSource(
      source,
      "installGlobalKeyboardShortcuts",
    );
    const handleGlobalKeyboardShortcut = extractFunctionSource(
      source,
      "handleGlobalKeyboardShortcut",
    );
    const openSettingsSurface = extractFunctionSource(source, "openSettingsSurface");
    const selectWorkflowByKeyboardIndex = extractFunctionSource(
      source,
      "selectWorkflowByKeyboardIndex",
    );

    expect(source).toContain("installGlobalKeyboardShortcuts();");
    expect(installGlobalKeyboardShortcuts).toContain('document.addEventListener("keydown"');
    expect(installGlobalKeyboardShortcuts).toContain("handleGlobalKeyboardShortcut(event)");
    expect(handleGlobalKeyboardShortcut).toContain("isSystemShortcutEvent(event)");
    expect(handleGlobalKeyboardShortcut).toContain("const key = event.key.toLowerCase()");
    expect(handleGlobalKeyboardShortcut).toContain('key === "k"');
    expect(handleGlobalKeyboardShortcut).toContain("focusComposerInput");
    expect(handleGlobalKeyboardShortcut).toContain('event.key === ","');
    expect(handleGlobalKeyboardShortcut).toContain("openSettingsSurface");
    expect(handleGlobalKeyboardShortcut).toContain("selectWorkflowByKeyboardIndex");
    expect(handleGlobalKeyboardShortcut).toContain("requestStopActiveComposerTurn");
    expect(handleGlobalKeyboardShortcut).toContain("state.quickActionsOpen = false");
    expect(openSettingsSurface).toContain('selectGroup("settings")');
    expect(selectWorkflowByKeyboardIndex).toContain("WORKFLOWS[index]");
    expect(selectWorkflowByKeyboardIndex).toContain("selectGroup(workflow.id)");
  });

  it("wires OpenClaw/Hermes-style chat state into the workbench composer", async () => {
    const source = await readAppSource();
    const stateController = await readFile(new URL("./controllers/state.js", import.meta.url), "utf8");
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const submitComposer = extractFunctionSource(source, "submitComposer");
    const finishComposerTurn = extractFunctionSource(source, "finishComposerTurn");
    const setInputValue = extractFunctionSource(source, "setInputValue");

    expect(source).toContain('from "./ui/chat.js"');
    expect(stateController).toContain('from "../ui/chat.js"');
    expect(stateController).toContain("chat: createDesktopChatState()");
    expect(submitComposer).toContain("handleDesktopChatSubmit(state.chat");
    expect(submitComposer).toContain("send: submitComposerMessage");
    expect(submitComposer).toContain("abort: requestStopActiveComposerTurn");
    expect(source).toContain("function submitComposerMessage");
    expect(source).toContain("function handleComposerHistoryNavigation");
    expect(source).toContain("function syncComposerStateFromInput");
    expect(source).toContain("function flushQueuedComposerSubmit");
    expect(source).toContain("handleComposerHistoryNavigation(event)");
    expect(finishComposerTurn).toContain("reconcileDesktopChatRunLifecycle(state.chat");
    expect(finishComposerTurn).toContain("flushQueuedComposerSubmit");
    expect(setInputValue).toContain("state.chat.composer.setInput(value)");
    expect(packageJson.scripts.check).toContain("node --check src/ui/chat.js");
    expect(packageJson.scripts.check).toContain("node --check src/ui/composer-state.js");
    expect(packageJson.scripts.check).toContain("node --check src/ui/attachment-payload-store.js");
  });

  it("persists restart-safe desktop UI state through preload file storage", async () => {
    const source = await readAppSource();
    const preloadSource = await readFile(new URL("./electron-preload.cjs", import.meta.url), "utf8");
    const mainSource = await readElectronMainSource();
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const initialize = extractFunctionSource(source, "initialize");
    const setInputValue = extractFunctionSource(source, "setInputValue");
    const syncComposerStateFromInput = extractFunctionSource(source, "syncComposerStateFromInput");
    const selectInspectorPanel = extractFunctionSource(source, "selectInspectorPanel");

    expect(source).toContain('from "./ui/persistence.js"');
    expect(source).toContain("function hydrateDesktopUiState");
    expect(source).toContain("function persistDesktopUiState");
    expect(initialize.indexOf("await hydrateDesktopUiState();")).toBeLessThan(
      initialize.indexOf("await refreshSnapshot();"),
    );
    expect(setInputValue).toContain("persistDesktopUiState();");
    expect(syncComposerStateFromInput).toContain("persistDesktopUiState();");
    expect(selectInspectorPanel).toContain("persistDesktopUiState();");
    expect(extractFunctionSource(source, "applyTaskRuntimeSnapshot")).toContain("persistDesktopUiState();");
    expect(extractFunctionSource(source, "upsertTaskRuntimeTask")).toContain("persistDesktopUiState();");
    expect(extractFunctionSource(source, "finalizeOptimisticComposerTask")).toContain(
      "persistDesktopUiState();",
    );
    expect(
      await readFile(new URL("./ui/persistence.js", import.meta.url), "utf8"),
    ).toContain("recentTasks: readRestartSafeRecentTasks");
    expect(source).toContain("bridge.uiState.read()");
    expect(source).toContain("bridge.uiState.write(createDesktopUiPersistenceSnapshot(state))");
    expect(mainSource).toContain('ipcMain.handle("director-angel:uiState:read"');
    expect(mainSource).toContain('ipcMain.handle("director-angel:uiState:write"');
    expect(preloadSource).toContain("uiState");
    expect(preloadSource).toContain('ipcRenderer.invoke("director-angel:uiState:read")');
    expect(preloadSource).toContain('ipcRenderer.invoke("director-angel:uiState:write"');
    expect(packageJson.scripts.check).toContain("node --check src/ui/persistence.js");
    expect(packageJson.scripts.check).toContain("node --check src/desktop-ui-state-store.js");
  });

  it("renders OpenClaw-style desktop sessions in the left sidebar", async () => {
    const html = await readIndexSource();
    const source = await readAppSource();
    const styles = await readStylesSource();
    const chatModule = await readFile(new URL("./ui/chat.js", import.meta.url), "utf8");
    const initialize = extractFunctionSource(source, "initialize");
    const submitComposerToBridge = extractFunctionSource(source, "submitComposerToBridge");
    const createDesktopSession = extractFunctionSource(source, "createDesktopSession");
    const selectDesktopSession = extractFunctionSource(source, "selectDesktopSession");

    expect(html).toContain('id="session-list"');
    expect(html).toContain('id="new-session"');
    expect(html).toContain("会话");
    expect(html.indexOf('id="session-list"')).toBeLessThan(
      html.indexOf('id="command-groups"'),
    );
    expect(source).toContain("sessionList: document.getElementById(\"session-list\")");
    expect(source).toContain("newSession: document.getElementById(\"new-session\")");
    expect(source).toContain("function renderDesktopSessions");
    expect(source).toContain("function createDesktopSession");
    expect(source).toContain("function selectDesktopSession");
    expect(source).toContain("function updateCurrentDesktopSessionFromPrompt");
    expect(source).toContain("ensureDesktopChatSessions(state.chat");
    expect(source).toContain("createDesktopChatSession(state.chat");
    expect(source).toContain("selectDesktopChatSession(state.chat");
    expect(initialize).toContain("renderDesktopSessions();");
    expect(submitComposerToBridge).toContain("updateCurrentDesktopSessionFromPrompt(input)");
    expect(createDesktopSession).toContain("persistDesktopUiState();");
    expect(selectDesktopSession).toContain("persistDesktopUiState();");
    expect(selectDesktopSession).toContain("clearDesktopWorkbenchTimelineForSessionSwitch");
    expect(source).toContain("function clearDesktopWorkbenchTimelineForSessionSwitch");
    expect(extractFunctionSource(source, "clearDesktopWorkbenchTimelineForSessionSwitch")).toContain(
      "elements.timeline.replaceChildren()",
    );
    expect(chatModule).toContain("export function ensureDesktopChatSessions");
    expect(chatModule).toContain("export function createDesktopChatSession");
    expect(chatModule).toContain("export function selectDesktopChatSession");
    expect(chatModule).toContain("export function updateDesktopChatSessionFromPrompt");
    expect(styles).toContain(".session-list");
    expect(styles).toContain(".new-session-button");
  });

  it("wires desktop session rename and close actions in the left sidebar", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();
    const chatModule = await readFile(new URL("./ui/chat.js", import.meta.url), "utf8");
    const renderDesktopSessions = extractFunctionSource(source, "renderDesktopSessions");
    const renameDesktopSession = extractFunctionSource(source, "renameDesktopSession");
    const closeDesktopSession = extractFunctionSource(source, "closeDesktopSession");

    expect(source).toContain("renameDesktopChatSession");
    expect(source).toContain("deleteDesktopChatSession");
    expect(renderDesktopSessions).toContain("data-desktop-session-rename");
    expect(renderDesktopSessions).toContain("data-desktop-session-close");
    expect(source).toContain("target.closest(\"[data-desktop-session-rename]\")");
    expect(source).toContain("target.closest(\"[data-desktop-session-close]\")");
    expect(renameDesktopSession).toContain("window.prompt");
    expect(renameDesktopSession).toContain("renameDesktopChatSession(state.chat");
    expect(renameDesktopSession).toContain("persistDesktopUiState();");
    expect(closeDesktopSession).toContain("window.confirm");
    expect(closeDesktopSession).toContain("deleteDesktopChatSession(state.chat");
    expect(closeDesktopSession).toContain("elements.timeline.replaceChildren()");
    expect(closeDesktopSession).toContain("persistDesktopUiState();");
    expect(chatModule).toContain("export function renameDesktopChatSession");
    expect(chatModule).toContain("export function deleteDesktopChatSession");
    expect(styles).toContain(".session-actions");
    expect(styles).toContain(".session-action-button");
  });

  it("clears deleted desktop session context through the Native Bridge", async () => {
    const source = await readAppSource();
    const contract = await readFile(new URL("./desktop-contract.js", import.meta.url), "utf8");
    const bridgeFacade = await readFile(new URL("./desktop-bridge-facade.js", import.meta.url), "utf8");
    const systemHandlers = await readFile(
      new URL("./desktop-system-handlers.js", import.meta.url),
      "utf8",
    );
    const closeDesktopSession = extractFunctionSource(source, "closeDesktopSession");

    expect(contract).toContain('COMPOSER_SESSION_DELETE: "composer.sessionDelete"');
    expect(bridgeFacade).toContain("DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE");
    expect(bridgeFacade).toContain("deleteDesktopWorkbenchConversationContext");
    expect(bridgeFacade).toContain("createDesktopWorkbenchTranscriptArchive");
    expect(bridgeFacade).toContain("archiveDesktopWorkbenchConversationContext");
    expect(systemHandlers).toContain("archiveSession");
    expect(systemHandlers).toContain("desktop-session-archives");
    expect(closeDesktopSession).toContain("DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE");
    expect(closeDesktopSession).toContain("sessionKey");
    expect(closeDesktopSession).toContain("reportNonFatalUiError");
  });

  it("renders composer attachments and forwards them with workbench submits", async () => {
    const html = await readIndexSource();
    const source = await readAppSource();
    const styles = await readStylesSource();
    const composerState = await readFile(new URL("./ui/composer-state.js", import.meta.url), "utf8");
    const payloadStore = await readFile(
      new URL("./ui/attachment-payload-store.js", import.meta.url),
      "utf8",
    );
    const submitComposerToBridge = extractFunctionSource(source, "submitComposerToBridge");
    const submitComposerMessage = extractFunctionSource(source, "submitComposerMessage");
    const removeComposerAttachmentById = extractFunctionSource(source, "removeComposerAttachmentById");

    expect(html).toContain('id="composer-attachments"');
    expect(source).toContain('from "./ui/attachment-payload-store.js"');
    expect(source).toContain("composerAttachments: document.getElementById(\"composer-attachments\")");
    expect(source).toContain("function renderComposerAttachments");
    expect(source).toContain("function addComposerAttachmentFromPath");
    expect(source).toContain("function removeComposerAttachmentById");
    expect(source).toContain("looksLikeDroppedPath");
    expect(source).toContain("addComposerAttachment(state.chat.composer");
    expect(source).toContain("removeComposerAttachment(state.chat.composer");
    expect(removeComposerAttachmentById).toContain("releaseDesktopAttachmentPayloads");
    expect(submitComposerMessage).toContain("options?.attachments");
    expect(submitComposerToBridge).toContain("materializeDesktopAttachmentPayloads(attachments)");
    expect(submitComposerToBridge).toContain("discardDesktopAttachmentDataUrls(attachments)");
    expect(submitComposerToBridge).toContain("releaseDesktopAttachmentPayloads(attachments)");
    expect(composerState).toContain("attachments:");
    expect(composerState).toContain("export function addComposerAttachment");
    expect(payloadStore).toContain("materializeDesktopAttachmentPayloads");
    expect(styles).toContain(".composer-attachments");
    expect(styles).toContain(".attachment-chip");
  });

  it("supports drag-and-drop file attachments in the composer", async () => {
    const source = await readAppSource();
    const composerState = await readFile(new URL("./ui/composer-state.js", import.meta.url), "utf8");
    const installHandlers = extractFunctionSource(source, "installEventHandlers");
    const handleComposerDrop = extractFunctionSource(source, "handleComposerDrop");

    expect(source).toContain("createComposerAttachmentsFromFiles");
    expect(installHandlers).toContain('elements.composer?.addEventListener("dragover"');
    expect(installHandlers).toContain('elements.composer?.addEventListener("drop"');
    expect(handleComposerDrop).toContain("event.dataTransfer?.files");
    expect(handleComposerDrop).toContain("createComposerAttachmentsFromFiles(files, { includePayloads: true })");
    expect(handleComposerDrop).toContain("registerDesktopAttachmentPayload");
    expect(handleComposerDrop).toContain("addComposerAttachment(state.chat.composer");
    expect(handleComposerDrop).toContain("renderComposerAttachments();");
    expect(composerState).toContain("export function createComposerAttachmentsFromFiles");
  });

  it("keeps desktop live audio visible, stoppable, and fail-closed in the composer", async () => {
    const html = await readIndexSource();
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(html).toContain('id="live-audio-toggle"');
    expect(html).toContain('id="live-audio-status"');
    expect(html).toContain("语音未运行");
    expect(html.indexOf('id="run-video"')).toBeLessThan(
      html.indexOf('id="live-audio-toggle"'),
    );
    expect(html.indexOf('id="live-audio-toggle"')).toBeLessThan(
      html.indexOf('id="quick-actions"'),
    );

    const stateController = await readFile(new URL("./controllers/state.js", import.meta.url), "utf8");
    expect(stateController).toContain("liveAudio: createLiveAudioState()");
    expect(stateController).toContain("function createLiveAudioState()");
    expect(source).toContain("async function toggleLiveAudio()");
    expect(source).toContain("async function startLiveAudio()");
    expect(source).toContain("async function stopLiveAudio()");
    expect(source).toContain("async function refreshLiveAudioStatus");
    expect(source).toContain("function applyLiveAudioBridgeResult");
    expect(source).toContain("function renderLiveAudioStatus");
    expect(source).toContain("function resolveLiveAudioStatusCopy");
    expect(source).toContain("DESKTOP_ACTIONS.LIVE_AUDIO_START");
    expect(source).toContain("DESKTOP_ACTIONS.LIVE_AUDIO_STOP");
    expect(source).toContain("DESKTOP_ACTIONS.LIVE_AUDIO_STATUS");
    expect(source).toContain("真实麦克风默认关闭，未启动。");
    expect(source).toContain("state.liveAudio.busy || (state.running && state.liveAudio.active !== true)");
    expect(source).toContain("state.liveAudio.busy || (running && state.liveAudio.active !== true)");
    expect(styles).toContain(".live-audio-status");
    expect(styles).toContain(".live-audio-button.active");
  });

  it("renders a backend-bound run center instead of relying on local loading state", async () => {
    const html = await readIndexSource();
    const source = await readAppSource();
    const runCenterModule = await readFile(new URL("./ui/run-center.js", import.meta.url), "utf8");
    const styles = await readStylesSource();
    const runCenterIndex = html.indexOf('id="run-center"');
    const inspectorIndex = html.indexOf('<aside class="inspector">');

    expect(html).toContain('id="run-center"');
    expect(html).toContain('data-run-center-panel="active"');
    expect(runCenterIndex).toBeGreaterThan(inspectorIndex);
    expect(source).toContain("function refreshTaskRuntime");
    expect(source).toContain("function startTaskRuntimePolling");
    expect(source).toContain("function stopTaskRuntimePollingIfIdle");
    expect(source).toContain("function renderRunCenter");
    expect(source).toContain("function applyTaskRuntimeSnapshot");
    expect(source).toContain('from "./ui/run-center.js"');
    expect(runCenterModule).toContain("export function createRunCenterTaskRow");
    expect(runCenterModule).toContain("export function formatTaskRuntimeTimeLabel");
    expect(runCenterModule).toContain("export function formatTaskRuntimeEventPreview");
    expect(runCenterModule).toContain("export function createRunCenterTaskTranscript");
    expect(runCenterModule).toContain("export function createRunCenterRenderScheduler");
    expect(runCenterModule).toContain("export function createRunCenterToastState");
    expect(runCenterModule).toContain("export function updateRunCenterToastStateFromTasks");
    expect(source).toContain("createRunCenterRenderScheduler");
    expect(source).toContain("createRunCenterToastState");
    expect(source).toContain("state.taskRuntime.renderScheduler");
    expect(source).toContain("updateRunCenterToastStateFromTasks");
    expect(source).toContain("function renderRunCenterFallbackToast");
    expect(source).toContain("conversation.sent");
    const stateController = await readFile(new URL("./controllers/state.js", import.meta.url), "utf8");
    expect(source).toContain('from "./controllers/state.js"');
    expect(stateController).toContain("export function createDesktopAppState");
    expect(stateController).toContain("optimisticTasks: new Map()");
    expect(stateController).toContain("completedComposerTurns: new Set()");
    expect(stateController).toContain("activeComposerTask: null");
    expect(stateController).toContain("refreshPromise: null");
    expect(stateController).toContain("renderScheduler: null");
    expect(stateController).toContain("toastState: null");
    expect(source).toContain("TASK_RUNTIME_POLL_INTERVAL_MS");
    expect(source).toContain("function mergeOptimisticTaskRuntimeTasks");
    expect(source).toContain("function collectTerminalComposerTurnIds");
    expect(source).toContain("function shouldKeepIncomingTaskRuntimeTask");
    expect(source).toContain("function resolveTaskRuntimeComposerTurnId");
    expect(source).toContain("function getRenderableTaskRuntimeTasks");
    expect(source).toContain("function finalizeOptimisticComposerTask");
    expect(source).toContain("function isLocalOptimisticConversationRuntimeTask");
    expect(source).toContain("function isTaskRuntimeComposerTurnTask");
    expect(extractFunctionSource(source, "mergeOptimisticTaskRuntimeTasks")).toContain("!state.running");
    expect(extractFunctionSource(source, "mergeOptimisticTaskRuntimeTasks")).toContain(
      'task.payload?.source === "desktop.conversation-runtime"',
    );
    expect(styles).toContain(".run-task-transcript");
    expect(styles).toContain(".run-task-transcript-time");
    expect(extractFunctionSource(source, "mergeOptimisticTaskRuntimeTasks")).toContain(
      "merged.delete(taskId)",
    );
    expect(extractFunctionSource(source, "finalizeOptimisticComposerTask")).toContain(
      "isTaskRuntimeComposerTurnTask(task, controller.turnId, taskIdsToRemove)",
    );
    expect(source).toContain("function reconcileActiveComposerTurnFromTaskRuntime");
    expect(extractFunctionSource(source, "applyTaskRuntimeSnapshot")).toContain(
      "reconcileActiveComposerTurnFromTaskRuntime(tasks)",
    );
    expect(extractFunctionSource(source, "applyTaskRuntimeSnapshot")).toContain(
      "filter(shouldKeepIncomingTaskRuntimeTask)",
    );
    expect(extractFunctionSource(source, "shouldKeepIncomingTaskRuntimeTask")).toContain(
      "completedComposerTurns.has(turnId)",
    );
    expect(extractFunctionSource(source, "mergeOptimisticTaskRuntimeTasks")).toContain(
      "completedComposerTurns.has(turnId)",
    );
    expect(extractFunctionSource(source, "mergeOptimisticTaskRuntimeTasks")).toContain(
      "collectTerminalComposerTurnIds",
    );
    expect(extractFunctionSource(source, "mergeOptimisticTaskRuntimeTasks")).toContain(
      "terminalComposerTurns.has(turnId)",
    );
    expect(extractFunctionSource(source, "collectTerminalComposerTurnIds")).toContain(
      "state.taskRuntime.completedComposerTurns.add(turnId)",
    );
    expect(extractFunctionSource(source, "reconcileActiveComposerTurnFromTaskRuntime")).toContain(
      "releaseComposerTurnRunning(activeTurn)",
    );
    expect(extractFunctionSource(source, "reconcileActiveComposerTurnFromTaskRuntime")).toContain(
      "state.taskRuntime.completedComposerTurns.add(activeTurn.turnId)",
    );
    expect(extractFunctionSource(source, "reconcileActiveComposerTurnFromTaskRuntime")).toContain(
      "createConversationRuntimeTaskTimelineMessage(matchingTask)",
    );
    expect(extractFunctionSource(source, "reconcileActiveComposerTurnFromTaskRuntime")).toContain(
      "renderConversationRuntimeTaskResult(matchingTask)",
    );
    expect(extractFunctionSource(source, "startTaskRuntimePolling")).toContain(
      "refreshTaskRuntime({ activeOnly: false })",
    );
    expect(extractFunctionSource(source, "startTaskRuntimePolling")).toContain("state.running");
    expect(extractFunctionSource(source, "startTaskRuntimePolling")).toContain(
      "state.taskRuntime.refreshPromise",
    );
    expect(extractFunctionSource(source, "refreshTaskRuntime")).toContain(
      "return state.taskRuntime.refreshPromise",
    );
    expect(extractFunctionSource(source, "submitComposerToBridge").indexOf("releaseComposerTurnRunning(composerTurn)")).toBeLessThan(
      extractFunctionSource(source, "submitComposerToBridge").indexOf("await refreshTaskRuntime({ activeOnly: false })"),
    );
    expect(source).toContain("DESKTOP_ACTIONS.TASK_RUNTIME_LIST");
    expect(source).toContain("DESKTOP_ACTIONS.TASK_RUNTIME_READ");
    expect(source).toContain("DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL");
    expect(source).toContain("taskRuntime.tasks");
    expect(source).toContain("data-task-cancel");
    expect(source).toContain("data-task-read");
    expect(source).toContain("data-task-retry");
    expect(source).toContain("function retryRunCenterTask");
    expect(extractFunctionSource(source, "retryRunCenterTask")).toContain("findLocalTaskRuntimeTask(taskId)");
    expect(extractFunctionSource(source, "retryRunCenterTask")).toContain("payload?.promptPreview");
    expect(extractFunctionSource(source, "retryRunCenterTask")).toContain("selectDesktopChatSession(state.chat");
    expect(extractFunctionSource(source, "retryRunCenterTask")).toContain("submitComposerMessage(prompt)");
    expect(extractFunctionSource(source, "submitComposerToBridge")).toContain("startTaskRuntimePolling();");
    expect(extractFunctionSource(source, "submitComposerToBridge")).toContain(
      "registerOptimisticComposerTask(composerTurn, input);",
    );
    expect(extractFunctionSource(source, "submitComposerToBridge")).toContain(
      'finalizeOptimisticComposerTask(composerTurn, "completed");',
    );
    expect(extractFunctionSource(source, "finalizeOptimisticComposerTask")).toContain(
      "state.taskRuntime.completedComposerTurns.add(controller.turnId)",
    );
    expect(extractFunctionSource(source, "renderRunCenter")).toContain(
      "getRenderableTaskRuntimeTasks().sort(compareTaskRuntimeUpdatedAt)",
    );
    expect(extractFunctionSource(source, "getRenderableTaskRuntimeTasks")).toContain(
      "completedComposerTurns.has(activeTurn.turnId)",
    );
    expect(extractFunctionSource(source, "getRenderableTaskRuntimeTasks")).toContain(
      "!isTaskRuntimeActive(task) && isTaskRuntimeComposerTurnTask(task, activeTurn.turnId)",
    );
    const runCenterRowSource = extractFunctionSource(runCenterModule, "createRunCenterTaskRow");
    expect(runCenterRowSource).toContain("formatTaskRuntimeUserFacingMetaParts(task)");
    expect(runCenterRowSource).toContain("formatTaskRuntimeEventPreview(task)");
    expect(runCenterRowSource).toContain('preview.className = "run-task-preview"');
    expect(runCenterRowSource).toContain("canRetryRunCenterTask(task)");
    expect(runCenterRowSource).toContain('"taskRetry"');
    expect(extractFunctionSource(source, "setRunning")).toContain(
      "scheduleRunCenterRender({ force: true });",
    );
    expect(extractFunctionSource(source, "applyTaskRuntimeSnapshot")).toContain(
      "scheduleRunCenterRender();",
    );
    expect(extractFunctionSource(source, "tryRenderRunCenter")).toContain("renderRunCenter();");
    expect(extractFunctionSource(source, "registerOptimisticComposerTask")).toContain(
      "reportNonFatalUiError(error,",
    );
    expect(extractFunctionSource(source, "getRenderableTaskRuntimeTasks")).toContain("state.running");
    expect(extractFunctionSource(source, "cancelActiveComposerTask")).toContain(
      "applyBridgeTaskRuntimeSnapshot",
    );
    expect(extractFunctionSource(source, "cancelTaskRuntimeTask")).toContain(
      "markTaskRuntimeTaskCancelledLocally(taskId, reason);",
    );
    expect(styles).toContain(".run-center");
    expect(styles).toContain(".run-task-row");
    expect(styles).toContain(".run-task-progress");
    expect(styles).toContain(".run-task-preview");
    expect(styles).toContain(".run-center-fallback-toast");
  });

  it("keeps the run center aligned with OpenClaw tool stream lifecycle semantics", async () => {
    const runCenterModule = await readFile(new URL("./ui/run-center.js", import.meta.url), "utf8");

    expect(runCenterModule).toContain("createRunCenterToolStreamSteps");
    expect(runCenterModule).toContain("isRunCenterToolStreamEvent");
    expect(runCenterModule).toContain("applyRunCenterToolStreamEvent");
    expect(runCenterModule).toContain("formatRunCenterToolStreamStep");
    expect(runCenterModule).toContain("formatRunCenterToolStreamElapsed");
    expect(runCenterModule).toContain("RUN_CENTER_RENDER_THROTTLE_MS");
    expect(runCenterModule).toContain("RUN_CENTER_FALLBACK_TOAST_DURATION_MS");
    expect(runCenterModule).toContain("filterRunCenterRuntimeEventsForTask");
    expect(runCenterModule).toContain("formatRunCenterToolPreviewText");
    expect(runCenterModule).toContain("runCenterPointerCopy");
    expect(runCenterModule).toContain("runCenterPointerOpen");
    expect(runCenterModule).toContain("drawerContent");
    expect(runCenterModule).toContain("复制来源");
    expect(runCenterModule).toContain("打开来源");
    expect(runCenterModule).toContain("toolCallId");
    expect(runCenterModule).toContain("inputPreview");
    expect(runCenterModule).toContain("outputPreview");
    expect(runCenterModule).toContain("失败原因");
    expect(runCenterModule).toContain("tool-stream:");
    expect(runCenterModule.indexOf("createRunCenterToolStreamSteps(runtimeEvents)")).toBeLessThan(
      runCenterModule.indexOf("for (const event of runtimeEvents)"),
    );
    expect(runCenterModule).toContain("if (isRunCenterToolStreamEvent(event))");
  });

  it("tracks Hermes-style streaming Markdown frames during model deltas", async () => {
    const source = await readAppSource();
    const timelineModule = await readFile(new URL("./ui/timeline.js", import.meta.url), "utf8");
    const appendDelta = extractFunctionSource(source, "appendTimelineMessageTextDelta");

    expect(timelineModule).toContain("export function createTimelineStreamingMarkdownFrame");
    expect(timelineModule).toContain("export function renderTimelineStreamingMarkdownFrame");
    expect(timelineModule).toContain("data-streaming-markdown-stable");
    expect(timelineModule).toContain("data-streaming-markdown-unstable");
    expect(timelineModule).toContain("findTimelineStableMarkdownBoundary(text)");
    expect(timelineModule).toContain("parseTimelineMarkdownMediaLine");
    expect(timelineModule).toContain("isTimelineMarkdownAudioVoiceDirective");
    expect(timelineModule).toContain("calculateTimelineMarkdownIndentDepth");
    expect(timelineModule).toContain("markdownQuoteDepth");
    expect(timelineModule).toContain("export async function resolveTimelineMarkdownLinkTitles");
    expect(timelineModule).toContain("export function isTimelineMarkdownTitleFetchable");
    expect(timelineModule).toContain("queueTimelineMarkdownLinkTitleResolution");
    expect(timelineModule).toContain("fetchTimelineMarkdownLinkTitle");
    expect(timelineModule).toContain("linkTitleStatus");
    expect(appendDelta).toContain("createTimelineStreamingMarkdownFrame");
    expect(appendDelta).toContain("renderTimelineStreamingMarkdownFrame");
    expect(appendDelta).toContain("__streamingMarkdownFrame");
    expect(appendDelta).toContain("stableMarkdownPrefixLength");
    expect(appendDelta).toContain("unstableMarkdownSuffixLength");
  });

  it("lets the run center copy and open MemPalace memory source pointers", async () => {
    const source = await readAppSource();
    const desktopContract = await readFile(new URL("./desktop-contract.js", import.meta.url), "utf8");
    const bridgeFacade = await readFile(new URL("./desktop-bridge-facade.js", import.meta.url), "utf8");
    const systemHandlers = await readDesktopSystemHandlersSource();

    expect(desktopContract).toContain("MEMPALACE_SOURCE_READ");
    expect(desktopContract).toContain("mempalace.sourceRead");
    expect(bridgeFacade).toContain("DESKTOP_ACTIONS.MEMPALACE_SOURCE_READ");
    expect(bridgeFacade).toContain("handlers.mempalace?.sourceRead");
    expect(systemHandlers).toContain("readMempalaceDrawerSourceSync");
    expect(systemHandlers).toContain("drawerId");
    expect(systemHandlers).toContain("mempalace: {");
    expect(systemHandlers).toContain("sourceRead: async (action)");
    expect(source).toContain("data-run-center-pointer-copy");
    expect(source).toContain("data-run-center-pointer-open");
    expect(source).toContain("function copyRunCenterPointer");
    expect(source).toContain("async function openRunCenterPointerSource");
    expect(extractFunctionSource(source, "copyRunCenterPointer")).toContain(
      "navigator.clipboard?.writeText",
    );
    expect(extractFunctionSource(source, "createRunCenterPointerSourceLines")).toContain(
      "MemPalace 来源定位",
    );
    expect(extractFunctionSource(source, "createRunCenterPointerSourceLines")).toContain(
      "原文片段",
    );
    expect(extractFunctionSource(source, "createRunCenterPointerSourceLines")).toContain(
      "Drawer 原文",
    );
    expect(extractFunctionSource(source, "openRunCenterPointerSource")).toContain(
      "source.drawerContent",
    );
    expect(extractFunctionSource(source, "openRunCenterPointerSource")).toContain(
      "source.drawerId",
    );
    expect(extractFunctionSource(source, "openRunCenterPointerSource")).toContain(
      "DESKTOP_ACTIONS.MEMPALACE_SOURCE_READ",
    );
    expect(extractFunctionSource(source, "openRunCenterPointerSource")).toContain(
      "invokeBridge",
    );
    expect(extractFunctionSource(source, "createRunCenterPointerSourceLines")).toContain(
      "二次读取完整 drawer 原文失败",
    );
  });

  it("renders Director Console v1 in the right inspector as a plan projection", async () => {
    const html = await readIndexSource();
    const source = await readAppSource();
    const stateController = await readFile(new URL("./controllers/state.js", import.meta.url), "utf8");
    const directorConsoleModule = await readFile(new URL("./ui/director-console.js", import.meta.url), "utf8");
    const commandCatalogSource = await readFile(new URL("./desktop-command-catalog.js", import.meta.url), "utf8");
    const desktopContract = await readFile(new URL("./desktop-contract.js", import.meta.url), "utf8");
    const bridgeFacade = await readFile(new URL("./desktop-bridge-facade.js", import.meta.url), "utf8");
    const styles = await readStylesSource();

    expect(html).toContain('id="director-console"');
    expect(html).toContain('aria-label="总导演控制台"');
    expect(source).toContain('from "./ui/director-console.js"');
    expect(source).toContain("function renderDirectorConsole");
    expect(source).toContain("function resolveDirectorConsoleProjection");
    expect(source).toContain("function createDirectorConsoleDecisionAction");
    expect(source).toContain('createCommandRunAction("director.planAccept"');
    expect(source).toContain('createCommandRunAction("director.planIgnore"');
    expect(source).toContain('createCommandRunAction("director.planRerun"');
    expect(source).toContain("state.directorConsole.projection = resolveDirectorConsoleProjection(snapshot)");
    expect(source).toContain("createDirectorConsolePanel(consoleProjection)");
    expect(commandCatalogSource).toContain('"director.plan"');
    expect(commandCatalogSource).toContain('"director.planAccept"');
    expect(commandCatalogSource).toContain('"director.planIgnore"');
    expect(commandCatalogSource).toContain('"director.planRerun"');
    expect(commandCatalogSource).toContain("DESKTOP_ACTIONS.DIRECTOR_PLAN");
    expect(desktopContract).toContain('DIRECTOR_PLAN: "director.plan"');
    expect(desktopContract).toContain('DIRECTOR_PLAN_ACCEPT: "director.planAccept"');
    expect(desktopContract).toContain('DIRECTOR_PLAN_IGNORE: "director.planIgnore"');
    expect(desktopContract).toContain('DIRECTOR_PLAN_RERUN: "director.planRerun"');
    expect(bridgeFacade).toContain(
      "[DESKTOP_ACTIONS.DIRECTOR_PLAN]: handlers.director?.plan",
    );
    expect(bridgeFacade).toContain(
      "[DESKTOP_ACTIONS.DIRECTOR_PLAN_ACCEPT]: handlers.director?.planAccept",
    );
    expect(bridgeFacade).toContain(
      "[DESKTOP_ACTIONS.DIRECTOR_PLAN_IGNORE]: handlers.director?.planIgnore",
    );
    expect(bridgeFacade).toContain(
      "[DESKTOP_ACTIONS.DIRECTOR_PLAN_RERUN]: handlers.director?.planRerun",
    );
    expect(stateController).toContain("function createDirectorConsoleState");
    expect(stateController).toContain("directorConsole: createDirectorConsoleState()");
    expect(directorConsoleModule).toContain("export function createDirectorConsolePanel");
    expect(directorConsoleModule).toContain('panel.dataset.directorConsole = "v1"');
    expect(directorConsoleModule).toContain("推荐模式");
    expect(directorConsoleModule).toContain("推荐模型");
    expect(directorConsoleModule).toContain("审核结果");
    expect(directorConsoleModule).toContain("执行预览");
    expect(directorConsoleModule).toContain("用户锁定");
    expect(directorConsoleModule).toContain("data-director-console-action");
    expect(directorConsoleModule).toContain("button.dataset.directorConsoleAction");
    expect(directorConsoleModule).toContain("requiresConfirmation");
    expect(styles).toContain(".director-console-panel");
    expect(styles).toContain(".director-console-gate");
    expect(styles).toContain(".director-console-actions");
  });

  it("keeps ordinary conversation runtime turns visible in the desktop task runtime", async () => {
    const appSource = await readAppSource();
    const runCenterModule = await readFile(new URL("./ui/run-center.js", import.meta.url), "utf8");
    const handlerSource = await readDesktopSystemHandlersSource();

    expect(appSource).toContain("createOptimisticComposerTaskId(turnId)");
    expect(appSource).toContain('return `conversation:${turnId}`;');
    expect(appSource).toContain('localOptimistic: true');
    expect(appSource).toContain("state.taskRuntime.activeComposerTask");
    expect(appSource).toContain('localCancelRequested');
    expect(runCenterModule).toContain("function formatTaskRuntimeUserFacingLabel");
    expect(runCenterModule).toContain("function formatTaskRuntimeUserFacingMetaParts");
    expect(runCenterModule).toContain("function scrubTaskRuntimeMetaText");
    expect(appSource).toContain('label: "Angel 回复"');
    const runCenterRowSource = extractFunctionSource(runCenterModule, "createRunCenterTaskRow");
    expect(runCenterRowSource).toContain("formatTaskRuntimeUserFacingLabel(task)");
    expect(runCenterRowSource).toContain("formatTaskRuntimeUserFacingMetaParts(task)");
    expect(runCenterRowSource).not.toContain("task.label");
    expect(runCenterRowSource).not.toContain("task.provider");
    expect(runCenterRowSource).not.toContain("task.model");
    expect(extractFunctionSource(appSource, "findActiveComposerTask")).toContain(
      "state.taskRuntime.optimisticTasks.get",
    );
    expect(appSource).toContain('"needs_attention"');
    expect(appSource).toContain(
      'new Set(["failed", "interrupted", "cancelled", "needs_attention"])',
    );
    expect(handlerSource).toContain("createDesktopConversationTaskStore");
    expect(handlerSource).toContain("startDesktopConversationTask");
    expect(handlerSource).toContain("completeDesktopConversationTask");
    expect(handlerSource).toContain("projectConversationRuntimeClientReply");
    expect(handlerSource).toContain('surface: "desktop.rich"');
    expect(handlerSource).toContain("projectedRuntimeReply.mainText");
    expect(handlerSource).toContain("failDesktopConversationTask");
    expect(handlerSource).toContain("cancelDesktopConversationTaskByAction");
    expect(handlerSource).toContain("conversationTaskStore");
    expect(handlerSource).toContain('category: "conversation-runtime"');
    expect(handlerSource).toContain('status === "needs_attention"');
    expect(handlerSource).toContain("listDesktopConversationTaskRecords");
    expect(handlerSource).toContain("readDesktopConversationTaskRecord");
    expect(handlerSource).toContain("conversationTaskCancel");
    expect(handlerSource).toContain("taskRuntimeCancel");
  });

  it("keeps workbench middle cards catalog-bound instead of static prompt cards", async () => {
    const workflowSource = await readWorkflowSource();
    const promptSurfaces = collectPropertySurfaces(workflowSource, "prompt");
    const cardBindings = collectCardBindings(workflowSource);

    expect(promptSurfaces).toEqual([]);
    expect(cardBindings.filter((card) => card.workflowId === "workbench")).toEqual([]);
  });

  it("keeps non-workbench static cards bound to catalog commands", async () => {
    const workflowSource = await readWorkflowSource();
    const cardBindings = collectCardBindings(workflowSource);
    const unboundCards = cardBindings.filter(
      (card) => card.workflowId !== "workbench" && card.commandId === null,
    );

    expect(unboundCards).toEqual([]);
  });

  it("keeps every non-workbench command card owned by its visible surface", async () => {
    const workflowSource = await readWorkflowSource();
    const cardBindings = collectCardBindings(workflowSource);
    const workflowCommandIds = collectWorkflowCommandIds(workflowSource);
    const orphanedCards = cardBindings.filter(
      (card) =>
        card.workflowId !== "workbench" &&
        !workflowCommandIds.get(card.workflowId)?.includes(card.commandId),
    );

    expect(orphanedCards).toEqual([]);
  });

  it("references only command ids that exist in the desktop catalog", async () => {
    const workflowSource = await readWorkflowSource();
    const catalogIds = new Set(
      listDirectorDesktopCommandCatalog().flatMap((group) =>
        group.commands.map((command) => command.id),
      ),
    );
    const referencedIds = new Set(
      [...workflowSource.matchAll(/"([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.-]+)"/gu)].map(
        (match) => match[1],
      ),
    );
    const missingIds = [...referencedIds].filter((id) => !catalogIds.has(id));

    expect(missingIds).toEqual([]);
  });

  it("renders settings as a navigation-preserving page instead of an inspector drilldown", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("const SETTINGS_TABS");
    expect(source).toContain("renderSettingsSurface()");
    expect(source).toContain('if (group?.id === "settings")');
    expect(source).toContain('elements.commandList.className = "settings-page"');
    expect(source).toContain("renderSettingsApiTab");
    expect(source).toContain("renderSettingsGuardrailsTab");
    expect(source).toContain("renderSettingsCommunicationTab");
    expect(source).toContain("createWeixinLoginPanel");
    expect(source).toContain("startWeixinGatewayLogin");
    expect(source).toContain("pollWeixinGatewayLogin");
    expect(source).toContain("提交验证码");
    expect(source).toContain("renderSettingsSwitchesTab");
    expect(styles).toContain(".desktop-shell.settings-mode");
    expect(styles).toContain("grid-template-columns: 288px minmax(0, 1fr);");
    expect(styles).toContain(".desktop-shell.settings-mode .inspector");
    expect(styles).toContain("display: none;");
    expect(styles).not.toContain(".desktop-shell.settings-mode .sidebar");
    expect(styles).toContain(".settings-page");
    expect(styles).toContain(".settings-tabs");
    expect(source).not.toContain("createSettingsParameterDetail");
    expect(source).not.toContain("renderSettingsEditor");
  });

  it("renders reflection results as a Chinese operator report instead of raw internal field labels", async () => {
    const source = await readAppSource();

    const reflectionResult = extractFunctionSource(source, "renderReflectionResult");

    expect(reflectionResult).toContain("复盘结论");
    expect(reflectionResult).toContain("建议沉淀");
    expect(reflectionResult).toContain("已写入经验候选");
    expect(reflectionResult).toContain("可复用经验");
    expect(reflectionResult).toContain("失败教训");
    expect(reflectionResult).toContain("下一步");
    expect(reflectionResult).toContain("formatReflectionOutcome");
    expect(reflectionResult).toContain("formatReflectionIntent");
    expect(reflectionResult).toContain("formatReflectionWriteStatus");
    expect(reflectionResult).not.toContain("Reflection:");
    expect(reflectionResult).not.toContain("Outcome:");
    expect(reflectionResult).not.toContain("What worked:");
    expect(reflectionResult).not.toContain("Failure lessons:");
  });

  it("renders production run results as final workbench output instead of raw backend labels", async () => {
    const source = await readAppSource();

    const productionResult = extractFunctionSource(source, "renderProductionRunResult");
    const productionReply = extractFunctionSource(source, "createProductionWorkbenchReply");

    expect(productionResult).toContain(
      'setResultOutput(productionRun.workbenchOutput || "没有可显示的制作结果。")',
    );
    expect(productionResult).toContain('title: productionRun.ok ? "制作结果" : "制作未完成"');
    expect(productionResult).toContain("createProductionWorkbenchReply(productionRun)");
    expect(productionResult).toContain("attachProductionRunTimelineActions");
    expect(productionReply).toContain("productionRun.workbenchOutput");
    expect(productionReply).toContain("没有可显示的制作结果。");
    expect(productionResult).not.toContain("蓝图：");
    expect(productionResult).not.toContain("Run：");
    expect(productionResult).not.toContain("系统审查状态");
    expect(productionResult).not.toContain("阶段流");
    expect(productionResult).not.toContain("下一步");
    expect(productionResult).not.toContain("formatProductionReviewDecision");
    expect(productionResult).not.toContain("formatProductionRecallStatus");
    expect(productionResult).not.toContain("formatProductionAssignmentCounts");
    expect(productionResult).not.toContain("Blueprint:");
    expect(productionResult).not.toContain("Run status:");
    expect(productionResult).not.toContain("Report:");
    expect(productionResult).not.toContain("Assignment:");
    expect(productionResult).not.toContain("Review:");
    expect(productionResult).not.toContain("Knowledge recall:");
    expect(productionResult).not.toContain("Skills:");
    expect(productionResult).not.toContain("Knowledge packs:");
    expect(productionResult).not.toContain("Report summary:");
    expect(productionResult).not.toContain("Stage timeline:");
    expect(productionResult).not.toContain("Next:");
  });

  it("renders API provider settings as direct backend-bound save controls", async () => {
    const source = await readAppSource();
    const html = await readIndexSource();
    const styles = await readStylesSource();

    expect(source).toContain("renderSettingsApiTab");
    expect(source).toContain("createProviderSelectRow");
    expect(source).toContain("createApiKeyRow");
    expect(source).toContain("normalizeApiKeyList");
    expect(source).toContain("createTextareaRow");
    expect(source).toContain("createDefaultModelRow");
    expect(source).toContain("createBrandedModelSelect");
    expect(source).toContain("createSelectedModelPreview");
    expect(source).toContain("resolveModelBrandMetadata");
    expect(source).toContain("createModelBrandLogo");
    expect(source).toContain("createEndpointTable");
    expect(source).toContain("saveApiProviderSettings");
    expect(source).toContain("testApiProviderSettings");
    expect(source).toContain("DESKTOP_ACTIONS.API_PROVIDER_SET");
    expect(source).toContain("DESKTOP_ACTIONS.API_PROVIDER_TEST");
    expect(source).toContain("renderApiProviderImageResult");
    expect(source).toContain("renderApiProviderVideoResult");
    expect(source).toContain("submitImageComposer");
    expect(source).toContain("submitVideoComposer");
    expect(source).toContain("runImage");
    expect(source).toContain("runVideo");
    expect(html).toContain('id="run-image"');
    expect(html).toContain('id="run-video"');
    expect(source).toContain("测试 Key");
    expect(source).toContain("apiProviderTest");
    expect(source).toContain("apiProviderImage");
    expect(source).toContain("apiProviderVideo");
    expect(source).toContain('document.createElement("textarea")');
    expect(source).toContain('textarea.addEventListener("paste"');
    expect(source).toContain('join("\\n")');
    expect(source).toContain("已配置；粘贴新 Key 会替换，留空不改");
    expect(source).toContain("defaultVisionModel");
    expect(source).toContain("models");
    expect(styles).toContain(".settings-model-select-wrap");
    expect(styles).toContain(".settings-model-brand-mark");
    expect(styles).toContain(".settings-model-brand-mark svg");
    expect(source).not.toContain("brandName");
    expect(source).not.toContain("createApiProviderSettingsCard");
  });

  it("renders ComfyUI external tool settings and results through real desktop actions", async () => {
    const source = await readAppSource();

    expect(source).toContain("renderSettingsExternalToolsTab");
    expect(source).toContain("createComfyUiSettingsForm");
    expect(source).toContain("saveComfyUiSettings");
    expect(source).toContain("testComfyUiSettings");
    expect(source).toContain("renderComfyUiRunResult");
    expect(source).toContain("DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE");
    expect(source).toContain("DESKTOP_ACTIONS.COMFYUI_TEST");
    expect(source).toContain("DESKTOP_ACTIONS.COMFYUI_RUN");
    expect(source).toContain("ComfyUI Workflow 文件");
    expect(source).toContain("未配置 workflow 时不会伪造生成结果");
  });

  it("renders MCP management beside external tools with backend-bound controls", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createMcpSettingsPanel");
    expect(source).toContain("createMcpServerList");
    expect(source).toContain("createMcpServerEditor");
    expect(source).toContain("saveMcpServerSettings");
    expect(source).toContain("testMcpServerSettings");
    expect(source).toContain("deleteMcpServerSettings");
    expect(source).toContain("loginMcpServerSettings");
    expect(source).toContain("revokeMcpServerSettings");
    expect(source).toContain("refreshMcpSettings");
    expect(source).toContain("DESKTOP_ACTIONS.MCP_SERVER_UPSERT");
    expect(source).toContain("DESKTOP_ACTIONS.MCP_SERVER_TOOL_SELECTION_SET");
    expect(source).toContain("DESKTOP_ACTIONS.MCP_SERVER_TEST");
    expect(source).toContain("DESKTOP_ACTIONS.MCP_SERVER_DELETE");
    expect(source).toContain("DESKTOP_ACTIONS.MCP_REFRESH");
    expect(source).toContain("DESKTOP_ACTIONS.MCP_LOGIN");
    expect(source).toContain("DESKTOP_ACTIONS.MCP_REVOKE");
    expect(source).toContain("needs-auth");
    expect(styles).toContain(".settings-mcp-layout");
    expect(styles).toContain(".settings-mcp-server-row");
    expect(styles).toContain(".settings-mcp-tool-select");
  });

  it("renders external tool provider setup guidance without exposing secret values", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    const guidancePanel = extractFunctionSource(source, "createExternalToolSetupGuidancePanel");
    const guidanceResolver = extractFunctionSource(source, "resolveExternalToolSetupGuidance");
    const guidanceAction = extractFunctionSource(source, "runExternalToolSetupGuidanceAction");

    expect(source).toContain("createExternalToolSetupGuidancePanel(externalToolBus, settings)");
    expect(source).toContain("createExternalToolSetupGuidanceItem");
    expect(guidanceAction).toContain("provider.setup.needs-auth");
    expect(guidanceAction).toContain("provider.setup.install");
    expect(guidanceAction).toContain("provider.setup.reconnect");
    expect(guidanceAction).toContain("provider.setup.last-known-good");
    expect(guidancePanel).toContain("SecretRef/Keychain 只显示引用状态");
    expect(guidanceResolver).toContain("formatExternalProviderSecretSource(provider)");
    expect(guidanceAction).toContain("DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE");
    expect(guidanceAction).toContain('operation: "install"');
    expect(guidanceAction).toContain('operation: "enable"');
    expect(source).toContain("settings-provider-secret-boundary");
    expect(source).not.toContain("configuredSecretValue");
    expect(source).not.toContain("secretValue");
    expect(styles).toContain(".settings-provider-setup-guidance");
    expect(styles).toContain(".settings-provider-setup-guidance-grid");
    expect(styles).toContain('.settings-provider-setup-guidance-item[data-state="needs-auth"]');
    expect(styles).toContain(".settings-provider-secret-boundary");
  });

  it("keeps desktop plugin lifecycle generic and contract-bound", async () => {
    const handlers = await readDesktopSystemHandlersSource();
    const manageBranch = extractFunctionSource(handlers, "manageDesktopPluginExternalTool");
    const registryProjection = extractFunctionSource(
      handlers,
      "registerDesktopPluginExternalToolSources",
    );
    const settingsNormalizer = extractFunctionSource(
      handlers,
      "normalizeDesktopPluginManageSettings",
    );

    expect(handlers).toContain('toolId.startsWith("plugin:")');
    expect(handlers).toContain("manageDesktopPluginExternalTool({");
    expect(handlers).toContain("registerDesktopPluginExternalToolSources(registry, workspace)");
    expect(handlers).toContain('schemaVersion: "director.external-tools.plugins.v1"');
    expect(manageBranch).toContain('toolId.slice("plugin:".length)');
    expect(manageBranch).toContain('manifestPath === undefined');
    expect(manageBranch).toContain('status: "manifest-required"');
    expect(manageBranch).toContain("loadDesktopPluginManifest(manifestPath)");
    expect(manageBranch).toContain("settings.version ?? previous?.version ?? manifestDocument?.version");
    expect(manageBranch).toContain('operation === "delete"');
    expect(registryProjection).toContain("createConversationRuntimePluginContractPlan(manifest)");
    expect(registryProjection).toContain('plan.status !== "admissible"');
    expect(registryProjection).toContain("plan.externalToolManifests");
    expect(registryProjection).toContain("desktopPluginLifecycle: true");
    expect(registryProjection).toContain("directStoreAccessAllowed: false");
    expect(settingsNormalizer).toContain("settings.manifestPath.trim()");
    expect(settingsNormalizer).toContain("settings.version.trim()");
    expect(manageBranch).not.toContain("tool-filesystem-read");
    expect(registryProjection).not.toContain("tool-filesystem-read");
  });

  it("routes desktop working memory recall through the provider contract registry", async () => {
    const handlers = await readDesktopSystemHandlersSource();
    const memoryRetrievalProvider = await readConversationRuntimeMemoryRetrievalProviderSource();
    const workingMemoryRecall = extractFunctionSource(handlers, "createDesktopWorkingMemoryRecall");
    const providerKindResolver = extractFunctionSource(
      handlers,
      "resolveDesktopWorkingMemoryProviderKind",
    );

    expect(handlers).toContain("createConversationRuntimeMemoryRetrievalProviderRegistry");
    expect(workingMemoryRecall).toContain("createConversationRuntimeMemoryRetrievalProviderRegistry()");
    expect(workingMemoryRecall).toContain('id: "desktop-working-memory"');
    expect(workingMemoryRecall).toContain("registry.recall({");
    expect(workingMemoryRecall).not.toContain("return createDefaultRuntimeMemory");
    expect(memoryRetrievalProvider).toContain(
      "directStoreAccessAllowed: entry.plan.directStoreAccessAllowed",
    );
    expect(providerKindResolver).toContain("mempalace");
    expect(providerKindResolver).not.toContain("src/stores/");
  });

  it("renders API provider results with Chinese operator labels instead of raw debug labels", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    const apiRunResult = extractFunctionSource(source, "renderApiProviderRunResult");
    const apiRunEndpoint = extractFunctionSource(source, "formatApiProviderRunEndpoint");
    const apiRunLatency = extractFunctionSource(source, "formatApiProviderRunLatency");
    const apiImageResult = extractFunctionSource(source, "renderApiProviderImageResult");
    const apiTestResult = extractFunctionSource(source, "testApiProviderSettings");

    for (const resultRenderer of [apiRunEndpoint, apiImageResult, apiTestResult]) {
      expect(resultRenderer).toContain("接口");
      expect(resultRenderer).not.toContain("Endpoint:");
    }
    expect(apiRunEndpoint).toContain("接口");
    expect(apiRunLatency).toContain("耗时");
    expect(apiRunResult).toContain("Angel 已回复");
    expect(apiRunResult).not.toContain("runResult.providerId");
    expect(apiRunResult).not.toContain("runResult.model");
    expect(apiRunResult).toContain("formatApiProviderRunEndpoint");
    expect(apiRunResult).toContain("formatApiProviderRunLatency");
    expect(apiRunResult).toContain("formatApiProviderRunFailureDetails");
    expect(source).toContain("这次失败没有拿到有效接口或耗时记录");
    expect(apiRunResult).not.toContain("`接口：${runResult.endpoint}`");
    expect(apiRunResult).not.toContain("`耗时：${runResult.latencyMs}ms`");
    expect(apiRunResult).toContain("setResultOutputWithContext");
    expect(apiRunResult).toContain("createRuntimeApprovalNotice(runResult.runtimeEvents)");
    expect(source).toContain("createRuntimeApprovalNotice");
    expect(source).toContain("formatRuntimeApprovalSummary");
    expect(source).toContain("formatRuntimeApprovalMode");
    expect(source).toContain("formatRuntimeApprovalRisk");
    expect(source).toContain("createRuntimeApprovalMetaRow");
    expect(source).toContain("createRuntimeApprovalProcessLedger");
    expect(source).toContain("readRuntimeApprovalProcessCapabilityLedger");
    expect(source).toContain("formatRuntimeApprovalProcessLedgerEntry");
    expect(source).toContain("Agent OS 进程账本");
    expect(source).toContain("createRuntimeApprovalActions");
    expect(source).toContain("DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE");
    expect(source).toContain('notice.className = "runtime-approval-notice"');
    expect(source).toContain('meta.className = "runtime-approval-meta"');
    expect(source).toContain('details.className = "runtime-approval-process-ledger"');
    expect(source).toContain("等待确认，不会自动执行。");
    expect(source).toContain("可以到设置 · 护栏预算切换工具确认模式。");
    expect(source).toContain("runtime.approval");
    expect(source).toContain("需要你确认");
    expect(source).toContain("pendingLearningConfirmations");
    expect(source).toContain("assets.learning?.pendingConfirmationCount");
    expect(source).toContain("待确认经验");
    expect(source).toContain("backgroundLearningList");
    expect(source).toContain("renderBackgroundLearningList");
    expect(source).toContain("createBackgroundLearningCard");
    expect(source).toContain("rememberBackgroundLearningRuntimeEvent");
    expect(source).toContain("createBackgroundLearningItemFromRuntimeEvent");
    expect(source).toContain("后台学习队列");
    expect(source).toContain("createBackgroundLearningStatusRows");
    expect(source).toContain("formatBackgroundLearningTrigger");
    expect(source).toContain("后台学习");
    expect(source).toContain("只生成候选");
    expect(source).toContain("定时触发");
    expect(source).toContain("createAngelRoleStatusRows");
    expect(source).toContain("formatAngelRoleSourceLabel");
    expect(source).toContain("岗位配置");
    expect(source).toContain("当前岗位");
    expect(styles).toContain(".background-learning-card");
    expect(styles).toContain(".background-learning-meta");
    expect(source).toContain("createContextualRecallDisclosure");
    expect(source).toContain("formatContextualRecallHitLines");
    expect(source).toContain("formatContextualRecallMemoryLines");
    expect(source).toContain('details.className = "result-context-disclosure"');
    expect(source).toContain('summary.textContent = contextualRecall.visibleSummary || "查看参考来源"');
    expect(source).toContain("createEvidenceDisclosureDetails");
    const evidenceModule = await readFile(new URL("./ui/evidence.js", import.meta.url), "utf8");
    expect(evidenceModule).toContain("formatEvidenceDisclosureLines");
    expect(source).toContain("runResult.evidenceDisclosure");
    expect(source).toContain("resolveTaskRuntimeEvidenceDisclosure");
    expect(extractFunctionSource(source, "createConversationRuntimeTaskTimelineMessage")).toContain(
      "evidenceDisclosure: resolveTaskRuntimeEvidenceDisclosure(task)",
    );
    expect(extractFunctionSource(source, "readTaskRuntimeTask")).toContain(
      "setResultOutputWithContext",
    );
    expect(extractFunctionSource(source, "readTaskRuntimeTask")).toContain(
      "evidenceDisclosure: resolveTaskRuntimeEvidenceDisclosure(task)",
    );
    expect(evidenceModule).toContain("source?.mediaAdmission");
    expect(evidenceModule).toContain('details.className = "result-evidence-disclosure"');
    expect(evidenceModule).toContain('summary.textContent = "查看读取证据"');
    expect(extractFunctionSource(source, "appendTimelineMessage")).toContain(
      "createEvidenceDisclosureDetails(message.evidenceDisclosure,",
    );
    expect(extractFunctionSource(source, "appendTimelineMessage")).toContain(
      "onAuthorizeMedia: executeMediaAuthorization",
    );
    expect(source).toContain('handle.bubble.querySelector(".result-evidence-disclosure")?.remove();');
    expect(styles).toContain(".result-context-disclosure");
    expect(styles).toContain(".result-evidence-disclosure");
    expect(styles).toContain(".runtime-approval-notice");
    expect(styles).toContain(".runtime-approval-process-ledger");
    expect(apiRunResult).not.toContain("Latency:");
    expect(apiImageResult).toContain("耗时");
    expect(apiImageResult).toContain("修订提示词");
    expect(apiImageResult).not.toContain("Latency:");
    expect(apiImageResult).not.toContain("Revised prompt:");
  });

  it("collects desktop evidence disclosure from runtime web extraction events", async () => {
    const handlers = await readDesktopSystemHandlersSource();

    expect(handlers).toContain("createDesktopEvidenceDisclosure");
    expect(handlers).toContain("collectDesktopEvidenceDisclosureSources");
    expect(handlers).toContain("readDesktopRuntimeToolOutput");
    expect(handlers).toContain('event.payload?.tool?.name === "web_extract_artifact_read"');
    expect(handlers).toContain("secondPassExtracted");
    expect(handlers).toContain("mediaInventory");
    expect(handlers).toContain("mediaAuthorization");
    expect(handlers).toContain("mediaUnderstandingWorkflow?.authorization?.request");
    expect(handlers).toContain("media_understanding_workflow");
    expect(handlers).toContain("mediaAdmission");
    expect(handlers).toContain("evidence_provenance");
    expect(handlers).toContain("evidenceProvenance");
    expect(handlers).toContain("persisted");
    expect(handlers).toContain("evidenceDisclosure");
  });

  it("persists desktop conversation tool evidence through the file-backed ledger", async () => {
    const handlers = await readDesktopSystemHandlersSource();

    expect(handlers).toContain("createFileConversationRuntimeToolEvidenceStore");
    expect(handlers).toContain("resolveDesktopToolEvidenceStorePath");
    expect(handlers).toContain('join(dataDir, "conversation-runtime", "tool-evidence")');
    expect(handlers).toContain("toolEvidenceStore: desktopToolEvidenceStore");
    expect(handlers).toContain("toolEvidenceStore,");
  });

  it("shows Weixin remote runtime tool approvals on the communication settings page", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain('createMetricBlock("远端工具确认"');
    expect(source).toContain('createMetricBlock("通道契约"');
    expect(source).toContain("createWeixinChannelContractPanel(gateway.channelContract)");
    expect(source).toContain("createWeixinRuntimeApprovalPanel(gateway.runtimeToolApprovals)");
    expect(source).toContain("settings-weixin-channel-contract");
    expect(source).toContain("settings-weixin-runtime-approval");
    expect(styles).toContain(".settings-weixin-channel-contract");
    expect(styles).toContain(".settings-weixin-runtime-approval");
  });

  it("renders Agent OS release gate matrix and live-only checklist in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseGateOpsPanel");
    expect(source).toContain("formatAgentOsReleaseGateSkipReason");
    expect(source).toContain("Agent OS 发布门禁");
    expect(source).toContain("CI-safe");
    expect(source).toContain("smoke");
    expect(source).toContain("synthetic");
    expect(source).toContain("real-provider");
    expect(source).toContain("real-data");
    expect(source).toContain("missing-auth");
    expect(source).toContain("missing-local-service");
    expect(source).toContain("provider-disabled");
    expect(source).toContain("unsafe-environment");
    expect(styles).toContain(".agent-os-release-gate-panel");
    expect(styles).toContain(".agent-os-release-gate-tier");
    expect(styles).toContain(".agent-os-release-gate-checklist");
  });

  it("renders Agent OS release smoke readiness plans in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeReadinessOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeReadinessRequirement");
    expect(source).toContain("Agent OS 发布 smoke 预检");
    expect(source).toContain("readiness plans");
    expect(source).toContain("canExecuteLiveCheck=false");
    expect(source).toContain("operator action");
    expect(source).toContain("missing-local-service");
    expect(source).toContain("missing-auth");
    expect(source).toContain("provider-disabled");
    expect(source).toContain("unsafe-environment");
    expect(styles).toContain(".agent-os-release-smoke-readiness-panel");
    expect(styles).toContain(".agent-os-release-smoke-readiness-plan");
    expect(styles).toContain(".agent-os-release-smoke-readiness-requirements");
  });

  it("renders Agent OS release smoke admission verdicts in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeAdmissionOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeAdmissionSignal");
    expect(source).toContain("Agent OS 发布 smoke 准入");
    expect(source).toContain("admission verdicts");
    expect(source).toContain("admitted=false");
    expect(source).toContain("runnerIntentCreated=false");
    expect(source).toContain("operator scope");
    expect(source).toContain("environment isolation");
    expect(source).toContain("audit evidence");
    expect(styles).toContain(".agent-os-release-smoke-admission-panel");
    expect(styles).toContain(".agent-os-release-smoke-admission-verdict");
    expect(styles).toContain(".agent-os-release-smoke-admission-signals");
  });

  it("renders Agent OS release smoke execution preflight packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeExecutionPreflightOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeExecutionEvidence");
    expect(source).toContain("Agent OS 发布 smoke 执行预检");
    expect(source).toContain("execution preflight packets");
    expect(source).toContain("executionIntentCreated=false");
    expect(source).toContain("liveRunnerStarted=false");
    expect(source).toContain("audit artifact");
    expect(source).toContain("operator scope evidence");
    expect(styles).toContain(".agent-os-release-smoke-execution-preflight-panel");
    expect(styles).toContain(".agent-os-release-smoke-execution-preflight-packet");
    expect(styles).toContain(".agent-os-release-smoke-execution-preflight-evidence");
  });

  it("renders Agent OS release smoke evidence intake packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeEvidenceIntakeOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeEvidenceIntakeItem");
    expect(source).toContain("Agent OS 发布 smoke 证据录入");
    expect(source).toContain("evidence intake packets");
    expect(source).toContain("remoteIntakeAllowed=false");
    expect(source).toContain("runnerIntentUnlocked=false");
    expect(source).toContain("evidence manifest");
    expect(source).toContain("local operator evidence");
    expect(styles).toContain(".agent-os-release-smoke-evidence-intake-panel");
    expect(styles).toContain(".agent-os-release-smoke-evidence-intake-packet");
    expect(styles).toContain(".agent-os-release-smoke-evidence-intake-missing");
  });

  it("renders Agent OS release smoke evidence manifest preflight packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeEvidenceManifestPreflightOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeEvidenceManifestField");
    expect(source).toContain("Agent OS 发布 smoke 证据清单预检");
    expect(source).toContain("manifest preflight packets");
    expect(source).toContain("manifestSchemaValid=false");
    expect(source).toContain("manifestContentRead=false");
    expect(source).toContain("schema required fields");
    expect(source).toContain("evidence manifest schema");
    expect(styles).toContain(".agent-os-release-smoke-evidence-manifest-preflight-panel");
    expect(styles).toContain(".agent-os-release-smoke-evidence-manifest-preflight-packet");
    expect(styles).toContain(".agent-os-release-smoke-evidence-manifest-preflight-fields");
  });

  it("renders Agent OS release smoke evidence manifest validation packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeEvidenceManifestValidationOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeEvidenceManifestValidationIssue");
    expect(source).toContain("Agent OS 发布 smoke 清单校验");
    expect(source).toContain("manifest validation packets");
    expect(source).toContain("manifestValidated=false");
    expect(source).toContain("manifestReadAllowed=false");
    expect(source).toContain("auditArtifactReady=false");
    expect(source).toContain("validation issues");
    expect(styles).toContain(".agent-os-release-smoke-evidence-manifest-validation-panel");
    expect(styles).toContain(".agent-os-release-smoke-evidence-manifest-validation-packet");
    expect(styles).toContain(".agent-os-release-smoke-evidence-manifest-validation-issues");
  });

  it("renders Agent OS release smoke evidence manifest path authorization packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeEvidenceManifestPathAuthorizationOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeEvidenceManifestPathAuthorizationIssue");
    expect(source).toContain("Agent OS 发布 smoke 清单路径授权");
    expect(source).toContain("manifest path authorization packets");
    expect(source).toContain("manifestPathAuthorized=false");
    expect(source).toContain("manifestPathReadAllowed=false");
    expect(source).toContain("remotePathRejected=true");
    expect(source).toContain("path authorization issues");
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-path-authorization-panel",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-path-authorization-packet",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-path-authorization-issues",
    );
  });

  it("renders Agent OS release smoke evidence manifest schema validator readiness packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain(
      "createAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessOpsPanel",
    );
    expect(source).toContain(
      "formatAgentOsReleaseSmokeEvidenceManifestSchemaValidatorReadinessIssue",
    );
    expect(source).toContain("Agent OS 发布 smoke 清单 schema 校验器");
    expect(source).toContain("schema validator readiness packets");
    expect(source).toContain("local schema contract");
    expect(source).toContain("schemaValidatorReady=false");
    expect(source).toContain("schemaDefinitionLoaded=false");
    expect(source).toContain("manifestReadAllowed=false");
    expect(source).toContain("schema validator issues");
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-panel",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-packet",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-schema-validator-readiness-issues",
    );
  });

  it("renders Agent OS release smoke evidence manifest schema definition binding packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain(
      "createAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingOpsPanel",
    );
    expect(source).toContain(
      "formatAgentOsReleaseSmokeEvidenceManifestSchemaDefinitionBindingIssue",
    );
    expect(source).toContain("Agent OS 发布 smoke 清单 schema 定义绑定");
    expect(source).toContain("schema definition binding packets");
    expect(source).toContain("embedded schema definition ref");
    expect(source).toContain("schemaDefinitionBound=false");
    expect(source).toContain("schemaDefinitionBindingReady=false");
    expect(source).toContain("manifestReadAllowed=false");
    expect(source).toContain("schema definition binding issues");
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-panel",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-packet",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-schema-definition-binding-issues",
    );
  });

  it("renders Agent OS release smoke evidence manifest read authorization packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain(
      "createAgentOsReleaseSmokeEvidenceManifestReadAuthorizationOpsPanel",
    );
    expect(source).toContain(
      "formatAgentOsReleaseSmokeEvidenceManifestReadAuthorizationIssue",
    );
    expect(source).toContain("Agent OS 发布 smoke 清单读取授权");
    expect(source).toContain("manifest read authorization packets");
    expect(source).toContain("local manifest read authorization");
    expect(source).toContain("manifestReadAuthorized=false");
    expect(source).toContain("manifestReadAuthorizationReady=false");
    expect(source).toContain("manifestContentRead=false");
    expect(source).toContain("manifest read authorization issues");
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-read-authorization-panel",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-read-authorization-packet",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-read-authorization-issues",
    );
  });

  it("renders Agent OS release smoke evidence manifest audit artifact readiness packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain(
      "createAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessOpsPanel",
    );
    expect(source).toContain(
      "formatAgentOsReleaseSmokeEvidenceManifestAuditArtifactReadinessIssue",
    );
    expect(source).toContain("Agent OS 发布 smoke 审计 artifact readiness");
    expect(source).toContain("audit artifact readiness packets");
    expect(source).toContain("local audit artifact contract");
    expect(source).toContain("auditArtifactReady=false");
    expect(source).toContain("auditArtifactReadinessReady=false");
    expect(source).toContain("manifestContentRead=false");
    expect(source).toContain("audit artifact readiness issues");
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-panel",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-packet",
    );
    expect(styles).toContain(
      ".agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-issues",
    );
  });

  it("renders Agent OS release smoke runner intent signing/revocation packets in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsReleaseSmokeRunnerIntentSigningRevocationOpsPanel");
    expect(source).toContain("formatAgentOsReleaseSmokeRunnerIntentSigningRevocationIssue");
    expect(source).toContain("Agent OS 发布 smoke runner intent 签发/撤销");
    expect(source).toContain("runner intent signing/revocation packets");
    expect(source).toContain("fail-closed runner intent signing/revocation");
    expect(source).toContain("runnerIntentSigned=false");
    expect(source).toContain("runnerIntentSignatureReady=false");
    expect(source).toContain("runnerIntentTokenIssued=false");
    expect(source).toContain("runner intent signing/revocation issues");
    expect(styles).toContain(".agent-os-release-smoke-runner-intent-signing-revocation-panel");
    expect(styles).toContain(".agent-os-release-smoke-runner-intent-signing-revocation-packet");
    expect(styles).toContain(".agent-os-release-smoke-runner-intent-signing-revocation-issues");
  });

  it("renders Agent OS memory eval status and diagnostic evidence in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsMemoryEvalOpsPanel");
    expect(source).toContain("formatAgentOsMemoryEvalMetric");
    expect(source).toContain("createAgentOsMemoryEvalDiagnosticList");
    expect(source).toContain("Agent OS 记忆评估");
    expect(source).toContain("local-only fixture");
    expect(source).toContain("recall@k");
    expect(source).toContain("NDCG@k");
    expect(source).toContain("verbatim");
    expect(source).toContain("provenance");
    expect(source).toContain("diagnostic");
    expect(styles).toContain(".agent-os-memory-eval-panel");
    expect(styles).toContain(".agent-os-memory-eval-metrics");
    expect(styles).toContain(".agent-os-memory-eval-diagnostics");
  });

  it("renders Agent OS memory sweep safety preflight in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsMemorySweepSafetyOpsPanel");
    expect(source).toContain("formatAgentOsMemorySweepSafetyReason");
    expect(source).toContain("Agent OS 记忆评测安全预检");
    expect(source).toContain("live-user-memory");
    expect(source).toContain("blocked reasons");
    expect(source).toContain("operator approval");
    expect(source).toContain("anonymization");
    expect(source).toContain("retention");
    expect(source).toContain("dry-run");
    expect(source).toContain("read-only");
    expect(source).toContain("network disabled");
    expect(styles).toContain(".agent-os-memory-sweep-safety-panel");
    expect(styles).toContain(".agent-os-memory-sweep-safety-reasons");
    expect(styles).toContain(".agent-os-memory-sweep-safety-checklist");
  });

  it("renders Agent OS memory eval dashboard maintenance actions in review ops", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    expect(source).toContain("createAgentOsMemoryEvalDashboardOpsPanel");
    expect(source).toContain("createAgentOsMemoryEvalDashboardTrendList");
    expect(source).toContain("createAgentOsMemoryEvalMaintenanceDueList");
    expect(source).toContain("Agent OS 记忆评估 dashboard");
    expect(source).toContain("memoryEvalTrend");
    expect(source).toContain("maintenance-due actions");
    expect(source).toContain("recall degradation");
    expect(source).toContain("dataset loader gate");
    expect(source).toContain("local-only dashboard");
    expect(styles).toContain(".agent-os-memory-eval-dashboard-panel");
    expect(styles).toContain(".agent-os-memory-eval-dashboard-trend");
    expect(styles).toContain(".agent-os-memory-eval-dashboard-maintenance");
  });

  it("renders shared turn operator trace in a developer inspector panel", async () => {
    const source = await readAppSource();
    const html = await readIndexSource();
    const styles = await readStylesSource();

    expect(html).toContain('data-panel="developer"');
    expect(html).toContain("开发者");
    expect(source).toContain("renderOperatorTraceResult");
    expect(source).toContain("formatOperatorTraceSummaryLines");
    expect(source).toContain("formatOperatorTraceLines");
    expect(source).toContain("result.operatorTrace");
    expect(source).toContain("召回");
    expect(source).toContain("工具确认");
    expect(styles).toContain(".operator-trace-output");
  });

  it("renders command results with Chinese output labels instead of terminal stream names", async () => {
    const source = await readAppSource();

    const commandResult = extractFunctionSource(source, "renderCommandResult");

    expect(commandResult).toContain("输出");
    expect(commandResult).toContain("错误输出");
    expect(commandResult).not.toContain("stdout:");
    expect(commandResult).not.toContain("stderr:");
  });

  it("keeps writable switch settings on the settings page with direct backend saves", async () => {
    const source = await readAppSource();

    expect(source).toContain("saveSettingsSwitchRows");
    expect(source).toContain("DESKTOP_ACTIONS.SETTINGS_SET");
    expect(source).toContain("parameter.writable");
    expect(source).toContain('parameter.type === "boolean"');
    expect(source).toContain("features");
    expect(source).toContain("roles");
    expect(source).toContain("adapterOverrides");
    expect(source).not.toContain("settings-category:");
    expect(source).not.toContain("createSettingsParameterCards");
  });

  it("scopes settings save feedback to the active settings footer instead of duplicate document ids", async () => {
    const source = await readAppSource();

    const footer = extractFunctionSource(source, "createSettingsFooter");
    const setFeedback = extractFunctionSource(source, "setSettingsFeedback");

    expect(footer).toContain("feedback.dataset.settingsFeedback");
    expect(footer).not.toContain('feedback.id = "settings-feedback"');
    expect(setFeedback).toContain(
      'document.querySelector(".settings-page [data-settings-feedback]")',
    );
    expect(source).not.toContain('id = "settings-feedback"');
  });

  it("renders cost budget guardrails as direct backend-bound settings", async () => {
    const source = await readAppSource();

    expect(source).toContain('{ id: "guardrails", label: "护栏预算" }');
    expect(source).toContain("renderSettingsGuardrailsTab");
    expect(source).toContain("createCostBudgetForm");
    expect(source).toContain("readCostBudgetFormValue");
    expect(source).toContain("saveCostBudgetSettings");
    expect(source).toContain("DESKTOP_ACTIONS.COST_BUDGET_SET");
    expect(source).toContain('"cost-limit"');
    expect(source).toContain('"cost-spent"');
    expect(source).toContain('"cost-blocked"');
    expect(source).toContain("settings.costBudget");
    expect(source).toContain("guardrails.costBudgetStatus");
    expect(source).toContain("guardrails.highRiskAdapterActionCount");
    expect(source).toContain("guardrails.operatorApprovalAdapterActionCount");
    expect(source).toContain("guardrails.toolApprovalMode");
    expect(source).toContain('createMetricBlock("高风险动作"');
    expect(source).toContain('createMetricBlock("工具审批"');
    expect(source).toContain('createMetricBlock("工具确认"');
  });

  it("links guardrail diagnostics to the real desktop asset panels", async () => {
    const source = await readAppSource();

    expect(source).toContain("createGuardrailActionRow");
    expect(source).toContain('selectWorkflowPanel("skills")');
    expect(source).toContain('selectWorkflowPanel("tools")');
    expect(source).toContain('selectWorkflowPanel("review")');
    expect(source).toContain("打开 Skill 库");
    expect(source).toContain("打开外部工具");
    expect(source).toContain("处理运行审批");
  });

  it("keeps settings snapshot descriptions renderable without runtime reference errors", async () => {
    const source = await readAppSource();
    const html = await readIndexSource();

    expect(source).toContain("function formatSettingParameterDescription(parameter)");
    expect(source).toContain("formatSettingParameterDescription(item)");
    expect(source).toContain("resolveSettingParameterEffect(parameter)");
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toContain("unsafe-eval");
  });

  it("renders E/S/T/R as navigation-preserving asset pages without composer timeline or inspector", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();
    const workflows = await readWorkflowSource();

    expect(source).toContain('new Set(["experience", "skills", "tools", "review"])');
    expect(workflows).toContain('"experience.reject"');
    expect(source).toContain("renderAssetSurface(group)");
    expect(source).toContain("renderAssetDetailPage(detail");
    expect(source).toContain('elements.desktopShell.classList.toggle("asset-mode", assetMode)');
    expect(source).toContain("elements.timeline.hidden = !visible");
    expect(source).toContain("elements.composer.hidden = !visible");
    expect(styles).toContain(".desktop-shell.asset-mode");
    expect(styles).toContain(".desktop-shell.asset-mode .inspector");
    expect(styles).toMatch(
      /\.desktop-shell\.asset-mode\s*\{[\s\S]*?grid-template-columns:\s*288px minmax\(0,\s*1fr\);/u,
    );
    expect(styles).not.toContain(".desktop-shell.asset-mode .sidebar");
  });

  it("renders selected non-workbench asset details in the middle page with workbench handoff controls", async () => {
    const source = await readAppSource();

    expect(source).toContain("findAssetDetail(state.selectedAsset)");
    expect(source).toContain('detail.className = "asset-detail-page"');
    expect(source).toContain("detail.fields");
    expect(source).toContain("detail.actionPrompt");
    expect(source).toContain("detail.actionPrompts");
    expect(source).toContain("data-workbench-prompt");
    expect(source).toContain("createWorkbenchPromptButton");
    expect(source).toContain("openWorkbenchPrompt(prompt)");
    expect(source).not.toContain("renderAssetInspector(selectedAsset)");
  });

  it("keeps workbench slash commands collapsed behind the composer command menu", async () => {
    const html = await readIndexSource();
    const source = await readAppSource();
    const styles = await readStylesSource();

    const composerStart = html.indexOf('<section class="composer"');
    expect(composerStart).toBeGreaterThanOrEqual(0);
    const composerEnd = html.indexOf("</section>", composerStart);
    expect(composerEnd).toBeGreaterThan(composerStart);
    const composerHtml = html.slice(composerStart, composerEnd);
    expect(composerHtml).toContain('class="composer-chip" type="button" id="run-image">@生成图片');
    expect(composerHtml).toContain('class="composer-chip" type="button" id="run-video">@生成视频');
    expect(composerHtml).toContain('class="composer-command-menu" id="quick-actions"');
    expect(composerHtml).not.toContain('class="image-button"');
    expect(composerHtml.indexOf('id="run-image"')).toBeLessThan(
      composerHtml.indexOf('id="quick-actions"'),
    );
    expect(composerHtml.indexOf('id="run-video"')).toBeLessThan(
      composerHtml.indexOf('id="quick-actions"'),
    );

    expect(source).toContain("if (state.running || !isWorkbenchActive())");
    expect(source).toContain("if (!bridge || state.running || !isWorkbenchActive())");
    expect(source).toContain("type: DESKTOP_ACTIONS.COMPOSER_SUBMIT");
    expect(source).toContain('surface: "workbench"');
    expect(source).toContain("state.quickActionsOpen");
    expect(source).toContain('className = "slash-command-toggle"');
    expect(source).toContain('className = "slash-command-menu"');
    expect(source).toContain('className = "slash-command-icon"');
    expect(source).toContain('className = "slash-command-label"');
    expect(source).toContain('label.textContent = action.label.replace(/^\\/+/u, "")');
    expect(source).toContain('aria-expanded", String(state.quickActionsOpen)');
    expect(source).toContain('elements.quickActions?.classList.toggle("open", state.quickActionsOpen)');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain('elements.angelInput?.addEventListener("input"');
    expect(source).toContain("syncQuickActionsFromComposerInput()");
    expect(source).toContain("filterQuickActionsForComposerInput");
    expect(source).toContain("getQuickActionComposerQuery()");
    expect(source).toContain("action.label.toLowerCase()");
    expect(source).toContain("action.prompt.toLowerCase()");
    expect(styles).toContain(".slash-command-menu");
    expect(styles).toContain(".composer-chip");
    expect(styles).toContain(".composer-command-menu.open .slash-command-menu");
    expect(styles).not.toContain(".image-button");
    expect(styles).toContain("bottom: calc(100% + 12px);");
    expect(styles).toContain("right: 0;");
    expect(styles).toContain("background: rgba(232, 236, 241, 0.52);");
    expect(styles).not.toContain("background: rgba(23, 25, 28, 0.96);");
    expect(styles).not.toContain("background: rgba(255, 255, 255, 0.96);");
    expect(styles).toContain("backdrop-filter: blur(7px) saturate(1.04);");
    expect(styles).not.toContain("backdrop-filter: blur(18px) saturate(1.08);");
    expect(styles).toContain("box-shadow: 0 12px 32px rgba(37, 42, 48, 0.08);");
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain("scrollbar-width: none;");
    expect(styles).toContain("touch-action: pan-y;");
    expect(styles).toContain(".slash-command-item");
    expect(styles).toContain("grid-template-columns: 22px minmax(0, 1fr);");
    expect(styles).toContain("background: transparent;");
    expect(styles).toContain(".slash-command-item.active");
    expect(styles).toContain("width: 0;");
    expect(styles).toContain("height: 0;");
    expect(source).toContain("const SNAPSHOT_QUICK_ACTION_LIMITS");
    expect(source).toContain("function getBaseQuickActions()");
    expect(source).toContain("function buildSnapshotQuickActions(snapshot)");
    expect(source).toContain("buildExperienceQuickActions(snapshot?.candidate?.items ?? [])");
    expect(source).toContain("buildSkillQuickActions(snapshot?.assets?.skills)");
    expect(source).toContain("buildToolQuickActions(snapshot?.assets?.tools)");
    expect(source).toContain('prompt: `/经验 接受 ${candidate.id}`');
    expect(source).toContain('prompt: `/技能 从经验 ${candidate.id}`');
    expect(source).toContain('prompt: `/技能 ${skill.enabled === false ? "开启" : "关闭"} ${skill.id}`');
    expect(source).toContain('prompt: `/工具 说明 ${adapter.id}`');
    expect(source).toContain('{ label: "/制作", prompt: "/制作 " }');
    expect(source).toContain('{ label: "/灵魂", prompt: "/灵魂 " }');
    expect(source).toContain('{ label: "/心跳", prompt: "/心跳 状态" }');
    expect(source).toContain("/灵魂、/心跳、/图片");
    expect(source).not.toContain('className = "tool-chip"');
    expect(source).toContain('state.selectedGroupId = "workbench"');
    expect(source).toContain("setInputValue(prompt)");
    expect(source).toContain("elements.angelInput?.focus()");
    expect(source).toContain("createAssetDirectActionButton");
    expect(source).toContain("executeAssetAction(action");
    expect(source).toContain("DESKTOP_ACTIONS.EXPERIENCE_ACCEPT");
    expect(source).toContain("DESKTOP_ACTIONS.EXPERIENCE_REJECT");
    expect(source).toContain("DESKTOP_ACTIONS.EXPERIENCE_PROMOTE");
    expect(source).toContain("DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW");
    expect(source).toContain("async function renderBridgeResult(result, options = {})");
    expect(source).toContain("createApiProviderRunTimelineMessage(result.apiProviderRun)");
    expect(source).toContain("createApiProviderMediaTimelineMessage(result.apiProviderImage, \"图片\")");
    expect(source).toContain("createApiProviderMediaTimelineMessage(result.apiProviderVideo, \"视频\")");
    expect(source).toContain("await renderProductionRunResult(result.productionRun, options)");
    expect(source).toContain("installBridgeEventHandlers()");
    expect(source).toContain("handleNativeBridgeEvent(event)");
    expect(source).toContain("createUserFacingBridgeStreamMessage(event)");
    expect(source).toContain("formatUserFacingExternalToolProgress(toolId, status)");
    expect(source).toContain("正在读取网页正文");
    expect(source).toContain("正在打开并检查页面");
    expect(source).toContain("正在处理资料，稍等一下。");
    expect(source).toContain("appendTimelineMessageChunk(state.activeStreamHandle");
    expect(source).toContain("renderProductionTimelineProgress");
    expect(source).toContain("执行流 · ${stage.title}");
    expect(source).toContain("createProductionStageProgressMessage");
    expect(source).toContain(
      "const finalHandle = await completeTimelineMessageStreaming(options.timelineHandle, message)",
    );
    expect(source).toContain("renderProductionStageTimeline");
    expect(source).toContain("syncHeartbeatAutoScan(snapshot)");
    expect(source).toContain("window.setInterval(runHeartbeatAutoScan");
    expect(source).toContain("background: true");
    expect(source).toContain("resolveHeartbeatBackgroundAction(state.snapshot)");
    expect(source).toContain('"feature:selfReflection.enabled"');
    expect(source).toContain("DESKTOP_ACTIONS.SELF_REFLECTION_DAILY");
    expect(source).toContain("state.lastSelfReflectionDate !== date");
    expect(source).toContain("result.selfReflectionReport.window?.date ?? action.date");
    expect(source).toContain('"runtime:heartbeat.intervalMs"');
    expect(source).toContain("saveSettingsNumberRows");
    expect(source).toContain('selectAssetDetail("review", `run:${productionRun.runId}`)');
    expect(styles).toContain(".inspector-run-center");
  });

  it("keeps production progress in the pending workbench bubble instead of appending duplicate stage cards", async () => {
    const source = await readAppSource();

    const timelineProgress = extractFunctionSource(source, "renderProductionTimelineProgress");

    expect(timelineProgress).toContain("const visibleStages = []");
    expect(timelineProgress).toContain("updateTimelineMessage(handle");
    expect(timelineProgress).not.toContain("appendTimelineMessage(stageMessage)");
  });

  it("shows lightweight thinking motion while workbench replies are pending or streaming", async () => {
    const source = await readAppSource();
    const timelineModule = await readFile(new URL("./ui/timeline.js", import.meta.url), "utf8");
    const styles = await readStylesSource();

    const appendMessage = extractFunctionSource(source, "appendTimelineMessage");
    const updateMessage = extractFunctionSource(source, "updateTimelineMessage");
    const completeMessage = extractFunctionSource(source, "completeTimelineMessageStreaming");
    const appendChunk = extractFunctionSource(source, "appendTimelineMessageChunk");
    const renderBridgeResult = extractFunctionSource(source, "renderBridgeResult");
    const streamDelay = extractFunctionSource(timelineModule, "resolveTimelineStreamDelay");

    expect(appendMessage).toContain("createThinkingIndicator()");
    expect(appendMessage).toContain('bubble.append(title, body, createThinkingIndicator())');
    expect(updateMessage).toContain('handle.bubble.querySelector(".thinking-indicator")?.remove()');
    expect(completeMessage).toContain("hasLiveModelStream");
    expect(completeMessage).toContain("appendNonStreamingModelReplyTranscriptStep");
    expect(completeMessage).toContain("await streamTimelineMessageBody");
    expect(completeMessage).toContain("createEvidenceDisclosureDetails");
    expect(renderBridgeResult).toContain("await completeTimelineMessageStreaming");
    expect(renderBridgeResult).not.toContain("updateTimelineMessage(options.timelineHandle, createApiProviderRunTimelineMessage");
    expect(appendChunk).toContain('handle.bubble.querySelector(".thinking-indicator")?.remove()');
    expect(source).toContain("createTimelineTextChunks(value);");
    expect(streamDelay).toContain("return 18");
    expect(streamDelay).toContain("return 44");
    expect(source).toContain('from "./ui/timeline.js"');
    expect(timelineModule).toContain("export function createThinkingIndicator");
    expect(timelineModule).toContain('indicator.className = "thinking-indicator"');
    expect(timelineModule).toContain('dot.className = "thinking-dot"');
    expect(styles).toContain(".message.streaming .bubble");
    expect(styles).toContain("animation: transcript-active-breathe");
    expect(styles).toContain(".thinking-indicator");
    expect(styles).toContain(".thinking-dot");
    expect(styles).toContain("@keyframes thinking-dot-pulse");
    expect(styles).toContain("@keyframes message-enter");
  });

  it("renders Codex-style run transcript steps in the middle timeline", async () => {
    const source = await readAppSource();
    const handlers = await readDesktopSystemHandlersSource();
    const styles = await readStylesSource();

    const submitComposer = extractFunctionSource(source, "submitComposerToBridge");
    const handleBridgeEvent = extractFunctionSource(source, "handleNativeBridgeEvent");
    const renderBridgeResult = extractFunctionSource(source, "renderBridgeResult");
    const transcriptFromResult = extractFunctionSource(source, "renderTimelineRunTranscriptFromResult");
    const attachTranscript = extractFunctionSource(source, "attachTimelineRunTranscript");
    const promptSteps = extractFunctionSource(source, "appendTimelineRunTranscriptPromptSteps");
    const runtimeStep = extractFunctionSource(source, "formatRuntimeEventTranscriptStep");
    const unifiedRuntimeStep = extractFunctionSource(source, "formatUnifiedRuntimeEventTranscriptStep");
    const toolStep = extractFunctionSource(source, "formatExternalToolTranscriptStep");
    const timelineModule = await readFile(new URL("./ui/timeline.js", import.meta.url), "utf8");
    const chunks = extractFunctionSource(timelineModule, "createTimelineTextChunks");

    expect(submitComposer).toContain("attachTimelineRunTranscript(pendingMessage, composerTurn");
    expect(submitComposer).toContain("appendTimelineRunTranscriptPromptSteps(pendingMessage, input)");
    expect(handleBridgeEvent).toContain("appendTimelineRunTranscriptFromNativeBridgeEvent");
    expect(handleBridgeEvent).toContain('event.type === "conversation.model.delta"');
    expect(handleBridgeEvent).toContain("appendTimelineMessageTextDelta");
    expect(renderBridgeResult).toContain("await renderTimelineRunTranscriptFromResult(result, options)");
    expect(renderBridgeResult).toContain("await completeTimelineMessageStreaming(options.timelineHandle, primaryEvent)");
    expect(source).toContain("function appendTimelineMessageTextDelta");
    expect(source).toContain("function appendNonStreamingModelReplyTranscriptStep");
    expect(source).toContain("model-stream-start");
    expect(source).toContain("model-non-streaming-final");
    expect(source).toContain("模型一次性回包，已显示最终回复");
    expect(handlers).toContain("createConversationModelStreamDeltaDesktopEvent");
    expect(handlers).toContain("onStreamDelta");
    expect(attachTranscript).toContain("window.setInterval");
    expect(attachTranscript).toContain("updateTimelineRunTranscriptElapsed(handle)");
    expect(promptSteps).not.toContain("extractUrlsFromText");
    expect(source).not.toContain("function looksLikeLocalPath");
    expect(source).not.toContain("function isFileUrl");
    expect(source).not.toContain("function isFreshLearningSourcePrompt");
    expect(source).not.toContain("function isLearningConfirmationPrompt");
    expect(source).not.toContain("function isLearningResultAdvicePrompt");
    expect(promptSteps).not.toContain("准备读取");
    expect(promptSteps).not.toContain("识别为学习保存确认");
    expect(promptSteps).not.toContain("识别为学习结果追问");
    expect(promptSteps).not.toContain("判断收录价值和可用点");
    expect(promptSteps).toContain("if (/^\\s*\\//u.test(text))");
    expect(promptSteps).toContain("text.split(/\\s+/u)[0]");
    expect(promptSteps).not.toContain("/^\\\\s*\\\\//u");
    expect(promptSteps).not.toContain("text.split(/\\\\s+/u)");
    expect(promptSteps).not.toContain("if (/学习|learn|收录|经验/iu.test(text))");
    expect(transcriptFromResult).toContain("selectConversationRuntimeEventsForDisplay(result)");
    expect(source).toContain("function selectConversationRuntimeEventsForDisplay");
    expect(source).toContain("result.runtimeEventsV1");
    expect(source).toContain("result?.conversationRuntime?.runtimeEventsV1");
    expect(transcriptFromResult).not.toContain("extractRuntimeEventTranscriptSteps(result.runtimeEvents)");
    expect(transcriptFromResult).toContain("result.operatorTrace");
    expect(runtimeStep).toContain("runtime.tool");
    expect(unifiedRuntimeStep).toContain("tool.started");
    expect(unifiedRuntimeStep).toContain("model.final");
    expect(runtimeStep).toContain("runtime.artifact");
    expect(toolStep).toContain("externalToolExecution");
    expect(chunks).toContain("Intl.Segmenter");
    expect(chunks).toContain('granularity: "grapheme"');
    expect(chunks).toContain("return [...text]");
    expect(source).toContain("createTimelineTextChunks(value);");
    expect(styles).toContain(".run-transcript");
    expect(styles).toContain(".run-transcript-elapsed");
    expect(styles).toContain(".run-transcript-step");
    expect(styles).toContain('.run-transcript-step[data-state="active"]');
    expect(styles).toContain(".message-body.long-message-body");
    expect(styles).not.toContain("max-height: min(52vh, 520px)");
  });

  it("keeps learning source prompt detection out of the desktop UI layer", async () => {
    const source = await readAppSource();

    expect(source).not.toContain("function looksLikeLocalPath");
    expect(source).not.toContain("function isFileUrl");
    expect(source).not.toContain("function isFreshLearningSourcePrompt");
  });

  it("filters native bridge stream events by active turn and desktop session", async () => {
    const source = await readAppSource();
    const chatModule = await readFile(new URL("./ui/chat.js", import.meta.url), "utf8");
    const handleBridgeEvent = extractFunctionSource(source, "handleNativeBridgeEvent");
    const shouldAppend = extractFunctionSource(source, "shouldAppendNativeBridgeStreamEvent");
    const readTurnId = extractFunctionSource(source, "readNativeBridgeEventTurnId");
    const readSessionKey = extractFunctionSource(source, "readNativeBridgeEventSessionKey");
    const submitComposer = extractFunctionSource(source, "submitComposerToBridge");
    const finishComposerTurn = extractFunctionSource(source, "finishComposerTurn");

    expect(chatModule).toContain("export function reconcileDesktopChatRunLifecycle");
    expect(chatModule).toContain("export function clearDesktopChatQueueItemsForRun");
    expect(chatModule).toContain("pendingRunId");
    expect(submitComposer).toContain("sessionKey: state.chat.sessionKey");
    expect(handleBridgeEvent).toContain("shouldAppendNativeBridgeStreamEvent(event)");
    expect(shouldAppend).toContain("readNativeBridgeEventSessionKey(event)");
    expect(shouldAppend).toContain("state.chat.sessionKey");
    expect(readTurnId).toContain("event?.metadata?.turnId");
    expect(readSessionKey).toContain("event?.sessionKey");
    expect(readSessionKey).toContain("event?.metadata?.sessionKey");
    expect(finishComposerTurn).toContain("reconcileDesktopChatRunLifecycle(state.chat");
  });

  it("supports pasted file attachments through the desktop composer path", async () => {
    const source = await readAppSource();
    const composerModule = await readFile(new URL("./ui/composer-state.js", import.meta.url), "utf8");
    const chatModule = await readFile(new URL("./ui/chat.js", import.meta.url), "utf8");

    expect(source).toContain("createComposerAttachmentsFromPastedFiles");
    expect(source).toContain('elements.angelInput?.addEventListener("paste"');
    expect(source).toContain("function handleComposerPaste");
    expect(source).toContain("function readComposerClipboardFiles");
    expect(extractFunctionSource(source, "handleComposerPaste")).toContain(
      "registerDesktopAttachmentPayload",
    );
    expect(extractFunctionSource(source, "handleComposerPaste")).toContain(
      "addComposerAttachment(state.chat.composer",
    );
    expect(extractFunctionSource(source, "normalizeComposerSubmitAttachments")).toContain(
      "isSendableComposerAttachment",
    );
    expect(composerModule).toContain("export function createComposerAttachmentsFromPastedFiles");
    expect(composerModule).toContain("allowPathless");
    expect(chatModule).toContain("function isSendableDesktopChatAttachment");
    expect(chatModule).toContain("attachment?.dataUrl");
  });

  it("uses a textarea composer with IME-safe multiline key handling", async () => {
    const source = await readAppSource();
    const html = await readIndexSource();
    const installHandlers = extractFunctionSource(source, "installEventHandlers");

    expect(html).toContain("<textarea");
    expect(html).toContain('id="angel-input"');
    expect(html).not.toContain('id="angel-input"\n              type="text"');
    expect(source).toContain("resolveComposerKeyAction");
    expect(source).toContain("insertComposerNewline");
    expect(installHandlers).toContain("resolveComposerKeyAction(event)");
    expect(installHandlers).toContain('composerAction === "newline"');
    expect(installHandlers).toContain('composerAction === "submit"');
    expect(installHandlers).toContain("setSelectionRange");
  });

  it("persists composer attachment metadata without storing payload bytes", async () => {
    const persistenceModule = await readFile(new URL("./ui/persistence.js", import.meta.url), "utf8");

    expect(persistenceModule).toContain("composerAttachments");
    expect(persistenceModule).toContain("function readComposerAttachmentMetadataList");
    expect(persistenceModule).toContain("function readComposerAttachmentMetadata");
    expect(extractFunctionSource(persistenceModule, "readComposerAttachmentMetadata")).not.toContain(
      "dataUrl",
    );
    expect(extractFunctionSource(persistenceModule, "readComposerAttachmentMetadata")).not.toContain(
      "contentEncoding",
    );
    expect(extractFunctionSource(persistenceModule, "readComposerAttachmentMetadata")).not.toContain(
      "content:",
    );
  });

  it("can show restart-restored run center task details without a live backend task", async () => {
    const source = await readAppSource();
    const readTask = extractFunctionSource(source, "readTaskRuntimeTask");

    expect(source).toContain("function findLocalTaskRuntimeTask");
    expect(source).toContain("function renderTaskRuntimeTaskDetail");
    expect(readTask).toContain("findLocalTaskRuntimeTask(taskId)");
    expect(readTask).toContain("renderTaskRuntimeTaskDetail");
    expect(extractFunctionSource(source, "renderTaskRuntimeTaskDetail")).toContain(
      "restoredFromUiState",
    );
    expect(extractFunctionSource(source, "renderTaskRuntimeTaskDetail")).toContain(
      "本地恢复历史",
    );
  });

  it("resumes run center polling when backend restores active runtime tasks", async () => {
    const source = await readAppSource();
    const applySnapshot = extractFunctionSource(source, "applyTaskRuntimeSnapshot");

    expect(source).toContain("function resumeTaskRuntimePollingForActiveBackendTasks");
    expect(applySnapshot).toContain("resumeTaskRuntimePollingForActiveBackendTasks()");
    const resume = extractFunctionSource(source, "resumeTaskRuntimePollingForActiveBackendTasks");
    expect(resume).toContain("state.taskRuntime.tasks.some(isTaskRuntimeActive)");
    expect(resume).toContain("startTaskRuntimePolling()");
    expect(resume).not.toContain("optimisticTasks");
  });

  it("renders the middle timeline as a Codex-style transcript instead of chat bubbles", async () => {
    const styles = await readStylesSource();

    expect(styles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(styles).toContain(".avatar {\n  display: none;");
    expect(styles).toContain("background: transparent;");
    expect(styles).toContain("border: 0;");
    expect(styles).toContain("border-radius: 0;");
    expect(styles).toContain("@keyframes transcript-active-breathe");
    expect(styles).not.toContain(".message.user {\n  justify-content: end;");
    expect(styles).not.toContain(".message.user .bubble");
    expect(styles).not.toContain("thinking-bubble-breathe");
  });

  it("keeps stale timeout cleanup from overwriting the original reply body", async () => {
    const source = await readAppSource();
    const finalizePendingStart = source.indexOf(
      "function finalizePendingComposerTimelineHandle(controller)",
    );
    const finalizePendingEnd = source.indexOf(
      "function startStaleTimelineMonitor()",
      finalizePendingStart,
    );
    const finalizeStaleStart = source.indexOf(
      "function finalizeStaleStreamingTimelineMessage(article)",
    );
    const finalizeStaleEnd = source.indexOf(
      "function installBridgeEventHandlers()",
      finalizeStaleStart,
    );
    const finalizePending = source.slice(finalizePendingStart, finalizePendingEnd);
    const finalizeStale = source.slice(finalizeStaleStart, finalizeStaleEnd);
    const markStale = extractFunctionSource(source, "markTimelineMessageAsStale");
    const stopTimer = extractFunctionSource(source, "stopTimelineRunTranscriptTimer");

    expect(finalizePending).toContain('markTimelineMessageAsStale(handle, "等待已结束")');
    expect(finalizePending).not.toContain("updateTimelineMessage(");
    expect(finalizeStale).toContain('markTimelineMessageAsStale(article, "等待已结束")');
    expect(finalizeStale).not.toContain("updateTimelineMessage(");
    expect(markStale).toContain("stopTimelineRunTranscriptTimer(handleOrArticle)");
    expect(markStale).toContain('article.classList.add("stale")');
    expect(stopTimer).toContain("updateTimelineRunTranscriptElapsed({ runTranscript }, Date.now())");
    expect(stopTimer).toContain("window.clearInterval(timerId)");
    expect(stopTimer).toContain("runTranscript.timerId = null");
  });

  it("clears the composer immediately after a workbench message is sent", async () => {
    const source = await readAppSource();

    const submitComposer = extractFunctionSource(source, "submitComposerToBridge");
    const slashCommand = extractFunctionSource(source, "submitLocalSlashCommand");

    expect(submitComposer.indexOf('body: input.length === 0 ? "让 Angel 按当前板块继续。" : input')).toBeLessThan(
      submitComposer.indexOf('setInputValue("");'),
    );
    expect(submitComposer.indexOf('setInputValue("");')).toBeLessThan(
      submitComposer.indexOf("const pendingMessage = appendTimelineMessage"),
    );
    expect(slashCommand.indexOf("appendTimelineMessage({")).toBeLessThan(
      slashCommand.indexOf('setInputValue("");'),
    );
    expect(slashCommand.indexOf('setInputValue("");')).toBeLessThan(
      slashCommand.indexOf("const pendingMessage = appendTimelineMessage"),
    );
  });

  it("keeps completed structured replies expanded instead of replacing them with task previews", async () => {
    const source = await readAppSource();

    const apiMessage = extractFunctionSource(source, "createApiProviderRunTimelineMessage");
    const apiBody = extractFunctionSource(source, "createApiProviderRunTimelineBody");
    const taskMessage = extractFunctionSource(source, "createConversationRuntimeTaskTimelineMessage");
    const taskFinalText = extractFunctionSource(source, "resolveConversationRuntimeTaskFinalText");
    const reconcileTask = extractFunctionSource(source, "reconcileActiveComposerTurnFromTaskRuntime");
    const shouldUpdateTask = extractFunctionSource(source, "shouldUpdateComposerTimelineFromTask");

    expect(apiMessage).toContain("createApiProviderRunTimelineBody(runResult)");
    expect(apiBody).toContain('runResult?.replySource === "structured-renderer"');
    expect(apiBody).toContain("return runResult.output.trim()");
    expect(taskMessage).toContain("resolveConversationRuntimeTaskFinalText(task)");
    expect(taskFinalText).toContain("task?.payload?.finalText");
    expect(taskFinalText).toContain("task?.finalText");
    expect(taskFinalText).toContain("task?.summary?.finalText");
    expect(taskFinalText.indexOf("task?.payload?.finalText")).toBeLessThan(
      taskFinalText.indexOf("task?.payload?.finalTextPreview"),
    );
    expect(reconcileTask).toContain("shouldUpdateComposerTimelineFromTask");
    expect(shouldUpdateTask).toContain("pendingHandle?.article?.classList.contains(\"streaming\")");
  });

  it("renders full media-learning follow-up text instead of the short preview", async () => {
    const source = await readAppSource();
    const apiRunResultSource = extractFunctionSource(source, "renderApiProviderRunResult");
    const apiBodySource = extractFunctionSource(source, "createApiProviderRunTimelineBody");
    const apiVisibleBodySource = extractFunctionSource(source, "readApiProviderRunVisibleBody");
    const taskMessageSource = extractFunctionSource(
      source,
      "createConversationRuntimeTaskTimelineMessage",
    );
    const taskTextSource = extractFunctionSource(source, "resolveConversationRuntimeTaskFinalText");
    const readTextSource = extractFunctionSource(source, "readNonEmptyTimelineText");
    const taskEvidenceSource = extractFunctionSource(source, "resolveTaskRuntimeEvidenceDisclosure");
    const context = {
      DESKTOP_EVENT_ROLES: {
        ANGEL: "angel",
        SYSTEM: "system",
      },
    };
    const resultOutputCalls = [];
    const contextWithInspector = {
      ...context,
      formatApiProviderRunEndpoint: () => "接口：统一运行时",
      formatApiProviderRunLatency: () => "耗时：未记录",
      formatApiProviderRunFailureDetails: () => [],
      createRuntimeApprovalNotice: () => null,
      setResultOutputWithContext: (value) => resultOutputCalls.push(value),
    };
    runInNewContext(
      [
        apiVisibleBodySource,
        apiRunResultSource,
        apiBodySource,
        readTextSource,
        taskTextSource,
        taskMessageSource,
        taskEvidenceSource,
        "this.renderApiProviderRunResult = renderApiProviderRunResult;",
        "this.createApiProviderRunTimelineBody = createApiProviderRunTimelineBody;",
        "this.createConversationRuntimeTaskTimelineMessage = createConversationRuntimeTaskTimelineMessage;",
      ].join("\n"),
      contextWithInspector,
    );
    const fullText = [
      "核心结论",
      "这次学到的是六宫格故事板更适合视频前期，而不是九宫格分镜。",
      "",
      "还没做到或局限",
      "只看到媒体链接或封面清单，没有证据表明已调用视觉/视频理解模型。",
      "",
      "证据",
      "来源：https://x.com/ponyodong/status/2055150198989746559",
      "",
      "下一步",
      "可以继续收第2条候选，或在用户授权后解析媒体。",
    ].join("\n");

    const apiBody = contextWithInspector.createApiProviderRunTimelineBody({
      replySource: "structured-renderer",
      output: `\n${fullText}\n`,
      message: "短摘要不应该显示",
    });
    const failureText =
      "模型供应方暂时不可用：系统已经找到并调用了模型供应方，但对方接口这次返回失败。";
    contextWithInspector.renderApiProviderRunResult({
      ok: false,
      replySource: "degraded-error",
      output: "",
      message: failureText,
      runtimeEvents: [],
    });
    const failureTimelineBody = contextWithInspector.createApiProviderRunTimelineBody({
      ok: false,
      replySource: "degraded-error",
      output: "",
      message: failureText,
    });
    const taskMessage = contextWithInspector.createConversationRuntimeTaskTimelineMessage({
      status: "completed",
      payload: {
        finalText: fullText,
        finalTextPreview: "短摘要不应该覆盖完整回答。",
        evidenceDisclosure: {
          sources: [
            {
              url: "https://x.com/ponyodong/status/2055150198989746559",
              fullBodyChars: 1680,
            },
          ],
        },
      },
    });

    expect(apiBody).toBe(fullText);
    expect(resultOutputCalls.at(-1)).toContain(failureText);
    expect(resultOutputCalls.at(-1)).not.toContain("Angel 没有回复成功\n\n");
    expect(failureTimelineBody).toBe(failureText);
    expect(taskMessage.body).toBe(fullText);
    expect(taskMessage.evidenceDisclosure.sources[0]).toMatchObject({
      url: "https://x.com/ponyodong/status/2055150198989746559",
      fullBodyChars: 1680,
    });
    expect(taskMessage.body).toContain("没有证据表明已调用视觉/视频理解模型");
    expect(taskMessage.body).toContain("下一步");
    expect(taskMessage.body).not.toContain("短摘要不应该覆盖完整回答");
  });

  it("does not turn completed task snapshots without final text into generic answer bodies", async () => {
    const source = await readAppSource();
    const taskMessageSource = extractFunctionSource(
      source,
      "createConversationRuntimeTaskTimelineMessage",
    );
    const taskTextSource = extractFunctionSource(source, "resolveConversationRuntimeTaskFinalText");
    const readTextSource = extractFunctionSource(source, "readNonEmptyTimelineText");
    const shouldUpdateSource = extractFunctionSource(source, "shouldUpdateComposerTimelineFromTask");
    const taskEvidenceSource = extractFunctionSource(source, "resolveTaskRuntimeEvidenceDisclosure");
    const context = {
      DESKTOP_EVENT_ROLES: {
        ANGEL: "angel",
        SYSTEM: "system",
      },
    };
    runInNewContext(
      [
        readTextSource,
        taskTextSource,
        taskEvidenceSource,
        taskMessageSource,
        shouldUpdateSource,
        "this.createConversationRuntimeTaskTimelineMessage = createConversationRuntimeTaskTimelineMessage;",
        "this.shouldUpdateComposerTimelineFromTask = shouldUpdateComposerTimelineFromTask;",
      ].join("\n"),
      context,
    );

    const taskWithTopLevelFinalText = context.createConversationRuntimeTaskTimelineMessage({
      status: "completed",
      finalText: "这是完整最终回复，不能被完成状态预览覆盖。",
      payload: {
        finalTextPreview: "ConversationRuntime 已完成本回合。",
      },
    });
    const genericOnlyTask = {
      status: "completed",
      payload: {
        turnId: "desktop-composer-turn-test",
        finalTextPreview: "ConversationRuntime 已完成本回合。",
      },
    };
    const genericOnlyMessage = context.createConversationRuntimeTaskTimelineMessage(genericOnlyTask);
    const alreadyFinalHandle = {
      article: {
        classList: {
          contains: () => false,
        },
      },
    };

    expect(taskWithTopLevelFinalText.body).toBe("这是完整最终回复，不能被完成状态预览覆盖。");
    expect(genericOnlyMessage.body).toBe("");
    expect(genericOnlyMessage.body).not.toContain("ConversationRuntime 已完成本回合。");
    expect(
      context.shouldUpdateComposerTimelineFromTask(
        { renderingFinalResult: false },
        alreadyFinalHandle,
        {
          status: "completed",
          payload: {
            finalText: "真实回复",
          },
        },
      ),
    ).toBe(false);
    expect(
      context.shouldUpdateComposerTimelineFromTask(
        { renderingFinalResult: false },
        {
          article: {
            classList: {
              contains: () => true,
            },
          },
        },
        genericOnlyTask,
      ),
    ).toBe(false);
  });

  it("keeps external tool bus snapshots from interrupting final reply rendering", async () => {
    const source = await readAppSource();

    const renderBridgeResult = extractFunctionSource(source, "renderBridgeResult");
    const applyToolBusSnapshot = extractFunctionSource(source, "applyExternalToolBusSnapshot");

    expect(renderBridgeResult).toContain("applyExternalToolBusSnapshot(result.externalToolBus)");
    expect(applyToolBusSnapshot).toContain("state.snapshot");
    expect(applyToolBusSnapshot).toContain("externalToolBus");
    expect(applyToolBusSnapshot).toContain("renderCommandList()");
    expect(applyToolBusSnapshot).toContain("renderSettingsSurface()");
    expect(applyToolBusSnapshot).toContain("scheduleRunCenterRender()");
  });

  it("shows structured answers before folded evidence disclosure", async () => {
    const source = await readAppSource();
    const evidenceModule = await readFile(new URL("./ui/evidence.js", import.meta.url), "utf8");
    const styles = await readStylesSource();
    const setResultOutput = extractFunctionSource(source, "setResultOutputWithContext");
    const evidenceDisclosure = extractFunctionSource(evidenceModule, "createEvidenceDisclosureDetails");
    const evidenceLines = extractFunctionSource(evidenceModule, "formatEvidenceDisclosureLines");
    const evidenceTitle = extractFunctionSource(evidenceModule, "formatEvidenceDisclosureTitle");
    const evidenceReadStatus = extractFunctionSource(evidenceModule, "formatEvidenceDisclosureReadStatus");
    const mediaAuthorizationControls = extractFunctionSource(evidenceModule, "createMediaAuthorizationControls");
    const mediaAuthorizationPayload = extractFunctionSource(evidenceModule, "resolveMediaAuthorizationActionPayload");
    const executeMediaAuthorization = extractFunctionSource(source, "executeMediaAuthorization");

    expect(source).toContain('from "./ui/evidence.js"');
    expect(evidenceModule).toContain("export function createEvidenceDisclosureDetails");
    expect(evidenceModule).toContain("export function resolveMediaAuthorizationActionPayload");
    expect(setResultOutput).toContain('text.className = "result-output-text"');
    expect(setResultOutput).toContain("const children = [text];");
    expect(setResultOutput.indexOf("const children = [text];")).toBeLessThan(
      setResultOutput.indexOf("children.push(evidence)"),
    );
    expect(setResultOutput).toContain("elements.resultOutput.replaceChildren(...children)");
    expect(evidenceDisclosure).toContain('document.createElement("details")');
    expect(evidenceDisclosure).toContain('details.className = "result-evidence-disclosure"');
    expect(evidenceDisclosure).toContain('summary.textContent = "查看读取证据"');
    expect(evidenceDisclosure).toContain("createMediaAuthorizationControls");
    expect(evidenceDisclosure).not.toContain("details.open");
    expect(evidenceDisclosure).not.toContain('setAttribute("open"');
    expect(evidenceLines).toContain("fullBodyChars");
    expect(evidenceLines).toContain("mediaCount");
    expect(evidenceLines).toContain("formatEvidenceDisclosureMediaCount");
    expect(evidenceLines).toContain("formatEvidenceDisclosureTitle");
    expect(evidenceLines).toContain("formatEvidenceDisclosureReadStatus");
    expect(evidenceLines).toContain("readStatus");
    expect(evidenceLines).toContain("sourceAccessStatus");
    expect(evidenceLines).toContain("failedReason");
    expect(evidenceLines).toContain("全文 ");
    expect(evidenceLines).toContain("待审");
    expect(evidenceLines).not.toContain("formatEvidenceDisclosureDebugLine");
    expect(evidenceLines).not.toContain("调试：");
    expect(evidenceTitle).toContain("来源：");
    expect(evidenceTitle).toContain("OpenCLI");
    expect(evidenceReadStatus).toContain("已读取");
    expect(evidenceReadStatus).toContain("失败原因：");
    const evidenceMediaCount = extractFunctionSource(evidenceModule, "formatEvidenceDisclosureMediaCount");
    expect(evidenceMediaCount).toContain("媒体 ");
    expect(evidenceMediaCount).toContain("未发现");
    expect(evidenceMediaCount).toContain("未授权理解");
    expect(evidenceMediaCount).toContain("已理解");
    expect(mediaAuthorizationControls).toContain("mediaAdmission");
    expect(mediaAuthorizationControls).toContain("request_user_authorization");
    expect(mediaAuthorizationControls).toContain("run_media_understanding_plan");
    expect(mediaAuthorizationControls).toContain('className = "media-authorization-actions"');
    expect(mediaAuthorizationControls).toContain("createMediaAuthorizationButton");
    expect(mediaAuthorizationControls).toContain('"media_inventory"');
    expect(mediaAuthorizationControls).toContain('"low_cost"');
    expect(mediaAuthorizationControls).toContain('"deep_multimodal"');
    expect(mediaAuthorizationControls).toContain("只记录清单");
    expect(mediaAuthorizationControls).toContain("低成本理解");
    expect(mediaAuthorizationControls).toContain("深度理解");
    expect(mediaAuthorizationPayload).toContain("artifactId");
    expect(mediaAuthorizationPayload).toContain("candidateId");
    expect(mediaAuthorizationPayload).toContain("sourceRef");
    expect(mediaAuthorizationPayload).toContain("tokenBudget");
    expect(mediaAuthorizationPayload).toContain("maxAssets");
    expect(mediaAuthorizationPayload).toContain("fileCountLimit");
    expect(mediaAuthorizationPayload).toContain("lowCostTokenLimit");
    expect(executeMediaAuthorization).toContain("DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND");
    expect(mediaAuthorizationPayload).toContain("userAuthorized: mode !== \"media_inventory\"");
    expect(executeMediaAuthorization).toContain("renderBridgeResult(result)");
    expect(styles).toContain(".media-authorization-actions");
    expect(styles).toContain(".media-authorization-button");
  });

  it("keeps ordinary evidence disclosure compact and hides debug-only fields", async () => {
    const evidenceModule = await readFile(new URL("./ui/evidence.js", import.meta.url), "utf8");
    const evidenceLines = extractFunctionSource(evidenceModule, "formatEvidenceDisclosureLines");
    const evidenceReadStatus = extractFunctionSource(evidenceModule, "formatEvidenceDisclosureReadStatus");

    expect(evidenceLines).toContain("formatEvidenceDisclosureTitle");
    expect(evidenceLines).toContain("formatEvidenceDisclosureMediaCount");
    expect(evidenceLines).toContain("全文 ");
    expect(evidenceLines).toContain("待审");
    expect(evidenceReadStatus).toContain("已读取");
    const evidenceMediaCount = extractFunctionSource(evidenceModule, "formatEvidenceDisclosureMediaCount");
    expect(evidenceMediaCount).toContain("媒体 ");
    expect(evidenceLines).not.toContain("formatEvidenceDisclosureDebugLine");
    expect(evidenceLines).not.toContain("OpenCLI Twitter/X article");
    expect(evidenceLines).not.toContain("调试：");
    expect(evidenceLines).not.toContain("预览字符=");
    expect(evidenceLines).not.toContain("媒体理解=");
  });

  it("renders media authorization controls as actionable budget modes", async () => {
    const evidenceModule = await readFile(new URL("./ui/evidence.js", import.meta.url), "utf8");

    const controls = extractFunctionSource(evidenceModule, "createMediaAuthorizationControls");
    const button = extractFunctionSource(evidenceModule, "createMediaAuthorizationButton");
    const payload = extractFunctionSource(evidenceModule, "resolveMediaAuthorizationActionPayload");

    expect(controls).toContain("recommendedMode");
    expect(controls).toContain("mediaAuthorization?.options");
    expect(controls).toContain("媒体处理授权");
    expect(controls).toContain("推荐");
    expect(button).toContain("button.dataset.mediaAuthorizationMode = mode");
    expect(button).toContain("button.dataset.recommended = String");
    expect(button).toContain("resolveMediaAuthorizationActionPayload(source, mode)");
    expect(button).toContain("formatMediaAuthorizationBudgetSummary");
    expect(button).toContain("button.dataset.tokenBudget");
    expect(button).toContain("button.dataset.maxAssets");
    expect(button).toContain("button.setAttribute(");
    expect(button).toContain("\"aria-label\"");
    expect(button).toContain("isRecommended");
    expect(evidenceModule).toContain("function formatMediaAuthorizationNumber");
    expect(payload).toContain('mode === "media_inventory"');
    expect(payload).toContain('mode === "low_cost"');
    expect(payload).toContain('mode === "deep_multimodal"');
    expect(payload).toContain("userAuthorized: mode !== \"media_inventory\"");
    expect(payload).toContain("tokenBudget");
    expect(payload).toContain("maxAssets");
  });

  it("mirrors event-only Angel replies into the result inspector", async () => {
    const source = await readAppSource();
    const renderBridgeResult = extractFunctionSource(source, "renderBridgeResult");
    const renderEventResult = extractFunctionSource(source, "renderEventOnlyBridgeResult");

    expect(renderBridgeResult).toContain("renderEventOnlyBridgeResult(result)");
    expect(renderBridgeResult.indexOf("const eventResultRendered = renderEventOnlyBridgeResult(result)")).toBeLessThan(
      renderBridgeResult.indexOf("for (const event of result.events ?? [])"),
    );
    expect(renderBridgeResult).toContain("if (!eventResultRendered)");
    expect(renderEventResult).toContain("selectPrimaryBridgeResultEvent");
    expect(renderEventResult).toContain("setResultOutputWithContext");
    expect(renderEventResult).toContain("primary.evidenceDisclosure");
    expect(renderEventResult).toContain("result.conversationRuntime?.evidenceDisclosure");
    expect(renderEventResult).toContain('selectInspectorPanel("result")');
    const renderTaskResult = extractFunctionSource(source, "renderConversationRuntimeTaskResult");
    expect(renderTaskResult).toContain("createConversationRuntimeTaskTimelineMessage(task)");
    expect(renderTaskResult).toContain("setResultOutputWithContext");
    expect(renderTaskResult).toContain("message.evidenceDisclosure");
    expect(renderTaskResult).toContain('selectInspectorPanel("result")');
  });

  it("wires asset title buttons and tool rows to real snapshot asset detail pages", async () => {
    const source = await readAppSource();

    expect(source).toContain(
      "selectAssetDetail(assetButton.dataset.assetSurface, assetButton.dataset.assetId)",
    );
    expect(source).toContain("data-tool-id");
    expect(source).toContain('selectAssetDetail("tools", row.dataset.toolId)');
    expect(source).toContain("state.selectedGroupId = surface");
    expect(source).toContain("createSkillAssetDetail");
    expect(source).toContain("createToolAssetDetail");
    expect(source).toContain("formatAdapterActionCatalog(adapter.actions)");
    expect(source).toContain("formatAdapterActionContracts(adapter.actions)");
    expect(source).toContain('label: "动作清单"');
    expect(source).toContain('label: "动作契约"');
    expect(source).toContain('label: "高风险动作"');
    expect(source).toContain('label: "需审批动作"');
  });

  it("renders non-settings snapshot assets as selectable middle-page details", async () => {
    const source = await readAppSource();

    expect(source).toContain('assetSurface: "experience"');
    expect(source).toContain('assetSurface: "skills"');
    expect(source).toContain('assetSurface: "tools"');
    expect(source).toContain('button.dataset.assetSurface = "review"');
    expect(source).toContain("createExperienceCandidateCard");
    expect(source).toContain("createSkillLibraryLayout");
    expect(source).toContain("createSkillTable");
    expect(source).toContain("createToolListCard");
    expect(source).toContain("createReviewConsoleLayout");
    expect(source).toContain("createReviewTable");
    expect(source).toContain("renderReviewDetailRoute");
    expect(source).toContain("traceProposalItems");
    expect(source).toContain("executionItems");
    expect(source).toContain("executionReportItems");
    expect(source).toContain("createReviewAssetDetail");
  });

  it("renders the experience library as a filterable table/list with title route links", async () => {
    const source = await readAppSource();
    const experienceLibraryModule = await readFile(new URL("./ui/experience-library.js", import.meta.url), "utf8");
    const styles = await readStylesSource();

    const librarySurface = extractFunctionSource(source, "renderExperienceAssetSurface");
    const toolbar = extractFunctionSource(experienceLibraryModule, "createExperienceLibraryToolbar");
    const filters = extractFunctionSource(experienceLibraryModule, "applyExperienceTableFilters");
    const layout = extractFunctionSource(experienceLibraryModule, "createExperienceLibraryLayout");
    const table = extractFunctionSource(experienceLibraryModule, "createExperienceTable");
    const row = extractFunctionSource(experienceLibraryModule, "createExperienceTableRow");
    const titleCell = extractFunctionSource(experienceLibraryModule, "createExperienceTitleCell");

    expect(source).toContain('from "./ui/experience-library.js"');
    expect(experienceLibraryModule).toContain("export function createExperienceLibraryToolbar");
    expect(experienceLibraryModule).toContain("export function createExperienceLibraryLayout");
    expect(librarySurface).toContain("createExperienceLibraryToolbar(experience,");
    expect(librarySurface).toContain(
      "createExperienceLibraryLayout(candidate?.items ?? [], experience,",
    );
    expect(toolbar).toContain('search.type = "search"');
    expect(toolbar).toContain('search.dataset.experienceFilter = "query"');
    expect(toolbar).toContain('category.dataset.experienceFilter = "category"');
    expect(toolbar).toContain('tag.dataset.experienceFilter = "tag"');
    expect(toolbar).toContain('source.dataset.experienceFilter = "source"');
    expect(toolbar).toContain('status.dataset.experienceFilter = "status"');
    expect(toolbar).toContain('date.dataset.experienceFilter = "date"');
    expect(toolbar).toContain("applyExperienceTableFilters");
    expect(filters).toContain("[data-experience-filter='tag']");
    expect(filters).toContain("[data-experience-filter='source']");
    expect(filters).toContain("[data-experience-filter='date']");
    expect(filters).toContain("matchesTag");
    expect(filters).toContain("matchesSource");
    expect(filters).toContain("matchesDate");
    expect(layout).toContain("createExperienceTaxonomySidebar(experience, items)");
    expect(layout).toContain("createExperienceTable(items, options)");
    expect(table).toContain('table.className = "experience-table"');
    expect(table).toContain('document.createElement("thead")');
    expect(table).toContain('document.createElement("tbody")');
    expect(table).toContain("经验列表");
    for (const label of ["经验", "分类", "标签", "状态", "操作"]) {
      expect(table).toContain(`"${label}"`);
    }
    expect(row).toContain("createExperienceTitleCell(item, options)");
    expect(row).toContain("row.dataset.tagIds");
    expect(row).toContain("row.dataset.sourceKind");
    expect(row).toContain("row.dataset.createdAtMs");
    expect(row).not.toContain("formatExperienceSourceKind(item.sourceKind)");
    expect(titleCell).toContain('button.className = "experience-title-link"');
    expect(titleCell).toContain('button.dataset.assetSurface = "experience"');
    expect(titleCell).toContain("button.dataset.assetId = `candidate:${item.id}`");
    expect(titleCell).toContain("formatCompactExperienceSummary(item.summary)");
    expect(titleCell).toContain('meta.className = "experience-title-meta"');
    expect(titleCell).toContain("options.formatExperienceSourceKind?.(item.sourceKind)");
    expect(titleCell).toContain("options.formatExperienceDistillation?.(item)");
    expect(titleCell).toContain("options.formatEpochDate?.(item.createdAtMs)");
    expect(styles).toMatch(/\.experience-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;/u);
    expect(styles).toMatch(/\.experience-table\s*\{[\s\S]*?min-width:\s*900px;/u);
  });

  it("maps the experience library to the reference learning lifecycle stages", async () => {
    const source = await readAppSource();
    const experienceLibraryModule = await readFile(new URL("./ui/experience-library.js", import.meta.url), "utf8");

    const toolbar = extractFunctionSource(experienceLibraryModule, "createExperienceLibraryToolbar");
    const row = extractFunctionSource(experienceLibraryModule, "createExperienceTableRow");
    const lifecycleStatus = extractFunctionSource(source, "resolveExperienceLifecycleStatus");
    const statusLabel = extractFunctionSource(source, "formatExperienceStatusLabel");
    const lifecycleBlock = extractFunctionSource(source, "createLifecycleBlock");
    const reviewPrompts = extractFunctionSource(source, "createExperienceReviewPrompts");
    const reviewSummary = extractFunctionSource(source, "createExperienceReviewSummary");
    const recallCopy = extractFunctionSource(source, "createExperienceRecallCopy");
    const editForm = extractFunctionSource(source, "createExperienceEditForm");
    const recommended = extractFunctionSource(source, "resolveRecommendedCommandId");
    const stepState = extractFunctionSource(source, "resolveStepState");

    expect(statusLabel).toContain("harvested");
    expect(statusLabel).toContain("reviewed");
    expect(statusLabel).toContain("publish-ready");
    expect(statusLabel).toContain("promoted");
    expect(lifecycleStatus).toContain("candidate.stage");
    expect(lifecycleStatus).toContain("candidate.status");
    for (const stage of ["harvested", "reviewed", "publish-ready", "promoted"]) {
      expect(toolbar).toContain(`"${stage}"`);
      expect(lifecycleBlock).toContain(`"${stage}"`);
    }
    expect(row).toContain("options.resolveExperienceLifecycleStatus?.(item)");
    expect(reviewPrompts).toContain("const lifecycleStatus = resolveExperienceLifecycleStatus(candidate)");
    expect(reviewPrompts).toContain('lifecycleStatus === "harvested"');
    expect(reviewPrompts).toContain('lifecycleStatus === "reviewed"');
    expect(reviewPrompts).toContain('lifecycleStatus === "publish-ready"');
    expect(reviewSummary).toContain('resolveExperienceLifecycleStatus(candidate)');
    expect(recallCopy).toContain('resolveExperienceLifecycleStatus(candidate)');
    expect(editForm).toContain('resolveExperienceLifecycleStatus(candidate) === "harvested"');
    expect(recommended).toContain('resolveExperienceLifecycleStatus(snapshot.candidate)');
    expect(stepState).toContain('resolveExperienceLifecycleStatus(snapshot.candidate)');
  });

  it("renders the skills library as a compact table/list with source sidebar and title route links", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    const librarySurface = extractFunctionSource(source, "renderSkillsAssetSurface");
    const toolbar = extractFunctionSource(source, "createSkillLibraryToolbar");
    const filters = extractFunctionSource(source, "applySkillTableFilters");
    const layout = extractFunctionSource(source, "createSkillLibraryLayout");
    const statusStrip = extractFunctionSource(source, "createSkillStatusStrip");
    const sidebar = extractFunctionSource(source, "createSkillSourceSidebar");
    const statusSummary = extractFunctionSource(source, "createSkillStatusSummary");
    const table = extractFunctionSource(source, "createSkillTable");
    const row = extractFunctionSource(source, "createSkillTableRow");
    const switchControl = extractFunctionSource(source, "createSkillEnablementSwitch");
    const titleCell = extractFunctionSource(source, "createSkillTitleCell");
    const actionCell = extractFunctionSource(source, "createSkillActionCell");
    const runtimeDiagnostics = extractFunctionSource(source, "createSkillRuntimeDiagnostics");
    const explanationSurface = extractFunctionSource(source, "createSkillExplanationSurfaceBlock");
    const actions = extractFunctionSource(source, "createSkillDirectActions");
    const executeAction = extractFunctionSource(source, "executeAssetAction");

    expect(librarySurface).toContain("createSkillLibraryToolbar(skills)");
    expect(librarySurface).toContain("createSkillStatusStrip(skills)");
    expect(librarySurface).toContain("createSkillLibraryLayout(skills?.items ?? [], skills)");
    expect(librarySurface.indexOf("createSkillLibraryToolbar(skills)")).toBeLessThan(
      librarySurface.indexOf("createSkillLibraryLayout(skills?.items ?? [], skills)"),
    );
    expect(librarySurface.indexOf("createSkillLibraryLayout(skills?.items ?? [], skills)")).toBeLessThan(
      librarySurface.indexOf("createSkillProposalTable(skills?.proposals ?? [])"),
    );
    expect(statusStrip).toContain("skills?.externalEnabledCount");
    expect(statusStrip).toContain("skills?.externalDisabledCount");
    expect(librarySurface).not.toContain('createAssetSection("Skill 列表"');
    expect(librarySurface).not.toContain("createSkillListCard");
    expect(toolbar).toContain('toolbar.className = "skill-library-toolbar"');
    expect(toolbar).toContain('search.type = "search"');
    expect(toolbar).toContain('search.dataset.skillFilter = "query"');
    expect(toolbar).toContain('source.dataset.skillFilter = "source"');
    expect(toolbar).toContain('category.dataset.skillFilter = "category"');
    expect(toolbar).toContain('status.dataset.skillFilter = "status"');
    expect(toolbar).toContain('tag.dataset.skillFilter = "tag"');
    expect(toolbar).toContain("applySkillTableFilters");
    expect(statusStrip).toContain('strip.className = "skill-status-strip"');
    expect(statusStrip).toContain("const summary = skills?.runtimeSummary ?? {}");
    expect(statusStrip).toContain("skills?.proposalCount");
    expect(statusStrip).toContain('["阻塞", summary.blockedCount ?? skills?.blockedCount ?? 0]');
    expect(statusStrip).toContain('["已移除", summary.missingSkillCount ?? skills?.missingSkillCount ?? 0]');
    expect(statusStrip).toContain('["未检查工具", summary.uncheckedToolCount ?? skills?.uncheckedToolCount ?? 0]');
    expect(statusStrip).toContain("summary.modelVisibleCount ??");
    expect(statusStrip).toContain("skills?.modelVisibleCount ??");
    expect(statusStrip).toContain("summary.eligibleCount ??");
    expect(statusStrip).toContain("skills?.eligibleCount ??");
    expect(filters).toContain(".skill-list-section [data-skill-row]");
    expect(filters).toContain("row.dataset.source");
    expect(filters).toContain("row.dataset.categoryId");
    expect(filters).toContain("row.dataset.enabled");
    expect(filters).toContain("row.dataset.tagNames");
    expect(filters).toContain("syncSkillSidebarFilterState");
    expect(layout).toContain('layout.className = "skill-library-layout"');
    expect(layout).toContain("createSkillSourceSidebar(skills)");
    expect(layout).toContain("createSkillTable(items)");
    expect(sidebar).toContain('aside.className = "skill-source-sidebar"');
    expect(sidebar).toContain("createSkillSourceSummary(skills)");
    expect(sidebar).toContain("createSkillStatusSummary(skills)");
    expect(statusSummary).toContain("const summary = skills?.runtimeSummary ?? {}");
    expect(statusSummary).toContain("summary.missingSkillCount ?? skills?.missingSkillCount ?? 0");
    expect(sidebar).toContain("createSkillCategorySummary");
    expect(sidebar).toContain("createSkillTagSummary");
    expect(sidebar).toContain("createSkillSidebarFilterButton");
    expect(source).toContain("syncSkillSidebarFilterState");
    expect(table).toContain('section.className = "skill-list-section"');
    expect(table).toContain('scroller.className = "skill-list-scroll"');
    expect(table).toContain('list.className = "skill-list"');
    expect(table).not.toContain('document.createElement("thead")');
    expect(table).not.toContain('document.createElement("tbody")');
    expect(table).toContain("Skill 列表");
    expect(row).toContain("row.dataset.source = item.source");
    expect(row).toContain("row.dataset.categoryId = resolveSkillCategoryId(item)");
    expect(row).toContain("row.dataset.enabled");
    expect(row).toContain("row.dataset.modelVisible = item.modelVisible === false ? \"hidden\" : \"visible\"");
    expect(row).toContain("row.dataset.eligible = item.eligible === false ? \"ineligible\" : \"eligible\"");
    expect(row).toContain("row.dataset.tagNames");
    expect(row).toContain('row.className = "skill-list-row"');
    expect(row).toContain("createSkillTitleCell(item)");
    expect(row).toContain("createSkillMetaStrip(item)");
    expect(row).toContain("createSkillListLine(\"标签\", formatSkillTags(item))");
    expect(row).toContain("createSkillListLine(\"工具\", formatSkillTools(item))");
    expect(row).toContain("createSkillListLine(\"运行\", formatSkillRuntimeLine(item))");
    expect(row).toContain("createSkillExplanationSurfaceBlock(item.explanationSurface");
    expect(row).toContain("createSkillRuntimeDiagnostics(item, { compact: true })");
    expect(row).not.toContain("createSkillEnablementCell(item)");
    expect(row).toContain("formatSkillTags(item)");
    expect(row).toContain("formatSkillTools(item)");
    expect(runtimeDiagnostics).toContain('block.className = compact ? "skill-runtime-diagnostics compact"');
    expect(runtimeDiagnostics).toContain("formatSkillModelVisibility(skill)");
    expect(runtimeDiagnostics).toContain("formatSkillEligibility(skill)");
    expect(runtimeDiagnostics).toContain("skill.statusReason || skill.disabledReason || skill.doctorSummary");
    expect(runtimeDiagnostics).toContain('["下一步", formatList(skill.nextActions)]');
    expect(explanationSurface).toContain('block.className = compact ? "skill-explanation-surface compact"');
    expect(explanationSurface).toContain("surface.statusExplanation");
    expect(explanationSurface).toContain("surface.operatorReviewExplanation");
    expect(explanationSurface).toContain("surface.curatorExplanation");
    expect(explanationSurface).toContain("surface.nextActions");
    expect(source).toContain("function mapSkillRuntimeTone(skill)");
    expect(styles).toContain(".skill-runtime-diagnostics");
    expect(styles).toContain(".skill-explanation-surface");
    expect(styles).toContain(".skill-runtime-diagnostics-header");
    expect(switchControl).toContain('input.type = "checkbox"');
    expect(switchControl).toContain('input.className = "skill-toggle"');
    expect(switchControl).toContain("DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET");
    expect(switchControl).toContain("await renderBridgeResult(result)");
    expect(titleCell).toContain('button.className = "skill-title-link"');
    expect(titleCell).toContain('button.dataset.assetSurface = "skills"');
    expect(titleCell).toContain("button.dataset.assetId = item.id");
    expect(titleCell).toContain(
      "formatCompactSkillSummary(item.chineseIntro || item.description || item.content || item.id)",
    );
    expect(titleCell).toContain('meta.className = "skill-title-meta"');
    expect(titleCell).toContain("resolveSkillCategoryName(item)");
    expect(titleCell).toContain("formatSkillUpdated(item)");
    expect(actionCell).toContain("createSkillDirectActions(item)");
    expect(actionCell).toContain("createSkillEnablementSwitch(item)");
    expect(actionCell).toContain('type: "ui.selectAsset"');
    expect(actionCell).toContain('"编辑"');
    expect(actionCell).toContain('"skill-action-button"');
    expect(actions).toContain("DESKTOP_ACTIONS.SKILL_DELETE");
    expect(actions).toContain("confirm:");
    expect(actions).not.toContain("DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET");
    expect(executeAction).toContain("window?.confirm");
    expect(executeAction).toContain("Object.entries(action).filter");
  });

  it("opens an experience title as a full middle-page detail route instead of a modal or right aside", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    const commandListHandler = extractFunctionSource(source, "installEventHandlers");
    const renderAssetSurface = extractFunctionSource(source, "renderAssetSurface");
    const detailRoute = extractFunctionSource(source, "renderExperienceDetailRoute");
    const detailDocument = extractFunctionSource(source, "createExperienceDetailDocument");

    expect(commandListHandler).toContain(
      "selectAssetDetail(assetButton.dataset.assetSurface, assetButton.dataset.assetId)",
    );
    expect(renderAssetSurface).toContain(
      'if (surfaceId === "experience" && selectedDetail?.kind === "experience-candidate")',
    );
    expect(renderAssetSurface).toContain(
      "renderExperienceDetailRoute(elements.commandList, selectedDetail, group)",
    );
    expect(renderAssetSurface).toMatch(
      /renderExperienceDetailRoute\(elements\.commandList, selectedDetail, group\);\n\s+return;\n\s+\}/u,
    );
    expect(detailRoute).toContain('header.className = "experience-detail-header"');
    expect(detailRoute).toContain('body.className = "experience-detail-route-body"');
    expect(detailRoute).toContain("createExperienceDetailNav()");
    expect(detailRoute).toContain("createExperienceDetailDocument(detail, group)");
    expect(detailRoute).toContain("createExperienceTaxonomyEditor(candidate)");
    expect(detailDocument).toContain("createExperienceOriginalSourceSection(detail)");
    expect(detailDocument).toContain("createExperienceExtractedExperienceSection(candidate)");
    expect(detailDocument).toContain("createExperienceReviewSection(candidate)");
    expect(detailDocument).toContain("createExperienceRecallSection(candidate, detail)");
    expect(detailDocument).toContain("createExperienceHistorySection(candidate)");
    expect(source).toContain("原始来源");
    expect(source).toContain("提炼经验");
    expect(source).toContain("审核");
    expect(source).toContain("召回");
    expect(source).toContain("历史");
    expect(source).toContain("createExperienceEditForm(candidate)");
    expect(source).toContain("DESKTOP_ACTIONS.EXPERIENCE_UPDATE");
    expect(source).toContain("data-experience-edit-field");
    expect(source).toContain("保存提炼经验");
    expect(source).toContain("抓取完整内容");
    expect(source).toContain("createSourceReaderBlock");
    expect(source).toContain("sourceDocument.content");
    expect(source).toContain("sourceDocument.rawContent");
    expect(source).toContain("sourceDocument.structuredContent");
    expect(source).toContain("sourceDocument.extractionReport");
    expect(source).toContain("parseSourceReaderContent");
    expect(source).toContain("normalizeStructuredSourceBlocks");
    expect(source).toContain("createExtractionReportNotes");
    expect(source).toContain("extractOrderedSourceBlocks");
    expect(source).toContain("createSourceOrderedSection");
    expect(source).toContain("extractMarkdownTables");
    expect(source).toContain("extractSourceMedia");
    expect(source).toContain("createSourceMediaSection");
    expect(source).toContain("createSourceRawDetails");
    expect(source).toContain("通过审核");
    expect(source).toContain("拒绝收录");
    expect(source).toContain('tone: "danger"');
    expect(source).not.toContain("showModal");
    expect(source).not.toContain("experience-detail-modal");
    expect(source).not.toContain("renderExperienceDetailRoute(elements.desktopShell");
    expect(styles).toMatch(
      /\.desktop-shell\.asset-mode\s*\{[\s\S]*?grid-template-columns:\s*288px minmax\(0,\s*1fr\);/u,
    );
    expect(styles).not.toContain(".desktop-shell.asset-mode .sidebar");
    expect(source).not.toContain("description: item.evidencePreview || item.summary");
    expect(source).not.toContain("summary: candidate.evidencePreview || candidate.summary");
  });

  it("opens a skill title as a full middle-page detail route instead of a modal or right aside", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    const commandListHandler = extractFunctionSource(source, "installEventHandlers");
    const renderAssetSurface = extractFunctionSource(source, "renderAssetSurface");
    const detailRoute = extractFunctionSource(source, "renderSkillDetailRoute");
    const detailDocument = extractFunctionSource(source, "createSkillDetailDocument");
    const detailMeta = extractFunctionSource(source, "createSkillDetailMetaPanel");
    const snapshotEditor = extractFunctionSource(source, "createSkillSnapshotEditor");
    const skillDetail = extractFunctionSource(source, "createSkillAssetDetail");
    const detailActions = extractFunctionSource(source, "renderSkillDetailRoute");

    expect(commandListHandler).toContain(
      "selectAssetDetail(assetButton.dataset.assetSurface, assetButton.dataset.assetId)",
    );
    expect(renderAssetSurface).toContain(
      'if (surfaceId === "skills" && selectedDetail?.kind === "skill")',
    );
    expect(renderAssetSurface).toContain(
      "renderSkillDetailRoute(elements.commandList, selectedDetail, group)",
    );
    expect(renderAssetSurface).toMatch(
      /renderSkillDetailRoute\(elements\.commandList, selectedDetail, group\);\n\s+return;\n\s+\}/u,
    );
    expect(detailRoute).toContain('header.className = "skill-detail-header"');
    expect(detailRoute).toContain('body.className = "skill-detail-route-body"');
    expect(detailRoute).toContain("createSkillDetailNav()");
    expect(detailRoute).toContain("createSkillDetailDocument(detail, group)");
    expect(detailRoute).toContain("createSkillDetailMetaPanel(skill)");
    expect(detailActions).toContain("createSkillDirectActions(skill)");
    expect(detailDocument).toContain('article.className = "skill-detail-document"');
    expect(detailDocument).toContain("skill.chineseIntro");
    expect(detailDocument).toContain("skill.description");
    expect(detailDocument).toContain("skill.content");
    expect(detailDocument).toContain("formatSkillOrigin(skill)");
    expect(detailDocument).toContain("formatList(skill.toolNames)");
    expect(detailDocument).toContain("createSkillExplanationSurfaceBlock(skill.explanationSurface");
    expect(detailDocument).toContain("formatSkillPermissionDetail(skill)");
    expect(detailDocument).toContain("skill.auditSummary");
    expect(detailDocument).toContain("detail.snapshotPath");
    expect(detailMeta).toContain('panel.className = "skill-detail-meta"');
    expect(detailMeta).toContain("createSkillSnapshotEditor(skill)");
    expect(detailMeta).toContain("createSkillExplanationSurfaceBlock(skill.explanationSurface");
    expect(detailMeta).toContain("createSkillRuntimeDiagnostics(skill)");
    expect(snapshotEditor).toContain('form.className = "skill-edit-form"');
    expect(snapshotEditor).toContain("type: DESKTOP_ACTIONS.SKILL_UPDATE");
    expect(snapshotEditor).toContain("readSkillEditField(form, \"description\")");
    expect(snapshotEditor).toContain("parseSkillListField(readSkillEditField(form, \"tags\"))");
    expect(detailMeta).toContain("formatSkillRiskLabel(skill.riskLevel)");
    expect(detailMeta).toContain("formatSkillTrustLabel(skill.trustStatus)");
    expect(detailMeta).toContain("formatSkillModelVisibility(skill)");
    expect(detailMeta).toContain("formatSkillEligibility(skill)");
    expect(detailMeta).toContain("formatSkillPermissionStatus(skill)");
    expect(detailMeta).toContain("formatSkillSnapshotVersion(skill)");
    expect(skillDetail).toContain('kind: "skill"');
    expect(skillDetail).toContain("skill,");
    expect(skillDetail).toContain("snapshotPath: skills.snapshotPath");
    expect(skillDetail).toContain('label: "风险等级"');
    expect(skillDetail).toContain('label: "启用状态"');
    expect(skillDetail).toContain('label: "中文简介"');
    expect(skillDetail).toContain('label: "模型可见"');
    expect(skillDetail).toContain('label: "召回资格"');
    expect(skillDetail).toContain('label: "未检查工具"');
    expect(skillDetail).toContain('label: "下一步"');
    expect(skillDetail).toContain('label: "权限状态"');
    expect(skillDetail).toContain('label: "状态说明"');
    expect(skillDetail).toContain('label: "快照版本"');
    expect(skillDetail).toContain('label: "权限"');
    expect(skillDetail).toContain('label: "审计状态"');
    expect(source).not.toContain("showModal");
    expect(source).not.toContain("skill-detail-modal");
    expect(source).not.toContain("renderSkillDetailRoute(elements.desktopShell");
    expect(styles).toMatch(
      /\.desktop-shell\.asset-mode\s*\{[\s\S]*?grid-template-columns:\s*288px minmax\(0,\s*1fr\);/u,
    );
    expect(styles).not.toContain(".desktop-shell.asset-mode .sidebar");
  });

  it("renders Skill proposals as review-gated rows with full detail and direct actions", async () => {
    const source = await readAppSource();

    const renderAssetSurface = extractFunctionSource(source, "renderAssetSurface");
    const skillsSurface = extractFunctionSource(source, "renderSkillsAssetSurface");
    const proposalTable = extractFunctionSource(source, "createSkillProposalTable");
    const proposalRow = extractFunctionSource(source, "createSkillProposalTableRow");
    const proposalTitle = extractFunctionSource(source, "createSkillProposalTitleCell");
    const proposalDetail = extractFunctionSource(source, "renderSkillProposalDetailRoute");
    const proposalActions = extractFunctionSource(source, "createSkillProposalDirectActions");
    const experiencePrompts = extractFunctionSource(source, "createExperienceReviewPrompts");

    expect(renderAssetSurface).toContain('selectedDetail?.kind === "skill-proposal"');
    expect(renderAssetSurface).toContain(
      "renderSkillProposalDetailRoute(elements.commandList, selectedDetail, group)",
    );
    expect(skillsSurface).toContain("createSkillProposalTable(skills?.proposals ?? [])");
    expect(proposalTable).toContain("Skill 候选");
    expect(proposalTable).toContain("skill-proposal-table");
    expect(proposalRow).toContain("createSkillProposalTitleCell(proposal)");
    expect(proposalRow).toContain("createSkillProposalActionCell(proposal)");
    expect(proposalTitle).toContain("button.dataset.assetId = `proposal:${proposal.id}`");
    expect(proposalDetail).toContain("createSkillProposalDetailNav()");
    expect(proposalDetail).toContain("createSkillProposalDetailDocument(detail)");
    expect(proposalDetail).toContain("createSkillProposalDetailMetaPanel(proposal)");
    expect(proposalActions).toContain("DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT");
    expect(proposalActions).toContain("DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT");
    expect(proposalActions).toContain("DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY");
    expect(experiencePrompts).toContain("DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE");
    expect(experiencePrompts).toMatch(
      /createUiSelectAssetAction\(\s*"experience",\s*`knowledge:\$\{candidate\.knowledgeCandidateId\}`,\s*\)/u,
    );
    expect(source).not.toMatch(/\bskill-proposal-modal\b|\bshowModal\b/u);
  });

  it("renders Skill curator explanation surfaces in Skills and Review details", async () => {
    const source = await readAppSource();

    const curatorPanel = extractFunctionSource(source, "createSkillCuratorRow");
    const reviewDetail = extractFunctionSource(source, "createReviewAssetDetail");

    expect(curatorPanel).toContain("createSkillExplanationSurfaceBlock(action.explanationSurface");
    expect(reviewDetail).toContain("action.explanationSurface?.curatorExplanation");
    expect(reviewDetail).toContain("formatList(action.explanationSurface?.nextActions");
    expect(reviewDetail).toContain("formatList(action.explanationSurface?.evidenceRefs");
  });

  it("renders Skill curator patch editor with diff confirmation", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    const curatorRow = extractFunctionSource(source, "createSkillCuratorRow");
    const patchEditor = extractFunctionSource(source, "createSkillCuratorPatchEditor");
    const diffPreview = extractFunctionSource(source, "createSkillCuratorPatchDiffPreview");
    const payloadReader = extractFunctionSource(source, "readSkillCuratorPatchEditorPayload");
    const reviewDetail = extractFunctionSource(source, "createReviewAssetDetail");

    expect(curatorRow).toContain("createSkillCuratorPatchEditor(action)");
    expect(patchEditor).toContain("data-skill-curator-patch-field");
    expect(patchEditor).toContain("diff confirmation");
    expect(patchEditor).toContain("我已核对 diff，只应用上方 bounded Skill patch");
    expect(patchEditor).toContain("DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH");
    expect(patchEditor).toContain('operatorScope: "skills.curator.write"');
    expect(patchEditor).toContain("patchEditorPayload");
    expect(diffPreview).toContain("editable fields: version, content, tags, toolNames");
    expect(payloadReader).toContain("patchEditorPayload");
    expect(reviewDetail).toContain("bounded file scope");
    expect(reviewDetail).toContain("remote curator write execution remains disabled");
    expect(styles).toContain(".skill-curator-patch-editor");
    expect(styles).toContain(".skill-curator-patch-diff-preview");
    expect(styles).toContain(".skill-curator-diff-confirmation");
    expect(styles).toContain(".skill-curator-patch-field");
  });

  it("opens a tool adapter as a full middle-page detail route with direct backend commands", async () => {
    const source = await readAppSource();
    const systemHandlers = await readDesktopSystemHandlersSource();
    const styles = await readStylesSource();

    const renderAssetSurface = extractFunctionSource(source, "renderAssetSurface");
    const detailRoute = extractFunctionSource(source, "renderToolDetailRoute");
    const detailDocument = extractFunctionSource(source, "createToolDetailDocument");
    const detailMeta = extractFunctionSource(source, "createToolDetailMetaPanel");
    const toolDetail = extractFunctionSource(source, "createToolAssetDetail");
    const toolActions = extractFunctionSource(source, "createToolActionPrompts");
    const toolEnablement = extractFunctionSource(source, "createToolEnablementSwitch");
    const toolEnablementAction = extractFunctionSource(source, "createToolEnablementAction");
    const toolsSurface = extractFunctionSource(source, "renderToolsAssetSurface");
    const toolList = extractFunctionSource(source, "createExternalToolList");
    const settingsToolsTab = extractFunctionSource(source, "renderSettingsExternalToolsTab");
    const settingsToolBus = extractFunctionSource(source, "createSettingsExternalToolBusPanel");
    const extensionControlPlane = extractFunctionSource(
      source,
      "createAgentOsExtensionControlPlanePanel",
    );
    const extensionControlPlaneRow = extractFunctionSource(
      source,
      "createAgentOsExtensionControlPlaneRow",
    );
    const extensionMatrixHealth = extractFunctionSource(source, "summarizeAgentOsExtensionMatrix");
    const toolBusList = extractFunctionSource(source, "createExternalToolBusList");
    const toolBusHealthPanel = extractFunctionSource(source, "createExternalToolBusHealthPanel");
    const toolBusLedger = extractFunctionSource(source, "createExternalToolProcessLedger");
    const toolHistory = extractFunctionSource(source, "createExternalToolExecutionHistory");
    const toolHistoryRow = extractFunctionSource(source, "createExternalToolExecutionRow");
    const settingsToolHistory = extractFunctionSource(source, "createSettingsExternalToolExecutionTable");
    const toolRow = extractFunctionSource(source, "createToolTableRow");
    const toolBusRow = extractFunctionSource(source, "createExternalToolBusRow");
    const toolBusMetaStrip = extractFunctionSource(source, "createExternalToolBusMetaStrip");
    const toolBusRowActions = extractFunctionSource(source, "createExternalToolBusRowActions");
    const toolLastKnownGood = extractFunctionSource(source, "formatExternalToolLastKnownGood");
    const bridgeEventHandler = extractFunctionSource(source, "handleNativeBridgeEvent");
    const mergeToolTimelineEvent = extractFunctionSource(source, "mergeExternalToolTimelineEvent");
    const conversationRuntimeText = extractFunctionSource(
      systemHandlers,
      "runDesktopApiProviderTextViaConversationRuntime",
    );

    expect(renderAssetSurface).toContain(
      'if (surfaceId === "tools" && selectedDetail?.kind === "tool")',
    );
    expect(renderAssetSurface).toContain(
      "renderToolDetailRoute(elements.commandList, selectedDetail, group)",
    );
    expect(renderAssetSurface).toMatch(
      /renderToolDetailRoute\(elements\.commandList, selectedDetail, group\);\n\s+return;\n\s+\}/u,
    );
    expect(detailRoute).toContain('header.className = "tool-detail-header"');
    expect(detailRoute).toContain("actions.append(createToolEnablementSwitch(adapter))");
    expect(detailRoute).toContain('body.className = "tool-detail-route-body"');
    expect(detailRoute).toContain("createToolDetailNav()");
    expect(detailRoute).toContain("createToolDetailDocument(detail, group)");
    expect(detailRoute).toContain("createToolDetailMetaPanel(detail.adapter)");
    expect(detailDocument).toContain('article.className = "tool-detail-document"');
    expect(detailDocument).toContain("formatAdapterActionCatalog(adapter.actions)");
    expect(detailDocument).toContain("formatAdapterActionContracts(adapter.actions)");
    expect(detailDocument).toContain("adapter.auditSummary");
    expect(detailDocument).toContain("detail.registryRoot");
    expect(detailMeta).toContain('panel.className = "tool-detail-meta"');
    expect(detailMeta).toContain("formatBoolean(adapter.enabled)");
    expect(detailMeta).toContain("formatAdapterApprovalMode(adapter.approvalMode)");
    expect(toolDetail).toContain('kind: "tool"');
    expect(toolDetail).toContain("adapter,");
    expect(toolDetail).toContain("registryRoot: tools.registryRoot");
    expect(toolDetail).toContain("actionPrompts: createToolActionPrompts(adapter)");
    expect(toolsSurface).toContain("createExternalToolBusList(tools?.externalToolBus)");
    expect(toolsSurface).toContain(
      'createAgentOsExtensionControlPlanePanel(tools?.externalToolBus, { surface: "tools" })',
    );
    expect(toolsSurface).toContain("createExternalToolExecutionHistory(tools?.externalToolBus)");
    expect(toolsSurface).toContain("createExternalToolProcessLedger(tools?.externalToolBus)");
    expect(settingsToolsTab).toContain("createSettingsExternalToolBusPanel");
    expect(settingsToolBus).toContain(
      'createAgentOsExtensionControlPlanePanel(externalToolBus, { surface: "settings" })',
    );
    expect(extensionControlPlane).toContain("Agent OS 扩展控制面");
    expect(extensionControlPlane).toContain("agentOsExtensionMatrix");
    expect(extensionControlPlane).toContain("agentOsExtensionMatrix.summary");
    expect(extensionControlPlane).toContain("createAgentOsExtensionControlPlaneRow");
    expect(extensionControlPlane).toContain("summarizeAgentOsExtensionMatrix");
    expect(extensionControlPlaneRow).toContain("entry.toolId");
    expect(extensionControlPlaneRow).toContain("entry.health?.status");
    expect(extensionControlPlaneRow).toContain("entry.health?.checkFn");
    expect(extensionControlPlaneRow).toContain("entry.capabilityIds");
    expect(extensionControlPlaneRow).toContain("entry.sandbox?.defaultMode");
    expect(extensionControlPlaneRow).toContain("entry.sandbox?.networkPolicy");
    expect(extensionControlPlaneRow).toContain("entry.sandbox?.requiresCommandPattern");
    expect(extensionControlPlaneRow).toContain("entry.sourceTrust?.status");
    expect(extensionMatrixHealth).toContain("summary.ready");
    expect(extensionMatrixHealth).toContain("summary.needsAuth");
    expect(extensionMatrixHealth).toContain("summary.needsSetup");
    expect(settingsToolBus).toContain("外部工具总线");
    expect(settingsToolBus).toContain("Catalog / Effective / Doctor");
    expect(settingsToolBus).toContain("externalToolBus.catalogCount");
    expect(settingsToolBus).toContain("createSettingsExternalToolExecutionTable(externalToolBus)");
    expect(settingsToolBus).toContain("createExternalToolProcessLedger(externalToolBus)");
    expect(settingsToolHistory).toContain("externalToolBus?.history");
    expect(toolBusList).toContain("外部工具总线");
    expect(toolBusList).toContain("Catalog / Effective / Doctor");
    expect(toolBusHealthPanel).toContain("catalogCount");
    expect(toolBusHealthPanel).toContain("effectiveCount");
    expect(toolBusHealthPanel).toContain("unavailableCount");
    expect(toolBusHealthPanel).toContain("lastKnownGoodCount");
    expect(toolBusHealthPanel).toContain("processCapabilityLedger");
    expect(toolBusList).toContain("createExternalToolBusHealthPanel(externalToolBus)");
    expect(settingsToolBus).toContain("createExternalToolProviderMatrixPanel(externalToolBus)");
    expect(toolBusHealthPanel).toContain("summarizeExternalToolBusHealth(externalToolBus)");
    expect(source).toContain("function createExternalToolProviderMatrixPanel(externalToolBus)");
    expect(source).toContain("externalToolBus?.providerMatrix?.providers");
    expect(toolBusList).toContain("createExternalToolBusRow");
    expect(settingsToolBus).toContain("summarizeExternalToolBusHealth(externalToolBus)");
    expect(settingsToolBus).toContain("lastKnownGoodCount");
    expect(toolBusLedger).toContain("processCapabilityLedger");
    expect(toolBusLedger).toContain("OS / Process Ledger");
    expect(toolBusLedger).toContain("commandPattern");
    expect(toolBusLedger).toContain("process?.signal");
    expect(toolBusRow).toContain("item.canInvoke");
    expect(toolBusRow).toContain("item.doctor?.summary");
    expect(toolBusRow).toContain("formatExternalToolSourceTrust");
    expect(toolBusRow).toContain("formatExternalToolInstallPolicy");
    expect(toolBusRow).toContain("formatExternalToolApprovalBoundary");
    expect(toolBusRow).toContain("formatExternalToolBusStatus");
    expect(toolBusRow).toContain("formatExternalToolBusCapabilities");
    expect(toolBusRow).toContain("formatExternalToolLastKnownGood(item.lastKnownGood)");
    expect(settingsToolBus).toContain("formatExternalToolLastKnownGood(item.lastKnownGood)");
    expect(toolLastKnownGood).toContain("最近可用");
    expect(toolLastKnownGood).toContain("lastKnownGood.checkedAtMs");
    expect(settingsToolBus).toContain("formatExternalToolSourceTrust");
    expect(settingsToolBus).toContain("formatExternalToolInstallPolicy");
    expect(toolBusRowActions).toContain("EXTERNAL_TOOL_MANAGE");
    expect(toolBusRowActions).toContain("COMFYUI_LIFECYCLE");
    expect(toolBusRowActions).toContain("COMFYUI_FIX_DEPENDENCIES");
    expect(toolBusRowActions).toContain('operation: "install"');
    expect(toolBusRowActions).toContain('item.source === "mcp"');
    expect(toolBusRowActions).toContain('toolId: item.id');
    expect(toolBusRowActions).toContain('operation: "delete"');
    expect(toolBusRowActions).toContain("dryRun: true");
    expect(systemHandlers).toContain('id: "install"');
    expect(systemHandlers).toContain("planDirectorComfyUiInstall");
    expect(systemHandlers).toContain("runDirectorComfyUiInstall");
    expect(toolHistory).toContain("外部工具执行");
    expect(toolHistory).toContain("activeExecutionCount");
    expect(toolHistory).toContain("createExternalToolExecutionRow(execution)");
    expect(toolHistoryRow).toContain("formatExternalToolExecutionStatus");
    expect(bridgeEventHandler).toContain('event?.type === "external-tool.timeline"');
    expect(mergeToolTimelineEvent).toContain("externalToolExecution");
    expect(mergeToolTimelineEvent).toContain("activeExecutionCount");
    expect(mergeToolTimelineEvent).toContain("renderCommandList()");
    expect(source).toContain("function applyExternalToolBusSnapshot(externalToolBus)");
    expect(conversationRuntimeText).toContain("apiProviderRun: {");
    expect(conversationRuntimeText).toContain("...boundedRunResult.runResult");
    expect(conversationRuntimeText).not.toContain("apiProviderRun: {\n      ...runResult");
    expect(styles).toContain(".external-tool-execution-row");
    expect(toolList).toContain("createToolTableRow(item)");
    expect(toolRow).toContain("createToolActionCell(item)");
    expect(toolActions).toContain('adapter.id === "comfyui-media"');
    expect(toolActions).toContain("DESKTOP_ACTIONS.COMFYUI_TEST");
    expect(toolActions).toContain('type: "ui.selectSettingsTab"');
    expect(toolActions).toContain(
      'action: createCommandRunAction("adapter.explain", { adapterId: adapter.id })',
    );
    expect(toolEnablement).toContain("createToolEnablementAction(tool, enabled)");
    expect(toolEnablementAction).toContain("DESKTOP_ACTIONS.EXTERNAL_TOOL_MANAGE");
    expect(toolEnablementAction).toMatch(
      /createCommandRunAction\(enabled \? "adapter\.enable" : "adapter\.disable"/u,
    );
    expect(toolDetail).not.toContain("prompt: `/工具 说明 ${adapter.id}`");
    expect(toolDetail).not.toContain(
      'prompt: `/工具 ${adapter.enabled ? "禁用" : "启用"} ${adapter.id}`',
    );
    expect(toolsSurface).toContain("countExternalToolBusCallableItems(tools?.externalToolBus)");
    expect(toolsSurface).toContain("总线可调用");
    expect(toolsSurface).toContain("配置已启用");
    expect(toolBusMetaStrip).toContain("运行时已启用");
    expect(toolBusMetaStrip).toContain("运行时不可调用");
    expect(source).toContain("function countExternalToolBusCallableItems(externalToolBus)");
    expect(source).toContain("配置已启用");
    expect(styles).toContain(".tool-detail-header");
    expect(styles).toContain(".tool-detail-route-body");
    expect(source).not.toContain("renderToolDetailRoute(elements.desktopShell");
  });

  it("renders Browser and Chrome provider as a function console with profile and security signals", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();

    const settingsToolsTab = extractFunctionSource(source, "renderSettingsExternalToolsTab");
    const browserPanel = extractFunctionSource(source, "createBrowserProviderSettingsPanel");
    const userProfileReader = extractFunctionSource(source, "readBrowserProviderUserProfile");
    const profileStateFormatter = extractFunctionSource(source, "formatBrowserChromeProfileState");
    const cdpReadinessFormatter = extractFunctionSource(source, "formatBrowserCdpReadiness");
    const profileMatrix = extractFunctionSource(source, "createBrowserProviderProfileMatrix");
    const securityAudit = extractFunctionSource(source, "createBrowserProviderSecurityAuditPanel");
    const actionBar = extractFunctionSource(source, "createBrowserProviderActionBar");
    const guidancePanel = extractFunctionSource(source, "createBrowserProviderGuidancePanel");

    expect(settingsToolsTab).toContain("createBrowserProviderSettingsPanel(externalToolBus)");
    expect(browserPanel).toContain("Browser 功能台");
    expect(browserPanel).toContain("createBrowserProviderProfileMatrix(browser)");
    expect(browserPanel).toContain("createBrowserProviderSecurityAuditPanel(browser)");
    expect(browserPanel).toContain("createBrowserProviderActionBar(browser, metadata)");
    expect(browserPanel).toContain("createBrowserProviderGuidancePanel(browser)");
    expect(userProfileReader).toContain("browser?.metadata?.providers?.user");
    expect(profileStateFormatter).toContain("真实 Chrome 登录态");
    expect(profileStateFormatter).toContain("已连接");
    expect(profileStateFormatter).toContain("未连上");
    expect(cdpReadinessFormatter).toContain("CDP 已就绪");
    expect(cdpReadinessFormatter).toContain("CDP 未就绪");
    expect(profileMatrix).toContain("内置浏览器");
    expect(profileMatrix).toContain("Angel 专用 Chrome");
    expect(profileMatrix).toContain("真实 Chrome 登录态");
    expect(profileMatrix).toContain("不要用内置浏览器冒充");
    expect(securityAudit).toContain("远程 CDP 默认禁止");
    expect(securityAudit).toContain("Site-level permissions");
    expect(securityAudit).toContain("supports_persistent_profile_mutation");
    expect(securityAudit).toContain("allowPrivateUrls");
    expect(actionBar).toContain('manageBrowserProvider("enable", { profile: "user" })');
    expect(actionBar).toContain('manageBrowserProvider("delete")');
    expect(guidancePanel).toContain("参考 Claude Code / OpenClaw / Hermes");
    expect(guidancePanel).toContain("不要假装已经用你的 Chrome 登录态读到了");
    expect(styles).toContain(".settings-browser-function-console");
    expect(styles).toContain(".browser-profile-matrix");
    expect(styles).toContain(".browser-security-audit-panel");
    expect(styles).toContain(".browser-provider-action-bar");
  });

  it("renders running review as a backend-bound queue table with full detail routes", async () => {
    const source = await readAppSource();

    const librarySurface = extractFunctionSource(source, "renderReviewAssetSurface");
    const toolbar = extractFunctionSource(source, "createReviewLibraryToolbar");
    const queueItems = extractFunctionSource(source, "createReviewQueueItems");
    const layout = extractFunctionSource(source, "createReviewConsoleLayout");
    const governancePanel = extractFunctionSource(source, "createReviewMemoryGovernancePanel");
    const governanceSummary = extractFunctionSource(
      source,
      "summarizeLearningGovernanceHeartbeatItems",
    );
    const governanceEvidenceParser = extractFunctionSource(
      source,
      "parseLearningGovernanceEvidenceRefs",
    );
    const sidebar = extractFunctionSource(source, "createReviewQueueSidebar");
    const attention = extractFunctionSource(source, "createReviewAttentionSummary");
    const table = extractFunctionSource(source, "createReviewTable");
    const row = extractFunctionSource(source, "createReviewTableRow");
    const titleCell = extractFunctionSource(source, "createReviewTitleCell");
    const detail = extractFunctionSource(source, "createReviewAssetDetail");

    expect(librarySurface).toContain("createReviewQueueItems(review)");
    expect(librarySurface).toContain("createReviewMemoryGovernancePanel(review)");
    expect(librarySurface).toContain("createReviewLibraryToolbar(items)");
    expect(librarySurface).toContain("createReviewConsoleLayout(items, review)");
    expect(governancePanel).toContain('panel.className = "review-memory-governance-panel"');
    expect(governancePanel).toContain("summarizeLearningGovernanceHeartbeatItems");
    expect(governancePanel).toContain('createMetricBlock("已接受经验积压"');
    expect(governancePanel).toContain('createMetricBlock("待审经验积压"');
    expect(governancePanel).toContain('createMetricBlock("缺召回评测知识"');
    expect(governancePanel).toContain("DESKTOP_ACTIONS.MAINTENANCE_PREVIEW");
    expect(governancePanel).toContain("DESKTOP_ACTIONS.MAINTENANCE_APPLY");
    expect(governancePanel).toContain("createReviewMemoryEvidenceOpsPanel");
    const evidenceOpsPanel = extractFunctionSource(source, "createReviewMemoryEvidenceOpsPanel");
    const readCard = extractFunctionSource(source, "createReviewMemoryReadCard");
    expect(evidenceOpsPanel).toContain('panel.className = "review-memory-evidence-ops"');
    expect(evidenceOpsPanel).toContain("createReviewMemoryGovernanceCard");
    expect(evidenceOpsPanel).toContain("createReviewEvidenceLookupCard");
    const governanceCard = extractFunctionSource(source, "createReviewMemoryGovernanceCard");
    const evidenceLookupCard = extractFunctionSource(source, "createReviewEvidenceLookupCard");
    expect(readCard).toContain('createCommandRunAction("memory.status")');
    expect(readCard).toContain('createCommandRunAction("memory.publications"');
    expect(governanceCard).toContain('recordInput.placeholder = "运行记忆 record id"');
    expect(governanceCard).toContain('createCommandRunAction("memory.publicationDemote"');
    expect(governanceCard).toContain('createCommandRunAction("memory.publicationRetract"');
    expect(governanceCard).toContain('createCommandRunAction("memory.publicationQuarantine"');
    expect(governanceCard).toContain('createCommandRunAction("memory.publicationRestore"');
    expect(evidenceLookupCard).toContain('runInput.placeholder = "Run id"');
    expect(evidenceLookupCard).toContain('evidenceInput.placeholder = "Evidence id"');
    expect(evidenceLookupCard).toContain('createCommandRunAction("evidence.list"');
    expect(evidenceLookupCard).toContain('createCommandRunAction("evidence.view"');
    expect(evidenceLookupCard).toContain('createCommandRunAction("evidence.content"');
    expect(governanceSummary).toContain('"maintenance-due"');
    expect(governanceSummary).toContain("parseLearningGovernanceEvidenceRefs");
    expect(governanceEvidenceParser).toContain("learning-governance://");
    expect(governanceEvidenceParser).toContain("accepted-experience-backlog");
    expect(governanceEvidenceParser).toContain("pending-experience-backlog");
    expect(governanceEvidenceParser).toContain("published-knowledge-missing-recall-eval");
    expect(toolbar).toContain('toolbar.className = "review-library-toolbar"');
    expect(toolbar).toContain('search.dataset.reviewFilter = "query"');
    expect(toolbar).toContain('lane.dataset.reviewFilter = "lane"');
    expect(toolbar).toContain('status.dataset.reviewFilter = "status"');
    expect(toolbar).toContain('["heartbeat", "心跳"]');
    expect(layout).toContain("createReviewQueueSidebar(items, review)");
    expect(layout).toContain("createReviewTable(items)");
    expect(sidebar).toContain("createReviewAttentionSummary(review, items)");
    expect(sidebar).toContain('attentionTitle.textContent = "优先处理"');
    expect(attention).toContain("heartbeatAttentionCount");
    expect(attention).toContain("failedRunCount");
    expect(attention).toContain("pendingReviewCount");
    expect(attention).toContain('"记忆/复盘提醒"');
    expect(attention).toContain('"记忆治理"');
    expect(attention).toContain("summarizeLearningGovernanceHeartbeatItems");
    expect(table).toContain('table.className = "review-table"');
    expect(table).toContain("运行与审查列表");
    for (const label of ["项目", "板块", "状态", "时间", "操作"]) {
      expect(table).toContain(`"${label}"`);
    }
    expect(row).toContain("row.dataset.lane = item.lane");
    expect(row).toContain("row.dataset.status = item.status");
    expect(titleCell).toContain('button.className = "review-title-link"');
    expect(titleCell).toContain('button.dataset.assetSurface = "review"');
    expect(titleCell).toContain("button.dataset.assetId = item.assetId");
    expect(queueItems).toContain("assetId: `experience:${candidate.id}`");
    expect(queueItems).toContain("assetId: `knowledge:${candidate.id}`");
    expect(queueItems).toContain("assetId: `trace:${proposal.id}`");
    expect(queueItems).toContain("assetId: `run:${run.runId}`");
    expect(queueItems).toContain("review?.executionReportItems");
    expect(queueItems).toContain("assetId: `report:${report.reportId}`");
    expect(queueItems).toContain("review?.heartbeatItems");
    expect(queueItems).toContain("assetId: `heartbeat:${event.eventId}`");
    expect(queueItems).toContain("priorityStatus: event.severity");
    expect(source).toContain("warn: 2");
    expect(source).toContain("info: 8");
    expect(detail).toContain('kind: "review-experience"');
    expect(detail).toContain('kind: "review-knowledge"');
    expect(detail).toContain('kind: "review-trace"');
    expect(detail).toContain('kind: "review-run"');
    expect(detail).toContain('kind: "review-report"');
    expect(detail).toContain('kind: "review-heartbeat"');
  });

  it("wires review detail buttons to native actions or command.run instead of composer prompts", async () => {
    const source = await readAppSource();

    const renderAssetSurface = extractFunctionSource(source, "renderAssetSurface");
    const detailRoute = extractFunctionSource(source, "renderReviewDetailRoute");
    const detailDocument = extractFunctionSource(source, "createReviewDetailDocument");
    const assignmentActions = extractFunctionSource(source, "createAssignmentDirectActions");
    const traceActions = extractFunctionSource(source, "createTraceProposalDirectActions");
    const runActions = extractFunctionSource(source, "createRunDirectActions");
    const reportActions = extractFunctionSource(source, "createReportDirectActions");
    const heartbeatActions = extractFunctionSource(source, "createHeartbeatDirectActions");
    const commandAction = extractFunctionSource(source, "createCommandRunAction");

    expect(renderAssetSurface).toContain(
      'if (surfaceId === "review" && selectedDetail?.kind?.startsWith("review-"))',
    );
    expect(renderAssetSurface).toContain(
      "renderReviewDetailRoute(elements.commandList, selectedDetail, group)",
    );
    expect(detailRoute).toContain('header.className = "review-detail-header"');
    expect(detailRoute).toContain('body.className = "review-detail-route-body"');
    expect(detailRoute).toContain("createReviewDetailNav(detail)");
    expect(detailRoute).toContain("createReviewDetailDocument(detail, group)");
    expect(detailRoute).toContain("createReviewDetailMetaPanel(detail)");
    expect(detailDocument).toContain("createReviewDecisionPanel(detail)");
    expect(detailDocument).toContain("createReviewOverviewPanel(detail)");
    expect(detailDocument).toContain("createReviewAssignmentSection(detail)");
    expect(detailDocument).toContain("createReviewDelegationSection(detail)");
    expect(commandAction).toContain("type: DESKTOP_ACTIONS.COMMAND_RUN");
    expect(traceActions).toContain('"traceProposal.accept"');
    expect(traceActions).toContain('"traceProposal.reject"');
    expect(runActions).toContain("DESKTOP_ACTIONS.RUN_CONTINUE");
    expect(runActions).toContain("DESKTOP_ACTIONS.RUN_DELEGATIONS");
    expect(runActions).toContain('"run.audit"');
    expect(runActions).toContain('"run.report"');
    expect(runActions).toContain('"run.retry"');
    expect(runActions).toContain("DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS");
    expect(runActions).toContain('"run.reroute"');
    expect(reportActions).toContain("DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS");
    expect(reportActions).toContain('"run.audit"');
    expect(heartbeatActions).toContain("DESKTOP_ACTIONS.RUN_REFLECT");
    expect(heartbeatActions).toContain("DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT");
    expect(heartbeatActions).toContain("DESKTOP_ACTIONS.EXPERIENCE_PROMOTE");
    expect(heartbeatActions).toContain("DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE");
    expect(heartbeatActions).toContain("DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH");
    expect(heartbeatActions).toContain("DESKTOP_ACTIONS.MAINTENANCE_PREVIEW");
    expect(heartbeatActions).toContain("DESKTOP_ACTIONS.MAINTENANCE_APPLY");
    expect(heartbeatActions).toContain("createUiSelectAssetAction");
    expect(assignmentActions).toContain('"run.retry"');
    expect(assignmentActions).toContain("DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT");
    expect(assignmentActions).toContain('"run.reroute"');
    expect(source).toContain("DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT");
    expect(source).toContain("DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH");
    expect(source).not.toContain("createRunAssetCard");
    expect(source).not.toContain("createTraceProposalCard");
  });

  it("translates run and report details into operator-readable review pages", async () => {
    const source = await readAppSource();

    const detail = extractFunctionSource(source, "createReviewAssetDetail");
    const runSections = extractFunctionSource(source, "createReviewRunOperatorSections");
    const overviewPanel = extractFunctionSource(source, "createReviewOverviewPanel");
    const overviewItems = extractFunctionSource(source, "createReviewOverviewItems");
    const decisionPanel = extractFunctionSource(source, "createReviewDecisionPanel");
    const decisionActions = extractFunctionSource(source, "selectReviewDecisionActions");
    const decisionCopy = extractFunctionSource(source, "createReviewDecisionCopy");
    const linkedReport = extractFunctionSource(source, "findReviewReportForRun");
    const reportSections = extractFunctionSource(source, "createReviewReportOperatorSections");
    const heartbeatSections = extractFunctionSource(
      source,
      "createReviewHeartbeatOperatorSections",
    );
    const heartbeatTarget = extractFunctionSource(source, "formatHeartbeatTarget");
    const handlers = await readDesktopSystemHandlersSource();
    const deriveTarget = extractFunctionSource(handlers, "deriveHeartbeatEventTarget");
    const assignmentSection = extractFunctionSource(source, "createReviewAssignmentSection");
    const assignmentRow = extractFunctionSource(source, "createReviewAssignmentRow");
    const delegationSection = extractFunctionSource(source, "createReviewDelegationSection");
    const delegationRow = extractFunctionSource(source, "createReviewDelegationRow");
    const schedulerTick = extractFunctionSource(source, "formatReviewSubagentSchedulerTick");
    const schedulerRecoveryPlan = extractFunctionSource(
      source,
      "formatReviewSubagentSchedulerRecoveryPlan",
    );
    const humanState = extractFunctionSource(source, "formatReviewAssignmentHumanState");
    const humanReason = extractFunctionSource(source, "formatReviewAssignmentReason");
    const humanNextStep = extractFunctionSource(source, "formatReviewAssignmentNextStep");
    const approvalMode = extractFunctionSource(source, "formatReviewApprovalMode");

    expect(detail).toContain("findReviewReportForRun(review, run.runId)");
    expect(detail).toContain("createReviewRunOperatorSections(run, report)");
    expect(detail).toContain("delegationSnapshot: run.delegationSnapshot");
    expect(detail).toContain("createReviewReportOperatorSections(report)");
    expect(detail).toContain("createHeartbeatDirectActions(event)");
    expect(linkedReport).toContain("review.executionReportItems");
    expect(linkedReport).toContain("item.runId === runId");
    expect(decisionPanel).toContain("你现在只看这里");
    expect(overviewPanel).toContain('panel.className = "review-overview-panel"');
    expect(overviewItems).toContain("先批准");
    expect(overviewItems).toContain("召回情况");
    expect(decisionActions).toContain("DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS");
    expect(decisionActions).toContain("DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT");
    expect(decisionCopy).toContain("你不用复制 Run ID 或 Assignment ID");
    expect(decisionCopy).toContain("批准全部待审任务");
    for (const label of [
      "这是什么",
      "输入与召回",
      "当前状态",
      "卡点与处理",
      "产物与复盘",
      "系统证据",
    ]) {
      expect(runSections).toContain(label);
    }
    expect(runSections).toContain("formatReviewRunRecallSummary(run)");
    expect(runSections).toContain("formatReviewRunArtifactSummary(run, report)");
    expect(runSections).toContain("formatReviewDelegationSummary(run.delegationSnapshot)");
    for (const label of ["这是什么", "当前结果", "失败原因", "建议动作", "系统证据"]) {
      expect(reportSections).toContain(label);
    }
    for (const label of ["这是什么", "发现的问题", "证据与动作", "可执行处理"]) {
      expect(heartbeatSections).toContain(label);
    }
    expect(heartbeatSections).toContain('event.kind === "adapter-risk"');
    expect(heartbeatSections).toContain('event.kind === "skill-proposal-due"');
    expect(heartbeatSections).toContain('event.kind === "maintenance-due"');
    expect(heartbeatTarget).toContain('target.kind === "learning-governance"');
    expect(deriveTarget).toContain("learning-governance://");
    expect(deriveTarget).toContain('kind: "learning-governance"');
    expect(deriveTarget).toContain("readFiniteNumber");
    expect(source).toContain('"adapter-risk": "心跳：Adapter 风险"');
    expect(source).toContain('"skill-proposal-due": "心跳：经验可转 Skill"');
    expect(source).toContain('"maintenance-due": "心跳：记忆治理维护"');
    for (const label of ["任务", "现在状态", "为什么", "下一步", "动作"]) {
      expect(assignmentSection).toContain(`"${label}"`);
    }
    expect(assignmentRow).toContain("formatReviewAssignmentHumanState(assignment)");
    expect(assignmentRow).toContain("formatReviewAssignmentReason(assignment)");
    expect(assignmentRow).toContain("formatReviewAssignmentNextStep(assignment)");
    expect(delegationSection).toContain("review-delegations");
    expect(delegationSection).toContain("review-delegation-table");
    expect(delegationSection).toContain("formatReviewSubagentSchedulerTick");
    expect(delegationSection).toContain("formatReviewSubagentSchedulerRecoveryPlan");
    expect(schedulerTick).toContain("调度意图");
    expect(schedulerTick).toContain("claimDryRun=");
    expect(schedulerTick).toContain("formatReviewSubagentSchedulerTickIntents");
    expect(schedulerRecoveryPlan).toContain("恢复建议");
    expect(schedulerRecoveryPlan).toContain("canRecover=");
    expect(schedulerRecoveryPlan).toContain("groups=");
    expect(schedulerRecoveryPlan).toContain("formatReviewSubagentSchedulerRecoveryGroups");
    expect(schedulerRecoveryPlan).toContain("formatReviewSubagentSchedulerRecoveryActions");
    expect(source).toContain("function formatReviewSubagentSchedulerRecoveryGroups");
    expect(source).toContain("running=");
    expect(source).toContain("completed=");
    expect(delegationRow).toContain("formatReviewDelegationVerification(delegation, verification)");
    expect(humanState).toContain(
      "formatReviewApprovalMode(assignment.approvalMode, assignment.status)",
    );
    expect(humanReason).toContain("bridgeFailureMessage");
    expect(humanReason).toContain("blockingReason");
    expect(humanNextStep).toContain("需要人工批准");
    expect(humanNextStep).toContain("等待依赖完成后自动继续");
    expect(approvalMode).toContain("需人工批准");
    expect(approvalMode).toContain("等待依赖完成后自动允许");
  });

  it("styles skills library and detail route hooks for readable responsive layouts", async () => {
    const styles = await readStylesSource();

    for (const selector of [
      ".skill-library-toolbar",
      ".skill-status-strip",
      ".skill-library-layout",
      ".skill-source-sidebar",
      ".skill-source-row.active",
      ".skill-tag-chip",
      ".skill-list-row",
      ".skill-list-main",
      ".skill-list-detail",
      ".skill-list-controls",
      ".skill-toggle",
      ".skill-toggle-wrap",
      ".skill-row-actions",
      ".skill-action-button",
      ".skill-table",
      ".skill-title-link",
      ".skill-detail-route",
      ".skill-detail-document",
    ]) {
      expect(styles).toContain(selector);
    }
    expect(styles).toMatch(
      /\.asset-page-body-skills\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(
      /\.asset-page-body-skills > \.asset-detail-page\s*\{[\s\S]*?display:\s*none;/u,
    );
    expect(styles).toMatch(
      /\.skill-library-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(130px,\s*170px\) minmax\(140px,\s*190px\);/u,
    );
    expect(styles).toMatch(/\.skill-library-toolbar\s*\{[\s\S]*?position:\s*sticky;/u);
    expect(styles).toMatch(
      /\.skill-library-toolbar small\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?white-space:\s*normal;/u,
    );
    expect(styles).toMatch(/\.skill-status-strip\s*\{[\s\S]*?flex-wrap:\s*wrap;/u);
    expect(styles).toMatch(
      /\.skill-library-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(200px,\s*236px\) minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(/\.skill-source-sidebar\s*\{[\s\S]*?position:\s*sticky;/u);
    expect(styles).toMatch(
      /\.skill-list-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(180px,\s*260px\) 124px;/u,
    );
    expect(styles).toMatch(/\.skill-list-controls\s*\{[\s\S]*?width:\s*124px;/u);
    expect(styles).toMatch(/\.skill-list-controls \.skill-toggle-state\s*\{[\s\S]*?display:\s*none;/u);
    expect(styles).toMatch(/\.skill-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;/u);
    expect(styles).toMatch(/\.skill-table\s*\{[\s\S]*?min-width:\s*960px;/u);
    expect(styles).toMatch(/\.skill-table\s*\{[\s\S]*?table-layout:\s*fixed;/u);
    expect(styles).toMatch(/\.skill-title-link\s*\{[\s\S]*?white-space:\s*normal;/u);
    expect(styles).toMatch(
      /\.skill-detail-route-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(150px,\s*180px\) minmax\(0,\s*1fr\) minmax\(260px,\s*320px\);/u,
    );
    expect(styles).toMatch(/\.skill-detail-document\s*\{[\s\S]*?min-width:\s*0;/u);
    expect(styles).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.skill-library-layout[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.skill-source-sidebar[\s\S]*?position:\s*static;/u,
    );
  });

  it("styles review queue and detail routes as full middle-page layouts", async () => {
    const styles = await readStylesSource();

    for (const selector of [
      ".review-library-toolbar",
      ".review-memory-governance-panel",
      ".review-memory-governance-body",
      ".review-memory-governance-actions",
      ".review-memory-evidence-ops",
      ".review-memory-evidence-ops-grid",
      ".review-memory-evidence-ops-card",
      ".review-memory-evidence-ops-actions",
      ".review-console-layout",
      ".review-queue-sidebar",
      ".review-table",
      ".review-title-link",
      ".review-detail-document",
      ".review-decision-panel",
      ".review-decision-actions",
      ".review-overview-panel",
      ".review-overview-item",
      ".review-assignment-table",
      ".review-delegation-table",
    ]) {
      expect(styles).toContain(selector);
    }
    expect(styles).toMatch(
      /\.asset-page-body-review\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(
      /\.asset-page-body-review > \.asset-detail-page\s*\{[\s\S]*?display:\s*none;/u,
    );
    expect(styles).toMatch(
      /\.review-console-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(220px,\s*260px\) minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(/\.review-queue-sidebar\s*\{[\s\S]*?position:\s*sticky;/u);
    expect(styles).toMatch(/\.review-table\s*\{[\s\S]*?table-layout:\s*fixed;/u);
    expect(styles).toMatch(/\.review-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;/u);
    expect(styles).toMatch(/\.review-table\s*\{[\s\S]*?min-width:\s*900px;/u);
    expect(styles).toMatch(
      /\.review-detail-route-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(150px,\s*180px\) minmax\(0,\s*1fr\) minmax\(260px,\s*320px\);/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1240px\)[\s\S]*?\.review-detail-meta\s*\{[\s\S]*?grid-column:\s*2;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.review-console-layout[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.review-overview-panel\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u,
    );
  });

  it("hides the bottom composer on non-workbench pages while keeping the global left nav", async () => {
    const source = await readAppSource();
    const styles = await readStylesSource();
    const visibility = extractFunctionSource(source, "renderWorkbenchSurfaceVisibility");

    expect(visibility).toContain("const visible = isWorkbenchActive()");
    expect(visibility).toContain('const settingsMode = workflowId === "settings"');
    expect(visibility).toContain(
      "const assetMode = !visible && isAssetSurfaceWorkflow(workflowId)",
    );
    expect(visibility).toContain(
      'elements.desktopShell.classList.toggle("settings-mode", settingsMode)',
    );
    expect(visibility).toContain('elements.desktopShell.classList.toggle("asset-mode", assetMode)');
    expect(visibility).toContain("elements.timeline.hidden = !visible");
    expect(visibility).toContain("elements.composer.hidden = !visible");
    expect(visibility).toContain('elements.composer.classList.toggle("hidden", !visible)');
    expect(styles).toMatch(
      /\.desktop-shell\.settings-mode\s*\{[\s\S]*?grid-template-columns:\s*288px minmax\(0,\s*1fr\);/u,
    );
    expect(styles).toMatch(
      /\.desktop-shell\.asset-mode\s*\{[\s\S]*?grid-template-columns:\s*288px minmax\(0,\s*1fr\);/u,
    );
    expect(styles).not.toContain(".desktop-shell.settings-mode .sidebar");
    expect(styles).not.toContain(".desktop-shell.asset-mode .sidebar");
  });

  it("binds experience category and tag edit controls to real desktop action names", async () => {
    const source = await readAppSource();
    const taxonomyEditor = extractFunctionSource(source, "createExperienceTaxonomyEditor");
    const taxonomyCreateControl = extractFunctionSource(source, "createTaxonomyCreateControl");
    const catalogCommandsByAction = new Map(
      listDirectorDesktopCommandCatalog()
        .flatMap((group) => group.commands)
        .filter((command) => command.handler?.type === "desktopAction")
        .map((command) => [command.handler.action, command]),
    );

    expect(taxonomyEditor).toContain("type: DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE");
    expect(taxonomyEditor).toContain("actionType: DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE");
    expect(taxonomyEditor).toContain("actionType: DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE");
    expect(taxonomyCreateControl).toContain("executeAssetAction({ type: actionType, name }");
    expect(catalogCommandsByAction.get(DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE)?.id).toBe(
      "experience.classificationSave",
    );
    expect(catalogCommandsByAction.get(DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE)?.id).toBe(
      "experience.categoryCreate",
    );
    expect(catalogCommandsByAction.get(DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE)?.id).toBe(
      "experience.tagCreate",
    );
  });

  it("allows captured remote media to render inside experience source details", async () => {
    const html = await readIndexSource();

    expect(html).toContain("img-src 'self' data: https:");
    expect(html).toContain("media-src 'self' data: https:");
    expect(html).toContain("connect-src 'self' https:");
  });

  it("maps every backend snapshot panel to an inspector panel in the DOM", async () => {
    const html = await readIndexSource();
    const domPanels = new Set(
      [...html.matchAll(/data-panel="([^"]+)"/gu)].map((match) => match[1]),
    );
    const missingPanels = [...new Set(Object.values(DESKTOP_PANELS))].filter(
      (panel) => !domPanels.has(panel),
    );

    expect(missingPanels).toEqual([]);
  });

  it("lets non-workbench command cards prefill the workbench composer instead of pretending to execute", async () => {
    const source = await readAppSource();

    expect(source).toContain("createCommandActionPrompt(command)");
    expect(source).toContain("appendWorkbenchPromptButton(elements.argForm, actionPrompt)");
    expect(source).toContain('"adapter.enable": "/工具 启用 "');
    expect(source).toContain('"task.proposal-explain": "/技能 解释 "');
    expect(source).toContain('"traceProposal.explain": "/审查 解释 "');
    expect(source).toContain('"task.proposal-apply": "/技能 应用 "');
    expect(source).toContain('"knowledge.explain": "/知识 说明 "');
    expect(source).toContain('"run.approve": "/运行 批准 "');
    expect(source).toContain('"run.approvePending": "/运行 批准全部 "');
    expect(source).toContain('"run.reroute": "/运行 切换 "');
    expect(source).not.toContain("selectedCommandId: state.selectedCommandId");
  });

  it("keeps selected candidate and knowledge ids when preparing workbench prompts", async () => {
    const source = await readAppSource();

    expect(source).toContain("`/经验 晋升 ${candidateId}`");
    expect(source).toContain("`/经验 接受 ${candidateId}`");
    expect(source).toContain("`/知识 发布 ${packId}`");
    expect(source).toContain("`/知识 说明 ${packId}`");
    expect(source).not.toContain(
      "function selectExperienceAction(_candidateId, status) {\n  const commandId",
    );
  });

  it("keeps knowledge candidate review actions in the experience page backend-bound", async () => {
    const source = await readAppSource();
    const detailSource = extractFunctionSource(source, "createExperienceAssetDetail");
    const knowledgeBlock = detailSource.slice(
      detailSource.indexOf('if (assetId.startsWith("knowledge:"))'),
      detailSource.indexOf('if (assetId.startsWith("published:"))'),
    );

    expect(knowledgeBlock).toContain("actionPrompts: createKnowledgeReviewActions(candidate)");
    expect(knowledgeBlock).not.toContain("`/知识 发布 ${candidate.id}`");
    expect(knowledgeBlock).not.toContain("`/知识 接受 ${candidate.id}`");

    const publishedBlock = detailSource.slice(
      detailSource.indexOf('if (assetId.startsWith("published:"))'),
    );
    expect(publishedBlock).toContain("actionPrompts:");
    expect(publishedBlock).toContain("DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW");
    expect(publishedBlock).toContain("includeGlobalExperience: true");
  });

  it("falls back to the state inspector panel for unknown backend panel names", async () => {
    const source = await readAppSource();

    expect(source).toContain("function resolveInspectorPanelName(panelName)");
    expect(source).toContain(': "state"');
    expect(source).toContain("const resolvedPanelName = resolveInspectorPanelName(panelName)");
  });

  it("keeps non-workbench asset pages scrollable inside the fixed desktop shell", async () => {
    const source = await readAppSource();
    const mainSource = await readFile(new URL("./electron-main.cjs", import.meta.url), "utf8");
    const styles = await readStylesSource();

    expect(mainSource).toContain("DIRECTOR_DESKTOP_INITIAL_SURFACE");
    expect(mainSource).toContain("createInitialSurfaceQuery()");
    expect(source).toContain("function applyInitialSurfaceFromLocation()");
    expect(source).toContain('new URLSearchParams(window.location.search).get("surface")');
    expect(source).toContain("function resetCommandBoardScroll()");
    expect(source).toContain("function markCommandBoardScrollResetForSurface(surfaceKey)");
    expect(source).toContain("function resetCommandBoardScrollIfNeeded()");
    expect(source).toContain("requestAnimationFrame(() => resetCommandBoardScroll())");
    expect(source).toContain("elements.commandBoard.scrollTop = 0");
    expect(source).toContain("markCommandBoardScrollResetForSurface(resolveCommandBoardSurfaceKey(group))");
    expect(styles).toMatch(/\.workbench\s*\{[\s\S]*?min-height:\s*0;/u);
    expect(styles).toMatch(/\.inspector\s*\{[\s\S]*?min-height:\s*0;/u);
    expect(styles).toMatch(/\.asset-mode \.command-board\s*\{[\s\S]*?overflow-y:\s*auto;/u);
    expect(styles).toMatch(/\.asset-view \.command-board\s*\{[\s\S]*?overflow-y:\s*auto;/u);
    expect(styles).toContain(".asset-detail-page");
  });
});

async function readWorkflowSource() {
  const source = await readAppSource();
  return source.slice(source.indexOf("const WORKFLOWS"), source.indexOf("const elements"));
}

async function readAppSource() {
  return readFile(new URL("./app.js", import.meta.url), "utf8");
}

async function readElectronMainSource() {
  return readFile(new URL("./electron-main.cjs", import.meta.url), "utf8");
}

async function readDesktopSystemHandlersSource() {
  return readFile(new URL("./desktop-system-handlers.js", import.meta.url), "utf8");
}

async function readConversationRuntimeMemoryRetrievalProviderSource() {
  return readFile(
    new URL(
      "../../../packages/conversation-runtime/src/memory-retrieval-provider.ts",
      import.meta.url,
    ),
    "utf8",
  );
}

async function readIndexSource() {
  return readFile(new URL("./index.html", import.meta.url), "utf8");
}

async function readStylesSource() {
  return readFile(new URL("./styles.css", import.meta.url), "utf8");
}

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const parametersStart = source.indexOf("(", start);
  expect(parametersStart).toBeGreaterThan(start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parameterDepth += 1;
    } else if (char === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersEnd = index;
        break;
      }
    }
  }
  expect(parametersEnd).toBeGreaterThan(parametersStart);
  const bodyStart = source.indexOf("{", parametersEnd);
  expect(bodyStart).toBeGreaterThan(parametersEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Could not extract function source for ${functionName}`);
}

function collectPropertySurfaces(source, propertyName) {
  const surfaces = [];
  let workflowId = null;
  for (const line of source.split("\n")) {
    const workflowMatch = line.match(/^ {4}id: "([^"]+)",/u);
    if (workflowMatch) {
      workflowId = workflowMatch[1];
    }
    if (line.includes(`${propertyName}:`)) {
      surfaces.push(workflowId);
    }
  }
  return surfaces;
}

function collectCardBindings(source) {
  const cards = [];
  for (const workflow of source.split(/\n {2}\{\n {4}id: /u).slice(1)) {
    const workflowId = workflow.match(/^"([^"]+)"/u)?.[1] ?? null;
    const cardsBlock = workflow.match(/cards: \[\n([\s\S]*?)\n {4}\],/u)?.[1] ?? "";
    for (const cardBlock of cardsBlock.split(/\n {6}\{/u).slice(1)) {
      cards.push({
        workflowId,
        commandId: cardBlock.match(/commandId: "([^"]+)"/u)?.[1] ?? null,
      });
    }
  }
  return cards;
}

function collectWorkflowCommandIds(source) {
  const workflows = new Map();
  for (const workflow of source.split(/\n {2}\{\n {4}id: /u).slice(1)) {
    const workflowId = workflow.match(/^"([^"]+)"/u)?.[1] ?? null;
    const commandIdsBlock = workflow.match(/commandIds: \[([\s\S]*?)\n {4}\],/u)?.[1] ?? "";
    workflows.set(
      workflowId,
      [...commandIdsBlock.matchAll(/"([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.-]+)"/gu)].map(
        (match) => match[1],
      ),
    );
  }
  return workflows;
}
