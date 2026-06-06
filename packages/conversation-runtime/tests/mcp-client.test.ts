import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeConversationRuntimeMcpServer,
  createConversationRuntimeMcpClient,
  createConversationRuntimeWritableMergedMcpServers,
  loadConversationRuntimeMcpJsonConfig,
  loadConversationRuntimeMergedMcpConfig,
  revokeConversationRuntimeMcpServerTokens,
  setConversationRuntimeMcpExecFileForTesting,
  setConversationRuntimeMcpSpawnWithInputForTesting,
  writeConversationRuntimeMcpJsonConfig,
} from "../src/index.js";

const MCP_OAUTH_E2E_TIMEOUT_MS = 30_000;

describe("conversation runtime MCP client config", () => {
  afterEach(() => {
    setConversationRuntimeMcpExecFileForTesting(null);
    setConversationRuntimeMcpSpawnWithInputForTesting(null);
  });

  it("loads Claude Code style .mcp.json and normalizes server config", () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-config-"));
    const configPath = join(dir, ".mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          exa: {
            type: "stdio",
            command: "npx",
            args: ["-y", "exa-mcp"],
            env: { EXA_API_KEY: "sk-secret" },
            tools: { include: ["search"] },
          },
          disabled: {
            url: "https://example.test/mcp",
            enabled: false,
          },
          malformed: {
            args: ["missing-command"],
          },
        },
      }),
    );

    expect(loadConversationRuntimeMcpJsonConfig(configPath)).toEqual({
      mcpServers: {
        exa: {
          type: "stdio",
          command: "npx",
          args: ["-y", "exa-mcp"],
          env: { EXA_API_KEY: "sk-secret" },
          headers: {},
          enabled: true,
          tools: { include: ["search"] },
        },
        disabled: {
          url: "https://example.test/mcp",
          args: [],
          env: {},
          headers: {},
          enabled: false,
        },
      },
    });
  });

  it("exposes no tools when every MCP server is disabled", async () => {
    const client = createConversationRuntimeMcpClient({
      servers: {
        disabled: {
          command: "node",
          enabled: false,
        },
      },
    });

    await expect(client.listTools()).resolves.toEqual([]);
    await client.close();
  });

  it("atomically writes Claude Code style MCP config and preserves oauth/header metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-write-"));
    const configPath = join(dir, ".mcp.json");

    await writeConversationRuntimeMcpJsonConfig(configPath, {
      mcpServers: {
        remote: {
          type: "http",
          url: "https://example.test/mcp",
          auth: "oauth",
          oauth: { clientId: "director", callbackPort: 33418 },
          headers: { Authorization: "Bearer sk-secret" },
          enabled: true,
          tools: { exclude: ["danger"] },
        },
      },
    });

    expect(loadConversationRuntimeMcpJsonConfig(configPath)).toEqual({
      mcpServers: {
        remote: expect.objectContaining({
          type: "http",
          url: "https://example.test/mcp",
          auth: "oauth",
          oauth: { clientId: "director", callbackPort: 33418 },
          headers: { Authorization: "Bearer sk-secret" },
          enabled: true,
          tools: { exclude: ["danger"] },
        }),
      },
    });
  });

  it("merges Director legacy MCP config, parent .mcp.json, and workspace .mcp.json with workspace precedence", () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-mcp-merged-parent-"));
    const workspaceRoot = join(parentRoot, "nested", "workspace");
    mkdirSync(join(workspaceRoot, ".director-angel", "mcp"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".director-angel", "mcp", "servers.json"),
      JSON.stringify({
        mcpServers: {
          legacy: {
            command: "node",
            args: ["legacy.js"],
            enabled: false,
          },
          shared: {
            command: "node",
            args: ["legacy-shared.js"],
            enabled: false,
          },
        },
      }),
    );
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          inherited: {
            command: "node",
            args: ["parent.js"],
            enabled: false,
          },
          shared: {
            command: "node",
            args: ["parent-shared.js"],
            enabled: false,
          },
        },
      }),
    );
    writeFileSync(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: {
            command: "node",
            args: ["workspace-shared.js"],
            enabled: false,
          },
        },
      }),
    );

    const config = loadConversationRuntimeMergedMcpConfig(workspaceRoot);

    expect(config.source).toBe("merged");
    expect(config.path).toBe(join(workspaceRoot, ".mcp.json"));
    expect(config.sources.map((source) => source.scope)).toEqual([
      "director-project",
      "project-parent",
      "project",
    ]);
    expect(Object.keys(config.servers).sort()).toEqual(["inherited", "legacy", "shared"]);
    expect(config.servers.shared?.args).toEqual(["workspace-shared.js"]);
    expect(config.serverSources).toMatchObject({
      legacy: {
        scope: "director-project",
        path: join(workspaceRoot, ".director-angel", "mcp", "servers.json"),
      },
      inherited: {
        scope: "project-parent",
        path: join(parentRoot, ".mcp.json"),
      },
      shared: {
        scope: "project",
        path: join(workspaceRoot, ".mcp.json"),
      },
    });
  });

  it("creates a writable project MCP document without copying unchanged inherited servers", () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-mcp-writable-parent-"));
    const workspaceRoot = join(parentRoot, "nested", "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          inherited: {
            command: "node",
            args: ["parent.js"],
            enabled: false,
          },
        },
      }),
    );

    expect(
      createConversationRuntimeWritableMergedMcpServers(workspaceRoot, {
        ...loadConversationRuntimeMergedMcpConfig(workspaceRoot).servers,
      }),
    ).toEqual({});
    expect(
      createConversationRuntimeWritableMergedMcpServers(workspaceRoot, {
        ...loadConversationRuntimeMergedMcpConfig(workspaceRoot).servers,
        inherited: {
          command: "node",
          args: ["workspace.js"],
          enabled: false,
        },
      }),
    ).toEqual({
      inherited: expect.objectContaining({
        args: ["workspace.js"],
      }),
    });
  });

  it("creates a disabled local tombstone when an inherited MCP server is removed from the merged view", () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-mcp-tombstone-parent-"));
    const workspaceRoot = join(parentRoot, "nested", "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          inherited: {
            command: "node",
            args: ["parent.js"],
            enabled: true,
          },
        },
      }),
    );

    expect(createConversationRuntimeWritableMergedMcpServers(workspaceRoot, {})).toEqual({
      inherited: expect.objectContaining({
        command: "node",
        args: ["parent.js"],
        enabled: false,
      }),
    });
  });

  it("keeps an existing disabled local tombstone when an inherited MCP server is removed again", () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-mcp-tombstone-repeat-parent-"));
    const workspaceRoot = join(parentRoot, "nested", "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          inherited: {
            command: "node",
            args: ["parent.js"],
            enabled: true,
          },
        },
      }),
    );
    writeFileSync(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          inherited: {
            command: "node",
            args: ["parent.js"],
            enabled: false,
          },
        },
      }),
    );

    expect(createConversationRuntimeWritableMergedMcpServers(workspaceRoot, {})).toEqual({
      inherited: expect.objectContaining({
        command: "node",
        args: ["parent.js"],
        enabled: false,
      }),
    });
  });

  it("removes a disabled local tombstone when the inherited MCP server is enabled again", () => {
    const parentRoot = mkdtempSync(join(tmpdir(), "director-mcp-tombstone-enable-parent-"));
    const workspaceRoot = join(parentRoot, "nested", "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    writeFileSync(
      join(parentRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          inherited: {
            command: "node",
            args: ["parent.js"],
            enabled: true,
          },
        },
      }),
    );
    writeFileSync(
      join(workspaceRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          inherited: {
            command: "node",
            args: ["parent.js"],
            enabled: false,
          },
        },
      }),
    );

    const inheritedServer = loadConversationRuntimeMergedMcpConfig(workspaceRoot).servers.inherited;
    if (inheritedServer === undefined) {
      throw new Error("Expected inherited MCP server to be available.");
    }

    expect(
      createConversationRuntimeWritableMergedMcpServers(workspaceRoot, {
        inherited: {
          ...inheritedServer,
          enabled: true,
        },
      }),
    ).toEqual({});
  });

  it("inspects disabled and failed servers with Claude Code style status buckets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-inspect-"));
    const client = createConversationRuntimeMcpClient({
      cwd: dir,
      servers: {
        disabled: {
          command: "node",
          enabled: false,
        },
        missing: {
          command: join(dir, "missing-command"),
          timeoutMs: 1000,
        },
      },
      nowMs: () => 1_700_000_000_000,
    });

    await expect(client.inspectServers()).resolves.toMatchObject({
      inspectedAtMs: 1_700_000_000_000,
      serverCount: 2,
      disabledCount: 1,
      failedCount: 1,
      servers: expect.arrayContaining([
        expect.objectContaining({ name: "disabled", status: "disabled" }),
        expect.objectContaining({
          name: "missing",
          status: "failed",
          error: expect.any(String),
        }),
      ]),
    });
    await client.close();
  });

  it("keeps MCP stderr under runtime logs for stdio servers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-stderr-"));
    mkdirSync(join(dir, ".director-angel", "runtime", "logs"), { recursive: true });
    const client = createConversationRuntimeMcpClient({
      cwd: dir,
      servers: {
        missing: {
          command: join(dir, "missing-command"),
          args: [],
          timeoutMs: 1000,
        },
      },
      nowMs: () => 1_700_000_000_000,
    });

    const tools = await client.listTools();
    expect(tools).toEqual([
      expect.objectContaining({
        serverName: "missing",
        toolName: "mcp_status",
        enabled: false,
        metadata: expect.objectContaining({
          source: "mcp",
          status: "failed",
        }),
      }),
    ]);
    await client.close();
  });

  it("preflights stdio MCP server startup through the Agent OS sandbox before creating transport", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-stdio-sandbox-"));
    mkdirSync(join(dir, ".director-angel", "runtime", "logs"), { recursive: true });
    const transportRequests: unknown[] = [];
    const client = createConversationRuntimeMcpClient({
      cwd: dir,
      servers: {
        local: {
          type: "stdio",
          command: "node",
          args: ["server.mjs"],
          timeoutMs: 1000,
        },
      },
      mcpStdioTransportFactory: (request) => {
        transportRequests.push(request);
        throw new Error("transport intentionally stopped after sandbox preflight");
      },
      nowMs: () => 1_700_000_000_000,
    });

    await expect(client.listTools()).resolves.toEqual([
      expect.objectContaining({
        serverName: "local",
        toolName: "mcp_status",
        enabled: false,
        metadata: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("transport intentionally stopped"),
        }),
      }),
    ]);
    expect(transportRequests).toEqual([
      expect.objectContaining({
        command: "node",
        args: ["server.mjs"],
        cwd: dir,
        sandbox: expect.objectContaining({
          ok: true,
          status: "admitted",
          backend: "host",
          evidence: expect.objectContaining({
            planHash: expect.any(String),
            commandHash: expect.any(String),
            backendConfig: expect.objectContaining({
              commandPattern: {
                executable: "node",
                argv: ["server.mjs"],
                operationId: "mcp:local",
              },
            }),
          }),
        }),
      }),
    ]);
    await client.close();
  });

  it("does not let MCP stdio long-lived process spawn without admitted sandbox evidence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-stdio-spawn-sandbox-"));
    mkdirSync(join(dir, ".director-angel", "runtime", "logs"), { recursive: true });
    let spawnWithoutSandboxError: unknown;
    const client = createConversationRuntimeMcpClient({
      cwd: dir,
      servers: {
        local: {
          type: "stdio",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          timeoutMs: 1000,
        },
      },
      mcpStdioTransportFactory: (request) => {
        try {
          request.spawnCommand({
            command: request.command,
            args: request.args,
            env: request.env,
            ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
          });
        } catch (error) {
          spawnWithoutSandboxError = error;
        }
        throw new Error("transport intentionally stopped after spawn sandbox check");
      },
      nowMs: () => 1_700_000_000_000,
    });

    await expect(client.listTools()).resolves.toEqual([
      expect.objectContaining({
        serverName: "local",
        toolName: "mcp_status",
        enabled: false,
        metadata: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("transport intentionally stopped"),
        }),
      }),
    ]);
    expect(spawnWithoutSandboxError).toEqual(expect.any(Error));
    expect(spawnWithoutSandboxError).toMatchObject({
      message: expect.stringContaining("requires admitted Agent OS sandbox evidence"),
    });
    await client.close();
  });

  it("records MCP stdio process signal evidence when closing a stubborn local server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-stdio-close-evidence-"));
    mkdirSync(join(dir, ".director-angel", "runtime", "logs"), { recursive: true });
    const serverScript = join(dir, "stubborn-server.mjs");
    writeFileSync(
      serverScript,
      `
import { McpServer } from "${new URL("../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js", import.meta.url).href}";
import { StdioServerTransport } from "${new URL("../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js", import.meta.url).href}";

process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
const server = new McpServer({ name: "stubborn", version: "1.0.0" }, { capabilities: { tools: {} } });
server.registerTool("alpha", { description: "Alpha tool" }, async () => ({ content: [{ type: "text", text: "alpha" }] }));
await server.connect(new StdioServerTransport());
`,
      "utf8",
    );
    const processEvents: unknown[] = [];
    const client = createConversationRuntimeMcpClient({
      cwd: dir,
      servers: {
        local: {
          type: "stdio",
          command: process.execPath,
          args: [serverScript],
          timeoutMs: 5_000,
        },
      },
      mcpStdioCloseDelayMs: 5,
      onMcpStdioProcessEvidence: (event) => {
        processEvents.push(event);
      },
      nowMs: () => 1_700_000_000_000,
    });

    await expect(client.listTools()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverName: "local",
          toolName: "alpha",
        }),
      ]),
    );
    await client.close();

    expect(processEvents).toEqual([
      expect.objectContaining({
        serverName: "local",
        process: expect.objectContaining({
          pid: expect.any(Number),
          signal: "SIGKILL",
          ownedProcess: true,
          terminationReason: "mcp-stdio-close",
          signals: [
            { signal: "SIGTERM", reason: "mcp-stdio-close" },
            { signal: "SIGKILL", reason: "mcp-stdio-close" },
          ],
        }),
        sandbox: expect.objectContaining({
          evidence: expect.objectContaining({
            backend: "host",
            backendConfig: expect.objectContaining({
              commandPattern: {
                executable: process.execPath,
                argv: [serverScript],
                operationId: "mcp:local",
              },
            }),
          }),
        }),
      }),
    ]);
  });

  it("runs OAuth login with a browser URL callback and persists MCP tokens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-oauth-"));
    const authServer = await startFakeMcpOAuthServer();
    try {
      const openedUrls: string[] = [];
      const result = await authorizeConversationRuntimeMcpServer({
        cwd: dir,
        serverName: "remote",
        servers: {
          remote: {
            type: "http",
            url: authServer.url,
            auth: "oauth",
          },
        },
        openAuthorizationUrl: async (url) => {
          openedUrls.push(url);
          const parsed = new URL(url);
          const redirectUri = parsed.searchParams.get("redirect_uri");
          const state = parsed.searchParams.get("state");
          if (!redirectUri) {
            throw new Error("missing redirect_uri");
          }
          await fetch(`${redirectUri}?code=ok-code&state=${state ?? ""}`);
        },
      });

      expect(result).toMatchObject({
        serverName: "remote",
        status: "authorized",
      });
      expect(openedUrls).toHaveLength(1);

      const store = JSON.parse(
        readFileSync(join(dir, ".director-angel", "mcp", "oauth-tokens.json"), "utf8"),
      );
      expect(JSON.stringify(store)).toContain("access-token-ok-code");
      expect(JSON.stringify(store)).toContain("refresh-token-ok-code");
    } finally {
      await authServer.close();
    }
  });

  it(
    "uses configured authServerMetadataUrl when running OAuth login",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "director-mcp-oauth-metadata-"));
      const authServer = await startFakeMcpOAuthServer();
      try {
        const openedUrls: string[] = [];
        const result = await authorizeConversationRuntimeMcpServer({
          cwd: dir,
          serverName: "remote",
          servers: {
            remote: {
              type: "http",
              url: "https://mcp.example.test/mcp",
              auth: "oauth",
              oauth: {
                authServerMetadataUrl: `${authServer.url}/.well-known/oauth-authorization-server`,
              },
            },
          },
          openAuthorizationUrl: async (url) => {
            openedUrls.push(url);
            const parsed = new URL(url);
            const redirectUri = parsed.searchParams.get("redirect_uri");
            const state = parsed.searchParams.get("state");
            if (!redirectUri) {
              throw new Error("missing redirect_uri");
            }
            await fetch(`${redirectUri}?code=configured-code&state=${state ?? ""}`);
          },
        });

        expect(result.status).toBe("authorized");
        expect(openedUrls[0]).toContain(`${authServer.url}/authorize`);
        const store = JSON.parse(
          readFileSync(join(dir, ".director-angel", "mcp", "oauth-tokens.json"), "utf8"),
        );
        expect(JSON.stringify(store)).toContain("access-token-configured-code");
        expect(JSON.stringify(store)).toContain(authServer.url);
      } finally {
        await authServer.close();
      }
    },
    MCP_OAUTH_E2E_TIMEOUT_MS,
  );

  it("stores MCP OAuth credentials in macOS keychain through security -i without argv payload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-keychain-"));
    const authServer = await startFakeMcpOAuthServer();
    const execCalls: Array<{ file: string; args: readonly string[] }> = [];
    const stdinCalls: Array<{ file: string; args: readonly string[]; input: string }> = [];
    const sandboxedSecurityCalls: Array<{ file: string; args: readonly string[] }> = [];
    let storedKeychainPayload = "";
    setConversationRuntimeMcpExecFileForTesting(async (file, args = []) => {
      execCalls.push({ file, args });
      sandboxedSecurityCalls.push({ file, args });
      if (args.includes("find-generic-password")) {
        if (storedKeychainPayload.length > 0) {
          return { stdout: storedKeychainPayload, stderr: "" };
        }
        throw new Error("not found");
      }
      return { stdout: "", stderr: "" };
    });
    setConversationRuntimeMcpSpawnWithInputForTesting(async (file, args, input) => {
      stdinCalls.push({ file, args, input });
      sandboxedSecurityCalls.push({ file, args });
      const match = input.match(/-X "([0-9a-f]+)"/iu);
      if (match?.[1]) {
        storedKeychainPayload = Buffer.from(match[1], "hex").toString("utf8");
      }
    });
    try {
      const result = await authorizeConversationRuntimeMcpServer({
        cwd: dir,
        oauthStorageMode: "keychain",
        serverName: "remote",
        servers: {
          remote: {
            type: "http",
            url: authServer.url,
            auth: "oauth",
          },
        },
        openAuthorizationUrl: async (url) => {
          const parsed = new URL(url);
          const redirectUri = parsed.searchParams.get("redirect_uri");
          const state = parsed.searchParams.get("state");
          if (!redirectUri) {
            throw new Error("missing redirect_uri");
          }
          await fetch(`${redirectUri}?code=keychain-code&state=${state ?? ""}`);
        },
      });

      expect(result.storage).toMatchObject({ kind: "keychain" });
      expect(result.storage).toMatchObject({
        keychainSandbox: expect.objectContaining({
          backend: "host",
          providerId: "agent-os-sandbox.host",
          ok: true,
          evidence: expect.objectContaining({
            backendConfig: expect.objectContaining({
              commandPattern: expect.objectContaining({
                executable: "security",
                argv: [
                  "find-generic-password",
                  "-a",
                  "director-angel",
                  "-s",
                  "Director Angel MCP OAuth",
                  "-w",
                ],
                operationId: "find-generic-password",
              }),
            }),
          }),
        }),
      });
      expect(result.storage.keychainSandbox?.evidence?.backendConfig).not.toHaveProperty(
        "commandPrefix",
      );
      expect(sandboxedSecurityCalls).toEqual(
        expect.arrayContaining([
          {
            file: "security",
            args: [
              "find-generic-password",
              "-a",
              "director-angel",
              "-s",
              "Director Angel MCP OAuth",
              "-w",
            ],
          },
          { file: "security", args: ["-i"] },
        ]),
      );
      expect(stdinCalls.length).toBeGreaterThan(0);
      expect(stdinCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "security",
            args: ["-i"],
            input: expect.stringContaining("add-generic-password"),
          }),
        ]),
      );
      expect(stdinCalls.every((call) => call.input.includes("-X"))).toBe(true);
      expect(stdinCalls.map((call) => call.input).join("\n")).not.toContain(
        "access-token-keychain-code",
      );
      expect(execCalls.flatMap((call) => call.args)).not.toContain("access-token-keychain-code");
    } finally {
      await authServer.close();
    }
  });

  it("runs XAA token exchange without opening browser OAuth callback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-xaa-"));
    const xaaServer = await startFakeMcpXaaServer();
    try {
      const openedUrls: string[] = [];
      const result = await authorizeConversationRuntimeMcpServer({
        cwd: dir,
        serverName: "remote",
        servers: {
          remote: {
            type: "http",
            url: xaaServer.mcpUrl,
            auth: "oauth",
            oauth: {
              clientId: "director-client",
              clientSecret: "director-secret",
              xaa: {
                idpClientId: "idp-client",
                idpIdToken: "id-token",
                idpTokenEndpoint: `${xaaServer.idpUrl}/token`,
              },
            },
          },
        },
        openAuthorizationUrl: async (url) => {
          openedUrls.push(url);
        },
      });

      expect(result).toMatchObject({
        status: "authorized",
        authMethod: "xaa",
      });
      expect(openedUrls).toEqual([]);
      expect(xaaServer.tokenRequests).toEqual(["idp", "as"]);
      const store = JSON.parse(
        readFileSync(join(dir, ".director-angel", "mcp", "oauth-tokens.json"), "utf8"),
      );
      expect(JSON.stringify(store)).toContain("xaa-access-token");
    } finally {
      await xaaServer.close();
    }
  });

  it(
    "revokes MCP OAuth tokens through the server endpoint and clears local credentials",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "director-mcp-oauth-revoke-"));
      const authServer = await startFakeMcpOAuthServer({ includeRevocationEndpoint: true });
      try {
        await authorizeConversationRuntimeMcpServer({
          cwd: dir,
          serverName: "remote",
          servers: {
            remote: {
              type: "http",
              url: "https://mcp.example.test/mcp",
              auth: "oauth",
              oauth: {
                authServerMetadataUrl: `${authServer.url}/.well-known/oauth-authorization-server`,
              },
            },
          },
          openAuthorizationUrl: async (url) => {
            const parsed = new URL(url);
            const redirectUri = parsed.searchParams.get("redirect_uri");
            const state = parsed.searchParams.get("state");
            if (!redirectUri) {
              throw new Error("missing redirect_uri");
            }
            await fetch(`${redirectUri}?code=revoke-code&state=${state ?? ""}`);
          },
        });

        const result = await revokeConversationRuntimeMcpServerTokens({
          cwd: dir,
          serverName: "remote",
          servers: {
            remote: {
              type: "http",
              url: "https://mcp.example.test/mcp",
              auth: "oauth",
              oauth: {
                authServerMetadataUrl: `${authServer.url}/.well-known/oauth-authorization-server`,
              },
            },
          },
        });

        expect(result).toMatchObject({
          serverName: "remote",
          status: "revoked",
          localCredentialsCleared: true,
          revokedTokenTypes: ["refresh_token", "access_token"],
        });
        expect(authServer.revokedTokens).toEqual([
          "refresh-token-revoke-code",
          "access-token-revoke-code",
        ]);
        const store = JSON.parse(
          readFileSync(join(dir, ".director-angel", "mcp", "oauth-tokens.json"), "utf8"),
        );
        expect(store.servers).toEqual({});
      } finally {
        await authServer.close();
      }
    },
    MCP_OAUTH_E2E_TIMEOUT_MS,
  );

  it("refreshes MCP tools when a connected server sends tools/list_changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "director-mcp-list-changed-"));
    const serverScript = join(dir, "list-changed-server.mjs");
    writeFileSync(
      serverScript,
      `
import { McpServer } from "${new URL("../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js", import.meta.url).href}";
import { StdioServerTransport } from "${new URL("../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js", import.meta.url).href}";

const server = new McpServer({ name: "director-test", version: "1.0.0" }, { capabilities: { tools: { listChanged: true } } });
server.registerTool("alpha", { description: "Alpha tool" }, async () => ({ content: [{ type: "text", text: "alpha" }] }));
await server.connect(new StdioServerTransport());
setTimeout(() => {
  try {
    server.registerTool("beta", { description: "Beta tool" }, async () => ({ content: [{ type: "text", text: "beta" }] }));
  } catch (error) {
    console.error(error);
  }
}, 120);
`,
      "utf8",
    );
    const events = [];
    const client = createConversationRuntimeMcpClient({
      cwd: dir,
      servers: {
        local: {
          type: "stdio",
          command: process.execPath,
          args: [serverScript],
          timeoutMs: 5_000,
        },
      },
      onServerListChanged: (event) => {
        events.push(event);
      },
      nowMs: () => 1_700_000_000_000,
    });
    try {
      await expect(client.listTools()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            serverName: "local",
            toolName: "alpha",
          }),
        ]),
      );
      await waitFor(() => events.some((event) => event.type === "tools" && event.itemCount === 2));
      await expect(client.listTools()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toolName: "alpha" }),
          expect.objectContaining({ toolName: "beta" }),
        ]),
      );
      expect(events).toEqual([
        expect.objectContaining({
          serverName: "local",
          type: "tools",
          status: "changed",
          itemCount: 2,
        }),
      ]);
    } finally {
      await client.close();
    }
  });
});

async function startFakeMcpOAuthServer(
  options: {
    readonly includeRevocationEndpoint?: boolean;
  } = {},
): Promise<{
  readonly url: string;
  readonly revokedTokens: readonly string[];
  readonly close: () => Promise<void>;
}> {
  const revokedTokens: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const origin = `http://${request.headers.host}`;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          ...(options.includeRevocationEndpoint === true
            ? { revocation_endpoint: `${origin}/revoke` }
            : {}),
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        }),
      );
      return;
    }
    if (url.pathname === "/register") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          client_id: "director-test-client",
          redirect_uris: [],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      );
      return;
    }
    if (url.pathname === "/revoke" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const token = form.get("token");
        if (token) {
          revokedTokens.push(token);
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const code = form.get("code") ?? "missing";
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: `access-token-${code}`,
            refresh_token: `refresh-token-${code}`,
            token_type: "Bearer",
            expires_in: 3600,
          }),
        );
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("fake OAuth server did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    get revokedTokens() {
      return revokedTokens;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startFakeMcpXaaServer(): Promise<{
  readonly mcpUrl: string;
  readonly idpUrl: string;
  readonly tokenRequests: readonly string[];
  readonly close: () => Promise<void>;
}> {
  const tokenRequests: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const origin = `http://${request.headers.host}`;
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          resource: `${origin}/mcp`,
          authorization_servers: [`${origin}/as`],
        }),
      );
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server/as") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer: `${origin}/as`,
          authorization_endpoint: `${origin}/as/authorize`,
          token_endpoint: `${origin}/as/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["urn:ietf:params:oauth:grant-type:jwt-bearer"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        }),
      );
      return;
    }
    if (url.pathname === "/idp/token" && request.method === "POST") {
      tokenRequests.push("idp");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "jwt-auth-grant",
          issued_token_type: "urn:ietf:params:oauth:token-type:id-jag",
          expires_in: 600,
        }),
      );
      return;
    }
    if (url.pathname === "/as/token" && request.method === "POST") {
      tokenRequests.push("as");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "xaa-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("fake XAA server did not bind a TCP port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    mcpUrl: `${origin}/mcp`,
    idpUrl: `${origin}/idp`,
    get tokenRequests() {
      return tokenRequests;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function waitFor(assertion: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error("Timed out waiting for condition.");
}
