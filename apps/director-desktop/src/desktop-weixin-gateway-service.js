import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import QRCode from "qrcode";

import {
  createChannelAdapterContractReport,
  defineChannelAdapterContract,
} from "@hotflow/channels-core";
import {
  admitAgentOsSandboxExecution,
  createAgentOsHostSandboxBackendAdapter,
  createAgentOsSandboxBackendRegistry,
  executeAgentOsSandboxCommand,
  planAgentOsSandboxExecution,
} from "@hotflow/agent-os-sandbox";

import {
  DEFAULT_ILINK_BOT_TYPE,
  ILINK_BASE_URL,
  WeixinGateway,
  checkWeixinQrLoginStatus,
  expireWeixinRuntimeToolApprovals,
  loadWeixinAccount,
  loadSelectedWeixinAccountId,
  loadWeixinRuntimeToolApprovals,
  saveWeixinAccount,
  selectWeixinAccount,
  startWeixinQrLogin,
} from "../../weixin-gateway/dist/index.js";

export const WEIXIN_GATEWAY_PARAMETER_ID = "gateway:weixin.alwaysOn";

const SERVICE_SCHEMA_ID = "director.weixin-gateway.service.v1";
const LOGIN_SCHEMA_ID = "director.weixin-gateway.login.v1";
const LAUNCH_AGENT_LABEL = "com.directorangel.weixin-gateway";
const LEGACY_LAUNCH_AGENT_LABELS = ["com.hotflow.director-angel.weixin-gateway"];
const SCREEN_SESSION_NAME = "director-weixin";
const COMMAND_TIMEOUT_MS = 5000;
const LOG_LINE_LIMIT = 80;
const LOGIN_EXPIRY_MS = 8 * 60 * 1000;
const PROCESS_CLEANUP_SETTLE_MS = 800;
export async function inspectWeixinGatewayService(workspaceRoot, options = {}) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  const serviceOptions = withWeixinGatewayWorkspaceOptions(paths, options);
  const [config, launchd, screen, logs, login] = await Promise.all([
    readJsonOrNull(paths.configPath),
    inspectLaunchd(paths, serviceOptions),
    inspectScreenFallback(serviceOptions),
    readRecentGatewayLogs(paths),
    readAndRepairWeixinLogin(paths.loginPath),
  ]);
  const account = await inspectWeixinAccount(paths.accountHome, config?.selectedAccountId);
  const runtimeToolApprovals = inspectWeixinRuntimeToolApprovals(
    paths.accountHome,
    account.primaryId,
  );
  const channelContract = createWeixinChannelContractReport();
  const running = launchd.running || screen.running;
  const enabled = config?.enabled === true || (config === null && paths.plistExists);
  const manager =
    screen.running && !launchd.running
      ? "screen"
      : launchd.available
        ? "launchd"
        : (options.platform ?? process.platform);
  const status = running
    ? "running"
    : launchd.available || paths.plistExists || screen.running
      ? "stopped"
      : "not-installed";

  return {
    schemaVersion: SERVICE_SCHEMA_ID,
    id: "weixin",
    label: "个人微信网关",
    parameterId: WEIXIN_GATEWAY_PARAMETER_ID,
    enabled,
    running,
    status,
    manager,
    serviceLabel: LAUNCH_AGENT_LABEL,
    screenSessionName: SCREEN_SESSION_NAME,
    platform: serviceOptions.platform ?? process.platform,
    source: config === null ? "defaults" : "file",
    configPath: paths.configPath,
    plistPath: paths.plistPath,
    plistExists: paths.plistExists,
    logDir: paths.logDir,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    hostApiUrl: resolveHostApiUrl(serviceOptions.env),
    learningFetchUrl: resolveLearningFetchUrl(serviceOptions.env, config),
    browserToolUrl: resolveBrowserToolUrl(serviceOptions.env, config),
    workspaceRoot: paths.workspaceRoot,
    gatewayMainPath: paths.gatewayMainPath,
    account,
    runtimeToolApprovals,
    channelContract,
    login: formatWeixinGatewayLogin(login),
    launchd,
    screen,
    logs,
    notes: createGatewayNotes({ enabled, running, status, account, launchd, screen }),
    issues: createGatewayIssues({ enabled, account, launchd }),
  };
}

function createWeixinChannelContractReport() {
  return createChannelAdapterContractReport(
    defineChannelAdapterContract({
      channel: "personal-weixin",
      adapterId: "weixin-gateway",
      transport: {
        ingress: "polling",
        supportsDirect: true,
        supportsGroups: false,
        supportsThreads: false,
        supportsAttachments: false,
        supportsStreaming: false,
      },
      runtime: {
        usesUnifiedConversationRuntime: true,
        usesDynamicCapabilityContext: true,
        emitsRuntimeEvents: true,
        recordsOperatorTrace: true,
        resultFirstReplies: true,
      },
      approval: {
        persistsRuntimeApprovals: true,
        routesApproveRejectBeforeChat: true,
        expiresStaleApprovals: true,
        executesThroughSharedToolExecutor: true,
        sanitizesStatusSnapshots: true,
      },
      memory: {
        hasGarbageFilter: true,
        separatesUserMemoryFromExperience: true,
        admitsExperienceOnlyAfterReview: true,
      },
      operations: {
        hasHealthStatus: true,
        hasReconnectFlow: true,
        hasCredentialRedaction: true,
      },
    }),
  );
}

function inspectWeixinRuntimeToolApprovals(accountHome, accountId) {
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    return {
      status: "unavailable",
      count: 0,
      pendingCount: 0,
      latest: null,
      items: [],
    };
  }
  try {
    expireWeixinRuntimeToolApprovals(accountHome, accountId);
    const approvals = loadWeixinRuntimeToolApprovals(accountHome, accountId);
    const items = approvals.slice(0, 6).map(formatWeixinRuntimeToolApprovalItem);
    return {
      status: "ok",
      count: approvals.length,
      pendingCount: approvals.filter((approval) => approval.status === "pending").length,
      latest: items[0] ?? null,
      items,
    };
  } catch (error) {
    return {
      status: "error",
      count: 0,
      pendingCount: 0,
      latest: null,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatWeixinRuntimeToolApprovalItem(approval) {
  return {
    approvalId: approval.approvalId,
    status: approval.status,
    title: approval.title ?? `确认使用 ${approval.toolName}`,
    summary: approval.summary ?? "",
    toolName: approval.toolName,
    peerId: approval.peerId,
    requestedByPeerId: approval.requestedByPeerId ?? null,
    sourceMessageId: approval.sourceMessageId ?? null,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    decidedAt: approval.decidedAt ?? null,
    decidedByPeerId: approval.decidedByPeerId ?? null,
  };
}

export async function setWeixinGatewayServiceEnabled(workspaceRoot, enabled, options = {}) {
  if (enabled) {
    return startWeixinGatewayService(workspaceRoot, options);
  }
  return stopWeixinGatewayService(workspaceRoot, options);
}

export async function controlWeixinGatewayService(workspaceRoot, operation, options = {}) {
  const normalized = String(operation ?? "status")
    .trim()
    .toLowerCase();
  if (["status", "inspect"].includes(normalized)) {
    return {
      operation: "status",
      service: await inspectWeixinGatewayService(workspaceRoot, options),
    };
  }
  if (["start", "enable", "on"].includes(normalized)) {
    return startWeixinGatewayService(workspaceRoot, options);
  }
  if (["stop", "disable", "off"].includes(normalized)) {
    return stopWeixinGatewayService(workspaceRoot, options);
  }
  if (["restart", "reload"].includes(normalized)) {
    return restartWeixinGatewayService(workspaceRoot, options);
  }
  throw new Error(`Unsupported Weixin gateway operation: ${String(operation)}`);
}

export async function selectWeixinGatewayAccount(workspaceRoot, accountId, options = {}) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  const before = await inspectWeixinGatewayService(workspaceRoot, options);
  const account = selectWeixinAccount(paths.accountHome, accountId);
  await writeGatewayServiceSelectedAccount(paths, account.normalizedAccountId, options);
  const shouldRestart = before.enabled === true || before.running === true;
  const serviceOperation = shouldRestart
    ? await restartWeixinGatewayService(workspaceRoot, options)
    : null;
  return {
    operation: "accountSelect",
    ok: serviceOperation?.ok ?? true,
    account: sanitizeSavedWeixinAccount(account),
    service: serviceOperation?.service ?? (await inspectWeixinGatewayService(workspaceRoot, options)),
    ...(serviceOperation === null ? {} : { serviceOperation }),
  };
}

async function startWeixinGatewayService(workspaceRoot, options) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  const serviceOptions = await withWeixinGatewayRuntimeEndpointOptions(paths, options);
  await ensureGatewayServiceDirs(paths);
  await writeLaunchAgentPlist(paths, serviceOptions);
  await writeGatewayServiceConfig(paths, true, serviceOptions);

  const readiness = await verifyWeixinGatewayReadiness(workspaceRoot, serviceOptions);
  if (!readiness.ok) {
    const service = await inspectWeixinGatewayService(workspaceRoot, serviceOptions);
    return {
      operation: "start",
      method: "blocked",
      service,
      commands: [],
      ok: false,
      message: readiness.message,
      issue: readiness.issue,
    };
  }

  await resetGatewayLogs(paths);
  const legacyResult = await stopLegacyLaunchAgents(paths, serviceOptions);
  const cleanupResult = await stopStaleWorkspaceGatewayProcesses(paths, serviceOptions);
  const launchResult = await startLaunchd(paths, serviceOptions);
  let service = await inspectWeixinGatewayService(workspaceRoot, serviceOptions);
  const fallbackResult =
    service.running === false && launchResult.method === "launchd"
      ? await startScreenFallbackAfterLaunchdFailure(paths, serviceOptions)
      : null;
  if (fallbackResult !== null) {
    service = await inspectWeixinGatewayService(workspaceRoot, serviceOptions);
  }
  return {
    operation: "start",
    method: service.running === true && fallbackResult !== null ? "screen-fallback" : launchResult.method,
    service,
    commands:
      fallbackResult === null
        ? [...legacyResult.commands, ...cleanupResult.commands, ...launchResult.commands]
        : [
            ...legacyResult.commands,
            ...cleanupResult.commands,
            ...launchResult.commands,
            ...fallbackResult.commands,
          ],
    ok: service.running === true || launchResult.method === "config-only",
    ...(service.running === true || launchResult.method === "config-only"
      ? {}
      : {
          message:
            service.launchd?.printError ??
            "微信网关启动命令已执行，但没有检测到后台进程；请查看日志或重新连接微信。",
          issue: "not-running-after-start",
        }),
  };
}

async function stopWeixinGatewayService(workspaceRoot, options) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  const serviceOptions = withWeixinGatewayWorkspaceOptions(paths, options);
  await ensureGatewayServiceDirs(paths);
  const launchResult = await stopLaunchd(paths, serviceOptions);
  await stopScreenFallback(serviceOptions);
  const legacyResult = await stopLegacyLaunchAgents(paths, serviceOptions);
  const cleanupResult = await stopStaleWorkspaceGatewayProcesses(paths, serviceOptions);
  await rm(paths.plistPath, { force: true });
  await writeGatewayServiceConfig(paths, false, serviceOptions);

  const service = await inspectWeixinGatewayService(workspaceRoot, serviceOptions);
  return {
    operation: "stop",
    method: launchResult.method,
    service,
    commands: [...launchResult.commands, ...legacyResult.commands, ...cleanupResult.commands],
  };
}

async function restartWeixinGatewayService(workspaceRoot, options) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  const serviceOptions = await withWeixinGatewayRuntimeEndpointOptions(paths, options);
  await ensureGatewayServiceDirs(paths);
  await writeLaunchAgentPlist(paths, serviceOptions);
  await writeGatewayServiceConfig(paths, true, serviceOptions);

  const readiness = await verifyWeixinGatewayReadiness(workspaceRoot, serviceOptions);
  if (!readiness.ok) {
    const service = await inspectWeixinGatewayService(workspaceRoot, serviceOptions);
    return {
      operation: "restart",
      method: "blocked",
      service,
      commands: [],
      ok: false,
      message: readiness.message,
      issue: readiness.issue,
    };
  }

  await resetGatewayLogs(paths);
  const legacyResult = await stopLegacyLaunchAgents(paths, serviceOptions);
  const cleanupResult = await stopStaleWorkspaceGatewayProcesses(paths, serviceOptions);
  const launchResult = shouldSkipLaunchctl(serviceOptions)
    ? { method: "config-only", commands: [] }
    : await restartLaunchd(paths, serviceOptions);
  let service = await inspectWeixinGatewayService(workspaceRoot, serviceOptions);
  const fallbackResult =
    service.running === false && launchResult.method === "launchd"
      ? await startScreenFallbackAfterLaunchdFailure(paths, serviceOptions)
      : null;
  if (fallbackResult !== null) {
    service = await inspectWeixinGatewayService(workspaceRoot, serviceOptions);
  }
  return {
    operation: "restart",
    method: service.running === true && fallbackResult !== null ? "screen-fallback" : launchResult.method,
    service,
    commands:
      fallbackResult === null
        ? [...legacyResult.commands, ...cleanupResult.commands, ...launchResult.commands]
        : [
            ...legacyResult.commands,
            ...cleanupResult.commands,
            ...launchResult.commands,
            ...fallbackResult.commands,
          ],
    ok: service.running === true || launchResult.method === "config-only",
    ...(service.running === true || launchResult.method === "config-only"
      ? {}
      : {
          message:
            service.launchd?.printError ??
            "微信网关重启命令已执行，但没有检测到后台进程；请查看日志或重新连接微信。",
          issue: "not-running-after-restart",
        }),
  };
}

async function verifyWeixinGatewayReadiness(workspaceRoot, options) {
  if (options.skipReadinessCheck === true || shouldSkipLaunchctl(options)) {
    return { ok: true };
  }
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  const selectedAccountId = resolveSelectedWeixinAccountIdSync(paths);
  const account = await inspectWeixinAccount(paths.accountHome, selectedAccountId);
  if (!account.loggedIn) {
    return {
      ok: false,
      issue: "missing-account",
      message: "没有可用的个人微信登录账号，请先点击“连接微信”。",
    };
  }
  const loadedAccount = loadWeixinAccountForReadiness(paths.accountHome, account.primaryId);
  if (loadedAccount === null) {
    return {
      ok: false,
      issue: "missing-account",
      message: "微信账号文件不可用，请重新连接微信。",
    };
  }
  const gateway = new WeixinGateway({
    home: paths.accountHome,
    account: loadedAccount,
    workspaceRoot: paths.workspaceRoot,
    dmPolicy: "disabled",
    allowedUsers: [],
    director: {
      hostApiUrl: resolveHostApiUrl(options.env),
      hostId: "desktop-readiness",
      agentId: "director",
      channel: "personal-weixin",
      autoAdvance: false,
      autoStartRun: false,
    },
    fetchFn: options.fetch,
    log: () => {},
    error: () => {},
  });
  try {
    await gateway.start({ once: true });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      issue: isExpiredWeixinSessionError(error) ? "expired-session" : "readiness-failed",
      message: isExpiredWeixinSessionError(error)
        ? "微信登录会话已过期，请点击“重新连接微信”扫码后再启动。"
        : `微信网关启动前检查失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function startWeixinGatewayLogin(workspaceRoot, options = {}) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  await ensureGatewayServiceDirs(paths);
  const loginApi = resolveWeixinLoginApi(options);
  const baseUrl = resolveIlinkBaseUrl(options.env);
  const qr = await loginApi.startWeixinQrLogin(
    {
      baseUrl,
      botType: resolveIlinkBotType(options.env),
      localTokenList: [],
    },
    options.fetch,
  );
  const displayQr = await createQrcodeDisplayPayload(qr);
  const now = new Date();
  const pending = {
    schemaVersion: LOGIN_SCHEMA_ID,
    sessionKey: qr.sessionKey,
    qrcode: qr.qrcode,
    qrcodeUrl: displayQr.qrcodeUrl,
    qrcodeImageSrc: displayQr.qrcodeImageSrc,
    baseUrl,
    status: "qr",
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LOGIN_EXPIRY_MS).toISOString(),
  };
  await writeJson(paths.loginPath, pending);

  return {
    operation: "loginStart",
    login: formatWeixinGatewayLogin(pending),
    service: await inspectWeixinGatewayService(workspaceRoot, options),
  };
}

export async function pollWeixinGatewayLogin(workspaceRoot, input = {}, options = {}) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  const pending = await readJsonOrNull(paths.loginPath);
  if (!isPendingWeixinLogin(pending)) {
    return {
      operation: "loginPoll",
      login: {
        schemaVersion: LOGIN_SCHEMA_ID,
        pending: false,
        status: "idle",
        message: "当前没有等待中的微信登录二维码。",
      },
      service: await inspectWeixinGatewayService(workspaceRoot, options),
    };
  }

  if (isExpiredLogin(pending)) {
    await rm(paths.loginPath, { force: true });
    return {
      operation: "loginPoll",
      login: {
        ...formatWeixinGatewayLogin(pending),
        pending: false,
        status: "expired",
        message: "二维码已过期，请重新点击连接微信。",
      },
      service: await inspectWeixinGatewayService(workspaceRoot, options),
    };
  }

  const verifyCode =
    typeof input.verifyCode === "string" && input.verifyCode.trim().length > 0
      ? input.verifyCode.trim()
      : undefined;
  const loginApi = resolveWeixinLoginApi(options);
  const status = await loginApi.checkWeixinQrLoginStatus(
    {
      qrcode: pending.qrcode,
      baseUrl: pending.baseUrl,
      ...(verifyCode === undefined ? {} : { verifyCode }),
    },
    options.fetch,
  );
  const updatedAt = new Date().toISOString();

  if (status.status === "confirmed") {
    const account = loginApi.saveWeixinAccount(paths.accountHome, status.credentials);
    await rm(paths.loginPath, { force: true });
    await writeGatewayServiceSelectedAccount(paths, account.normalizedAccountId, options);
    const started = await startWeixinGatewayService(workspaceRoot, options);
    return {
      operation: "loginPoll",
      login: {
        schemaVersion: LOGIN_SCHEMA_ID,
        pending: false,
        status: "confirmed",
        message: "微信已连接，个人微信网关已启动。",
        account: sanitizeSavedWeixinAccount(account),
      },
      service: started.service,
      serviceOperation: {
        operation: started.operation,
        method: started.method,
      },
    };
  }

  const nextPending = {
    ...pending,
    status: status.status,
    baseUrl:
      status.status === "scaned_but_redirect" && status.redirectBaseUrl
        ? status.redirectBaseUrl
        : pending.baseUrl,
    updatedAt,
    ...(status.message ? { message: status.message } : {}),
  };

  if (["expired", "verify_code_blocked", "binded_redirect"].includes(status.status)) {
    await rm(paths.loginPath, { force: true });
    return {
      operation: "loginPoll",
      login: {
        ...formatWeixinGatewayLogin(nextPending),
        pending: false,
        message: formatTerminalLoginMessage(status.status, status.message),
      },
      service: await inspectWeixinGatewayService(workspaceRoot, options),
    };
  }

  await writeJson(paths.loginPath, nextPending);
  return {
    operation: "loginPoll",
    login: formatWeixinGatewayLogin(nextPending),
    service: await inspectWeixinGatewayService(workspaceRoot, options),
  };
}

function resolveWeixinGatewayPaths(workspaceRoot, options = {}) {
  const root = resolve(workspaceRoot);
  const directorRoot = join(root, ".director-angel");
  const runtimeRoot = join(directorRoot, "runtime");
  const serviceRoot = join(runtimeRoot, "gateway-service");
  const logDir = join(runtimeRoot, "logs");
  const plistPath = join(
    resolveLaunchAgentHome(options.env, root),
    "Library",
    "LaunchAgents",
    `${LAUNCH_AGENT_LABEL}.plist`,
  );
  const launchAgentDir = dirname(plistPath);
  const gatewayMainPath =
    options.gatewayMainPath ??
    fileURLToPath(new URL("../../weixin-gateway/dist/main.js", import.meta.url));

  return {
    workspaceRoot: root,
    directorRoot,
    runtimeRoot,
    serviceRoot,
    accountHome: join(directorRoot, "weixin"),
    configPath: join(serviceRoot, "weixin-gateway.json"),
    loginPath: join(serviceRoot, "weixin-login.json"),
    logDir,
    stdoutPath: join(logDir, "weixin-gateway.out.log"),
    stderrPath: join(logDir, "weixin-gateway.err.log"),
    plistPath,
    legacyPlistPaths: LEGACY_LAUNCH_AGENT_LABELS.map((label) =>
      join(launchAgentDir, `${label}.plist`),
    ),
    plistExists: existsSync(plistPath),
    gatewayMainPath,
  };
}

function withWeixinGatewayWorkspaceOptions(paths, options = {}) {
  return {
    ...options,
    workspaceRoot: paths.workspaceRoot,
    cwd: options.cwd ?? paths.workspaceRoot,
  };
}

async function withWeixinGatewayRuntimeEndpointOptions(paths, options = {}) {
  const existingConfig = await readJsonOrNull(paths.configPath);
  const base = withWeixinGatewayWorkspaceOptions(paths, options);
  const env = {
    ...(options.env ?? process.env),
    ...(resolveLearningFetchUrl(options.env, existingConfig)
      ? { DIRECTOR_LEARNING_FETCH_URL: resolveLearningFetchUrl(options.env, existingConfig) }
      : {}),
    ...(resolveBrowserToolUrl(options.env, existingConfig)
      ? { DIRECTOR_BROWSER_TOOL_URL: resolveBrowserToolUrl(options.env, existingConfig) }
      : {}),
  };
  return {
    ...base,
    env,
  };
}

async function ensureGatewayServiceDirs(paths) {
  await Promise.all([
    mkdir(dirname(paths.plistPath), { recursive: true }),
    mkdir(paths.serviceRoot, { recursive: true }),
    mkdir(paths.logDir, { recursive: true }),
  ]);
}

async function writeGatewayServiceConfig(paths, enabled, options) {
  const selectedAccountId = resolveSelectedWeixinAccountIdSync(paths);
  const existingConfig = await readJsonOrNull(paths.configPath);
  await writeJson(paths.configPath, {
    schemaVersion: SERVICE_SCHEMA_ID,
    enabled,
    manager: "launchd",
    serviceLabel: LAUNCH_AGENT_LABEL,
    workspaceRoot: paths.workspaceRoot,
    gatewayMainPath: paths.gatewayMainPath,
    hostApiUrl: resolveHostApiUrl(options.env),
    learningFetchUrl: resolveLearningFetchUrl(options.env, existingConfig),
    browserToolUrl: resolveBrowserToolUrl(options.env, existingConfig),
    ...(selectedAccountId ? { selectedAccountId } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: "director-desktop",
  });
}

async function writeGatewayServiceSelectedAccount(paths, accountId, options) {
  const existingConfig = await readJsonOrNull(paths.configPath);
  await writeJson(paths.configPath, {
    schemaVersion: SERVICE_SCHEMA_ID,
    enabled: existingConfig?.enabled === true,
    manager: "launchd",
    serviceLabel: LAUNCH_AGENT_LABEL,
    workspaceRoot: paths.workspaceRoot,
    gatewayMainPath: paths.gatewayMainPath,
    hostApiUrl: resolveHostApiUrl(options.env),
    learningFetchUrl: resolveLearningFetchUrl(options.env, existingConfig),
    browserToolUrl: resolveBrowserToolUrl(options.env, existingConfig),
    selectedAccountId: accountId,
    updatedAt: new Date().toISOString(),
    updatedBy: "director-desktop",
  });
}

export async function writeWeixinGatewayRuntimeEndpointConfig(workspaceRoot, endpoints, options = {}) {
  const paths = resolveWeixinGatewayPaths(workspaceRoot, options);
  await ensureGatewayServiceDirs(paths);
  const existingConfig = await readJsonOrNull(paths.configPath);
  const selectedAccountId = resolveSelectedWeixinAccountIdSync(paths);
  await writeJson(paths.configPath, {
    schemaVersion: SERVICE_SCHEMA_ID,
    enabled: existingConfig?.enabled === true,
    manager: existingConfig?.manager ?? "runtime",
    serviceLabel: LAUNCH_AGENT_LABEL,
    workspaceRoot: paths.workspaceRoot,
    gatewayMainPath: paths.gatewayMainPath,
    hostApiUrl: resolveHostApiUrl(options.env),
    learningFetchUrl:
      endpoints.learningFetchUrl?.trim() || resolveLearningFetchUrl(options.env, existingConfig),
    browserToolUrl:
      endpoints.browserToolUrl?.trim() || resolveBrowserToolUrl(options.env, existingConfig),
    ...(selectedAccountId ? { selectedAccountId } : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: "director-desktop-runtime",
  });
}

async function writeLaunchAgentPlist(paths, options) {
  const plist = buildLaunchAgentPlist(paths, options);
  await writeFile(paths.plistPath, plist, "utf8");
}

function buildLaunchAgentPlist(paths, options) {
  const env = options.env ?? process.env;
  const selectedAccountId = resolveSelectedWeixinAccountIdSync(paths);
  const nodeExecutable = resolveNodeExecutable(env);
  const launchEnv = {
    PATH: resolveServicePath(env),
    HOTFLOW_WORKSPACE_ROOT: paths.workspaceRoot,
    DIRECTOR_ANGEL_WORKSPACE_ROOT: paths.workspaceRoot,
    DIRECTOR_HOST_API_URL: resolveHostApiUrl(env),
    DIRECTOR_WEIXIN_HOST_TOOLS: env.DIRECTOR_WEIXIN_HOST_TOOLS || "true",
    ...(resolveLearningFetchUrl(env)
      ? { DIRECTOR_LEARNING_FETCH_URL: resolveLearningFetchUrl(env) }
      : {}),
    ...(resolveBrowserToolUrl(env)
      ? { DIRECTOR_BROWSER_TOOL_URL: resolveBrowserToolUrl(env) }
      : {}),
    ...(env.DIRECTOR_WEIXIN_ACCOUNT_ID || selectedAccountId
      ? { DIRECTOR_WEIXIN_ACCOUNT_ID: env.DIRECTOR_WEIXIN_ACCOUNT_ID || selectedAccountId }
      : {}),
    ...(env.DIRECTOR_WEIXIN_DM_POLICY
      ? { DIRECTOR_WEIXIN_DM_POLICY: env.DIRECTOR_WEIXIN_DM_POLICY }
      : {}),
    ...(env.DIRECTOR_WEIXIN_ALLOWED_USERS
      ? { DIRECTOR_WEIXIN_ALLOWED_USERS: env.DIRECTOR_WEIXIN_ALLOWED_USERS }
      : {}),
    ...(env.DIRECTOR_WEIXIN_TRUSTED_OPERATORS
      ? { DIRECTOR_WEIXIN_TRUSTED_OPERATORS: env.DIRECTOR_WEIXIN_TRUSTED_OPERATORS }
      : {}),
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodeExecutable)}</string>
    <string>${xmlEscape(paths.gatewayMainPath)}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(paths.workspaceRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(paths.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(paths.stderrPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(launchEnv)
  .map(
    ([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`,
  )
  .join("\n")}
  </dict>
</dict>
</plist>
`;
}

function resolveSelectedWeixinAccountIdSync(paths) {
  try {
    const selected = loadSelectedWeixinAccountId(paths.accountHome);
    if (selected) {
      return selected;
    }
  } catch {
    // no account-store selection yet
  }
  try {
    const config = JSON.parse(readFileSync(paths.configPath, "utf8"));
    if (
      typeof config.selectedAccountId === "string" &&
      config.selectedAccountId.trim() &&
      existsSync(join(paths.accountHome, "accounts", `${config.selectedAccountId.trim()}.json`))
    ) {
      return config.selectedAccountId.trim();
    }
  } catch {
    // no persisted service selection yet
  }
  return resolveMostRecentWeixinAccountIdSync(paths.accountHome);
}

async function startLaunchd(paths, options) {
  if (shouldSkipLaunchctl(options)) {
    return { method: "config-only", commands: [] };
  }
  if ((options.platform ?? process.platform) !== "darwin") {
    return { method: "unsupported", commands: [] };
  }

  const commands = [];
  const domain = resolveLaunchdDomain();
  const target = resolveLaunchdServiceTarget();
  commands.push(await runLaunchctl(["enable", target], options));
  const printed = await runLaunchctl(["print", target], options);
  commands.push(printed);
  if (printed.code === 0) {
    commands.push(await runLaunchctl(["bootout", domain, paths.plistPath], options));
  }
  const boot = await runLaunchctl(["bootstrap", domain, paths.plistPath], options);
  commands.push(boot);
  if (boot.code !== 0 && !isAlreadyBootstrapped(boot)) {
    return { method: "launchd-error", commands };
  }
  const kickstart = await runLaunchctl(["kickstart", "-k", target], options);
  commands.push(kickstart);
  if (kickstart.code !== 0) {
    commands.push(await runLaunchctl(["start", LAUNCH_AGENT_LABEL], options));
  }
  return { method: "launchd", commands };
}

async function stopLaunchd(paths, options) {
  if (shouldSkipLaunchctl(options)) {
    return { method: "config-only", commands: [] };
  }
  if ((options.platform ?? process.platform) !== "darwin") {
    return { method: "unsupported", commands: [] };
  }
  const commands = [];
  const domain = resolveLaunchdDomain();
  const target = resolveLaunchdServiceTarget();
  commands.push(await runLaunchctl(["disable", target], options));
  commands.push(await runLaunchctl(["stop", LAUNCH_AGENT_LABEL], options));
  commands.push(await runLaunchctl(["bootout", domain, paths.plistPath], options));
  return { method: "launchd", commands };
}

async function stopLegacyLaunchAgents(paths, options) {
  if (shouldSkipLaunchctl(options)) {
    return { method: "legacy-launchd", commands: [] };
  }
  if ((options.platform ?? process.platform) !== "darwin") {
    return { method: "legacy-launchd", commands: [] };
  }
  const commands = [];
  const domain = resolveLaunchdDomain();
  for (const [index, label] of LEGACY_LAUNCH_AGENT_LABELS.entries()) {
    const target = `${domain}/${label}`;
    const plistPath = paths.legacyPlistPaths[index];
    commands.push(await runLaunchctl(["disable", target], options));
    commands.push(await runLaunchctl(["stop", label], options));
    if (plistPath) {
      commands.push(await runLaunchctl(["bootout", domain, plistPath], options));
      await rm(plistPath, { force: true });
    }
  }
  return { method: "legacy-launchd", commands };
}

async function restartLaunchd(paths, options) {
  return startLaunchd(paths, options);
}

async function inspectLaunchd(paths, options) {
  const platform = options.platform ?? process.platform;
  if (shouldSkipLaunchctl(options) || platform !== "darwin") {
    return {
      available: platform === "darwin",
      running: false,
      state: "unknown",
      pid: null,
      lastExitStatus: null,
      printError: null,
      serviceTarget: resolveLaunchdServiceTarget(),
    };
  }

  const target = resolveLaunchdServiceTarget();
  const printed = await runLaunchctl(["print", target], options);
  const info = parseLaunchctlPrint(printed.stdout);
  const running = printed.code === 0 && (info.state === "running" || info.pid !== null);
  return {
    available: true,
    running,
    state: printed.code === 0 ? (info.state ?? "loaded") : "not-loaded",
    pid: info.pid,
    lastExitStatus: info.lastExitStatus,
    printError: printed.code === 0 ? null : compactCommandOutput(printed),
    serviceTarget: target,
  };
}

async function inspectScreenFallback(options) {
  if (shouldSkipLaunchctl(options)) {
    return { running: false, available: false, detail: null };
  }
  const listed = await runCommand("screen", ["-ls"], options);
  const output = `${listed.stdout}\n${listed.stderr}`;
  return {
    available: listed.code === 0 || output.includes(SCREEN_SESSION_NAME) || /No Sockets found/u.test(output),
    running: output.includes(SCREEN_SESSION_NAME),
    detail: listed.code === 0 ? output.trim().slice(0, 1000) : null,
  };
}

async function stopScreenFallback(options) {
  if (shouldSkipLaunchctl(options)) {
    return;
  }
  const screen = await inspectScreenFallback(options);
  if (screen.running) {
    await runCommand("screen", ["-S", SCREEN_SESSION_NAME, "-X", "quit"], options);
  }
}

async function stopStaleWorkspaceGatewayProcesses(paths, options) {
  if (shouldSkipLaunchctl(options)) {
    return { method: "process-cleanup", commands: [] };
  }

  const listed = await listWorkspaceGatewayProcesses(options);
  const commands = [
    {
      tool: "ps",
      args: ["eww", "-axo", "pid=,command="],
      code: listed.code,
      stdout: "",
      stderr: listed.code === 0 ? "" : compactCommandOutput(listed),
      ...(listed.sandbox === undefined ? {} : { sandbox: listed.sandbox }),
    },
  ];
  if (listed.code !== 0) {
    return { method: "process-cleanup", commands };
  }

  const initialPids = collectStaleWorkspaceGatewayProcessIds(listed.stdout, paths);
  for (const pid of initialPids) {
    const killed = await runCommand(
      "kill",
      ["-TERM", String(pid)],
      withWeixinGatewayKillCommandOptions(options, "-TERM", pid),
    );
    commands.push({
      tool: "kill",
      args: ["-TERM", String(pid)],
      code: killed.code,
      stdout: killed.stdout,
      stderr: killed.stderr,
      ...(killed.sandbox === undefined ? {} : { sandbox: killed.sandbox }),
    });
  }

  if (initialPids.length > 0) {
    await sleep(resolveProcessCleanupSettleMs(options));
    const afterTerm = await listWorkspaceGatewayProcesses(options);
    commands.push({
      tool: "ps",
      args: ["eww", "-axo", "pid=,command="],
      code: afterTerm.code,
      stdout: "",
      stderr: afterTerm.code === 0 ? "" : compactCommandOutput(afterTerm),
      ...(afterTerm.sandbox === undefined ? {} : { sandbox: afterTerm.sandbox }),
    });
    if (afterTerm.code === 0) {
      const remainingPids = collectStaleWorkspaceGatewayProcessIds(afterTerm.stdout, paths);
      for (const pid of remainingPids) {
        const killed = await runCommand(
          "kill",
          ["-KILL", String(pid)],
          withWeixinGatewayKillCommandOptions(options, "-KILL", pid),
        );
        commands.push({
          tool: "kill",
          args: ["-KILL", String(pid)],
          code: killed.code,
          stdout: killed.stdout,
          stderr: killed.stderr,
          ...(killed.sandbox === undefined ? {} : { sandbox: killed.sandbox }),
        });
      }
    }
  }

  return { method: "process-cleanup", commands };
}

function withWeixinGatewayKillCommandOptions(options, signal, pid) {
  const pidText = String(pid);
  const previousPatterns = Array.isArray(options.weixinGatewayAllowedCommandPatterns)
    ? options.weixinGatewayAllowedCommandPatterns
    : [];
  const previousPids = Array.isArray(options.weixinGatewayAllowedProcessPids)
    ? options.weixinGatewayAllowedProcessPids.map(String)
    : [];
  const operationId = `kill ${signal} ${pidText}`;
  return {
    ...options,
    weixinGatewayAllowedCommandPatterns: [
      ...previousPatterns,
      {
        executable: "kill",
        argv: [signal, pidText],
        operationId,
      },
    ],
    weixinGatewayAllowedProcessPids: [...new Set([...previousPids, pidText])],
    weixinGatewayProcessEvidence: createWeixinGatewayKillProcessEvidence(signal, pid),
  };
}

function listWorkspaceGatewayProcesses(options) {
  return runCommand("ps", ["eww", "-axo", "pid=,command="], options);
}

function collectStaleWorkspaceGatewayProcessIds(output, paths) {
  const pids = [];
  for (const line of String(output ?? "").split(/\r?\n/u)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u);
    if (match === null) {
      continue;
    }
    const pid = Number.parseInt(match[1], 10);
    const command = match[2] ?? "";
    if (pid === process.pid || !Number.isFinite(pid)) {
      continue;
    }
    if (isWorkspaceGatewayStartCommand(command, paths)) {
      pids.push(pid);
    }
  }
  return [...new Set(pids)];
}

function isWorkspaceGatewayStartCommand(command, paths) {
  const text = String(command ?? "");
  const mentionsGateway =
    text.includes(paths.gatewayMainPath) ||
    /(?:@hotflow\/weixin-gateway|apps\/weixin-gateway\/(?:dist\/main\.js|src\/main\.ts)|weixin-gateway\/dist\/main\.js)/u.test(
      text,
    );
  if (!mentionsGateway || !/(?:^|\s|--)(?:["']?start["']?)(?:\s|$)/u.test(text)) {
    return false;
  }
  return (
    text.includes(paths.workspaceRoot) ||
    text.includes(`PWD=${paths.workspaceRoot}`) ||
    text.includes(`INIT_CWD=${paths.workspaceRoot}`) ||
    text.includes(`HOTFLOW_WORKSPACE_ROOT=${paths.workspaceRoot}`) ||
    text.includes(`DIRECTOR_ANGEL_WORKSPACE_ROOT=${paths.workspaceRoot}`) ||
    text.includes(`PNPM_SCRIPT_SRC_DIR=${paths.workspaceRoot}`)
  );
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function resolveProcessCleanupSettleMs(options) {
  return typeof options.processCleanupSettleMs === "number"
    ? Math.max(0, options.processCleanupSettleMs)
    : PROCESS_CLEANUP_SETTLE_MS;
}

async function startScreenFallback(paths, options) {
  if (shouldSkipLaunchctl(options)) {
    return null;
  }
  await stopScreenFallback(options);
  const env = options.env ?? process.env;
  const selectedAccountId = resolveSelectedWeixinAccountIdSync(paths);
  const startEnv = {
    ...env,
    HOTFLOW_WORKSPACE_ROOT: paths.workspaceRoot,
    DIRECTOR_ANGEL_WORKSPACE_ROOT: paths.workspaceRoot,
    DIRECTOR_HOST_API_URL: resolveHostApiUrl(env),
    DIRECTOR_WEIXIN_HOST_TOOLS: env.DIRECTOR_WEIXIN_HOST_TOOLS || "true",
    ...(resolveLearningFetchUrl(env)
      ? { DIRECTOR_LEARNING_FETCH_URL: resolveLearningFetchUrl(env) }
      : {}),
    ...(resolveBrowserToolUrl(env)
      ? { DIRECTOR_BROWSER_TOOL_URL: resolveBrowserToolUrl(env) }
      : {}),
    ...(env.DIRECTOR_WEIXIN_ACCOUNT_ID || selectedAccountId
      ? { DIRECTOR_WEIXIN_ACCOUNT_ID: env.DIRECTOR_WEIXIN_ACCOUNT_ID || selectedAccountId }
      : {}),
    ...(env.DIRECTOR_WEIXIN_DM_POLICY
      ? { DIRECTOR_WEIXIN_DM_POLICY: env.DIRECTOR_WEIXIN_DM_POLICY }
      : {}),
    ...(env.DIRECTOR_WEIXIN_ALLOWED_USERS
      ? { DIRECTOR_WEIXIN_ALLOWED_USERS: env.DIRECTOR_WEIXIN_ALLOWED_USERS }
      : {}),
    ...(env.DIRECTOR_WEIXIN_TRUSTED_OPERATORS
      ? { DIRECTOR_WEIXIN_TRUSTED_OPERATORS: env.DIRECTOR_WEIXIN_TRUSTED_OPERATORS }
      : {}),
  };
  const script = [
    `cd ${shellQuote(paths.workspaceRoot)}`,
    `mkdir -p ${shellQuote(paths.logDir)}`,
    [
      "exec",
      shellQuote(resolveNodeExecutable(env)),
      shellQuote(paths.gatewayMainPath),
      "start",
      ">>",
      shellQuote(paths.stdoutPath),
      "2>>",
      shellQuote(paths.stderrPath),
    ].join(" "),
  ].join(" && ");
  const result = await runCommand(
    "screen",
    [
      "-dmS",
      SCREEN_SESSION_NAME,
      "zsh",
      "-lc",
      script,
    ],
    {
      ...options,
      cwd: paths.workspaceRoot,
      env: startEnv,
    },
  );
  return {
    method: "screen",
    commands: [
      {
        tool: "screen",
        args: ["-dmS", SCREEN_SESSION_NAME, "zsh", "-lc", script],
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    ],
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, "'\\''")}'`;
}

async function startScreenFallbackAfterLaunchdFailure(paths, options) {
  const unload = await stopLaunchd(paths, options);
  const screen = await startScreenFallback(paths, options);
  return screen === null
    ? unload
    : {
        method: "screen",
        commands: [...unload.commands, ...screen.commands],
      };
}

async function runLaunchctl(args, options) {
  const result = await runCommand("launchctl", args, options);
  return {
    tool: "launchctl",
    args,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCommand(file, args, options = {}) {
  const cwd = options.cwd ?? options.workspaceRoot;
  const env = options.env ?? process.env;
  const commandRunner =
    typeof options.agentOsSandboxCommandRunner === "function"
      ? options.agentOsSandboxCommandRunner
      : typeof options.runCommand === "function"
        ? adaptWeixinGatewayRunCommandToSandboxRunner(options.runCommand)
        : runWeixinGatewayProcessCommand;

  return runWeixinGatewaySandboxCommand(file, args, {
    workspaceRoot: options.workspaceRoot ?? cwd ?? process.cwd(),
    cwd,
    env,
    allowedCommandPatterns: options.allowedCommandPatterns ?? options.weixinGatewayAllowedCommandPatterns,
    allowedProcessPids: options.weixinGatewayAllowedProcessPids,
    processEvidence: options.weixinGatewayProcessEvidence,
    commandRunner,
  });
}

async function runWeixinGatewaySandboxCommand(file, args, options) {
  const command = formatWeixinGatewaySandboxCommand(file, args);
  const workspaceRoot = options.workspaceRoot;
  const registry = createAgentOsSandboxBackendRegistry({
    enabledBackends: ["host"],
    adapters: [
      createAgentOsHostSandboxBackendAdapter({
        allowHostExecution: true,
        allowedCommandPatterns: resolveWeixinGatewayAllowedCommandPatterns(file, args, {
          ...options,
          command,
        }),
        networkPolicy: "none",
        commandRunner: options.commandRunner,
      }),
    ],
  });
  const plan = planAgentOsSandboxExecution({
    toolName: "weixin-gateway-service",
    operationId: command,
    providerId: "weixin-gateway",
    cwd: options.cwd ?? workspaceRoot,
    command,
    argv: args,
    env: options.env,
    requestedNetworkPolicy: "none",
    preflight: {
      verdict: "allow",
      sandboxMode: "host",
      checkedAt: new Date().toISOString(),
      providerId: "weixin-gateway",
      reason: "Weixin gateway service lifecycle command is routed through Agent OS host sandbox backend.",
    },
    policy: {
      enabledBackends: ["host"],
      readableRoots: [workspaceRoot],
      writableRoots: [workspaceRoot],
      networkPolicy: "none",
    },
  });
  const admission = await admitAgentOsSandboxExecution(plan, { registry });
  const execution = await executeAgentOsSandboxCommand(plan, admission, { registry });
  const evidence =
    execution.evidence === undefined
      ? undefined
      : mergeWeixinGatewayProcessEvidence(execution.evidence, options.processEvidence);
  return {
    code: execution.exitCode ?? (execution.ok ? 0 : 1),
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? formatWeixinGatewaySandboxExecutionReason(execution),
    sandbox: {
      ok: execution.ok,
      status: execution.status,
      ...(execution.backend === undefined ? {} : { backend: execution.backend }),
      ...(execution.providerId === undefined ? {} : { providerId: execution.providerId }),
      ...(execution.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
      ...(execution.error === undefined ? {} : { error: execution.error }),
      ...(execution.reason === undefined ? {} : { reason: execution.reason }),
      ...(evidence === undefined ? {} : { evidence }),
    },
  };
}

function formatWeixinGatewaySandboxExecutionReason(execution) {
  if (
    execution.error === "sandbox-backend-admission-denied" &&
    execution.reason === "Host sandbox command is not allowed by configured prefixes"
  ) {
    return "Command is not an allowed Weixin gateway lifecycle argv pattern.";
  }
  return execution.reason ?? execution.error ?? "";
}

function resolveWeixinGatewayAllowedCommandPatterns(file, args, options = {}) {
  if (Array.isArray(options.allowedCommandPatterns) && options.allowedCommandPatterns.length > 0) {
    return options.allowedCommandPatterns;
  }
  if (
    Array.isArray(options.weixinGatewayAllowedCommandPatterns) &&
    options.weixinGatewayAllowedCommandPatterns.length > 0
  ) {
    return options.weixinGatewayAllowedCommandPatterns;
  }
  const argv = Array.isArray(args) ? args.map(String) : [];
  if (file === "kill" && !isAllowedWeixinGatewayKillCommand(argv, options)) {
    return [createBlockedWeixinGatewayCommandPattern()];
  }
  return [
    {
      executable: String(file),
      argv,
      operationId: options.command ?? formatWeixinGatewaySandboxCommand(file, argv),
    },
  ];
}

function isAllowedWeixinGatewayKillCommand(argv, options) {
  const signal = argv[0];
  const pid = argv[1];
  const allowedPids = Array.isArray(options.allowedProcessPids)
    ? options.allowedProcessPids.map(String)
    : [];
  return (
    (signal === "-TERM" || signal === "-KILL") &&
    typeof pid === "string" &&
    /^\d+$/u.test(pid) &&
    allowedPids.includes(pid)
  );
}

function createBlockedWeixinGatewayCommandPattern() {
  return {
    executable: "__blocked_weixin_gateway_command__",
    argv: [],
    operationId: "blocked",
  };
}

function createWeixinGatewayKillProcessEvidence(signal, pid) {
  const normalizedSignal = normalizeWeixinGatewayProcessSignal(signal);
  return {
    pid,
    signal: normalizedSignal,
    ownedProcess: true,
    terminationReason: "stale-workspace-gateway-cleanup",
    signals: [
      {
        signal: normalizedSignal,
        reason: "stale-workspace-gateway-cleanup",
      },
    ],
  };
}

function normalizeWeixinGatewayProcessSignal(signal) {
  if (signal === "-TERM") {
    return "SIGTERM";
  }
  if (signal === "-KILL") {
    return "SIGKILL";
  }
  return String(signal).replace(/^-/, "SIG");
}

function mergeWeixinGatewayProcessEvidence(evidence, processEvidence) {
  if (processEvidence === undefined) {
    return evidence;
  }
  return {
    ...evidence,
    process: processEvidence,
  };
}

function adaptWeixinGatewayRunCommandToSandboxRunner(runCommand) {
  return async (request) => {
    const result = await runCommand(request.executable, request.argv, {
      cwd: request.cwd,
      env: request.env ?? process.env,
      timeout: COMMAND_TIMEOUT_MS,
    });
    return {
      exitCode: result.exitCode ?? result.code ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}

function runWeixinGatewayProcessCommand(request) {
  return new Promise((resolveCommand) => {
    execFile(
      request.executable,
      [...request.argv],
      {
        cwd: request.cwd,
        env: request.env ?? process.env,
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof error === "object" && "code" in error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolveCommand({
          exitCode: code,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

function formatWeixinGatewaySandboxCommand(file, args) {
  return [file, ...(Array.isArray(args) ? args : [])]
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(" ");
}

function shouldSkipLaunchctl(options) {
  return (
    options.skipServiceControl === true || (options.runCommand === undefined && isVitestRuntime())
  );
}

function resolveLaunchdDomain() {
  return `gui/${typeof process.getuid === "function" ? process.getuid() : 501}`;
}

function resolveLaunchdServiceTarget() {
  return `${resolveLaunchdDomain()}/${LAUNCH_AGENT_LABEL}`;
}

function parseLaunchctlPrint(output) {
  const state = output.match(/^\s*state\s*=\s*([A-Za-z0-9_-]+)/mu)?.[1] ?? null;
  const pidText = output.match(/^\s*pid\s*=\s*(\d+)/mu)?.[1] ?? null;
  const exitText = output.match(/^\s*last exit status\s*=\s*(-?\d+)/imu)?.[1] ?? null;
  return {
    state,
    pid: pidText ? Number.parseInt(pidText, 10) : null,
    lastExitStatus: exitText ? Number.parseInt(exitText, 10) : null,
  };
}

function isAlreadyBootstrapped(command) {
  return /already\s+(?:loaded|exists)|service\s+already|bootstrap failed:\s*5/iu.test(
    `${command.stdout}\n${command.stderr}`,
  );
}

function compactCommandOutput(command) {
  const text = `${command.stderr || command.stdout}`.trim();
  return text.length > 0 ? text.slice(0, 1000) : `exit ${command.code}`;
}

async function inspectWeixinAccount(home, configuredSelectedAccountId = null) {
  const accountIds = await readJsonOrNull(join(home, "accounts", "accounts.json"));
  const ids = Array.isArray(accountIds)
    ? accountIds.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];
  const storeSelectedAccountId = loadSelectedWeixinAccountId(home);
  const configSelectedAccountId =
    typeof configuredSelectedAccountId === "string" && configuredSelectedAccountId.trim().length > 0
      ? configuredSelectedAccountId.trim()
      : null;
  const selectedAccountId =
    storeSelectedAccountId ?? (configSelectedAccountId && ids.includes(configSelectedAccountId)
      ? configSelectedAccountId
      : null);
  const accounts = [];
  for (const id of ids) {
    const account = await readJsonOrNull(join(home, "accounts", `${id}.json`));
    accounts.push({
      id,
      userId: typeof account?.userId === "string" ? account.userId : null,
      savedAt: typeof account?.savedAt === "string" ? account.savedAt : null,
      selected: id === selectedAccountId,
    });
  }
  const sortedAccounts = sortWeixinAccountsForDisplay(accounts);
  const primary = sortedAccounts.find((account) => account.id === selectedAccountId) ?? sortedAccounts[0];

  return {
    home,
    loggedIn: sortedAccounts.length > 0,
    count: sortedAccounts.length,
    selectedAccountId,
    primaryId: primary?.id ?? null,
    primaryUserId: primary?.userId ?? null,
    accounts: sortedAccounts.slice(0, 8),
  };
}

function sortWeixinAccountsForDisplay(accounts) {
  return [...accounts].sort((a, b) => {
    if (a.selected !== b.selected) {
      return a.selected ? -1 : 1;
    }
    const aTime = Date.parse(a.savedAt ?? "");
    const bTime = Date.parse(b.savedAt ?? "");
    const aValue = Number.isFinite(aTime) ? aTime : 0;
    const bValue = Number.isFinite(bTime) ? bTime : 0;
    return bValue - aValue;
  });
}

function resolveMostRecentWeixinAccountIdSync(home) {
  const accountIds = readJsonSync(join(home, "accounts", "accounts.json"));
  const ids = Array.isArray(accountIds)
    ? accountIds.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];
  const accounts = ids
    .map((id, index) => {
      const account = readJsonSync(join(home, "accounts", `${id}.json`));
      const savedAt = Date.parse(account?.savedAt ?? "");
      return {
        id,
        index,
        exists: account !== null,
        savedAt: Number.isFinite(savedAt) ? savedAt : 0,
      };
    })
    .filter((account) => account.exists);
  accounts.sort((a, b) => b.savedAt - a.savedAt || a.index - b.index);
  return accounts[0]?.id ?? null;
}

function readJsonSync(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function loadWeixinAccountForReadiness(home, accountId) {
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    return null;
  }
  try {
    return loadWeixinAccount(home, accountId);
  } catch {
    return null;
  }
}

function isExpiredWeixinSessionError(error) {
  return /登录会话已过期|session.*expired|expired/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function readRecentGatewayLogs(paths) {
  const [stdout, stderr] = await Promise.all([
    readTail(paths.stdoutPath, LOG_LINE_LIMIT),
    readTail(paths.stderrPath, LOG_LINE_LIMIT),
  ]);
  return {
    stdout,
    stderr,
    combined: [
      ...stdout.map((line) => `out ${line}`),
      ...stderr.map((line) => `err ${line}`),
    ].slice(-LOG_LINE_LIMIT),
  };
}

async function readTail(path, limit) {
  try {
    const text = await readFile(path, "utf8");
    return text.split(/\r?\n/u).filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function resetGatewayLogs(paths) {
  await mkdir(paths.logDir, { recursive: true });
  await Promise.all([writeFile(paths.stdoutPath, "", "utf8"), writeFile(paths.stderrPath, "", "utf8")]);
}

function resolveWeixinLoginApi(options) {
  return (
    options.weixinLoginApi ?? {
      startWeixinQrLogin,
      checkWeixinQrLoginStatus,
      saveWeixinAccount,
    }
  );
}

function isPendingWeixinLogin(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.schemaVersion === LOGIN_SCHEMA_ID &&
    typeof value.qrcode === "string" &&
    value.qrcode.trim().length > 0
  );
}

function isExpiredLogin(login) {
  const expiresAt = Date.parse(login.expiresAt ?? "");
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

async function readAndRepairWeixinLogin(path) {
  const login = await readJsonOrNull(path);
  if (!isPendingWeixinLogin(login) || isExpiredLogin(login)) {
    return login;
  }
  const repaired = await repairWeixinLoginDisplayPayload(login);
  if (repaired !== login) {
    await writeJson(path, repaired);
  }
  return repaired;
}

async function repairWeixinLoginDisplayPayload(login) {
  const qrcodeUrl = typeof login.qrcodeUrl === "string" ? login.qrcodeUrl.trim() : "";
  const qrcodeImageSrc =
    typeof login.qrcodeImageSrc === "string" ? login.qrcodeImageSrc.trim() : "";
  if (isDirectImageSource(qrcodeImageSrc) || isBase64ImagePayload(qrcodeImageSrc)) {
    return login;
  }
  if (!qrcodeUrl && !qrcodeImageSrc) {
    return login;
  }
  const displayQr = await createQrcodeDisplayPayload({
    qrcode: login.qrcode,
    qrcodeUrl: qrcodeUrl || qrcodeImageSrc,
  });
  return {
    ...login,
    qrcodeUrl: displayQr.qrcodeUrl,
    qrcodeImageSrc: displayQr.qrcodeImageSrc,
  };
}

async function createQrcodeDisplayPayload(qr) {
  const qrcodeUrl = typeof qr.qrcodeUrl === "string" ? qr.qrcodeUrl.trim() : "";
  const qrcode = typeof qr.qrcode === "string" ? qr.qrcode.trim() : "";
  const qrcodeImageSrc = normalizeDirectQrcodeImageSrc(qrcodeUrl);
  if (qrcodeImageSrc) {
    return {
      qrcodeUrl,
      qrcodeImageSrc,
    };
  }

  const text = qrcodeUrl || qrcode;
  if (!text) {
    return {
      qrcodeUrl: "",
      qrcodeImageSrc: null,
    };
  }

  return {
    qrcodeUrl: "",
    qrcodeImageSrc: await QRCode.toDataURL(text, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
    }),
  };
}

function formatWeixinGatewayLogin(login) {
  if (!isPendingWeixinLogin(login)) {
    return {
      schemaVersion: LOGIN_SCHEMA_ID,
      pending: false,
      status: "idle",
    };
  }
  const status = isExpiredLogin(login) ? "expired" : (login.status ?? "qr");
  return {
    schemaVersion: LOGIN_SCHEMA_ID,
    pending: status !== "expired",
    sessionKey: login.sessionKey ?? null,
    status,
    baseUrl: typeof login.baseUrl === "string" ? login.baseUrl : ILINK_BASE_URL,
    qrcodeUrl: typeof login.qrcodeUrl === "string" ? login.qrcodeUrl : "",
    qrcodeImageSrc:
      typeof login.qrcodeImageSrc === "string"
        ? login.qrcodeImageSrc
        : normalizeQrcodeImageSrc(login.qrcodeUrl),
    needVerifyCode: status === "need_verifycode",
    startedAt: typeof login.startedAt === "string" ? login.startedAt : null,
    updatedAt: typeof login.updatedAt === "string" ? login.updatedAt : null,
    expiresAt: typeof login.expiresAt === "string" ? login.expiresAt : null,
    message:
      typeof login.message === "string" && login.message.trim().length > 0
        ? login.message.trim()
        : formatLoginStatusMessage(status),
  };
}

function normalizeQrcodeImageSrc(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return null;
  }
  if (isDirectImageSource(text)) {
    return text;
  }
  if (isBase64ImagePayload(text)) {
    return `data:image/png;base64,${text.replace(/\s/gu, "")}`;
  }
  return null;
}

function normalizeDirectQrcodeImageSrc(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return null;
  }
  if (isDirectImageSource(text)) {
    return text;
  }
  if (isBase64ImagePayload(text)) {
    return `data:image/png;base64,${text.replace(/\s/gu, "")}`;
  }
  return null;
}

function isDirectImageSource(value) {
  return /^(?:data:image\/|https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$)/iu.test(value);
}

function isBase64ImagePayload(value) {
  return /^[A-Za-z0-9+/=\r\n]+$/u.test(value) && value.replace(/\s/gu, "").length > 100;
}

function sanitizeSavedWeixinAccount(account) {
  return {
    normalizedAccountId: account.normalizedAccountId,
    accountId: account.accountId,
    baseUrl: account.baseUrl,
    savedAt: account.savedAt,
    ...(account.userId === undefined ? {} : { userId: account.userId }),
  };
}

function formatLoginStatusMessage(status) {
  const messages = {
    qr: "请用手机微信扫描二维码。",
    wait: "等待扫码。",
    scaned: "已扫码，请在手机微信确认。",
    scaned_but_redirect: "已扫码，正在切换 iLink 登录节点。",
    need_verifycode: "微信要求输入手机端显示的数字验证码。",
    expired: "二维码已过期，请重新点击连接微信。",
    verify_code_blocked: "验证码多次错误，请稍后重新扫码。",
    binded_redirect: "此微信已连接过当前通道，无需重复连接。",
  };
  return messages[status] ?? "等待微信登录状态更新。";
}

function formatTerminalLoginMessage(status, fallback) {
  return fallback?.trim() || formatLoginStatusMessage(status);
}

function createGatewayNotes({ enabled, running, status, account, launchd, screen }) {
  const notes = [];
  notes.push(enabled ? "客户端已要求微信网关常驻运行。" : "微信网关常驻运行未开启。");
  notes.push(running ? "网关进程正在运行。" : `网关状态：${status}。`);
  if (account.loggedIn) {
    notes.push(`已登录 ${account.count} 个个人微信账号。`);
  } else {
    notes.push("还没有可用个人微信登录凭据。");
  }
  if (launchd.printError) {
    notes.push(`launchd 状态：${launchd.printError}`);
  }
  if (screen.running) {
    notes.push("检测到临时 screen 网关进程；关闭常驻开关时会一并尝试停止。");
  }
  return notes;
}

function createGatewayIssues({ enabled, account, launchd }) {
  const issues = [];
  if (enabled && !account.loggedIn) {
    issues.push("微信网关没有登录账号，开启后也无法收发消息；需要先执行微信登录。");
  }
  if (
    enabled &&
    launchd.printError &&
    !/not loaded|could not find service|exit 113|exit 3/iu.test(launchd.printError)
  ) {
    issues.push(`launchd 查询失败：${launchd.printError}`);
  }
  return issues;
}

function resolveNodeExecutable(env = process.env) {
  return (
    env.DIRECTOR_DESKTOP_NODE_EXECUTABLE?.trim() ||
    env.npm_node_execpath?.trim() ||
    process.execPath
  );
}

function resolveServicePath(env = process.env) {
  return env.PATH?.trim() || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
}

function resolveHostApiUrl(env = process.env) {
  return env?.DIRECTOR_HOST_API_URL?.trim() || "http://127.0.0.1:3201";
}

function resolveLearningFetchUrl(env = process.env, config = null) {
  return env?.DIRECTOR_LEARNING_FETCH_URL?.trim() || config?.learningFetchUrl?.trim() || "";
}

function resolveBrowserToolUrl(env = process.env, config = null) {
  return env?.DIRECTOR_BROWSER_TOOL_URL?.trim() || config?.browserToolUrl?.trim() || "";
}

function resolveIlinkBaseUrl(env = process.env) {
  return env?.DIRECTOR_WEIXIN_ILINK_BASE_URL?.trim() || ILINK_BASE_URL;
}

function resolveIlinkBotType(env = process.env) {
  return env?.DIRECTOR_WEIXIN_BOT_TYPE?.trim() || DEFAULT_ILINK_BOT_TYPE;
}

function resolveLaunchAgentHome(env, workspaceRoot) {
  if (isVitestRuntime() && env === undefined) {
    return join(workspaceRoot, ".director-angel", "test-home");
  }
  return resolveHome(env);
}

function resolveHome(env = process.env) {
  return env?.HOME?.trim() || homedir();
}

function isVitestRuntime() {
  return (
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.NODE_ENV === "test"
  );
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
