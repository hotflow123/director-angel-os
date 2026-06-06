const { BrowserWindow, app, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync, existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { fileURLToPath } = require("node:url");
const { createDesktopBackgroundRuntime } = require("./desktop-background-runtime.cjs");
const { createRunCliProcessCommand } = require("./desktop-cli-process-runner.cjs");

app.setName("Director Angel");

const runtimeRoot = resolve(__dirname, "../../..");
const defaultWritableRoot = join(app.getPath("appData"), "Director Angel");
const workspaceRoot = resolveDirectorDesktopWorkspaceRoot({
  env: process.env,
  runtimeRoot,
  defaultWritableRoot,
  packaged: app.isPackaged,
});
const hotflowDataDir = resolveDirectorDesktopDataDir({
  env: process.env,
  workspaceRoot,
  defaultWritableRoot,
  packaged: app.isPackaged,
});
const hostApiUrl = process.env.DIRECTOR_HOST_API_URL?.trim() || "";
const cliMainPath = resolve(runtimeRoot, "apps/cli/dist/main.js");
const smokeMode = process.env.DIRECTOR_DESKTOP_SMOKE === "1";
const smokeWaitMs = Number.parseInt(process.env.DIRECTOR_DESKTOP_SMOKE_WAIT_MS ?? "1500", 10);
const smokeComposerPrompt = process.env.DIRECTOR_DESKTOP_SMOKE_COMPOSER_PROMPT?.trim() ?? "";
const smokeComposerTimeoutMs = Number.parseInt(
  process.env.DIRECTOR_DESKTOP_SMOKE_COMPOSER_TIMEOUT_MS ?? "180000",
  10,
);
const smokeFailures = [];
const smokeExternalOpenUrls = [];
const commandTimeoutMs = Number.parseInt(
  process.env.DIRECTOR_DESKTOP_COMMAND_TIMEOUT_MS ?? "120000",
  10,
);
const browserLearningTimeoutMs = Number.parseInt(
  process.env.DIRECTOR_DESKTOP_BROWSER_LEARN_TIMEOUT_MS ?? "25000",
  10,
);
const nativeBridgeInvokeTimeoutMs = Number.parseInt(
  process.env.DIRECTOR_DESKTOP_NATIVE_BRIDGE_TIMEOUT_MS ?? "240000",
  10,
);
const MAIN_WINDOW_ROLE = "director-angel-main";
const DEFAULT_SMOKE_EXTERNAL_NAVIGATION_URLS = Object.freeze([
  "https://x.com/hotflow/status/1",
  "https://mp.weixin.qq.com/s/director-angel-smoke",
  "https://example.com/director-angel-smoke",
]);
const desktopUserDataDir = join(hotflowDataDir, "director-desktop-user-data");
const mainWindowHtmlPath = resolve(__dirname, "index.html");
const desktopIconPath =
  process.platform === "darwin"
    ? resolve(__dirname, "../assets/DirectorAngel.icns")
    : resolve(__dirname, "../assets/director-angel-operator-logo.png");
const desktopLogPath = join(hotflowDataDir, "director-desktop", "logs", "director-desktop.log");

assertDirectorDesktopLaunchContext();
ensureDesktopRuntimeDirs({ workspaceRoot, hotflowDataDir, desktopUserDataDir });
app.setPath("userData", desktopUserDataDir);
app.setAppUserModelId?.("com.hotflow.director-angel");
process.env.DIRECTOR_ANGEL_WORKSPACE_ROOT = workspaceRoot;
process.env.HOTFLOW_WORKSPACE_ROOT = workspaceRoot;
process.env.HOTFLOW_DATA_DIR = hotflowDataDir;

const singleInstanceLock = smokeMode || app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

let bridgePromise = null;
let mainWindowPromise = null;
let mainWindow = null;
let backgroundRuntime = null;
let backgroundRuntimeRunTurn = null;
let uiStateStorePromise = null;
const runCliProcessCommand = createRunCliProcessCommand({
  spawn,
  workspaceRoot,
  commandTimeoutMs,
  processEnv: process.env,
  emitDesktopEvent,
});

ipcMain.handle("director-angel:invoke", async (_event, action) => {
  const startedAt = Date.now();
  const actionType = action?.type ?? "unknown";
  const turnId = action?.turnId ?? action?.payload?.turnId ?? "";
  logDesktopBridgeInvoke("start", { actionType, turnId });
  try {
    const bridge = await getBridgePromise();
    const result = await withTimeout(
      bridge.invoke(action),
      nativeBridgeInvokeTimeoutMs,
      `Native Bridge action ${actionType} timed out after ${nativeBridgeInvokeTimeoutMs}ms`,
    );
    logDesktopBridgeInvoke("finish", {
      actionType,
      turnId,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logDesktopBridgeInvoke("error", {
      actionType,
      turnId,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

ipcMain.handle("director-angel:uiState:read", async () => {
  const store = await getUiStateStore();
  return store.read();
});

ipcMain.handle("director-angel:uiState:write", async (_event, snapshot) => {
  const store = await getUiStateStore();
  return store.write(snapshot);
});

async function getUiStateStore() {
  if (uiStateStorePromise === null) {
    uiStateStorePromise = import("./desktop-ui-state-store.js").then((module) =>
      module.createDesktopUiStateFileStore({ dataDir: hotflowDataDir }),
    );
  }
  return uiStateStorePromise;
}

function getBridgePromise() {
  return (bridgePromise ??= createBridge());
}

function resolveDirectorDesktopWorkspaceRoot({ env, runtimeRoot, defaultWritableRoot, packaged }) {
  const configuredRoot = env.DIRECTOR_ANGEL_WORKSPACE_ROOT ?? env.HOTFLOW_WORKSPACE_ROOT;
  if (typeof configuredRoot === "string" && configuredRoot.trim().length > 0) {
    return resolve(configuredRoot);
  }
  return packaged ? join(defaultWritableRoot, "workspace") : runtimeRoot;
}

function resolveDirectorDesktopDataDir({ env, workspaceRoot, defaultWritableRoot, packaged }) {
  const configuredDataDir = env.HOTFLOW_DATA_DIR;
  if (typeof configuredDataDir === "string" && configuredDataDir.trim().length > 0) {
    return resolve(configuredDataDir);
  }
  return packaged ? join(defaultWritableRoot, ".hotflow") : join(workspaceRoot, ".hotflow");
}

function ensureDesktopRuntimeDirs({ workspaceRoot, hotflowDataDir, desktopUserDataDir }) {
  ensureWritableDir(workspaceRoot);
  ensureWritableDir(hotflowDataDir);
  ensureWritableDir(desktopUserDataDir);
}

function ensureWritableDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    if (!existsSync(dir)) {
      throw error;
    }
  }
}

function warmBridgeInBackground() {
  void getBridgePromise().catch((error) => {
    console.error("Director Angel desktop bridge failed to warm in background:", error);
  });
}

function getBackgroundRuntime() {
  return (backgroundRuntime ??= createDesktopBackgroundRuntime({
    dataDir: hotflowDataDir,
    env: process.env,
    emitDesktopEvent,
    scheduledLearningRunner:
      process.env.DIRECTOR_DESKTOP_SMOKE_BACKGROUND_LEARNING === "1"
        ? runSmokeScheduledLearningJob
        : undefined,
    runTurn: (input, context) => getBackgroundRuntimeRunTurn()(input, context),
  }));
}

function getBackgroundRuntimeRunTurn() {
  if (typeof backgroundRuntimeRunTurn === "function") {
    return backgroundRuntimeRunTurn;
  }
  return async (...args) => {
    const bridge = await getBridgePromise();
    if (typeof bridge.backgroundRuntime?.runTurn !== "function") {
      throw new Error("Director Angel desktop background runtime turn runner is unavailable.");
    }
    backgroundRuntimeRunTurn = bridge.backgroundRuntime.runTurn;
    return backgroundRuntimeRunTurn(...args);
  };
}

function startBackgroundRuntimeInBackground() {
  try {
    getBackgroundRuntime().start();
  } catch (error) {
    console.error("Director Angel desktop background runtime failed to start:", error);
  }
}

function stopBackgroundRuntime() {
  backgroundRuntime?.stop();
}

async function createBridge() {
  const [
    directorKnowledge,
    nativeBridge,
    browserFetch,
    browserToolServiceModule,
    cliSandboxRunnerModule,
    hostApiService,
    hostApiServer,
    weixinGatewayService,
  ] = await Promise.all([
    import("../../cli/dist/director-knowledge.js"),
    import("./desktop-native-bridge.js"),
    import("./desktop-browser-fetch.js"),
    import("./desktop-browser-tool-service.js"),
    import("./desktop-cli-sandbox-runner.js"),
    import("./desktop-host-api-service.js"),
    import("../../director-host-api/dist/server.js"),
    import("./desktop-weixin-gateway-service.js"),
  ]);
  const experienceFetchText = browserFetch.createDesktopBrowserLearningFetchText({
    BrowserWindow,
    timeoutMs: browserLearningTimeoutMs,
  });
  const learningFetchServer = browserFetch.createDesktopBrowserLearningFetchServer({
    fetchText: experienceFetchText,
  });
  const learningFetchEndpoint = await learningFetchServer.start({ port: 0 });
  process.env.DIRECTOR_LEARNING_FETCH_URL = learningFetchEndpoint.url;
  const browserToolService = browserToolServiceModule.createDesktopBrowserToolService({
    BrowserWindow,
    visible: process.env.DIRECTOR_BROWSER_TOOL_VISIBLE === "1",
  });
  const browserToolServer = browserToolServiceModule.createDesktopBrowserToolServer({
    browserToolService,
  });
  const browserToolEndpoint = await browserToolServer.start({ port: 0 });
  process.env.DIRECTOR_BROWSER_TOOL_URL = browserToolEndpoint.url;
  await weixinGatewayService.writeWeixinGatewayRuntimeEndpointConfig(workspaceRoot, {
    learningFetchUrl: learningFetchEndpoint.url,
    browserToolUrl: browserToolEndpoint.url,
  });
  const deferredExternalToolControlPlane = createDeferredExternalToolControlPlane();
  const managedHostApi = await hostApiService.startDesktopManagedHostApi({
    explicitHostApiUrl: hostApiUrl,
    createApp: hostApiServer.createDirectorHostApiApp,
    env: process.env,
    experienceFetchText,
    externalToolControlPlane: deferredExternalToolControlPlane.controlPlane,
    externalToolExecutionQueue: deferredExternalToolControlPlane.executionQueuePort,
  });
  const runCliCommand = cliSandboxRunnerModule.createDirectorDesktopCliSandboxRunner({
    workspaceRoot,
    dataDir: hotflowDataDir,
    cliMainPath,
    resolveCliRuntime,
    runProcessCommand: runCliProcessCommand,
  });
  const openExternalUrl = nativeBridge.createDesktopOpenExternalUrlSandboxRunner({
    cwd: workspaceRoot,
    executable: "electron-shell",
    createArgv: (url) => ["openExternal", url],
    commandRunner: async (request) => {
      const url = request.argv[1];
      await shell.openExternal(url);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  const bridge = nativeBridge.createDirectorDesktopNativeBridge({
    workspaceRoot,
    dataDir: hotflowDataDir,
    knowledge: directorKnowledge,
    hostApiUrl: managedHostApi.hostApiUrl,
    experienceFetchText,
    browserToolService,
    openExternalUrl,
    weixinGatewayOptions: {
      env: process.env,
    },
    runCliCommand,
    emitDesktopEvent,
    desktop: {
      pickDirectory: pickLearningDirectory,
    },
  });
  if (typeof bridge.backgroundRuntime?.runTurn === "function") {
    backgroundRuntimeRunTurn = bridge.backgroundRuntime.runTurn;
  }
  deferredExternalToolControlPlane.attach(bridge.externalToolControlPlane);
  deferredExternalToolControlPlane.attachExecutionQueue(bridge.externalToolExecutionQueue);
  return bridge;
}

function createDeferredExternalToolControlPlane() {
  let target = null;
  let executionQueue = null;
  const unavailableInvoke = (request = {}) => ({
    ok: false,
    status: "unavailable",
    toolId: request.toolId ?? "unknown",
    content: "Desktop external tool control plane is not ready yet.",
    error: "desktop-external-tool-control-plane-not-ready",
    trace: [
      {
        stage: "control_plane.not_ready",
        detail: "Desktop bridge has not attached its external tool control plane yet.",
        occurredAtMs: Date.now(),
      },
    ],
  });
  return {
    attach(nextTarget) {
      target = nextTarget ?? null;
    },
    attachExecutionQueue(nextQueue) {
      executionQueue = nextQueue ?? null;
    },
    get executionQueue() {
      return executionQueue;
    },
    executionQueuePort: {
      list: () => executionQueue?.list?.() ?? [],
    },
    controlPlane: {
      listCatalog: () => target?.listCatalog?.() ?? [],
      resolveEffective: (options) => target?.resolveEffective?.(options) ?? [],
      invoke: (request) => target?.invoke?.(request) ?? unavailableInvoke(request),
    },
  };
}

function emitDesktopEvent(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("director-angel:event", payload);
    }
  }
}

function withTimeout(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timeout = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  });
}

function logDesktopBridgeInvoke(phase, payload) {
  const entry = {
    timestamp: new Date().toISOString(),
    phase,
    ...payload,
  };
  try {
    mkdirSync(dirname(desktopLogPath), { recursive: true });
    appendFileSync(desktopLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write Director Angel desktop log:", error);
  }
}

function resolveCliRuntime() {
  const explicitNode = process.env.DIRECTOR_DESKTOP_NODE_EXECUTABLE;
  if (explicitNode) {
    return { executable: explicitNode, env: {} };
  }
  if (process.env.npm_node_execpath) {
    return { executable: process.env.npm_node_execpath, env: {} };
  }
  if (process.versions.electron) {
    return {
      executable: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return { executable: process.execPath, env: {} };
}

function assertDirectorDesktopLaunchContext() {
  const expectedAppPath = resolve(__dirname, "..");
  const expectedRepoRootAppPath = runtimeRoot;
  const expectedLaunchAppPath =
    typeof process.env.DIRECTOR_DESKTOP_EXPECT_APP_PATH === "string" &&
    process.env.DIRECTOR_DESKTOP_EXPECT_APP_PATH.trim().length > 0
      ? resolve(process.env.DIRECTOR_DESKTOP_EXPECT_APP_PATH)
      : expectedAppPath;
  const actualAppPath = resolve(app.getAppPath());
  const actualMain = resolve(process.argv[1] ?? "");
  const defaultElectronAppMarker = "default_app.asar";
  const unsafeLaunch =
    actualAppPath.includes(defaultElectronAppMarker) || actualMain.includes(defaultElectronAppMarker);
  if (
    !unsafeLaunch &&
    (actualAppPath === expectedLaunchAppPath ||
      actualAppPath === expectedAppPath ||
      actualAppPath === expectedRepoRootAppPath ||
      actualMain === resolve(__filename))
  ) {
    return;
  }
  console.error(
    `Director Angel desktop refused unsafe Electron launch: appPath=${actualAppPath} main=${actualMain} expected=${expectedLaunchAppPath}`,
  );
  app.exit(1);
}

async function pickLearningDirectory(action) {
  const result = await dialog.showOpenDialog({
    title: "选择 Director Angel 学习资料",
    buttonLabel: "交给 Angel",
    properties: ["openFile", "openDirectory"],
  });
  const selectedDirectory = result.canceled ? null : (result.filePaths[0] ?? null);

  return {
    selectedDirectory,
    events: [
      {
        role: "system",
        title: "目录选择",
        body:
          selectedDirectory === null ? "已取消目录选择。" : `已选择学习目录：${selectedDirectory}`,
        actionType: action.type,
      },
    ],
  };
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "Director Angel",
    icon: desktopIconPath,
    backgroundColor: "#f4f6f8",
    show: !smokeMode,
    webPreferences: {
      preload: join(__dirname, "electron-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.directorAngelWindowRole = MAIN_WINDOW_ROLE;
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  attachMainWindowNavigationGuard(window);
  attachRendererDiagnostics(window);

  const loaded =
    smokeMode === true
      ? new Promise((resolveLoaded) => {
          window.webContents.once("did-finish-load", resolveLoaded);
        })
      : null;

  await window.loadFile(join(__dirname, "index.html"), {
    query: createInitialSurfaceQuery(),
  });

  if (smokeMode) {
    await loaded;
    if (process.env.DIRECTOR_DESKTOP_SMOKE_EXTERNAL_NAVIGATION === "1") {
      await runSmokeExternalNavigationAcceptance(window);
    }
    if (process.env.DIRECTOR_DESKTOP_SMOKE_BACKGROUND_LEARNING === "1") {
      await runSmokeBackgroundLearningAcceptance(window);
    }
    if (smokeComposerPrompt.length > 0) {
      await runSmokeComposerAcceptance(window, smokeComposerPrompt);
    }
    await delay(smokeWaitMs);
    if (smokeFailures.length > 0) {
      for (const failure of smokeFailures) {
        console.error(failure);
      }
      app.exit(1);
      return;
    }
    app.quit();
    return;
  }

  window.once("ready-to-show", () => {
    window.show();
  });
}

async function ensureMainWindow() {
  if (focusMainWindow()) {
    return;
  }
  if (mainWindowPromise !== null) {
    await mainWindowPromise;
    focusMainWindow();
    return;
  }
  mainWindowPromise = createWindow();
  try {
    await mainWindowPromise;
  } finally {
    mainWindowPromise = null;
  }
}

function attachMainWindowNavigationGuard(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedDirectorMainWindowUrl(url)) {
      return { action: "allow" };
    }
    openExternalUrlOutsideMainWindow(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedDirectorMainWindowUrl(url)) {
      return;
    }
    event.preventDefault();
    openExternalUrlOutsideMainWindow(url);
  });
}

function isAllowedDirectorMainWindowUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") {
      return false;
    }
    return resolve(fileURLToPath(parsed)) === mainWindowHtmlPath;
  } catch {
    return false;
  }
}

function openExternalUrlOutsideMainWindow(url) {
  if (!shouldOpenExternallyFromMainWindow(url)) {
    return;
  }
  if (process.env.DIRECTOR_DESKTOP_SMOKE_CAPTURE_EXTERNAL === "1") {
    smokeExternalOpenUrls.push(url);
    return;
  }
  void shell.openExternal(url).catch((error) => {
    console.error("Director Angel blocked main-window navigation but failed to open externally:", error);
  });
}

function shouldOpenExternallyFromMainWindow(url) {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function createInitialSurfaceQuery() {
  const initialSurface = process.env.DIRECTOR_DESKTOP_INITIAL_SURFACE?.trim();
  return initialSurface ? { surface: initialSurface } : {};
}

function getSmokeExternalNavigationUrls() {
  const configured = process.env.DIRECTOR_DESKTOP_SMOKE_EXTERNAL_URLS?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_SMOKE_EXTERNAL_NAVIGATION_URLS;
}

async function runSmokeExternalNavigationAcceptance(window) {
  const externalUrls = getSmokeExternalNavigationUrls();
  const unexpectedNavigations = [];
  const onDidNavigate = (_event, url) => {
    if (!isAllowedDirectorMainWindowUrl(url)) {
      unexpectedNavigations.push(url);
    }
  };
  window.webContents.on("did-navigate", onDidNavigate);
  try {
    for (const url of externalUrls) {
      await window.webContents.executeJavaScript(`window.location.href = ${JSON.stringify(url)};`);
      await delay(100);
      assertSmokeMainWindowStillOnApp(url, "will-navigate");
      await window.webContents.executeJavaScript(
        `window.open(${JSON.stringify(url)}, "_blank", "noopener");`,
      );
      await delay(100);
      assertSmokeMainWindowStillOnApp(url, "window-open");
    }
  } catch (error) {
    smokeFailures.push(
      `external navigation smoke failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    window.webContents.off("did-navigate", onDidNavigate);
  }
  if (unexpectedNavigations.length > 0) {
    smokeFailures.push(`main window navigated outside app: ${unexpectedNavigations.join(", ")}`);
  }
  if (process.env.DIRECTOR_DESKTOP_SMOKE_CAPTURE_EXTERNAL === "1") {
    for (const url of externalUrls) {
      if (!smokeExternalOpenUrls.includes(url)) {
        smokeFailures.push(`external navigation was not handed off outside main window: ${url}`);
      }
    }
  }
  writeSmokeExternalNavigationArtifact({
    externalUrls,
    unexpectedNavigations,
  });
}

async function runSmokeComposerAcceptance(window, prompt) {
  const startedAt = new Date().toISOString();
  try {
    const result = await window.webContents.executeJavaScript(
      `(${runSmokeComposerInRenderer.toString()})(${JSON.stringify({
        prompt,
        timeoutMs: smokeComposerTimeoutMs,
      })})`,
      true,
    );
    const mainWindowUrl = BrowserWindow.getAllWindows().find(
      (item) => !item.isDestroyed() && item.directorAngelWindowRole === MAIN_WINDOW_ROLE,
    )?.webContents.getURL();
    const artifact = {
      schemaVersion: "director.desktop.composer-smoke.v1",
      startedAt,
      checkedAt: new Date().toISOString(),
      prompt,
      mainWindowHtmlPath,
      mainWindowUrl: mainWindowUrl ?? null,
      mainWindowStayedOnApp: Boolean(mainWindowUrl && isAllowedDirectorMainWindowUrl(mainWindowUrl)),
      result,
      failures: [...smokeFailures],
    };
    writeSmokeComposerArtifact(artifact);
    assertSmokeComposerResult(artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    smokeFailures.push(`composer smoke failed: ${message}`);
    writeSmokeComposerArtifact({
      schemaVersion: "director.desktop.composer-smoke.v1",
      startedAt,
      checkedAt: new Date().toISOString(),
      prompt,
      mainWindowHtmlPath,
      result: null,
      failures: [...smokeFailures],
    });
  }
}

async function runSmokeBackgroundLearningAcceptance(window) {
  const runtime = getBackgroundRuntime();
  const nowMs = Date.now();
  const schedule = createSmokeRoleScopedScheduledLearningSchedule(nowMs);
  runtime.scheduleStore.upsert(schedule);
  const schedulerReport = await waitForSmokeBackgroundSchedulerDispatch(runtime, schedule.scheduleId);
  const workerReport = await runtime.runWorkerOnce();
  const jobId = schedulerReport.applyReport.upsertedJobIds[0] ?? null;
  const job = jobId === null ? null : runtime.backgroundJobStore.read(jobId);
  const result = {
    completed: workerReport.completedCount > 0 && job?.status === "completed",
    schedulerReport,
    workerReport,
    job,
    pendingCandidateBoundary: {
      candidateOnly: job?.metadata?.candidateOnly === true,
      autoPublish: job?.metadata?.autoPublish === false,
      memorySync: job?.metadata?.memorySync === "skip-auto-write",
    },
    ui: await collectSmokeBackgroundLearningUi(window),
  };
  writeSmokeBackgroundLearningArtifact({
    schemaVersion: "director.desktop.background-learning-smoke.v1",
    checkedAt: new Date().toISOString(),
    mainWindowHtmlPath,
    result,
    failures: [...smokeFailures],
  });
  assertSmokeBackgroundLearningResult(result);
}

function createSmokeRoleScopedScheduledLearningSchedule(nowMs) {
  return {
    scheduleId: "role-learning:director:smoke",
    sessionKey: "role:director:learning",
    title: "导演 Angel smoke 后台学习",
    objective: "围绕导演岗位学习 smoke 资料，只生成待审经验候选。",
    schedule: { kind: "every", everyMs: 60_000, anchorMs: nowMs - 60_000 },
    state: { nextRunAtMs: nowMs - 1 },
    budget: { tokenLimit: 12000, fileCountLimit: 1, videoMinuteLimit: 0 },
    allowedTools: ["web_extract", "director.learning.url", "director.learning.admit"],
    allowedCapabilities: ["learning"],
    sourceRefs: ["https://example.test/director-background-learning-smoke"],
    metadata: {
      scheduledLearning: true,
      roleId: "director",
      roleTitle: "导演 Angel",
      roleDomain: "影视制作与 AI 工作流",
      learningScope: ["短剧制作", "AI 分镜"],
      sourcePolicy: {
        qualityGate: "high_signal_only",
        candidateOnly: true,
      },
      candidateOnly: true,
      autoPublish: false,
      memorySync: "skip-auto-write",
    },
  };
}

async function waitForSmokeBackgroundSchedulerDispatch(runtime, scheduleId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const report = runtime.scheduleOnce();
    if (report.applyReport.upsertedJobIds.length > 0) {
      return report;
    }
    await delay(100);
  }
  const report = runtime.scheduleOnce();
  smokeFailures.push(`smoke background learning did not dispatch a scheduled job: ${scheduleId}`);
  return report;
}

async function runSmokeScheduledLearningJob({ job }) {
  return {
    status: "completed",
    summary: "smoke 后台学习已生成 1 条待审候选。",
    evidenceRefIds: [`learning-artifact:${job.jobId}`],
    sourceRefs: job.sourceRefs,
    policyEnvelopeRefs: ["policy:role-learning-smoke"],
  };
}

async function collectSmokeBackgroundLearningUi(window) {
  await window.webContents.executeJavaScript("window.dispatchEvent(new Event('focus'));", true);
  await delay(100);
  return window.webContents.executeJavaScript(
    `({
      hasCard: document.querySelector(".background-learning-card") !== null,
      cardText: document.querySelector("#background-learning-list")?.textContent ?? "",
      statusText: document.querySelector("#status-list")?.textContent ?? ""
    })`,
    true,
  );
}

function assertSmokeBackgroundLearningResult(result) {
  if (result.schedulerReport?.dispatchedCount < 1) {
    smokeFailures.push("smoke background learning did not dispatch a scheduled job");
  }
  if (result.workerReport?.completedCount < 1 || result.completed !== true) {
    smokeFailures.push("smoke background learning did not complete a worker job");
  }
  if (
    result.pendingCandidateBoundary?.candidateOnly !== true ||
    result.pendingCandidateBoundary?.autoPublish !== true ||
    result.pendingCandidateBoundary?.memorySync !== true
  ) {
    smokeFailures.push("smoke background learning lost candidate-only boundary");
  }
  if (result.ui?.hasCard !== true) {
    smokeFailures.push("smoke background learning did not render the background learning card");
  }
}

function writeSmokeBackgroundLearningArtifact(artifact) {
  const artifactPath = process.env.DIRECTOR_DESKTOP_SMOKE_BACKGROUND_LEARNING_ARTIFACT_PATH?.trim();
  if (!artifactPath) {
    return;
  }
  try {
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  } catch (error) {
    smokeFailures.push(
      `background learning smoke artifact write failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertSmokeComposerResult(artifact) {
  if (!artifact.mainWindowStayedOnApp) {
    smokeFailures.push(`composer smoke main window left app: ${artifact.mainWindowUrl ?? "missing"}`);
  }
  const result = artifact.result;
  if (!result?.completed) {
    smokeFailures.push(`composer smoke did not complete: ${result?.reason ?? "unknown"}`);
  }
  const combinedText = [result?.resultText, result?.timelineText, result?.evidenceText]
    .filter(Boolean)
    .join("\n");
  if (combinedText.trim().length === 0) {
    smokeFailures.push("composer smoke did not render any user-visible answer text");
  }
  const timelineHasFinalReply =
    result?.timelineText?.includes("Angel 已回复") === true ||
    result?.timelineText?.includes("Angel 没有回复成功") === true;
  if (timelineHasFinalReply && /尚未执行命令/u.test(result?.resultText ?? "")) {
    smokeFailures.push("composer smoke left result inspector on placeholder");
  }
  if (/全文字符[：=]\s*0/u.test(combinedText)) {
    smokeFailures.push("composer smoke rendered zero full-body characters for a URL read");
  }
  if (result?.hasEvidenceDisclosure !== true) {
    smokeFailures.push("composer smoke did not render the evidence disclosure area");
  }
}

function writeSmokeComposerArtifact(artifact) {
  const artifactPath = process.env.DIRECTOR_DESKTOP_SMOKE_COMPOSER_ARTIFACT_PATH?.trim();
  if (!artifactPath) {
    return;
  }
  try {
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  } catch (error) {
    smokeFailures.push(
      `composer smoke artifact write failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function runSmokeComposerInRenderer({ prompt, timeoutMs }) {
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const startedAtMs = Date.now();
  const readText = (selector) => document.querySelector(selector)?.textContent ?? "";
  const readAllText = (selector) =>
    Array.from(document.querySelectorAll(selector))
      .map((item) => item.textContent ?? "")
      .filter(Boolean)
      .join("\n");
  const collect = (reason, completed = false) => {
    const resultText = readText("#result-output");
    const timelineText = readText("#timeline");
    const evidenceText = readAllText(".result-evidence-disclosure");
    const operatorTraceText = readText("#operator-trace-output");
    const runCommand = document.querySelector("#run-command");
    return {
      completed,
      reason,
      elapsedMs: Date.now() - startedAtMs,
      runCommandMode: runCommand?.dataset?.mode ?? null,
      runCommandDisabled: runCommand?.disabled === true,
      resultText,
      timelineText,
      evidenceText,
      operatorTraceText,
      hasEvidenceDisclosure: document.querySelector(".result-evidence-disclosure") !== null,
      resultTextLength: resultText.length,
      timelineTextLength: timelineText.length,
      evidenceTextLength: evidenceText.length,
    };
  };

  while (Date.now() - startedAtMs < timeoutMs) {
    const input = document.querySelector("#angel-input");
    const send = document.querySelector("#run-command");
    if (input && send && send.disabled !== true) {
      input.value = prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      send.click();
      break;
    }
    await sleep(100);
  }

  let last = collect("submitted");
  while (Date.now() - startedAtMs < timeoutMs) {
    await sleep(500);
    last = collect("waiting");
    const finished = last.runCommandMode !== "stop" && last.runCommandDisabled !== true;
    const hasAnswer =
      last.resultText.includes("Angel 已回复") ||
      last.resultText.includes("Angel 没有回复成功") ||
      last.resultText.includes("URL 学习") ||
      last.timelineText.includes("Angel 已回复") ||
      last.timelineText.includes("Angel 没有回复成功") ||
      last.timelineText.includes("URL 学习") ||
      last.timelineText.includes("执行失败");
    if (finished && hasAnswer) {
      return collect("completed", true);
    }
  }
  return last;
}

function writeSmokeExternalNavigationArtifact({ externalUrls, unexpectedNavigations }) {
  const artifactPath = process.env.DIRECTOR_DESKTOP_SMOKE_ARTIFACT_PATH?.trim();
  if (!artifactPath) {
    return;
  }
  const mainWindowUrl = BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && window.directorAngelWindowRole === MAIN_WINDOW_ROLE,
  )?.webContents.getURL();
  const artifact = {
    schemaVersion: "director.desktop.external-navigation-smoke.v1",
    checkedAt: new Date().toISOString(),
    mainWindowHtmlPath,
    mainWindowUrl: mainWindowUrl ?? null,
    mainWindowStayedOnApp: Boolean(mainWindowUrl && isAllowedDirectorMainWindowUrl(mainWindowUrl)),
    externalUrls,
    externalHandoffUrls: [...smokeExternalOpenUrls],
    unexpectedNavigations,
    failures: [...smokeFailures],
  };
  try {
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  } catch (error) {
    smokeFailures.push(
      `external navigation smoke artifact write failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertSmokeMainWindowStillOnApp(url, trigger) {
  const currentUrl = BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed() && window.directorAngelWindowRole === MAIN_WINDOW_ROLE,
  )?.webContents.getURL();
  if (!currentUrl || !isAllowedDirectorMainWindowUrl(currentUrl)) {
    smokeFailures.push(
      `main window left app after ${trigger}: target=${url} current=${currentUrl ?? "missing"}`,
    );
  }
  if (currentUrl && resolve(fileURLToPath(new URL(currentUrl))) !== mainWindowHtmlPath) {
    smokeFailures.push(
      `main window path changed after ${trigger}: target=${url} current=${currentUrl}`,
    );
  }
}

function attachRendererDiagnostics(window) {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logDesktopBridgeInvoke("renderer-console", {
      level,
      message,
      line,
      sourceId,
    });
    if (level >= 3) {
      smokeFailures.push(`renderer console error: ${message} (${sourceId}:${line})`);
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    logDesktopBridgeInvoke("renderer-process-gone", { reason: details.reason });
    smokeFailures.push(`renderer process gone: ${details.reason}`);
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    logDesktopBridgeInvoke("renderer-failed-load", { errorCode, errorDescription });
    smokeFailures.push(`renderer failed to load: ${errorCode} ${errorDescription}`);
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, Math.max(0, ms));
  });
}

function hasMainWindow() {
  return Boolean(mainWindow && !mainWindow.isDestroyed());
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = BrowserWindow.getAllWindows().find(
      (window) => !window.isDestroyed() && window.directorAngelWindowRole === MAIN_WINDOW_ROLE,
    ) ?? null;
  }
  if (mainWindow === null) {
    return false;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  return true;
}

if (singleInstanceLock) {
  app.on("second-instance", async () => {
    if (app.isReady()) {
      await ensureMainWindow();
    }
  });
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) {
    return;
  }
  await ensureMainWindow();
  warmBridgeInBackground();
  startBackgroundRuntimeInBackground();

  app.on("activate", async () => {
    if (!hasMainWindow()) {
      await ensureMainWindow();
    }
  });
});

app.on("before-quit", stopBackgroundRuntime);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
