import { type ExecFileOptions, execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { type Stats, createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, parse } from "node:path";
import { PassThrough, type Stream } from "node:stream";
import { promisify } from "node:util";
import {
  admitAgentOsSandboxExecution,
  assertAgentOsSandboxLongLivedProcessSpawnAdmitted,
  createAgentOsHostSandboxBackendAdapter,
  createAgentOsSandboxBackendRegistry,
  createAgentOsSandboxCommandAdmissionEvidence,
  executeAgentOsSandboxCommand,
  planAgentOsSandboxExecution,
} from "@hotflow/agent-os-sandbox";
import type {
  AgentOsProcessCapabilityProcessEvidence,
  AgentOsProcessCapabilitySignalEvidence,
  AgentOsSandboxCommandExecutionEvidence,
  AgentOsSandboxCommandExecutionResult,
} from "@hotflow/agent-os-sandbox";
import {
  UnauthorizedError,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  discoverOAuthServerInfo,
  refreshAuthorization as refreshMcpAuthorization,
  auth as runMcpOAuth,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Prompt, Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
  ConversationRuntimeMcpToolCallInput,
  ConversationRuntimeMcpToolCallOutput,
  ConversationRuntimeMcpToolProvider,
  ConversationRuntimeMcpToolSource,
} from "./mcp-tool-provider.js";

export type ConversationRuntimeMcpTransport = "stdio" | "http" | "sse";
export type ConversationRuntimeMcpOAuthStorageMode = "file" | "keychain" | "auto";

export interface ConversationRuntimeMcpServerConfig {
  readonly type?: ConversationRuntimeMcpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth?: "none" | "oauth" | "header";
  readonly oauth?: {
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly callbackPort?: number;
    readonly authServerMetadataUrl?: string;
    readonly xaa?:
      | boolean
      | {
          readonly idpClientId?: string;
          readonly idpClientSecret?: string;
          readonly idpIdToken?: string;
          readonly idpTokenEndpoint?: string;
        };
  };
  readonly enabled?: boolean;
  readonly tools?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  };
  readonly timeoutMs?: number;
}

export interface ConversationRuntimeMcpJsonConfig {
  readonly mcpServers?: Readonly<Record<string, ConversationRuntimeMcpServerConfig>>;
}

export type ConversationRuntimeMcpConfigSourceScope =
  | "director-project"
  | "project-parent"
  | "project";

export interface ConversationRuntimeMergedMcpConfigSource {
  readonly scope: ConversationRuntimeMcpConfigSourceScope;
  readonly path: string;
  readonly version: string;
  readonly updatedAtMs: number;
  readonly serverCount: number;
}

export interface ConversationRuntimeMergedMcpConfig {
  readonly path: string;
  readonly source: "claude-code-project" | "director-project" | "merged" | "project-parent";
  readonly version: string;
  readonly updatedAtMs: number | null;
  readonly servers: Readonly<Record<string, ConversationRuntimeMcpServerConfig>>;
  readonly serverSources: Readonly<
    Record<
      string,
      { readonly scope: ConversationRuntimeMcpConfigSourceScope; readonly path: string }
    >
  >;
  readonly sources: readonly ConversationRuntimeMergedMcpConfigSource[];
  readonly sourceCount: number;
}

export type ConversationRuntimeMcpServerConnectionStatus =
  | "connected"
  | "failed"
  | "needs-auth"
  | "disabled";

export interface ConversationRuntimeMcpServerToolStatus {
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly openWorld?: boolean;
}

export interface ConversationRuntimeMcpServerInspection {
  readonly name: string;
  readonly status: ConversationRuntimeMcpServerConnectionStatus;
  readonly enabled: boolean;
  readonly transport: ConversationRuntimeMcpTransport;
  readonly toolCount: number;
  readonly enabledToolCount: number;
  readonly tools: readonly ConversationRuntimeMcpServerToolStatus[];
  readonly selection?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  };
  readonly auth: {
    readonly mode: "none" | "oauth" | "header";
    readonly needsAuth: boolean;
    readonly configured: boolean;
  };
  readonly error?: string;
  readonly config: ConversationRuntimeMcpServerConfig;
}

export interface ConversationRuntimeMcpInspection {
  readonly inspectedAtMs: number;
  readonly serverCount: number;
  readonly enabledCount: number;
  readonly connectedCount: number;
  readonly failedCount: number;
  readonly needsAuthCount: number;
  readonly disabledCount: number;
  readonly toolCount: number;
  readonly servers: readonly ConversationRuntimeMcpServerInspection[];
  readonly notes: readonly string[];
  readonly issues: readonly string[];
}

export interface ConversationRuntimeMcpClientOptions {
  readonly servers: Readonly<Record<string, ConversationRuntimeMcpServerConfig>>;
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly cwd?: string;
  readonly stderrLogPath?: string;
  readonly oauthStorePath?: string;
  readonly oauthStorageMode?: ConversationRuntimeMcpOAuthStorageMode;
  readonly oauthStore?: ConversationRuntimeMcpOAuthStore;
  readonly refreshLockDir?: string;
  readonly openAuthorizationUrl?: (url: string) => Promise<void> | void;
  readonly mcpStdioTransportFactory?: (
    request: ConversationRuntimeMcpStdioTransportRequest,
  ) => Transport;
  readonly mcpStdioCloseDelayMs?: number;
  readonly onMcpStdioProcessEvidence?: (
    event: ConversationRuntimeMcpStdioProcessEvidenceEvent,
  ) => Promise<void> | void;
  readonly onServerListChanged?: (
    event: ConversationRuntimeMcpListChangedEvent,
  ) => Promise<void> | void;
  readonly nowMs?: () => number;
}

export interface ConversationRuntimeMcpStdioProcessEvidenceEvent {
  readonly serverName: string;
  readonly process: AgentOsProcessCapabilityProcessEvidence;
  readonly sandbox?: ConversationRuntimeMcpStdioTransportRequest["sandbox"];
}

export interface ConversationRuntimeMcpStdioTransportRequest {
  readonly serverName: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly stderr: "pipe";
  readonly spawnCommand: (
    request: ConversationRuntimeMcpStdioSpawnRequest,
  ) => ConversationRuntimeMcpStdioProcess;
  readonly sandbox: ConversationRuntimeMcpStdioSandboxAdmission;
}

export interface ConversationRuntimeMcpStdioSandboxAdmission {
  readonly ok: boolean;
  readonly status: string;
  readonly backend?: string;
  readonly providerId?: string;
  readonly evidence?: AgentOsSandboxCommandExecutionEvidence;
}

export interface ConversationRuntimeMcpStdioSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly sandbox?: ConversationRuntimeMcpStdioSandboxAdmission;
}

export interface ConversationRuntimeMcpStdioProcess {
  readonly stdin?: {
    write(chunk: string): boolean;
    once(event: "drain", listener: () => void): void;
    end(): void;
    on?(event: "error", listener: (error: Error) => void): void;
  } | null;
  readonly stdout?: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  } | null;
  readonly stderr?: {
    pipe(
      destination: NodeJS.WritableStream,
      options?: { readonly end?: boolean },
    ): NodeJS.WritableStream;
  } | null;
  readonly pid?: number | undefined;
  readonly exitCode?: number | null | undefined;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "spawn", listener: () => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
  once(event: "close", listener: () => void): void;
  kill(signal: NodeJS.Signals): void;
}

export interface ConversationRuntimeMcpAuthorizeOptions
  extends ConversationRuntimeMcpClientOptions {
  readonly serverName: string;
  readonly callbackPort?: number;
  readonly timeoutMs?: number;
  readonly skipBrowserOpen?: boolean;
}

export interface ConversationRuntimeMcpAuthorizeResult {
  readonly serverName: string;
  readonly status: "authorized";
  readonly authorizationUrl?: string;
  readonly callbackUrl: string;
  readonly expiresAtMs?: number;
  readonly authMethod?: "oauth" | "xaa";
  readonly storage?: ConversationRuntimeMcpOAuthStoreInspection;
}

export interface ConversationRuntimeMcpRevokeOptions extends ConversationRuntimeMcpClientOptions {
  readonly serverName: string;
  readonly preserveDiscovery?: boolean;
}

export interface ConversationRuntimeMcpRevokeResult {
  readonly serverName: string;
  readonly status: "revoked" | "cleared" | "not-configured";
  readonly revokedTokenTypes: readonly ("refresh_token" | "access_token")[];
  readonly localCredentialsCleared: boolean;
  readonly revocationEndpoint?: string;
  readonly issues: readonly string[];
  readonly storage: ConversationRuntimeMcpOAuthStoreInspection;
}

export interface ConversationRuntimeMcpOAuthStoreInspection {
  readonly kind: "file" | "keychain" | "fallback";
  readonly path?: string;
  readonly primaryKind?: string;
  readonly fallbackKind?: string;
  readonly keychainSandbox?: {
    readonly ok: boolean;
    readonly status: string;
    readonly backend?: string;
    readonly providerId?: string;
    readonly evidence?: AgentOsSandboxCommandExecutionEvidence;
  };
}

export interface ConversationRuntimeMcpOAuthStore {
  readonly kind?: string;
  readonly path?: string;
  read(): Promise<ConversationRuntimeMcpOAuthStoreDocument>;
  write(store: ConversationRuntimeMcpOAuthStoreDocument): Promise<void>;
  delete?(): Promise<void>;
}

export interface ConversationRuntimeMcpOAuthStoreEntry {
  readonly serverName?: string;
  readonly serverUrl?: string;
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly tokens?: OAuthTokens;
  readonly expiresAtMs?: number;
  readonly scope?: string;
  readonly discoveryState?: ConversationRuntimeMcpOAuthDiscoveryState;
}

export interface ConversationRuntimeMcpOAuthDiscoveryState {
  readonly authorizationServerUrl: string;
  readonly resourceMetadataUrl?: string;
  readonly authorizationServerMetadata?: AuthorizationServerMetadata;
  readonly resourceMetadata?: OAuthProtectedResourceMetadata;
}

export interface ConversationRuntimeMcpOAuthStoreDocument {
  readonly schemaVersion: "director.mcp.oauth.v1";
  readonly servers: Record<string, ConversationRuntimeMcpOAuthStoreEntry>;
}

export interface ConversationRuntimeMcpListChangedEvent {
  readonly serverName: string;
  readonly type: "tools" | "prompts" | "resources";
  readonly status: "changed" | "failed";
  readonly itemCount?: number;
  readonly previousItemCount?: number;
  readonly error?: string;
  readonly atMs: number;
}

interface ConnectedMcpServer {
  readonly name: string;
  readonly config: ConversationRuntimeMcpServerConfig;
  readonly client: Client;
  readonly transport: Transport;
  toolCount?: number;
  promptCount?: number;
  resourceCount?: number;
}

const DEFAULT_MCP_CLIENT_NAME = "director-angel";
const DEFAULT_MCP_CLIENT_VERSION = "0.1.0";
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
const DEFAULT_OAUTH_TIMEOUT_MS = 300_000;
const DEFAULT_AUTH_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_REFRESH_LOCK_STALE_MS = 120_000;
const DEFAULT_REFRESH_LOCK_RETRY_COUNT = 5;
const DEFAULT_REFRESH_LOCK_RETRY_BASE_MS = 100;
const MCP_KEYCHAIN_SERVICE = "Director Angel MCP OAuth";
const MCP_KEYCHAIN_ACCOUNT = "director-angel";
const SECURITY_STDIN_LINE_LIMIT = 4096 - 64;
const XAA_TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const XAA_JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const XAA_ID_JAG_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id-jag";
const XAA_ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const execFileAsync = promisify(execFile);
type ExecFileAsync = (
  file: string,
  args?: readonly string[],
  options?: ExecFileOptions,
) => Promise<{
  readonly stdout: string | Buffer;
  readonly stderr: string | Buffer;
}>;
let mcpExecFileAsync: ExecFileAsync = execFileAsync;
type SpawnWithInput = (file: string, args: readonly string[], input: string) => Promise<void>;
let mcpSpawnWithInput: SpawnWithInput = spawnWithInput;
let latestMcpKeychainSandboxExecution:
  | Pick<
      AgentOsSandboxCommandExecutionResult,
      "backend" | "evidence" | "ok" | "providerId" | "status"
    >
  | undefined;

const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "SHELL",
  "TMPDIR",
]);

const CREDENTIAL_PATTERN =
  /(?:ghp_[A-Za-z0-9_]{1,255}|sk-[A-Za-z0-9_]{1,255}|Bearer\s+\S+|token=[^\s&,;"']{1,255}|key=[^\s&,;"']{1,255}|API_KEY=[^\s&,;"']{1,255}|password=[^\s&,;"']{1,255}|secret=[^\s&,;"']{1,255})/giu;

export function loadConversationRuntimeMcpJsonConfig(
  filePath: string,
): ConversationRuntimeMcpJsonConfig {
  if (!existsSync(filePath)) {
    return {};
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    return {};
  }
  const mcpServers = parsed.mcpServers;
  if (!isRecord(mcpServers)) {
    return {};
  }
  const servers: Record<string, ConversationRuntimeMcpServerConfig> = {};
  for (const [name, value] of Object.entries(mcpServers)) {
    if (!isRecord(value)) {
      continue;
    }
    const config = normalizeMcpServerConfig(value);
    if (config !== null) {
      servers[name] = config;
    }
  }
  return { mcpServers: servers };
}

export async function writeConversationRuntimeMcpJsonConfig(
  filePath: string,
  config: ConversationRuntimeMcpJsonConfig,
): Promise<void> {
  const document = {
    mcpServers: config.mcpServers ?? {},
  };
  await mkdir(dirname(filePath), { recursive: true });
  let existingMode: number | undefined;
  try {
    existingMode = (await stat(filePath)).mode;
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const handle = await open(tempPath, "w", existingMode ?? 0o644);
  try {
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.datasync();
  } finally {
    await handle.close();
  }

  try {
    if (existingMode !== undefined) {
      await chmod(tempPath, existingMode);
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export function loadConversationRuntimeMergedMcpConfig(
  workspaceRoot: string,
): ConversationRuntimeMergedMcpConfig {
  const claudeCodeConfigPath = join(workspaceRoot, ".mcp.json");
  const directorConfigPath = join(workspaceRoot, ".director-angel", "mcp", "servers.json");
  const sources = listConversationRuntimeMcpConfigSources(workspaceRoot);
  const servers: Record<string, ConversationRuntimeMcpServerConfig> = {};
  const serverSources: Record<
    string,
    { scope: ConversationRuntimeMcpConfigSourceScope; path: string }
  > = {};
  for (const source of sources) {
    const config = loadConversationRuntimeMcpJsonConfig(source.path);
    for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
      servers[name] = server;
      serverSources[name] = {
        scope: source.scope,
        path: source.path,
      };
    }
  }
  const writableStats = existsSync(claudeCodeConfigPath)
    ? createMcpConfigFileStats(statSync(claudeCodeConfigPath))
    : null;
  const latestSourceStats =
    sources.length === 0
      ? writableStats
      : sources.reduce((latest, source) =>
          source.stats.mtimeMs > latest.stats.mtimeMs ? source : latest,
        ).stats;
  return {
    path: claudeCodeConfigPath,
    source: resolveConversationRuntimeMcpConfigSourceLabel(
      sources,
      claudeCodeConfigPath,
      directorConfigPath,
    ),
    version: formatConversationRuntimeMcpConfigVersion(sources, writableStats),
    updatedAtMs: latestSourceStats?.mtimeMs ?? null,
    servers,
    serverSources,
    sources: sources.map((source) => ({
      scope: source.scope,
      path: source.path,
      version: `${source.stats.mtimeMs}:${source.stats.size}`,
      updatedAtMs: source.stats.mtimeMs,
      serverCount: source.serverCount,
    })),
    sourceCount: sources.length,
  };
}

export function createConversationRuntimeWritableMergedMcpServers(
  workspaceRoot: string,
  servers: Readonly<Record<string, ConversationRuntimeMcpServerConfig>>,
): Readonly<Record<string, ConversationRuntimeMcpServerConfig>> {
  const configPath = join(workspaceRoot, ".mcp.json");
  const current = loadConversationRuntimeMergedMcpConfig(workspaceRoot);
  const currentProjectConfig = existsSync(configPath)
    ? loadConversationRuntimeMcpJsonConfig(configPath)
    : {};
  const writable: Record<string, ConversationRuntimeMcpServerConfig> = {
    ...(currentProjectConfig.mcpServers ?? {}),
  };
  for (const [name, server] of Object.entries(servers ?? {})) {
    const source = current.serverSources[name];
    const previous = current.servers[name];
    const inheritedSource =
      source?.path === configPath
        ? findInheritedMcpServerSource(current.sources, configPath, name)
        : null;
    if (
      source?.path === configPath &&
      previous?.enabled === false &&
      inheritedSource !== null &&
      areMcpServerConfigsEquivalentForLocalOverride(server, inheritedSource.server)
    ) {
      delete writable[name];
      continue;
    }
    if (
      source === undefined ||
      source.path === configPath ||
      !areMcpServerConfigsEqual(server, previous)
    ) {
      writable[name] = server;
    }
  }
  for (const name of Object.keys(writable)) {
    if (!Object.prototype.hasOwnProperty.call(servers ?? {}, name)) {
      const inheritedSource = findInheritedMcpServerSource(current.sources, configPath, name);
      if (inheritedSource !== null) {
        writable[name] = {
          ...inheritedSource.server,
          enabled: false,
        };
      } else {
        delete writable[name];
      }
    }
  }
  for (const [name, source] of Object.entries(current.serverSources)) {
    if (
      source.path !== configPath &&
      current.servers[name] !== undefined &&
      !Object.prototype.hasOwnProperty.call(servers ?? {}, name)
    ) {
      writable[name] = {
        ...current.servers[name],
        enabled: false,
      };
    }
  }
  return writable;
}

function findInheritedMcpServerSource(
  sources: readonly ConversationRuntimeMergedMcpConfigSource[],
  configPath: string,
  serverName: string,
): { readonly server: ConversationRuntimeMcpServerConfig } | null {
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    if (source === undefined) {
      continue;
    }
    if (source.path === configPath) {
      continue;
    }
    const server = loadConversationRuntimeMcpJsonConfig(source.path).mcpServers?.[serverName];
    if (server !== undefined) {
      return { server };
    }
  }
  return null;
}

function areMcpServerConfigsEquivalentForLocalOverride(
  left: ConversationRuntimeMcpServerConfig,
  right: ConversationRuntimeMcpServerConfig,
): boolean {
  return (
    JSON.stringify(normalizeMcpOverrideComparableConfig(left)) ===
    JSON.stringify(normalizeMcpOverrideComparableConfig(right))
  );
}

function normalizeMcpOverrideComparableConfig(value: ConversationRuntimeMcpServerConfig): unknown {
  return normalizeMcpConfigForCompare(stripMcpDefaultConfigFields(value));
}

function stripMcpDefaultConfigFields(
  value: ConversationRuntimeMcpServerConfig,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "enabled" && item === true) {
      continue;
    }
    if (key === "type" && item === "stdio" && typeof value.command === "string") {
      continue;
    }
    if (
      (key === "args" || key === "env" || key === "headers") &&
      isEmptyMcpConfigObjectOrArray(item)
    ) {
      continue;
    }
    result[key] = item;
  }
  return result;
}

function isEmptyMcpConfigObjectOrArray(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return isRecord(value) && Object.keys(value).length === 0;
}

interface ConversationRuntimeMcpConfigSourceWithStats {
  readonly scope: ConversationRuntimeMcpConfigSourceScope;
  readonly path: string;
  readonly stats: ConversationRuntimeMcpConfigFileStats;
  readonly serverCount: number;
}

interface ConversationRuntimeMcpConfigFileStats {
  readonly mtimeMs: number;
  readonly size: number;
}

function listConversationRuntimeMcpConfigSources(
  workspaceRoot: string,
): ConversationRuntimeMcpConfigSourceWithStats[] {
  const sources: ConversationRuntimeMcpConfigSourceWithStats[] = [];
  appendConversationRuntimeMcpConfigSource(sources, {
    scope: "director-project",
    path: join(workspaceRoot, ".director-angel", "mcp", "servers.json"),
  });

  const projectPaths: string[] = [];
  let currentDir = workspaceRoot;
  const rootDir = parse(currentDir).root;
  while (currentDir !== rootDir) {
    projectPaths.push(join(currentDir, ".mcp.json"));
    currentDir = dirname(currentDir);
  }
  projectPaths.reverse();
  const workspaceProjectPath = join(workspaceRoot, ".mcp.json");
  for (const path of projectPaths) {
    appendConversationRuntimeMcpConfigSource(sources, {
      scope: path === workspaceProjectPath ? "project" : "project-parent",
      path,
    });
  }
  return sources;
}

function appendConversationRuntimeMcpConfigSource(
  sources: ConversationRuntimeMcpConfigSourceWithStats[],
  input: { readonly scope: ConversationRuntimeMcpConfigSourceScope; readonly path: string },
): void {
  if (!existsSync(input.path)) {
    return;
  }
  const stats = createMcpConfigFileStats(statSync(input.path));
  const config = loadConversationRuntimeMcpJsonConfig(input.path);
  sources.push({
    scope: input.scope,
    path: input.path,
    stats,
    serverCount: Object.keys(config.mcpServers ?? {}).length,
  });
}

function resolveConversationRuntimeMcpConfigSourceLabel(
  sources: readonly ConversationRuntimeMcpConfigSourceWithStats[],
  claudeCodeConfigPath: string,
  directorConfigPath: string,
): ConversationRuntimeMergedMcpConfig["source"] {
  if (sources.length === 0) {
    return "claude-code-project";
  }
  if (sources.length > 1) {
    return "merged";
  }
  const source = sources[0];
  if (source === undefined) {
    return "claude-code-project";
  }
  if (source.path === claudeCodeConfigPath) {
    return "claude-code-project";
  }
  if (source.path === directorConfigPath) {
    return "director-project";
  }
  return "project-parent";
}

function formatConversationRuntimeMcpConfigVersion(
  sources: readonly ConversationRuntimeMcpConfigSourceWithStats[],
  writableStats: ConversationRuntimeMcpConfigFileStats | null,
): string {
  if (sources.length === 0) {
    return writableStats === null ? "missing" : `${writableStats.mtimeMs}:${writableStats.size}`;
  }
  if (sources.length === 1) {
    const stats = sources[0]?.stats;
    if (stats === undefined) {
      return writableStats === null ? "missing" : `${writableStats.mtimeMs}:${writableStats.size}`;
    }
    return `${stats.mtimeMs}:${stats.size}`;
  }
  return sources
    .map((source) => `${source.scope}:${source.stats.mtimeMs}:${source.stats.size}`)
    .join("|");
}

function createMcpConfigFileStats(stats: Stats): ConversationRuntimeMcpConfigFileStats {
  return {
    mtimeMs: Number(stats.mtimeMs),
    size: Number(stats.size),
  };
}

function areMcpServerConfigsEqual(
  left: ConversationRuntimeMcpServerConfig | undefined,
  right: ConversationRuntimeMcpServerConfig | undefined,
): boolean {
  return (
    JSON.stringify(normalizeMcpConfigForCompare(left)) ===
    JSON.stringify(normalizeMcpConfigForCompare(right))
  );
}

function normalizeMcpConfigForCompare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeMcpConfigForCompare);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeMcpConfigForCompare(entry)]),
    );
  }
  return value;
}

export function createConversationRuntimeMcpClient(
  options: ConversationRuntimeMcpClientOptions,
): ConversationRuntimeMcpToolProvider & {
  readonly callTool: (
    input: ConversationRuntimeMcpToolCallInput,
  ) => Promise<ConversationRuntimeMcpToolCallOutput>;
  readonly inspectServers: () => Promise<ConversationRuntimeMcpInspection>;
  readonly close: () => Promise<void>;
} {
  const clients = new Map<string, Promise<ConnectedMcpServer>>();
  const oauthStore = resolveMcpOAuthStore(options);

  const refreshConnectedTools = async (
    server: ConnectedMcpServer,
  ): Promise<ConversationRuntimeMcpToolSource[]> => {
    const result = await server.client.listTools(undefined, {
      timeout: resolveToolTimeoutMs(server.config),
    });
    server.toolCount = result.tools.length;
    return result.tools
      .filter((tool) => isMcpToolSelected(tool.name, server.config))
      .map((tool) => mapMcpToolSource(server.name, server.config, tool));
  };

  async function ensureConnected(serverName: string): Promise<ConnectedMcpServer> {
    const existing = clients.get(serverName);
    if (existing !== undefined) {
      return existing;
    }
    const config = options.servers[serverName];
    if (config === undefined) {
      throw new Error(`MCP server "${serverName}" is not configured.`);
    }
    if (config.enabled === false) {
      throw new Error(`MCP server "${serverName}" is disabled.`);
    }
    const connecting = connectMcpServer(serverName, config, options, oauthStore);
    clients.set(serverName, connecting);
    return connecting;
  }

  return {
    listTools: async () => {
      const tools: ConversationRuntimeMcpToolSource[] = [];
      for (const [serverName, config] of Object.entries(options.servers)) {
        if (config.enabled === false) {
          continue;
        }
        try {
          const server = await ensureConnected(serverName);
          tools.push(...(await refreshConnectedTools(server)));
        } catch (error) {
          const needsAuth = isMcpNeedsAuthError(error);
          tools.push({
            serverName,
            toolName: "mcp_status",
            description: needsAuth
              ? `MCP server needs authentication: ${sanitizeMcpError(toErrorMessage(error))}`
              : `MCP server unavailable: ${sanitizeMcpError(toErrorMessage(error))}`,
            inputSchema: emptyObjectSchema(),
            readOnly: true,
            enabled: false,
            metadata: {
              source: "mcp",
              status: needsAuth ? "needs-auth" : "failed",
              error: sanitizeMcpError(toErrorMessage(error)),
            },
          });
        }
      }
      return tools;
    },
    inspectServers: async () => inspectMcpServers({ ...options, ensureConnected }),
    callTool: async (input) => {
      const server = await ensureConnected(input.serverName);
      try {
        const result = (await server.client.callTool(
          {
            name: input.toolName,
            arguments: input.args,
            _meta: {
              "director-angel/toolUseId": input.callId,
            },
          },
          CallToolResultSchema,
          { timeout: resolveToolTimeoutMs(server.config) },
        )) as CallToolResult;
        const content = formatMcpCallToolResult(result);
        const ok = result.isError !== true;
        return {
          ok,
          content,
          output: {
            content: result.content,
            ...(result.structuredContent === undefined
              ? {}
              : { structuredContent: result.structuredContent }),
          },
          ...(ok ? {} : { error: content }),
          metadata: {
            serverName: input.serverName,
            toolName: input.toolName,
          },
        };
      } catch (error) {
        return {
          ok: false,
          content: sanitizeMcpError(toErrorMessage(error)),
          error: sanitizeMcpError(toErrorMessage(error)),
          metadata: {
            serverName: input.serverName,
            toolName: input.toolName,
          },
        };
      }
    },
    close: async () => {
      const settled = await Promise.allSettled(clients.values());
      clients.clear();
      await Promise.allSettled(
        settled.flatMap((item) =>
          item.status === "fulfilled" ? [item.value.transport.close()] : [],
        ),
      );
    },
  };
}

export async function authorizeConversationRuntimeMcpServer(
  options: ConversationRuntimeMcpAuthorizeOptions,
): Promise<ConversationRuntimeMcpAuthorizeResult> {
  const config = options.servers[options.serverName];
  if (config === undefined) {
    throw new Error(`MCP server "${options.serverName}" is not configured.`);
  }
  if (config.enabled === false) {
    throw new Error(`MCP server "${options.serverName}" is disabled.`);
  }
  if (config.type !== "http" && config.type !== "sse" && config.url === undefined) {
    throw new Error(`MCP server "${options.serverName}" does not use HTTP/SSE OAuth.`);
  }
  if (typeof config.url !== "string" || config.url.trim().length === 0) {
    throw new Error(`MCP server "${options.serverName}" is missing url.`);
  }

  if (config.oauth?.xaa !== undefined && config.oauth.xaa !== false) {
    const oauthStore = resolveMcpOAuthStore(options);
    const provider = createMcpOAuthProvider({
      serverName: options.serverName,
      serverConfig: config,
      redirectUri: defaultMcpOAuthRedirectUri(config),
      clientName: options.clientName ?? DEFAULT_MCP_CLIENT_NAME,
      clientVersion: options.clientVersion ?? DEFAULT_MCP_CLIENT_VERSION,
      store: oauthStore,
      lockDir: resolveMcpRefreshLockDir(options),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    });
    const tokens = await performMcpXaaTokenExchange(options.serverName, config, {
      fetchFn: createMcpAuthFetch(),
    });
    await provider.saveTokens(tokens);
    return {
      serverName: options.serverName,
      status: "authorized",
      callbackUrl: defaultMcpOAuthRedirectUri(config),
      ...(tokens.expires_in === undefined
        ? {}
        : { expiresAtMs: (options.nowMs?.() ?? Date.now()) + tokens.expires_in * 1000 }),
      authMethod: "xaa",
      storage: inspectMcpOAuthStore(oauthStore),
    };
  }

  const port = options.callbackPort ?? config.oauth?.callbackPort ?? 0;
  const callback = await waitForOAuthCallback({
    port,
    timeoutMs: options.timeoutMs ?? DEFAULT_OAUTH_TIMEOUT_MS,
  });
  const oauthStore = resolveMcpOAuthStore(options);
  const provider = createMcpOAuthProvider({
    serverName: options.serverName,
    serverConfig: config,
    redirectUri: callback.redirectUri,
    clientName: options.clientName ?? DEFAULT_MCP_CLIENT_NAME,
    clientVersion: options.clientVersion ?? DEFAULT_MCP_CLIENT_VERSION,
    store: oauthStore,
    lockDir: resolveMcpRefreshLockDir(options),
    onAuthorizationUrl: async (url) => {
      callback.setAuthorizationUrl(url);
      if (options.skipBrowserOpen !== true) {
        try {
          await options.openAuthorizationUrl?.(url);
        } catch {
          // The URL is still surfaced in the result; a failed browser open should not kill OAuth.
        }
      }
    },
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
  });
  callback.setExpectedState(await provider.state?.());

  try {
    const first = await runMcpOAuth(provider, {
      serverUrl: config.url,
      fetchFn: createMcpAuthFetch(),
    });
    if (first !== "REDIRECT") {
      throw new Error(`Unexpected OAuth start result: ${first}`);
    }
    const authorizationCode = await callback.codePromise;
    const second = await runMcpOAuth(provider, {
      serverUrl: config.url,
      authorizationCode,
      fetchFn: createMcpAuthFetch(),
    });
    if (second !== "AUTHORIZED") {
      throw new Error(`Unexpected OAuth completion result: ${second}`);
    }
    const tokens = await provider.tokens();
    return {
      serverName: options.serverName,
      status: "authorized",
      ...(callback.authorizationUrl === undefined
        ? {}
        : { authorizationUrl: callback.authorizationUrl }),
      callbackUrl: callback.redirectUri,
      ...(tokens?.expires_in === undefined
        ? {}
        : { expiresAtMs: (options.nowMs?.() ?? Date.now()) + tokens.expires_in * 1000 }),
      authMethod: "oauth",
      storage: inspectMcpOAuthStore(oauthStore),
    };
  } finally {
    await callback.close();
  }
}

export async function revokeConversationRuntimeMcpServerTokens(
  options: ConversationRuntimeMcpRevokeOptions,
): Promise<ConversationRuntimeMcpRevokeResult> {
  const config = options.servers[options.serverName];
  if (config === undefined) {
    return {
      serverName: options.serverName,
      status: "not-configured",
      revokedTokenTypes: [],
      localCredentialsCleared: false,
      issues: [`MCP server "${options.serverName}" is not configured.`],
      storage: inspectMcpOAuthStore(resolveMcpOAuthStore(options)),
    };
  }
  if (config.type !== "http" && config.type !== "sse" && config.url === undefined) {
    throw new Error(`MCP server "${options.serverName}" does not use HTTP/SSE OAuth.`);
  }
  if (typeof config.url !== "string" || config.url.trim().length === 0) {
    throw new Error(`MCP server "${options.serverName}" is missing url.`);
  }

  const store = resolveMcpOAuthStore(options);
  const serverKey = buildMcpOAuthServerKey(options.serverName, config);
  const document = await store.read();
  const entry = document.servers[serverKey];
  const issues: string[] = [];
  const revokedTokenTypes: ("refresh_token" | "access_token")[] = [];
  let revocationEndpoint: string | undefined;

  if (entry?.tokens?.access_token !== undefined || entry?.tokens?.refresh_token !== undefined) {
    try {
      const metadata = await fetchMcpAuthServerMetadata({
        serverName: options.serverName,
        serverUrl: entry.discoveryState?.authorizationServerUrl ?? config.url,
        ...(config.oauth?.authServerMetadataUrl === undefined
          ? {}
          : { configuredMetadataUrl: config.oauth.authServerMetadataUrl }),
        fetchFn: createMcpAuthFetch(),
      });
      revocationEndpoint = readAuthorizationServerMetadataString(metadata, "revocation_endpoint");
      if (revocationEndpoint === undefined) {
        issues.push(
          "OAuth server does not advertise revocation_endpoint; local credentials were cleared only.",
        );
      } else {
        const authMethod = chooseMcpRevocationAuthMethod(metadata);
        const clientInformation =
          entry.clientInformation ??
          (config.oauth?.clientId === undefined
            ? undefined
            : {
                client_id: config.oauth.clientId,
                ...(config.oauth.clientSecret === undefined
                  ? {}
                  : { client_secret: config.oauth.clientSecret }),
              });
        if (entry.tokens.refresh_token !== undefined) {
          try {
            await revokeMcpOAuthToken({
              endpoint: revocationEndpoint,
              token: entry.tokens.refresh_token,
              tokenTypeHint: "refresh_token",
              ...(clientInformation === undefined ? {} : { clientInformation }),
              accessToken: entry.tokens.access_token,
              authMethod,
            });
            revokedTokenTypes.push("refresh_token");
          } catch (error) {
            issues.push(
              `Failed to revoke refresh token: ${sanitizeMcpError(toErrorMessage(error))}`,
            );
          }
        }
        if (entry.tokens.access_token !== undefined) {
          try {
            await revokeMcpOAuthToken({
              endpoint: revocationEndpoint,
              token: entry.tokens.access_token,
              tokenTypeHint: "access_token",
              ...(clientInformation === undefined ? {} : { clientInformation }),
              accessToken: entry.tokens.access_token,
              authMethod,
            });
            revokedTokenTypes.push("access_token");
          } catch (error) {
            issues.push(
              `Failed to revoke access token: ${sanitizeMcpError(toErrorMessage(error))}`,
            );
          }
        }
      }
    } catch (error) {
      issues.push(
        `Failed to discover or call token revocation: ${sanitizeMcpError(toErrorMessage(error))}`,
      );
    }
  }

  await updateMcpOAuthStore(store, serverKey, (previous) => {
    if (options.preserveDiscovery === true && previous.discoveryState !== undefined) {
      return {
        serverName: previous.serverName ?? options.serverName,
        ...(previous.serverUrl === undefined ? {} : { serverUrl: previous.serverUrl }),
        discoveryState: previous.discoveryState,
      };
    }
    return null;
  });

  return {
    serverName: options.serverName,
    status: revokedTokenTypes.length > 0 ? "revoked" : "cleared",
    revokedTokenTypes,
    localCredentialsCleared: true,
    ...(revocationEndpoint === undefined ? {} : { revocationEndpoint }),
    issues,
    storage: inspectMcpOAuthStore(store),
  };
}

async function inspectMcpServers(
  options: ConversationRuntimeMcpClientOptions & {
    readonly ensureConnected: (serverName: string) => Promise<ConnectedMcpServer>;
  },
): Promise<ConversationRuntimeMcpInspection> {
  const servers: ConversationRuntimeMcpServerInspection[] = [];
  const notes: string[] = [];
  const issues: string[] = [];
  for (const [serverName, config] of Object.entries(options.servers)) {
    if (config.enabled === false) {
      servers.push(
        createMcpServerInspection(serverName, config, {
          status: "disabled",
          tools: [],
        }),
      );
      continue;
    }
    try {
      const server = await options.ensureConnected(serverName);
      const result = await server.client.listTools(undefined, {
        timeout: resolveToolTimeoutMs(config),
      });
      servers.push(
        createMcpServerInspection(serverName, config, {
          status: "connected",
          tools: result.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            enabled: isMcpToolSelected(tool.name, config),
            readOnly: tool.annotations?.readOnlyHint === true,
            destructive: tool.annotations?.destructiveHint === true,
            openWorld: tool.annotations?.openWorldHint === true,
          })),
        }),
      );
    } catch (error) {
      const message = sanitizeMcpError(toErrorMessage(error));
      const status = isMcpNeedsAuthError(error) ? "needs-auth" : "failed";
      issues.push(`${serverName}: ${message}`);
      servers.push(
        createMcpServerInspection(serverName, config, {
          status,
          tools: [],
          error: message,
        }),
      );
    }
  }

  if (servers.length === 0) {
    notes.push("No MCP servers configured.");
  }

  return {
    inspectedAtMs: options.nowMs?.() ?? Date.now(),
    serverCount: servers.length,
    enabledCount: servers.filter((server) => server.enabled).length,
    connectedCount: servers.filter((server) => server.status === "connected").length,
    failedCount: servers.filter((server) => server.status === "failed").length,
    needsAuthCount: servers.filter((server) => server.status === "needs-auth").length,
    disabledCount: servers.filter((server) => server.status === "disabled").length,
    toolCount: servers.reduce((sum, server) => sum + server.enabledToolCount, 0),
    servers,
    notes,
    issues,
  };
}

function createMcpServerInspection(
  name: string,
  config: ConversationRuntimeMcpServerConfig,
  input: {
    readonly status: ConversationRuntimeMcpServerConnectionStatus;
    readonly tools: readonly ConversationRuntimeMcpServerToolStatus[];
    readonly error?: string;
  },
): ConversationRuntimeMcpServerInspection {
  const selection =
    config.tools === undefined
      ? undefined
      : {
          ...(config.tools.include === undefined ? {} : { include: [...config.tools.include] }),
          ...(config.tools.exclude === undefined ? {} : { exclude: [...config.tools.exclude] }),
        };
  const authMode = resolveMcpAuthMode(config);
  return {
    name,
    status: input.status,
    enabled: config.enabled !== false,
    transport: config.type ?? (config.url ? "http" : "stdio"),
    toolCount: input.tools.length,
    enabledToolCount: input.tools.filter((tool) => tool.enabled).length,
    tools: input.tools,
    ...(selection === undefined ? {} : { selection }),
    auth: {
      mode: authMode,
      needsAuth: input.status === "needs-auth",
      configured:
        authMode === "oauth" ||
        Object.keys(config.headers ?? {}).some((key) => key.toLowerCase() === "authorization"),
    },
    ...(input.error === undefined ? {} : { error: input.error }),
    config: redactMcpServerConfig(config),
  };
}

function mapMcpToolSource(
  serverName: string,
  config: ConversationRuntimeMcpServerConfig,
  tool: Tool,
): ConversationRuntimeMcpToolSource {
  return {
    serverName,
    toolName: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: normalizeMcpInputSchema(tool.inputSchema),
    readOnly: tool.annotations?.readOnlyHint === true,
    destructive: tool.annotations?.destructiveHint === true,
    openWorld: tool.annotations?.openWorldHint === true,
    metadata: {
      transport: config.type ?? (config.url ? "http" : "stdio"),
    },
  };
}

async function handleMcpListChanged({
  server,
  serverName,
  type,
  error,
  items,
  options,
}: {
  readonly server: ConnectedMcpServer | undefined;
  readonly serverName: string;
  readonly type: "tools" | "prompts" | "resources";
  readonly error: Error | null;
  readonly items: readonly Tool[] | readonly Prompt[] | readonly Resource[] | null;
  readonly options: ConversationRuntimeMcpClientOptions;
}): Promise<void> {
  const previousItemCount =
    type === "tools"
      ? server?.toolCount
      : type === "prompts"
        ? server?.promptCount
        : server?.resourceCount;
  if (error !== null) {
    await options.onServerListChanged?.({
      serverName,
      type,
      status: "failed",
      ...(previousItemCount === undefined ? {} : { previousItemCount }),
      error: sanitizeMcpError(error.message),
      atMs: options.nowMs?.() ?? Date.now(),
    });
    return;
  }
  const itemCount = items?.length ?? 0;
  if (server !== undefined) {
    if (type === "tools") {
      server.toolCount = itemCount;
    } else if (type === "prompts") {
      server.promptCount = itemCount;
    } else {
      server.resourceCount = itemCount;
    }
  }
  await options.onServerListChanged?.({
    serverName,
    type,
    status: "changed",
    itemCount,
    ...(previousItemCount === undefined ? {} : { previousItemCount }),
    atMs: options.nowMs?.() ?? Date.now(),
  });
}

async function connectMcpServer(
  serverName: string,
  config: ConversationRuntimeMcpServerConfig,
  options: ConversationRuntimeMcpClientOptions,
  oauthStore: ConversationRuntimeMcpOAuthStore,
): Promise<ConnectedMcpServer> {
  const transport = await createMcpTransport(serverName, config, options, oauthStore);
  // biome-ignore lint/style/useConst: listChanged callbacks may fire before the server object is assigned.
  let connectedServer: ConnectedMcpServer | undefined;
  const client = new Client(
    {
      name: options.clientName ?? DEFAULT_MCP_CLIENT_NAME,
      version: options.clientVersion ?? DEFAULT_MCP_CLIENT_VERSION,
    },
    {
      capabilities: {},
      listChanged: {
        tools: {
          debounceMs: 300,
          onChanged: async (error, tools) => {
            await handleMcpListChanged({
              server: connectedServer,
              serverName,
              type: "tools",
              error,
              items: tools,
              options,
            });
          },
        },
        prompts: {
          debounceMs: 300,
          onChanged: async (error, prompts) => {
            await handleMcpListChanged({
              server: connectedServer,
              serverName,
              type: "prompts",
              error,
              items: prompts,
              options,
            });
          },
        },
        resources: {
          debounceMs: 300,
          onChanged: async (error, resources) => {
            await handleMcpListChanged({
              server: connectedServer,
              serverName,
              type: "resources",
              error,
              items: resources,
              options,
            });
          },
        },
      },
    },
  );
  await client.connect(transport, { timeout: resolveToolTimeoutMs(config) });
  connectedServer = {
    name: serverName,
    config,
    client,
    transport,
  };
  return connectedServer;
}

async function createMcpTransport(
  serverName: string,
  config: ConversationRuntimeMcpServerConfig,
  options: ConversationRuntimeMcpClientOptions,
  oauthStore: ConversationRuntimeMcpOAuthStore,
): Promise<Transport> {
  if (config.type === "sse") {
    if (typeof config.url !== "string" || config.url.trim().length === 0) {
      throw new Error(`MCP server "${serverName}" is missing url.`);
    }
    return new SSEClientTransport(new URL(config.url), {
      ...(resolveMcpAuthMode(config) === "oauth"
        ? {
            authProvider: createMcpOAuthProvider({
              serverName,
              serverConfig: config,
              redirectUri: defaultMcpOAuthRedirectUri(config),
              clientName: options.clientName ?? DEFAULT_MCP_CLIENT_NAME,
              clientVersion: options.clientVersion ?? DEFAULT_MCP_CLIENT_VERSION,
              store: oauthStore,
              lockDir: resolveMcpRefreshLockDir(options),
              ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
            }),
          }
        : {}),
      requestInit: {
        ...(config.headers === undefined ? {} : { headers: config.headers }),
      },
    });
  }
  if (config.type === "http" || (config.type === undefined && config.url !== undefined)) {
    if (typeof config.url !== "string" || config.url.trim().length === 0) {
      throw new Error(`MCP server "${serverName}" is missing url.`);
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      ...(resolveMcpAuthMode(config) === "oauth"
        ? {
            authProvider: createMcpOAuthProvider({
              serverName,
              serverConfig: config,
              redirectUri: defaultMcpOAuthRedirectUri(config),
              clientName: options.clientName ?? DEFAULT_MCP_CLIENT_NAME,
              clientVersion: options.clientVersion ?? DEFAULT_MCP_CLIENT_VERSION,
              store: oauthStore,
              lockDir: resolveMcpRefreshLockDir(options),
              ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
            }),
          }
        : {}),
      requestInit: {
        ...(config.headers === undefined ? {} : { headers: config.headers }),
      },
    }) as unknown as Transport;
  }
  if (typeof config.command !== "string" || config.command.trim().length === 0) {
    throw new Error(`MCP server "${serverName}" is missing command.`);
  }
  const stderrLogPath =
    options.stderrLogPath ??
    join(options.cwd ?? process.cwd(), ".director-angel", "runtime", "logs", "mcp-stderr.log");
  await mkdir(dirname(stderrLogPath), { recursive: true });
  const stderrLog = createWriteStream(stderrLogPath, { flags: "a" });
  stderrLog.write(
    `\n===== [${new Date(options.nowMs?.() ?? Date.now()).toISOString()}] starting MCP server '${serverName}' =====\n`,
  );
  const request = await createSandboxedMcpStdioTransportRequest({
    serverName,
    command: config.command,
    args: [...(config.args ?? [])],
    env: buildSafeMcpEnv(config.env),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stderr: "pipe",
    spawnCommand: spawnMcpStdioProcess,
    options,
  });
  const transport = createMcpStdioTransport(request, options);
  transport.stderr?.pipe(stderrLog, { end: false });
  return transport;
}

async function createSandboxedMcpStdioTransportRequest({
  serverName,
  command,
  args,
  env,
  cwd,
  stderr,
  spawnCommand,
  options,
}: Omit<ConversationRuntimeMcpStdioTransportRequest, "sandbox"> & {
  readonly options: ConversationRuntimeMcpClientOptions;
}): Promise<ConversationRuntimeMcpStdioTransportRequest> {
  const registry = createAgentOsSandboxBackendRegistry({
    enabledBackends: ["host"],
    adapters: [
      createAgentOsHostSandboxBackendAdapter({
        allowHostExecution: true,
        allowedCommandPatterns: [
          {
            executable: command,
            argv: args,
            operationId: `mcp:${serverName}`,
          },
        ],
        networkPolicy: "none",
      }),
    ],
  });
  const plan = planAgentOsSandboxExecution({
    toolName: "mcp-stdio-server",
    operationId: `mcp:${serverName}`,
    providerId: `mcp:${serverName}`,
    ...(cwd === undefined ? {} : { cwd }),
    command: [command, ...args].join(" "),
    argv: args,
    env,
    requestedNetworkPolicy: "none",
    preflight: {
      verdict: "allow",
      sandboxMode: "host",
      checkedAt: new Date(options.nowMs?.() ?? Date.now()).toISOString(),
      providerId: `mcp:${serverName}`,
      reason: "MCP stdio server startup is routed through Agent OS host sandbox backend.",
    },
    policy: {
      enabledBackends: ["host"],
      readableRoots: cwd === undefined ? [] : [cwd],
      writableRoots: cwd === undefined ? [] : [cwd],
      networkPolicy: "none",
    },
  });
  const now = () => new Date(options.nowMs?.() ?? Date.now()).toISOString();
  const admission = await admitAgentOsSandboxExecution(plan, { registry, now });
  if (!admission.ok) {
    throw new Error(
      `MCP stdio server "${serverName}" sandbox startup blocked: ${
        admission.reason ?? admission.error ?? "unknown sandbox failure"
      }`,
    );
  }
  const evidence = createAgentOsSandboxCommandAdmissionEvidence(plan, admission);
  return {
    serverName,
    command,
    args,
    env,
    ...(cwd === undefined ? {} : { cwd }),
    stderr,
    spawnCommand,
    sandbox: {
      ok: true,
      status: admission.status,
      ...(admission.backend === undefined ? {} : { backend: admission.backend }),
      ...(admission.providerId === undefined ? {} : { providerId: admission.providerId }),
      ...(evidence === undefined ? {} : { evidence }),
    },
  };
}

function createMcpStdioTransport(
  request: ConversationRuntimeMcpStdioTransportRequest,
  options: ConversationRuntimeMcpClientOptions,
): Transport & { readonly stderr?: Stream | null } {
  const factory = options.mcpStdioTransportFactory;
  if (factory !== undefined) {
    return factory(request);
  }
  return new AgentOsSandboxMcpStdioTransport(request, options);
}

class AgentOsSandboxMcpStdioTransport implements Transport {
  private process: ConversationRuntimeMcpStdioProcess | undefined;
  private readonly readBuffer = new ReadBuffer();
  private readonly stderrStream = new PassThrough();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly request: ConversationRuntimeMcpStdioTransportRequest,
    private readonly options: ConversationRuntimeMcpClientOptions,
  ) {}

  async start(): Promise<void> {
    if (this.process !== undefined) {
      throw new Error(
        "AgentOsSandboxMcpStdioTransport already started. Client.connect() starts transports automatically.",
      );
    }
    await new Promise<void>((resolve, reject) => {
      const child = this.request.spawnCommand({
        command: this.request.command,
        args: this.request.args,
        env: this.request.env,
        ...(this.request.cwd === undefined ? {} : { cwd: this.request.cwd }),
        sandbox: this.request.sandbox,
      });
      this.process = child;
      child.on("error", (error) => {
        reject(error);
        this.onerror?.(error);
      });
      child.on("spawn", () => {
        resolve();
      });
      child.on("close", () => {
        this.process = undefined;
        this.onclose?.();
      });
      child.stdin?.on?.("error", (error) => {
        this.onerror?.(error);
      });
      child.stdout?.on("data", (chunk) => {
        this.readBuffer.append(chunk);
        this.processReadBuffer();
      });
      child.stdout?.on("error", (error) => {
        this.onerror?.(error);
      });
      child.stderr?.pipe(this.stderrStream, { end: false });
    });
  }

  get stderr(): Stream | null {
    return this.stderrStream;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  async close(): Promise<void> {
    if (this.process !== undefined) {
      const processToClose = this.process;
      this.process = undefined;
      const signalEvidence: AgentOsProcessCapabilitySignalEvidence[] = [];
      const closePromise = new Promise<void>((resolve) => {
        processToClose.once("close", () => {
          resolve();
        });
      });
      try {
        processToClose.stdin?.end();
      } catch {
        // ignore shutdown errors
      }
      await Promise.race([closePromise, createMcpCloseDelay(this.options.mcpStdioCloseDelayMs)]);
      if (processToClose.exitCode === null) {
        this.sendCloseSignal(processToClose, "SIGTERM", signalEvidence);
        await Promise.race([closePromise, createMcpCloseDelay(this.options.mcpStdioCloseDelayMs)]);
      }
      if (processToClose.exitCode === null) {
        this.sendCloseSignal(processToClose, "SIGKILL", signalEvidence);
      }
      await this.emitProcessEvidence(processToClose, signalEvidence);
    }
    this.readBuffer.clear();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.process?.stdin;
    if (stdin === undefined || stdin === null) {
      throw new Error("Not connected");
    }
    const json = serializeMessage(message);
    if (stdin.write(json)) {
      return;
    }
    await new Promise<void>((resolve) => {
      stdin.once("drain", resolve);
    });
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private sendCloseSignal(
    processToClose: ConversationRuntimeMcpStdioProcess,
    signal: NodeJS.Signals,
    signalEvidence: AgentOsProcessCapabilitySignalEvidence[],
  ): void {
    signalEvidence.push({ signal, reason: "mcp-stdio-close" });
    try {
      processToClose.kill(signal);
    } catch {
      // ignore shutdown errors
    }
  }

  private async emitProcessEvidence(
    processToClose: ConversationRuntimeMcpStdioProcess,
    signalEvidence: AgentOsProcessCapabilitySignalEvidence[],
  ): Promise<void> {
    const callback = this.options.onMcpStdioProcessEvidence;
    if (callback === undefined) {
      return;
    }
    const processEvidence: AgentOsProcessCapabilityProcessEvidence = {
      ...(processToClose.pid === undefined ? {} : { pid: processToClose.pid }),
      signal: signalEvidence.at(-1)?.signal ?? null,
      ownedProcess: true,
      terminationReason: "mcp-stdio-close",
      ...(signalEvidence.length === 0 ? {} : { signals: [...signalEvidence] }),
    };
    try {
      await callback({
        serverName: this.request.serverName,
        process: processEvidence,
        ...(this.request.sandbox === undefined
          ? {}
          : {
              sandbox:
                this.request.sandbox.evidence === undefined
                  ? this.request.sandbox
                  : {
                      ...this.request.sandbox,
                      evidence: {
                        ...this.request.sandbox.evidence,
                        process: processEvidence,
                      },
                    },
            }),
      });
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function spawnMcpStdioProcess(
  request: ConversationRuntimeMcpStdioSpawnRequest,
): ConversationRuntimeMcpStdioProcess {
  try {
    assertAgentOsSandboxLongLivedProcessSpawnAdmitted({
      executable: request.command,
      argv: request.args,
      ...(request.sandbox === undefined ? {} : { sandbox: request.sandbox }),
    });
  } catch (error) {
    throw new Error(
      `MCP stdio process spawn requires admitted Agent OS sandbox evidence: ${toErrorMessage(
        error,
      )}`,
    );
  }
  return spawn(request.command, [...request.args], {
    env: {
      ...request.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
  });
}

function createMcpCloseDelay(delayMs = 2_000): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, delayMs)).unref();
  });
}

function createMcpOAuthProvider({
  serverName,
  serverConfig,
  redirectUri,
  clientName,
  clientVersion,
  store,
  lockDir,
  nowMs,
  onAuthorizationUrl,
}: {
  readonly serverName: string;
  readonly serverConfig: ConversationRuntimeMcpServerConfig;
  readonly redirectUri: string;
  readonly clientName: string;
  readonly clientVersion: string;
  readonly store: ConversationRuntimeMcpOAuthStore;
  readonly lockDir: string;
  readonly nowMs?: () => number;
  readonly onAuthorizationUrl?: (url: string) => Promise<void> | void;
}): OAuthClientProvider {
  const serverKey = buildMcpOAuthServerKey(serverName, serverConfig);
  let codeVerifier: string | undefined;
  let state: string | undefined;
  return {
    get redirectUrl() {
      return redirectUri;
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: `${clientName} (${serverName})`,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        software_id: "director-angel",
        software_version: clientVersion,
      };
    },
    state: () => {
      state ??= randomBytes(32).toString("base64url");
      return state;
    },
    clientInformation: async () => {
      const entry = (await store.read()).servers[serverKey];
      if (entry?.clientInformation !== undefined) {
        return entry.clientInformation;
      }
      if (serverConfig.oauth?.clientId !== undefined) {
        return {
          client_id: serverConfig.oauth.clientId,
          ...(serverConfig.oauth.clientSecret === undefined
            ? {}
            : { client_secret: serverConfig.oauth.clientSecret }),
        };
      }
      return undefined;
    },
    saveClientInformation: async (clientInformation) => {
      await updateMcpOAuthStore(store, serverKey, {
        serverName,
        clientInformation,
        ...(serverConfig.url === undefined ? {} : { serverUrl: serverConfig.url }),
      });
    },
    tokens: async () => {
      const entry = (await store.read()).servers[serverKey];
      if (entry?.tokens === undefined) {
        return undefined;
      }
      const expiresInRaw =
        entry.expiresAtMs === undefined
          ? entry.tokens.expires_in
          : Math.floor((entry.expiresAtMs - (nowMs?.() ?? Date.now())) / 1000);
      if (
        typeof expiresInRaw === "number" &&
        expiresInRaw <= 300 &&
        entry.tokens.refresh_token !== undefined
      ) {
        try {
          return await refreshMcpTokensWithLock({
            serverName,
            serverConfig,
            serverKey,
            store,
            lockDir,
            refreshToken: entry.tokens.refresh_token,
            ...(nowMs === undefined ? {} : { nowMs }),
          });
        } catch {
          // The SDK's auth path can still attempt its own refresh if this proactive path fails.
        }
      }
      const expiresIn =
        entry.expiresAtMs === undefined
          ? entry.tokens.expires_in
          : Math.max(0, Math.floor((entry.expiresAtMs - (nowMs?.() ?? Date.now())) / 1000));
      return {
        ...entry.tokens,
        ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
      };
    },
    saveTokens: async (tokens) => {
      await updateMcpOAuthStore(store, serverKey, {
        serverName,
        tokens,
        ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
        ...(serverConfig.url === undefined ? {} : { serverUrl: serverConfig.url }),
        ...(typeof tokens.expires_in === "number"
          ? { expiresAtMs: (nowMs?.() ?? Date.now()) + tokens.expires_in * 1000 }
          : {}),
      });
    },
    redirectToAuthorization: async (authorizationUrl) => {
      const url = authorizationUrl.toString();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error("Invalid MCP OAuth authorization URL.");
      }
      await onAuthorizationUrl?.(url);
    },
    saveCodeVerifier: (nextCodeVerifier) => {
      codeVerifier = nextCodeVerifier;
    },
    codeVerifier: () => {
      if (codeVerifier === undefined) {
        throw new Error("No MCP OAuth code verifier saved.");
      }
      return codeVerifier;
    },
    saveDiscoveryState: async (discoveryState) => {
      await updateMcpOAuthStore(store, serverKey, {
        serverName,
        ...(serverConfig.url === undefined ? {} : { serverUrl: serverConfig.url }),
        discoveryState: {
          authorizationServerUrl: discoveryState.authorizationServerUrl,
          ...(discoveryState.resourceMetadataUrl === undefined
            ? {}
            : { resourceMetadataUrl: discoveryState.resourceMetadataUrl }),
          ...(discoveryState.authorizationServerMetadata === undefined
            ? {}
            : { authorizationServerMetadata: discoveryState.authorizationServerMetadata }),
          ...(discoveryState.resourceMetadata === undefined
            ? {}
            : { resourceMetadata: discoveryState.resourceMetadata }),
        },
      });
    },
    discoveryState: async () => {
      const stored = (await store.read()).servers[serverKey]?.discoveryState;
      if (stored?.authorizationServerUrl !== undefined) {
        return stored;
      }
      if (serverConfig.oauth?.authServerMetadataUrl === undefined) {
        return undefined;
      }
      const metadata = await fetchMcpAuthServerMetadata({
        serverName,
        ...(serverConfig.url === undefined ? {} : { serverUrl: serverConfig.url }),
        configuredMetadataUrl: serverConfig.oauth.authServerMetadataUrl,
        fetchFn: createMcpAuthFetch(),
      });
      if (metadata === undefined) {
        return undefined;
      }
      const discovered = {
        authorizationServerUrl: metadata.issuer,
        authorizationServerMetadata: metadata,
      };
      await updateMcpOAuthStore(store, serverKey, {
        serverName,
        ...(serverConfig.url === undefined ? {} : { serverUrl: serverConfig.url }),
        discoveryState: {
          authorizationServerUrl: discovered.authorizationServerUrl,
          authorizationServerMetadata: discovered.authorizationServerMetadata,
        },
      });
      return discovered;
    },
    invalidateCredentials: async (scope) => {
      if (scope === "verifier") {
        codeVerifier = undefined;
        return;
      }
      await updateMcpOAuthStore(store, serverKey, (entry) => {
        if (scope === "all") {
          return null;
        }
        if (scope === "client") {
          const { clientInformation: _clientInformation, ...next } = entry;
          return next;
        }
        if (scope === "tokens") {
          const { tokens: _tokens, expiresAtMs: _expiresAtMs, ...next } = entry;
          return next;
        }
        if (scope === "discovery") {
          const { discoveryState: _discoveryState, ...next } = entry;
          return next;
        }
        return entry;
      });
    },
  };
}

function defaultMcpOAuthRedirectUri(config: ConversationRuntimeMcpServerConfig): string {
  return `http://127.0.0.1:${config.oauth?.callbackPort ?? 33418}/callback`;
}

function resolveMcpOAuthStorePath(
  options: Pick<ConversationRuntimeMcpClientOptions, "cwd" | "oauthStorePath">,
): string {
  return (
    options.oauthStorePath ??
    join(options.cwd ?? process.cwd(), ".director-angel", "mcp", "oauth-tokens.json")
  );
}

function resolveMcpRefreshLockDir(
  options: Pick<ConversationRuntimeMcpClientOptions, "cwd" | "refreshLockDir">,
): string {
  return (
    options.refreshLockDir ?? join(options.cwd ?? process.cwd(), ".director-angel", "mcp", "locks")
  );
}

function buildMcpOAuthServerKey(
  serverName: string,
  config: ConversationRuntimeMcpServerConfig,
): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        type: config.type ?? (config.url ? "http" : "stdio"),
        url: config.url,
        headers: config.headers ?? {},
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `${serverName}|${hash}`;
}

async function readMcpOAuthStoreDocument(
  storePath: string,
): Promise<ConversationRuntimeMcpOAuthStoreDocument> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as unknown;
    if (isRecord(parsed) && isRecord(parsed.servers)) {
      return {
        schemaVersion: "director.mcp.oauth.v1",
        servers: Object.fromEntries(
          Object.entries(parsed.servers).filter(
            (entry): entry is [string, ConversationRuntimeMcpOAuthStoreEntry] =>
              typeof entry[0] === "string" && isRecord(entry[1]),
          ),
        ),
      };
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  return {
    schemaVersion: "director.mcp.oauth.v1",
    servers: {},
  };
}

async function updateMcpOAuthStore(
  store: ConversationRuntimeMcpOAuthStore,
  serverKey: string,
  patch:
    | Partial<ConversationRuntimeMcpOAuthStoreEntry>
    | ((
        entry: ConversationRuntimeMcpOAuthStoreEntry,
      ) => ConversationRuntimeMcpOAuthStoreEntry | null),
): Promise<void> {
  const document = await store.read();
  const previous = document.servers[serverKey] ?? {};
  const nextEntry = typeof patch === "function" ? patch(previous) : { ...previous, ...patch };
  const servers = { ...document.servers };
  if (nextEntry === null) {
    delete servers[serverKey];
  } else {
    servers[serverKey] = removeUndefinedMcpOAuthFields(nextEntry);
  }
  await store.write({
    schemaVersion: "director.mcp.oauth.v1",
    servers,
  });
}

async function writeMcpOAuthStoreDocument(
  storePath: string,
  store: ConversationRuntimeMcpOAuthStoreDocument,
): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(tempPath, 0o600).catch(() => {});
  await rename(tempPath, storePath);
}

function removeUndefinedMcpOAuthFields(
  entry: ConversationRuntimeMcpOAuthStoreEntry,
): ConversationRuntimeMcpOAuthStoreEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as ConversationRuntimeMcpOAuthStoreEntry;
}

function removeUndefinedFields<T extends object>(entry: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function resolveMcpOAuthStore(
  options: Pick<
    ConversationRuntimeMcpClientOptions,
    "cwd" | "oauthStorePath" | "oauthStorageMode" | "oauthStore"
  >,
): ConversationRuntimeMcpOAuthStore {
  if (options.oauthStore !== undefined) {
    return options.oauthStore;
  }
  const fileStore = createFileMcpOAuthStore(resolveMcpOAuthStorePath(options));
  const mode = options.oauthStorageMode ?? "file";
  if (mode === "file") {
    return fileStore;
  }
  const keychainStore =
    process.platform === "darwin" ? createMacOsKeychainMcpOAuthStore() : undefined;
  if (mode === "keychain") {
    if (keychainStore === undefined) {
      throw new Error("MCP OAuth keychain storage is only available on macOS.");
    }
    return keychainStore;
  }
  return keychainStore === undefined
    ? fileStore
    : createFallbackMcpOAuthStore(keychainStore, fileStore);
}

function createFileMcpOAuthStore(storePath: string): ConversationRuntimeMcpOAuthStore {
  return {
    kind: "file",
    path: storePath,
    read: () => readMcpOAuthStoreDocument(storePath),
    write: (store) => writeMcpOAuthStoreDocument(storePath, store),
    delete: async () => {
      await unlink(storePath).catch((error) => {
        if (!isNodeErrorCode(error, "ENOENT")) {
          throw error;
        }
      });
    },
  };
}

function createFallbackMcpOAuthStore(
  primary: ConversationRuntimeMcpOAuthStore,
  fallback: ConversationRuntimeMcpOAuthStore,
): ConversationRuntimeMcpOAuthStore {
  return {
    kind: "fallback",
    ...(fallback.path === undefined ? {} : { path: fallback.path }),
    read: async () => {
      try {
        const primaryDocument = await primary.read();
        if (Object.keys(primaryDocument.servers).length > 0) {
          return primaryDocument;
        }
      } catch {
        // Fall through to file storage. This mirrors Claude Code's keychain + plaintext fallback.
      }
      return fallback.read();
    },
    write: async (store) => {
      let primaryHadData = false;
      try {
        primaryHadData = Object.keys((await primary.read()).servers).length > 0;
      } catch {
        primaryHadData = false;
      }
      try {
        await primary.write(store);
        await fallback.delete?.();
        return;
      } catch {
        await fallback.write(store);
        if (primaryHadData) {
          await primary.delete?.().catch(() => {});
        }
      }
    },
    delete: async () => {
      await Promise.allSettled([
        primary.delete?.() ?? Promise.resolve(),
        fallback.delete?.() ?? Promise.resolve(),
      ]);
    },
  };
}

function createMacOsKeychainMcpOAuthStore(): ConversationRuntimeMcpOAuthStore {
  return {
    kind: "keychain",
    read: async () => {
      if (process.platform !== "darwin") {
        return emptyMcpOAuthStoreDocument();
      }
      try {
        const { stdout } = await runMcpKeychainSecurityCommand({
          operationId: "find-generic-password",
          args: [
            "find-generic-password",
            "-a",
            MCP_KEYCHAIN_ACCOUNT,
            "-s",
            MCP_KEYCHAIN_SERVICE,
            "-w",
          ],
        });
        if (typeof stdout === "string" && stdout.trim().length > 0) {
          return normalizeMcpOAuthStoreDocument(JSON.parse(stdout.trim()) as unknown);
        }
      } catch {
        return emptyMcpOAuthStoreDocument();
      }
      return emptyMcpOAuthStoreDocument();
    },
    write: async (store) => {
      if (process.platform !== "darwin") {
        throw new Error("MCP OAuth keychain storage is only available on macOS.");
      }
      const payload = `${JSON.stringify(store, null, 2)}\n`;
      const hexPayload = Buffer.from(payload, "utf8").toString("hex");
      const interactiveCommand =
        `add-generic-password -U -a "${escapeMacOsKeychainInteractiveArg(MCP_KEYCHAIN_ACCOUNT)}" ` +
        `-s "${escapeMacOsKeychainInteractiveArg(MCP_KEYCHAIN_SERVICE)}" -X "${hexPayload}"\n`;
      if (interactiveCommand.length <= SECURITY_STDIN_LINE_LIMIT) {
        await runMcpKeychainSecurityCommand({
          operationId: "add-generic-password.interactive",
          args: ["-i"],
          input: interactiveCommand,
        });
        return;
      }
      await runMcpKeychainSecurityCommand({
        operationId: "add-generic-password",
        args: [
          "add-generic-password",
          "-U",
          "-a",
          MCP_KEYCHAIN_ACCOUNT,
          "-s",
          MCP_KEYCHAIN_SERVICE,
          "-X",
          hexPayload,
        ],
      });
    },
    delete: async () => {
      if (process.platform !== "darwin") {
        return;
      }
      await runMcpKeychainSecurityCommand({
        operationId: "delete-generic-password",
        args: ["delete-generic-password", "-a", MCP_KEYCHAIN_ACCOUNT, "-s", MCP_KEYCHAIN_SERVICE],
      }).catch((error) => {
        const message = toErrorMessage(error);
        if (!/\bcould not be found\b|\bnot found\b|exit code:?\s*44\b/iu.test(message)) {
          throw error;
        }
      });
    },
  };
}

async function runMcpKeychainSecurityCommand(input: {
  readonly operationId: string;
  readonly args: readonly string[];
  readonly input?: string;
}): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const command = ["security", ...input.args].join(" ");
  const registry = createAgentOsSandboxBackendRegistry({
    enabledBackends: ["host"],
    adapters: [
      createAgentOsHostSandboxBackendAdapter({
        allowHostExecution: true,
        allowedCommandPatterns: [
          {
            executable: "security",
            argv: input.args,
            operationId: input.operationId,
          },
        ],
        networkPolicy: "none",
        commandRunner: async (request) => {
          if (input.input !== undefined) {
            await mcpSpawnWithInput(request.executable, request.argv, input.input);
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          try {
            const result = await mcpExecFileAsync(request.executable, request.argv, {
              timeout: DEFAULT_AUTH_REQUEST_TIMEOUT_MS,
              maxBuffer: 128 * 1024,
              windowsHide: true,
            });
            return {
              exitCode: 0,
              stdout: String(result.stdout ?? ""),
              stderr: String(result.stderr ?? ""),
            };
          } catch (error) {
            return {
              exitCode: readProcessExitCode(error),
              stdout: readProcessOutput(error, "stdout"),
              stderr: readProcessOutput(error, "stderr") || toErrorMessage(error),
            };
          }
        },
      }),
    ],
  });
  const now = () => new Date().toISOString();
  const plan = planAgentOsSandboxExecution({
    toolName: "mcp-oauth-keychain",
    operationId: input.operationId,
    providerId: "mcp-oauth-keychain",
    command,
    argv: input.args,
    requestedNetworkPolicy: "none",
    preflight: {
      verdict: "allow",
      sandboxMode: "host",
      checkedAt: now(),
      providerId: "mcp-oauth-keychain",
      reason: "MCP OAuth Keychain security helper is routed through Agent OS host sandbox backend.",
    },
    policy: {
      enabledBackends: ["host"],
      networkPolicy: "none",
    },
  });
  const admission = await admitAgentOsSandboxExecution(plan, { registry, now });
  const execution = await executeAgentOsSandboxCommand(plan, admission, { registry, now });
  latestMcpKeychainSandboxExecution = {
    ok: execution.ok,
    status: execution.status,
    ...(execution.backend === undefined ? {} : { backend: execution.backend }),
    ...(execution.providerId === undefined ? {} : { providerId: execution.providerId }),
    ...(execution.evidence === undefined ? {} : { evidence: execution.evidence }),
  };
  if (!execution.ok || execution.exitCode !== 0) {
    throw new Error(
      `security ${input.operationId} failed: ${
        execution.stderr?.trim() || execution.reason || execution.error || "unknown sandbox failure"
      }`,
    );
  }
  return {
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? "",
  };
}

function escapeMacOsKeychainInteractiveArg(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

export function setConversationRuntimeMcpExecFileForTesting(
  execFileImpl: ExecFileAsync | null,
): void {
  mcpExecFileAsync = execFileImpl ?? execFileAsync;
}

export function setConversationRuntimeMcpSpawnWithInputForTesting(
  spawnImpl: SpawnWithInput | null,
): void {
  mcpSpawnWithInput = spawnImpl ?? spawnWithInput;
}

function spawnWithInput(file: string, args: readonly string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${file} ${args.join(" ")} failed with exit code ${String(code)}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
    child.stdin.end(input);
  });
}

function readProcessExitCode(error: unknown): number {
  if (!isRecord(error)) {
    return 1;
  }
  return typeof error.code === "number" && Number.isFinite(error.code)
    ? error.code
    : typeof error.status === "number" && Number.isFinite(error.status)
      ? error.status
      : 1;
}

function readProcessOutput(error: unknown, key: "stderr" | "stdout"): string {
  if (!isRecord(error)) {
    return "";
  }
  const value = error[key];
  return typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function inspectMcpOAuthStore(
  store: ConversationRuntimeMcpOAuthStore,
): ConversationRuntimeMcpOAuthStoreInspection {
  if (store.kind === "fallback") {
    return {
      kind: "fallback",
      ...(store.path === undefined ? {} : { path: store.path }),
      primaryKind: process.platform === "darwin" ? "keychain" : "unavailable",
      fallbackKind: "file",
      ...(latestMcpKeychainSandboxExecution === undefined
        ? {}
        : { keychainSandbox: latestMcpKeychainSandboxExecution }),
    };
  }
  return {
    kind: store.kind === "keychain" ? "keychain" : "file",
    ...(store.path === undefined ? {} : { path: store.path }),
    ...(store.kind === "keychain" && latestMcpKeychainSandboxExecution !== undefined
      ? { keychainSandbox: latestMcpKeychainSandboxExecution }
      : {}),
  };
}

function normalizeMcpOAuthStoreDocument(value: unknown): ConversationRuntimeMcpOAuthStoreDocument {
  if (isRecord(value) && isRecord(value.servers)) {
    return {
      schemaVersion: "director.mcp.oauth.v1",
      servers: Object.fromEntries(
        Object.entries(value.servers).filter(
          (entry): entry is [string, ConversationRuntimeMcpOAuthStoreEntry] =>
            typeof entry[0] === "string" && isRecord(entry[1]),
        ),
      ),
    };
  }
  return emptyMcpOAuthStoreDocument();
}

function emptyMcpOAuthStoreDocument(): ConversationRuntimeMcpOAuthStoreDocument {
  return {
    schemaVersion: "director.mcp.oauth.v1",
    servers: {},
  };
}

async function refreshMcpTokensWithLock({
  serverName,
  serverConfig,
  serverKey,
  store,
  lockDir,
  refreshToken,
  nowMs,
}: {
  readonly serverName: string;
  readonly serverConfig: ConversationRuntimeMcpServerConfig;
  readonly serverKey: string;
  readonly store: ConversationRuntimeMcpOAuthStore;
  readonly lockDir: string;
  readonly refreshToken: string;
  readonly nowMs?: () => number;
}): Promise<OAuthTokens | undefined> {
  const release = await acquireMcpRefreshLock({
    lockDir,
    serverKey,
    ...(nowMs === undefined ? {} : { nowMs }),
  });
  try {
    const current = (await store.read()).servers[serverKey];
    if (current?.tokens !== undefined) {
      const expiresIn =
        current.expiresAtMs === undefined
          ? current.tokens.expires_in
          : Math.floor((current.expiresAtMs - (nowMs?.() ?? Date.now())) / 1000);
      if (typeof expiresIn === "number" && expiresIn > 300) {
        return {
          ...current.tokens,
          expires_in: expiresIn,
        };
      }
    }
    const freshestRefreshToken = current?.tokens?.refresh_token ?? refreshToken;
    const metadata = await fetchMcpAuthServerMetadata({
      serverName,
      ...((current?.discoveryState?.authorizationServerUrl ?? serverConfig.url) === undefined
        ? {}
        : { serverUrl: current?.discoveryState?.authorizationServerUrl ?? serverConfig.url }),
      ...(serverConfig.oauth?.authServerMetadataUrl === undefined
        ? {}
        : { configuredMetadataUrl: serverConfig.oauth.authServerMetadataUrl }),
      fetchFn: createMcpAuthFetch(),
    });
    const authorizationServerUrl =
      current?.discoveryState?.authorizationServerUrl ??
      readAuthorizationServerMetadataString(metadata, "issuer") ??
      serverConfig.url;
    if (authorizationServerUrl === undefined) {
      return undefined;
    }
    const clientInformation =
      current?.clientInformation ??
      (serverConfig.oauth?.clientId === undefined
        ? undefined
        : {
            client_id: serverConfig.oauth.clientId,
            ...(serverConfig.oauth.clientSecret === undefined
              ? {}
              : { client_secret: serverConfig.oauth.clientSecret }),
          });
    if (clientInformation === undefined) {
      return undefined;
    }
    const refreshed = await refreshMcpAuthorization(authorizationServerUrl, {
      ...(metadata === undefined ? {} : { metadata }),
      clientInformation,
      refreshToken: freshestRefreshToken,
      fetchFn: createMcpAuthFetch(),
    });
    await updateMcpOAuthStore(store, serverKey, {
      serverName,
      tokens: refreshed,
      ...(refreshed.scope === undefined ? {} : { scope: refreshed.scope }),
      ...(serverConfig.url === undefined ? {} : { serverUrl: serverConfig.url }),
      ...(typeof refreshed.expires_in === "number"
        ? { expiresAtMs: (nowMs?.() ?? Date.now()) + refreshed.expires_in * 1000 }
        : {}),
    });
    return refreshed;
  } finally {
    await release?.();
  }
}

async function acquireMcpRefreshLock({
  lockDir,
  serverKey,
  nowMs,
}: {
  readonly lockDir: string;
  readonly serverKey: string;
  readonly nowMs?: () => number;
}): Promise<(() => Promise<void>) | undefined> {
  await mkdir(lockDir, { recursive: true });
  const lockPath = join(lockDir, `mcp-refresh-${serverKey.replace(/[^a-zA-Z0-9]/g, "_")}.lock`);
  for (let attempt = 0; attempt < DEFAULT_REFRESH_LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAtMs: nowMs?.() ?? Date.now(),
        }),
      );
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        return undefined;
      }
      if (await removeStaleMcpRefreshLock(lockPath, nowMs)) {
        continue;
      }
      await sleepMs(DEFAULT_REFRESH_LOCK_RETRY_BASE_MS * (attempt + 1));
    }
  }
  return undefined;
}

async function removeStaleMcpRefreshLock(lockPath: string, nowMs?: () => number): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    if ((nowMs?.() ?? Date.now()) - info.mtimeMs > DEFAULT_REFRESH_LOCK_STALE_MS) {
      await unlink(lockPath).catch(() => {});
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createMcpAuthFetch(): FetchLike {
  return async (url, init) => {
    const timeout = AbortSignal.timeout(DEFAULT_AUTH_REQUEST_TIMEOUT_MS);
    const existingSignal = init?.signal ?? undefined;
    if (existingSignal === undefined) {
      return fetch(url, { ...init, signal: timeout });
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    existingSignal.addEventListener("abort", abort);
    timeout.addEventListener("abort", abort);
    if (existingSignal.aborted) {
      controller.abort();
    }
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      existingSignal.removeEventListener("abort", abort);
      timeout.removeEventListener("abort", abort);
    }
  };
}

async function fetchMcpAuthServerMetadata({
  serverName,
  serverUrl,
  configuredMetadataUrl,
  fetchFn,
}: {
  readonly serverName: string;
  readonly serverUrl?: string;
  readonly configuredMetadataUrl?: string;
  readonly fetchFn?: FetchLike;
}): Promise<AuthorizationServerMetadata | undefined> {
  if (configuredMetadataUrl !== undefined) {
    if (
      !configuredMetadataUrl.startsWith("https://") &&
      !configuredMetadataUrl.startsWith("http://127.0.0.1:")
    ) {
      throw new Error(`authServerMetadataUrl must use https:// (got: ${configuredMetadataUrl})`);
    }
    const response = await (fetchFn ?? fetch)(configuredMetadataUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} fetching configured auth server metadata from ${configuredMetadataUrl}`,
      );
    }
    return OAuthMetadataSchema.parse(await response.json()) as AuthorizationServerMetadata;
  }
  if (serverUrl === undefined) {
    return undefined;
  }
  try {
    const info = await discoverOAuthServerInfo(serverUrl, {
      ...(fetchFn === undefined ? {} : { fetchFn }),
    });
    if (info.authorizationServerMetadata !== undefined) {
      return info.authorizationServerMetadata;
    }
  } catch {
    // Fall through to path-aware metadata discovery.
  }
  try {
    return await discoverAuthorizationServerMetadata(serverUrl, {
      ...(fetchFn === undefined ? {} : { fetchFn }),
    });
  } catch (error) {
    throw new Error(
      `${serverName}: OAuth metadata discovery failed: ${sanitizeMcpError(toErrorMessage(error))}`,
    );
  }
}

function readAuthorizationServerMetadataString(
  metadata: AuthorizationServerMetadata | undefined,
  key: "issuer" | "revocation_endpoint",
): string | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function chooseMcpRevocationAuthMethod(
  metadata: AuthorizationServerMetadata | undefined,
): "client_secret_basic" | "client_secret_post" {
  const metadataRecord = metadata as Record<string, unknown> | undefined;
  const methodsRaw =
    metadataRecord?.revocation_endpoint_auth_methods_supported ??
    metadataRecord?.token_endpoint_auth_methods_supported;
  const methods = Array.isArray(methodsRaw)
    ? methodsRaw.filter((item): item is string => typeof item === "string")
    : [];
  return methods.length > 0 &&
    !methods.includes("client_secret_basic") &&
    methods.includes("client_secret_post")
    ? "client_secret_post"
    : "client_secret_basic";
}

async function revokeMcpOAuthToken({
  endpoint,
  token,
  tokenTypeHint,
  clientInformation,
  accessToken,
  authMethod,
}: {
  readonly endpoint: string;
  readonly token: string;
  readonly tokenTypeHint: "access_token" | "refresh_token";
  readonly clientInformation?: OAuthClientInformationMixed;
  readonly accessToken?: string;
  readonly authMethod: "client_secret_basic" | "client_secret_post";
}): Promise<void> {
  const params = new URLSearchParams();
  params.set("token", token);
  params.set("token_type_hint", tokenTypeHint);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const clientId = clientInformation?.client_id;
  const clientSecret = clientInformation?.client_secret;
  if (clientId !== undefined && clientSecret !== undefined) {
    if (authMethod === "client_secret_post") {
      params.set("client_id", clientId);
      params.set("client_secret", clientSecret);
    } else {
      headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
    }
  } else if (clientId !== undefined) {
    params.set("client_id", clientId);
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: params,
  });
  if (response.ok) {
    return;
  }
  if (response.status === 401 && accessToken !== undefined) {
    const retryParams = new URLSearchParams();
    retryParams.set("token", token);
    retryParams.set("token_type_hint", tokenTypeHint);
    const retry = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${accessToken}`,
      },
      body: retryParams,
    });
    if (retry.ok) {
      return;
    }
    throw new Error(`HTTP ${retry.status}`);
  }
  throw new Error(`HTTP ${response.status}`);
}

interface XaaTokenExchangeResponse {
  readonly access_token?: string;
  readonly issued_token_type?: string;
  readonly expires_in?: number;
  readonly scope?: string;
}

interface XaaJwtBearerResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly refresh_token?: string;
}

async function performMcpXaaTokenExchange(
  serverName: string,
  serverConfig: ConversationRuntimeMcpServerConfig,
  {
    fetchFn,
  }: {
    readonly fetchFn?: FetchLike;
  } = {},
): Promise<OAuthTokens> {
  const xaa = normalizeMcpXaaConfig(serverConfig.oauth?.xaa ?? false);
  if (typeof serverConfig.url !== "string" || serverConfig.url.trim().length === 0) {
    throw new Error(`XAA: server '${serverName}' needs an MCP URL.`);
  }
  if (serverConfig.oauth?.clientId === undefined || serverConfig.oauth.clientSecret === undefined) {
    throw new Error(`XAA: server '${serverName}' needs oauth.clientId and oauth.clientSecret.`);
  }
  if (
    xaa.idpClientId === undefined ||
    xaa.idpIdToken === undefined ||
    xaa.idpTokenEndpoint === undefined
  ) {
    throw new Error(
      `XAA: server '${serverName}' needs oauth.xaa.idpClientId, oauth.xaa.idpIdToken and oauth.xaa.idpTokenEndpoint.`,
    );
  }
  const xaaFetch = fetchFn ?? createMcpAuthFetch();
  const protectedResource = await discoverMcpXaaProtectedResource(serverConfig.url, xaaFetch);
  const authorizationServer = await discoverMcpXaaAuthorizationServer(
    protectedResource.authorization_servers,
    xaaFetch,
  );
  const jag = await requestMcpXaaJwtAuthorizationGrant({
    tokenEndpoint: xaa.idpTokenEndpoint,
    audience: authorizationServer.issuer,
    resource: protectedResource.resource,
    idToken: xaa.idpIdToken,
    clientId: xaa.idpClientId,
    ...(xaa.idpClientSecret === undefined ? {} : { clientSecret: xaa.idpClientSecret }),
    fetchFn: xaaFetch,
  });
  const authMethod = chooseMcpRevocationAuthMethod(authorizationServer);
  const tokenResult = await exchangeMcpXaaJwtBearerGrant({
    tokenEndpoint: authorizationServer.token_endpoint,
    assertion: jag.jwtAuthGrant,
    clientId: serverConfig.oauth.clientId,
    clientSecret: serverConfig.oauth.clientSecret,
    authMethod,
    fetchFn: xaaFetch,
  });
  return {
    access_token: tokenResult.access_token,
    token_type: tokenResult.token_type ?? "Bearer",
    ...(tokenResult.expires_in === undefined ? {} : { expires_in: tokenResult.expires_in }),
    ...(tokenResult.scope === undefined ? {} : { scope: tokenResult.scope }),
    ...(tokenResult.refresh_token === undefined
      ? {}
      : { refresh_token: tokenResult.refresh_token }),
  };
}

function normalizeMcpXaaConfig(
  value: ConversationRuntimeMcpServerConfig["oauth"] extends infer OAuth
    ? OAuth extends { readonly xaa?: infer Xaa }
      ? Xaa
      : never
    : never,
): {
  readonly idpClientId?: string;
  readonly idpClientSecret?: string;
  readonly idpIdToken?: string;
  readonly idpTokenEndpoint?: string;
} {
  if (!isRecord(value)) {
    return {};
  }
  return removeUndefinedFields({
    idpClientId: readOptionalString(value, "idpClientId"),
    idpClientSecret: readOptionalString(value, "idpClientSecret"),
    idpIdToken: readOptionalString(value, "idpIdToken"),
    idpTokenEndpoint: readOptionalString(value, "idpTokenEndpoint"),
  }) as {
    readonly idpClientId?: string;
    readonly idpClientSecret?: string;
    readonly idpIdToken?: string;
    readonly idpTokenEndpoint?: string;
  };
}

async function discoverMcpXaaProtectedResource(
  serverUrl: string,
  fetchFn: FetchLike,
): Promise<{ readonly resource: string; readonly authorization_servers: readonly string[] }> {
  const metadata = await discoverOAuthProtectedResourceMetadata(serverUrl, {}, fetchFn);
  const resource = typeof metadata.resource === "string" ? metadata.resource : undefined;
  const authorizationServers = Array.isArray(metadata.authorization_servers)
    ? metadata.authorization_servers.filter((item): item is string => typeof item === "string")
    : [];
  if (resource === undefined || authorizationServers.length === 0) {
    throw new Error("XAA: PRM discovery failed: resource or authorization_servers missing.");
  }
  if (normalizeMcpXaaUrl(resource) !== normalizeMcpXaaUrl(serverUrl)) {
    throw new Error(`XAA: PRM resource mismatch: expected ${serverUrl}, got ${resource}`);
  }
  return {
    resource,
    authorization_servers: authorizationServers,
  };
}

async function discoverMcpXaaAuthorizationServer(
  authorizationServerUrls: readonly string[],
  fetchFn: FetchLike,
): Promise<
  AuthorizationServerMetadata & { readonly token_endpoint: string; readonly issuer: string }
> {
  const errors: string[] = [];
  for (const authorizationServerUrl of authorizationServerUrls) {
    try {
      const metadata = await discoverAuthorizationServerMetadata(authorizationServerUrl, {
        fetchFn,
      });
      const issuer = readAuthorizationServerMetadataString(metadata, "issuer");
      const tokenEndpoint =
        metadata === undefined ? undefined : (metadata as Record<string, unknown>).token_endpoint;
      if (metadata === undefined || issuer === undefined || typeof tokenEndpoint !== "string") {
        errors.push(`${authorizationServerUrl}: missing issuer or token_endpoint`);
        continue;
      }
      if (normalizeMcpXaaUrl(issuer) !== normalizeMcpXaaUrl(authorizationServerUrl)) {
        errors.push(`${authorizationServerUrl}: issuer mismatch ${issuer}`);
        continue;
      }
      if (
        new URL(tokenEndpoint).protocol !== "https:" &&
        !tokenEndpoint.startsWith("http://127.0.0.1:")
      ) {
        errors.push(`${authorizationServerUrl}: refusing non-HTTPS token endpoint`);
        continue;
      }
      const grants = Array.isArray((metadata as Record<string, unknown>).grant_types_supported)
        ? ((metadata as Record<string, unknown>).grant_types_supported as unknown[]).filter(
            (item): item is string => typeof item === "string",
          )
        : undefined;
      if (grants !== undefined && !grants.includes(XAA_JWT_BEARER_GRANT)) {
        errors.push(`${authorizationServerUrl}: jwt-bearer grant not advertised`);
        continue;
      }
      return metadata as AuthorizationServerMetadata & {
        readonly token_endpoint: string;
        readonly issuer: string;
      };
    } catch (error) {
      errors.push(`${authorizationServerUrl}: ${sanitizeMcpError(toErrorMessage(error))}`);
    }
  }
  throw new Error(`XAA: no authorization server supports jwt-bearer. Tried: ${errors.join("; ")}`);
}

async function requestMcpXaaJwtAuthorizationGrant({
  tokenEndpoint,
  audience,
  resource,
  idToken,
  clientId,
  clientSecret,
  fetchFn,
}: {
  readonly tokenEndpoint: string;
  readonly audience: string;
  readonly resource: string;
  readonly idToken: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly fetchFn: FetchLike;
}): Promise<{
  readonly jwtAuthGrant: string;
  readonly expiresIn?: number;
  readonly scope?: string;
}> {
  const params = new URLSearchParams({
    grant_type: XAA_TOKEN_EXCHANGE_GRANT,
    requested_token_type: XAA_ID_JAG_TOKEN_TYPE,
    audience,
    resource,
    subject_token: idToken,
    subject_token_type: XAA_ID_TOKEN_TYPE,
    client_id: clientId,
  });
  if (clientSecret !== undefined) {
    params.set("client_secret", clientSecret);
  }
  const response = await fetchFn(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const body = await readJsonResponse<XaaTokenExchangeResponse>(response, "XAA token exchange");
  if (body.access_token === undefined) {
    throw new Error("XAA: token exchange response missing access_token.");
  }
  if (body.issued_token_type !== XAA_ID_JAG_TOKEN_TYPE) {
    throw new Error(`XAA: unexpected issued_token_type: ${String(body.issued_token_type)}`);
  }
  return {
    jwtAuthGrant: body.access_token,
    ...(typeof body.expires_in === "number" ? { expiresIn: body.expires_in } : {}),
    ...(body.scope === undefined ? {} : { scope: body.scope }),
  };
}

async function exchangeMcpXaaJwtBearerGrant({
  tokenEndpoint,
  assertion,
  clientId,
  clientSecret,
  authMethod,
  fetchFn,
}: {
  readonly tokenEndpoint: string;
  readonly assertion: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authMethod: "client_secret_basic" | "client_secret_post";
  readonly fetchFn: FetchLike;
}): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: XAA_JWT_BEARER_GRANT,
    assertion,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (authMethod === "client_secret_post") {
    params.set("client_id", clientId);
    params.set("client_secret", clientSecret);
  } else {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
  }
  const response = await fetchFn(tokenEndpoint, {
    method: "POST",
    headers,
    body: params,
  });
  const body = await readJsonResponse<XaaJwtBearerResponse>(response, "XAA jwt-bearer grant");
  if (body.access_token === undefined) {
    throw new Error("XAA: jwt-bearer response missing access_token.");
  }
  return {
    access_token: body.access_token,
    token_type: body.token_type ?? "Bearer",
    ...(typeof body.expires_in === "number" ? { expires_in: body.expires_in } : {}),
    ...(body.scope === undefined ? {} : { scope: body.scope }),
    ...(body.refresh_token === undefined ? {} : { refresh_token: body.refresh_token }),
  };
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${label} failed: HTTP ${response.status}: ${redactMcpSensitiveJson(text).slice(0, 240)}`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned non-JSON.`);
  }
}

function redactMcpSensitiveJson(value: string): string {
  return value.replace(
    /"(access_token|refresh_token|id_token|assertion|subject_token|client_secret)"\s*:\s*"[^"]*"/giu,
    (_match, key: string) => `"${key}":"[REDACTED]"`,
  );
}

function normalizeMcpXaaUrl(url: string): string {
  try {
    return new URL(url).href.replace(/\/$/u, "");
  } catch {
    return url.replace(/\/$/u, "");
  }
}

async function waitForOAuthCallback({
  port,
  timeoutMs,
}: {
  readonly port: number;
  readonly timeoutMs: number;
}): Promise<{
  readonly redirectUri: string;
  readonly authorizationUrl: string | undefined;
  readonly setAuthorizationUrl: (url: string) => void;
  readonly setExpectedState: (state: string | undefined) => void;
  readonly codePromise: Promise<string>;
  readonly close: () => Promise<void>;
}> {
  let authorizationUrl: string | undefined;
  let expectedState: string | undefined;
  let settleCode: (code: string) => void = () => {};
  let settleError: (error: Error) => void = () => {};
  const codePromise = new Promise<string>((resolve, reject) => {
    settleCode = resolve;
    settleError = reject;
  });
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      const error = url.searchParams.get("error");
      if (error !== null) {
        const description = url.searchParams.get("error_description");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<h1>Director Angel MCP OAuth failed</h1><p>You can close this window.</p>");
        settleError(new Error(`OAuth error: ${error}${description ? ` - ${description}` : ""}`));
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? undefined;
      if (code === null || code.length === 0) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Missing OAuth code");
        return;
      }
      if (expectedState !== undefined && state !== expectedState) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          "<h1>Director Angel MCP OAuth failed</h1><p>Invalid state. You can close this window.</p>",
        );
        settleError(new Error("OAuth state mismatch."));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>Director Angel MCP OAuth complete</h1><p>You can close this window.</p>");
      settleCode(code);
    } catch (error) {
      settleError(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const timeout = setTimeout(() => {
    settleError(new Error("MCP OAuth login timed out."));
  }, timeoutMs);
  timeout.unref?.();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref?.();
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    redirectUri: `http://127.0.0.1:${actualPort}/callback`,
    get authorizationUrl() {
      return authorizationUrl;
    },
    setAuthorizationUrl: (url) => {
      authorizationUrl = url;
    },
    setExpectedState: (state) => {
      expectedState = state;
    },
    codePromise,
    close: async () => {
      clearTimeout(timeout);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function normalizeMcpServerConfig(
  value: Readonly<Record<string, unknown>>,
): ConversationRuntimeMcpServerConfig | null {
  const type = readOptionalString(value, "type");
  const url = readOptionalString(value, "url");
  const command = readOptionalString(value, "command");
  const auth = readOptionalString(value, "auth");
  if (url === undefined && command === undefined) {
    return null;
  }
  const tools = readToolSelection(value.tools);
  const oauth = readMcpOAuthConfig(value.oauth);
  return {
    ...(type === "stdio" || type === "http" || type === "sse" ? { type } : {}),
    ...(url === undefined ? {} : { url }),
    ...(command === undefined ? {} : { command }),
    args: readStringArray(value.args),
    env: readStringRecord(value.env),
    headers: readStringRecord(value.headers),
    ...(auth === "none" || auth === "oauth" || auth === "header" ? { auth } : {}),
    ...(oauth === undefined ? {} : { oauth }),
    enabled: value.enabled !== false,
    ...(tools === undefined ? {} : { tools }),
    ...(typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)
      ? { timeoutMs: value.timeoutMs }
      : {}),
  };
}

function readMcpOAuthConfig(value: unknown):
  | {
      readonly clientId?: string;
      readonly clientSecret?: string;
      readonly callbackPort?: number;
      readonly authServerMetadataUrl?: string;
      readonly xaa?:
        | boolean
        | {
            readonly idpClientId?: string;
            readonly idpClientSecret?: string;
            readonly idpIdToken?: string;
            readonly idpTokenEndpoint?: string;
          };
    }
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const clientId = readOptionalString(value, "clientId");
  const clientSecret = readOptionalString(value, "clientSecret");
  const authServerMetadataUrl = readOptionalString(value, "authServerMetadataUrl");
  const xaa = readMcpXaaConfig(value.xaa);
  const callbackPort =
    typeof value.callbackPort === "number" &&
    Number.isInteger(value.callbackPort) &&
    value.callbackPort > 0
      ? value.callbackPort
      : undefined;
  if (
    clientId === undefined &&
    clientSecret === undefined &&
    authServerMetadataUrl === undefined &&
    callbackPort === undefined &&
    xaa === undefined
  ) {
    return undefined;
  }
  return {
    ...(clientId === undefined ? {} : { clientId }),
    ...(clientSecret === undefined ? {} : { clientSecret }),
    ...(callbackPort === undefined ? {} : { callbackPort }),
    ...(authServerMetadataUrl === undefined ? {} : { authServerMetadataUrl }),
    ...(xaa === undefined ? {} : { xaa }),
  };
}

function readMcpXaaConfig(value: unknown):
  | boolean
  | {
      readonly idpClientId?: string;
      readonly idpClientSecret?: string;
      readonly idpIdToken?: string;
      readonly idpTokenEndpoint?: string;
    }
  | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return removeUndefinedFields({
    idpClientId: readOptionalString(value, "idpClientId"),
    idpClientSecret: readOptionalString(value, "idpClientSecret"),
    idpIdToken: readOptionalString(value, "idpIdToken"),
    idpTokenEndpoint: readOptionalString(value, "idpTokenEndpoint"),
  }) as {
    readonly idpClientId?: string;
    readonly idpClientSecret?: string;
    readonly idpIdToken?: string;
    readonly idpTokenEndpoint?: string;
  };
}

function readToolSelection(value: unknown):
  | {
      readonly include?: readonly string[];
      readonly exclude?: readonly string[];
    }
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const include = readStringArray(value.include);
  const exclude = readStringArray(value.exclude);
  if (include.length === 0 && exclude.length === 0) {
    return undefined;
  }
  return {
    ...(include.length === 0 ? {} : { include }),
    ...(exclude.length === 0 ? {} : { exclude }),
  };
}

function normalizeMcpInputSchema(value: unknown): unknown {
  if (!isRecord(value)) {
    return emptyObjectSchema();
  }
  let schema: Record<string, unknown> = { ...value };
  if (schema.definitions !== undefined && schema.$defs === undefined) {
    const { definitions, ...rest } = schema;
    schema = { ...rest, $defs: definitions };
  }
  if (schema.type !== "object") {
    schema.type = "object";
  }
  if (!isRecord(schema.properties)) {
    schema.properties = {};
  }
  if (Array.isArray(schema.required) && isRecord(schema.properties)) {
    const properties = schema.properties;
    schema.required = schema.required.filter(
      (item): item is string => typeof item === "string" && item in properties,
    );
  }
  return rewriteDefinitionRefs(schema);
}

function rewriteDefinitionRefs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(rewriteDefinitionRefs);
  }
  if (!isRecord(value)) {
    return value;
  }
  const rewritten: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    rewritten[key] =
      key === "$ref" && typeof entry === "string"
        ? entry.replace("#/definitions/", "#/$defs/")
        : rewriteDefinitionRefs(entry);
  }
  return rewritten;
}

function emptyObjectSchema(): Record<string, unknown> {
  return { type: "object", properties: {} };
}

function buildSafeMcpEnv(
  userEnv: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (SAFE_ENV_KEYS.has(key) || key.startsWith("XDG_")) {
      env[key] = value;
    }
  }
  return { ...env, ...(userEnv ?? {}) };
}

function formatMcpCallToolResult(result: CallToolResult): string {
  const parts = result.content.map((item) => {
    if (item.type === "text") {
      return item.text;
    }
    if (item.type === "image") {
      return `[image:${item.mimeType}]`;
    }
    if (item.type === "audio") {
      return `[audio:${item.mimeType}]`;
    }
    if (item.type === "resource") {
      return "text" in item.resource ? item.resource.text : `[resource:${item.resource.uri}]`;
    }
    if (item.type === "resource_link") {
      return `[resource_link:${item.uri}]`;
    }
    return JSON.stringify(item);
  });
  if (result.structuredContent !== undefined) {
    parts.push(`structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return sanitizeMcpError(parts.join("\n").trim() || "(empty MCP result)");
}

function resolveToolTimeoutMs(config: ConversationRuntimeMcpServerConfig): number {
  return typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)
    ? Math.max(1_000, config.timeoutMs)
    : DEFAULT_TOOL_TIMEOUT_MS;
}

function isMcpToolSelected(toolName: string, config: ConversationRuntimeMcpServerConfig): boolean {
  const include = new Set(config.tools?.include ?? []);
  const exclude = new Set(config.tools?.exclude ?? []);
  if (include.size > 0 && !include.has(toolName)) {
    return false;
  }
  return !exclude.has(toolName);
}

function resolveMcpAuthMode(
  config: ConversationRuntimeMcpServerConfig,
): "none" | "oauth" | "header" {
  if (config.auth === "oauth" || config.oauth !== undefined) {
    return "oauth";
  }
  if (
    config.auth === "header" ||
    Object.keys(config.headers ?? {}).some((key) => key.toLowerCase() === "authorization")
  ) {
    return "header";
  }
  return "none";
}

function redactMcpServerConfig(
  config: ConversationRuntimeMcpServerConfig,
): ConversationRuntimeMcpServerConfig {
  return {
    ...config,
    ...(config.oauth === undefined ? {} : { oauth: redactMcpOAuthConfig(config.oauth) }),
    env: redactRecord(config.env),
    headers: redactRecord(config.headers),
  };
}

function redactMcpOAuthConfig(
  oauth: NonNullable<ConversationRuntimeMcpServerConfig["oauth"]>,
): NonNullable<ConversationRuntimeMcpServerConfig["oauth"]> {
  return {
    ...oauth,
    ...(oauth.clientSecret === undefined ? {} : { clientSecret: "[REDACTED]" }),
    ...(isRecord(oauth.xaa)
      ? {
          xaa: {
            ...oauth.xaa,
            ...(oauth.xaa.idpClientSecret === undefined ? {} : { idpClientSecret: "[REDACTED]" }),
            ...(oauth.xaa.idpIdToken === undefined ? {} : { idpIdToken: "[REDACTED]" }),
          },
        }
      : {}),
  };
}

function redactRecord(value: Readonly<Record<string, string>> | undefined): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /key|token|secret|password|authorization|auth/iu.test(key)
        ? "[REDACTED]"
        : sanitizeMcpError(entry),
    ]),
  );
}

function isMcpNeedsAuthError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) {
    return true;
  }
  const message = toErrorMessage(error);
  return /\b(401|unauthori[sz]ed|needs[- ]auth|authentication required|forbidden)\b/iu.test(
    message,
  );
}

function sanitizeMcpError(value: string): string {
  return value.replace(CREDENTIAL_PATTERN, "[REDACTED]");
}

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
