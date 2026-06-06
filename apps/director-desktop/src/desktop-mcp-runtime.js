import { join } from "node:path";

import {
  authorizeConversationRuntimeMcpServer,
  createAsyncConversationRuntimeToolRegistry,
  createConversationRuntimeWritableMergedMcpServers,
  createConversationRuntimeMcpClient,
  createDirectorConversationRuntimeTools,
  loadConversationRuntimeMergedMcpConfig,
  revokeConversationRuntimeMcpServerTokens,
  writeConversationRuntimeMcpJsonConfig,
} from "@hotflow/conversation-runtime";

export async function createDesktopConversationRuntimeMcpContext({
  workspaceRoot,
  clientName = "director-angel-desktop",
  oauthStorageMode = resolveDesktopMcpOAuthStorageMode(),
  effectiveToolChecks,
} = {}) {
  const mcpConfig = loadDesktopMcpConfig(workspaceRoot);
  if (Object.keys(mcpConfig.servers).length === 0) {
    const registry = createAsyncConversationRuntimeToolRegistry({
      directorTools: createDirectorConversationRuntimeTools(),
      ...(effectiveToolChecks === undefined ? {} : { effectiveToolChecks }),
    });
    return {
      tools: await registry.listModelTools(),
      mcpClient: null,
      close: async () => {},
    };
  }
  const mcpClient = createConversationRuntimeMcpClient({
    servers: mcpConfig.servers,
    clientName,
    clientVersion: "0.1.0",
    cwd: workspaceRoot,
    oauthStorageMode,
    stderrLogPath: join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "logs",
      "mcp-stderr.log",
    ),
  });
  const registry = createAsyncConversationRuntimeToolRegistry({
    directorTools: createDirectorConversationRuntimeTools(),
    mcpToolProvider: mcpClient,
    ...(effectiveToolChecks === undefined ? {} : { effectiveToolChecks }),
  });
  return {
    tools: await registry.listModelTools(),
    mcpClient,
    close: () => mcpClient.close(),
  };
}

export function loadDesktopMcpConfig(workspaceRoot) {
  return loadConversationRuntimeMergedMcpConfig(workspaceRoot);
}

export async function writeDesktopMcpConfig(workspaceRoot, servers) {
  const configPath = join(workspaceRoot, ".mcp.json");
  const nextServers = createConversationRuntimeWritableMergedMcpServers(workspaceRoot, servers);
  await writeConversationRuntimeMcpJsonConfig(configPath, { mcpServers: nextServers });
  return loadDesktopMcpConfig(workspaceRoot);
}

export function createDesktopMcpClientForConfig(
  workspaceRoot,
  servers,
  clientName = "director-angel-desktop",
  oauthStorageMode = resolveDesktopMcpOAuthStorageMode(),
) {
  return createConversationRuntimeMcpClient({
    servers,
    clientName,
    clientVersion: "0.1.0",
    cwd: workspaceRoot,
    oauthStorageMode,
    stderrLogPath: join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "logs",
      "mcp-stderr.log",
    ),
  });
}

export async function revokeDesktopMcpServerTokens({
  workspaceRoot,
  serverName,
  clientName = "director-angel-desktop",
  oauthStorageMode = resolveDesktopMcpOAuthStorageMode(),
} = {}) {
  const config = loadDesktopMcpConfig(workspaceRoot);
  return revokeConversationRuntimeMcpServerTokens({
    servers: config.servers,
    serverName,
    clientName,
    clientVersion: "0.1.0",
    cwd: workspaceRoot,
    oauthStorePath: join(workspaceRoot, ".director-angel", "mcp", "oauth-tokens.json"),
    oauthStorageMode,
  });
}

export async function authorizeDesktopMcpServer({
  workspaceRoot,
  serverName,
  openAuthorizationUrl,
  clientName = "director-angel-desktop",
  timeoutMs,
  oauthStorageMode = resolveDesktopMcpOAuthStorageMode(),
} = {}) {
  const config = loadDesktopMcpConfig(workspaceRoot);
  return authorizeConversationRuntimeMcpServer({
    servers: config.servers,
    serverName,
    clientName,
    clientVersion: "0.1.0",
    cwd: workspaceRoot,
    oauthStorePath: join(workspaceRoot, ".director-angel", "mcp", "oauth-tokens.json"),
    oauthStorageMode,
    ...(openAuthorizationUrl === undefined ? {} : { openAuthorizationUrl }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

function resolveDesktopMcpOAuthStorageMode() {
  const raw = process.env.DIRECTOR_MCP_OAUTH_STORAGE;
  return raw === "file" || raw === "keychain" || raw === "auto" ? raw : "auto";
}
