import { describe, expect, it } from "vitest";

import {
  buildMcpToolName,
  createAsyncConversationRuntimeToolRegistry,
  createConversationRuntimeToolRegistry,
  createDirectorConversationRuntimeToolRegistry,
  createDirectorConversationRuntimeTools,
  createMcpToolExecutor,
  createToolSearchTool,
  parseMcpToolName,
  searchConversationRuntimeTools,
} from "../src/index.js";

describe("createConversationRuntimeToolRegistry", () => {
  it("exposes Claude Code style built-in web_search beside legacy Director tools", () => {
    const registry = createDirectorConversationRuntimeToolRegistry();
    const tools = registry.listModelTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain("web_search");
    expect(toolNames).toContain("web_extract");
    expect(toolNames).toContain("web_extract_artifact_read");
    expect(toolNames).toContain("browser_navigate");
    expect(toolNames).toContain("browser_snapshot");
    expect(toolNames).toContain("browser_click");
    expect(toolNames).toContain("browser_type");
    expect(toolNames).toContain("browser_scroll");
    expect(toolNames).toContain("browser_get_images");
    expect(toolNames).toContain("tool.search");
    expect(toolNames).toContain("director.learning.query");
    expect(toolNames).toContain("director.learning.url");
    expect(toolNames).toContain("director.learning.admit");
    expect(toolNames).toContain("director.learning.media_understand");
    expect(toolNames).toContain("agent.delegate");
    expect(toolNames).toContain("run_subagent");
    expect(toolNames).toContain("spawn_subagent");
    expect(new Set(toolNames).size).toBe(toolNames.length);
    expect(tools.find((tool) => tool.name === "web_search")).toMatchObject({
      name: "web_search",
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "web.search",
        source: "built-in",
      }),
    });
    expect(tools.find((tool) => tool.name === "web_extract")).toMatchObject({
      name: "web_extract",
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "web.extract",
        source: "built-in",
      }),
    });
    expect(tools.find((tool) => tool.name === "web_extract_artifact_read")).toMatchObject({
      name: "web_extract_artifact_read",
      readOnly: true,
      metadata: expect.objectContaining({
        capability: "web.extract.artifact.read",
        source: "built-in",
      }),
    });
    expect(tools.find((tool) => tool.name === "browser_navigate")).toMatchObject({
      name: "browser_navigate",
      readOnly: false,
      metadata: expect.objectContaining({
        capability: "browser.navigate",
        source: "built-in",
      }),
    });
    expect(tools.find((tool) => tool.name === "agent.delegate")).toMatchObject({
      name: "agent.delegate",
      readOnly: false,
      metadata: expect.objectContaining({
        agentTool: true,
        capability: "agent.subagent.delegate",
        taskBacked: true,
        reviewGated: true,
      }),
    });
    expect(tools.find((tool) => tool.name === "run_subagent")).toMatchObject({
      name: "run_subagent",
      readOnly: false,
      metadata: expect.objectContaining({
        agentTool: true,
        syncSubagent: true,
        capability: "agent.subagent.run",
      }),
    });
    expect(tools.find((tool) => tool.name === "spawn_subagent")).toMatchObject({
      name: "spawn_subagent",
      readOnly: false,
      metadata: expect.objectContaining({
        agentTool: true,
        asyncSubagent: true,
        capability: "agent.subagent.spawn",
        taskBacked: true,
      }),
    });
  });

  it("keeps the compatibility tool helper backed by the same registry", () => {
    const tools = createDirectorConversationRuntimeTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "web_search",
        "web_extract",
        "web_extract_artifact_read",
        "browser_navigate",
        "browser_snapshot",
        "tool.search",
        "director.learning.query",
        "director.learning.admit",
        "director.learning.media_understand",
        "director.experience.candidates.list",
        "agent.delegate",
        "run_subagent",
        "spawn_subagent",
      ]),
    );
  });

  it("copies Claude Code MCP naming and merges discovered tools after built-ins", async () => {
    const registry = createAsyncConversationRuntimeToolRegistry({
      builtinTools: [
        {
          name: "web_search",
          description: "Search the web.",
          readOnly: true,
          metadata: { source: "built-in" },
        },
      ],
      mcpToolProvider: {
        listTools: () => [
          {
            serverName: "exa.search",
            toolName: "web search",
            description: "  Neural\nsearch  ",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
            readOnly: true,
          },
          {
            serverName: "mutator",
            toolName: "publish",
            description: "Publish a record.",
            destructive: true,
          },
          {
            serverName: "disabled",
            toolName: "echo",
            enabled: false,
          },
        ],
      },
    });

    const tools = await registry.listModelTools();
    const toolNames = tools.map((tool) => tool.name);

    expect(buildMcpToolName("exa.search", "web search")).toBe("mcp__exa_search__web_search");
    expect(parseMcpToolName("mcp__exa_search__web_search")).toEqual({
      serverName: "exa_search",
      toolName: "web_search",
    });
    expect(toolNames).toEqual([
      "web_search",
      "mcp__exa_search__web_search",
      "mcp__mutator__publish",
    ]);
    expect(tools.find((tool) => tool.name === "mcp__exa_search__web_search")).toMatchObject({
      readOnly: true,
      metadata: expect.objectContaining({
        source: "mcp",
        capability: "mcp.tool",
        serverName: "exa.search",
        toolName: "web search",
        fullyQualifiedName: "mcp__exa_search__web_search",
        requiresApproval: false,
      }),
    });
    expect(tools.find((tool) => tool.name === "mcp__mutator__publish")).toMatchObject({
      readOnly: false,
      metadata: expect.objectContaining({
        requiresApproval: true,
        destructive: true,
      }),
    });
  });

  it("executes MCP calls through the shared executor port and reports unavailable state", async () => {
    const unavailableExecutor = createMcpToolExecutor();
    await expect(
      unavailableExecutor({
        turnId: "turn-1",
        sessionKey: "session-1",
        call: {
          id: "call-1",
          name: "mcp__exa__search",
          args: { query: "Director Angel" },
        },
      }),
    ).resolves.toMatchObject({
      callId: "call-1",
      toolName: "mcp__exa__search",
      ok: false,
      error: "mcp-executor-unavailable",
      metadata: expect.objectContaining({ source: "mcp" }),
    });

    const executor = createMcpToolExecutor(async (input) => ({
      ok: true,
      content: `${input.serverName}/${input.toolName}: ${input.args.query}`,
      output: { serverName: input.serverName, toolName: input.toolName },
    }));
    await expect(
      executor({
        turnId: "turn-1",
        sessionKey: "session-1",
        call: {
          id: "call-2",
          name: "mcp__exa__search",
          args: { query: "Director Angel" },
        },
      }),
    ).resolves.toMatchObject({
      callId: "call-2",
      toolName: "mcp__exa__search",
      ok: true,
      content: "exa/search: Director Angel",
      output: { serverName: "exa", toolName: "search" },
    });
  });

  it("uses original MCP server and tool names from metadata when invoking normalized tool names", async () => {
    const executor = createMcpToolExecutor(async (input) => ({
      ok: true,
      content: `${input.serverName}/${input.toolName}`,
    }));

    await expect(
      executor({
        turnId: "turn-1",
        sessionKey: "session-1",
        call: {
          id: "call-3",
          name: "mcp__exa_search__web_search",
          args: {},
          metadata: {
            serverName: "exa.search",
            toolName: "web search",
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      content: "exa.search/web search",
    });
  });

  it("searches tools by name, capability, and MCP server metadata", () => {
    const matches = searchConversationRuntimeTools({
      query: "browser image",
      tools: [
        createToolSearchTool(),
        {
          name: "browser_get_images",
          description: "Extract images from the current browser page.",
          readOnly: true,
          metadata: { capability: "browser.images", source: "built-in" },
        },
        {
          name: "mcp__comfyui__queue_prompt",
          description: "Submit a ComfyUI workflow prompt.",
          readOnly: false,
          metadata: {
            source: "mcp",
            serverName: "comfyui",
            toolName: "queue_prompt",
            capability: "mcp.tool",
          },
        },
        {
          name: "director.knowledge.recall",
          description: "Recall published experience.",
          readOnly: true,
          metadata: { capability: "knowledge.recall" },
        },
      ],
      maxResults: 3,
    });

    expect(matches.map((match) => match.name)).toEqual([
      "browser_get_images",
      "mcp__comfyui__queue_prompt",
    ]);
    expect(matches[0]).toMatchObject({
      score: expect.any(Number),
      reason: expect.stringContaining("browser"),
    });
  });
});
