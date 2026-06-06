import { describe, expect, it } from "vitest";

import {
  createAgentToolDelegationEnvelope,
  createParentVisibleSubagentResult,
  isAgentOsMemoryEvidence,
  isAgentOsSkillToolContract,
  isAgentOsSubagentProfile,
  isAgentOsToolProjection,
  subagentScopeDoesNotEscalate,
} from "../src/index.js";

describe("agent os kernel safety and context contracts", () => {
  it("validates tool projection after policy and sandbox filtering", () => {
    expect(
      isAgentOsToolProjection({
        toolName: "web.search",
        visibility: "model-visible",
        readOnly: true,
        providerId: "builtin-web",
        policyVerdict: {
          verdict: "allow",
          reason: "read-only web search",
          decidedAt: "2026-05-08T09:00:00.000Z",
        },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "network-limited",
          checkedAt: "2026-05-08T09:00:00.000Z",
        },
      }),
    ).toBe(true);

    expect(
      isAgentOsToolProjection({
        toolName: "terminal.exec",
        visibility: "hidden",
        readOnly: false,
        providerId: "unknown-terminal",
        policyVerdict: {
          verdict: "blocked",
          reason: "unknown execution provider is fail-closed",
          decidedAt: "2026-05-08T09:00:00.000Z",
        },
        sandboxPreflight: {
          verdict: "blocked",
          sandboxMode: "disabled",
          checkedAt: "2026-05-08T09:00:00.000Z",
        },
        hiddenReason: "sandbox preflight blocked execution",
      }),
    ).toBe(true);
  });

  it("validates SkillTool setup and missing-tool context before model use", () => {
    expect(
      isAgentOsSkillToolContract({
        skillId: "mempalace.recall",
        skillVersion: "0.1.0",
        lifecycle: "needs-setup",
        modelVisible: false,
        needsSetup: true,
        requiredTools: ["mcp.mempalace.search"],
        missingTools: ["mcp.mempalace.search"],
        permissionVerdict: {
          verdict: "needs_setup",
          reason: "MemPalace MCP search is not configured",
          decidedAt: "2026-05-08T09:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("validates memory evidence with verbatim drawer and provenance", () => {
    expect(
      isAgentOsMemoryEvidence({
        evidenceId: "mem-1",
        layer: "L2",
        backend: "mempalace",
        retrievalEngine: "hybrid",
        matchMode: "semantic",
        citation: "drawer:mempalace/project/director-angel#chunk-12",
        verbatim: "User prefers local-only memory unless explicitly opted in.",
        provenance: {
          sourceId: "conversation-42",
          sourceKind: "conversation",
          recordedAt: "2026-05-07T08:00:00.000Z",
          localOnly: true,
        },
      }),
    ).toBe(true);
  });

  it("prevents subagents from escalating permissions, workspace, memory, or tools", () => {
    const parent = {
      subagentId: "parent",
      parentTurnId: "turn-1",
      profileId: "operator",
      permissions: ["chat:reply", "workspace:write"],
      tools: ["web.search", "file.patch"],
      writableRoots: ["/repo"],
      memoryLayers: ["L0", "L1", "L2"],
      maxTurns: 4,
    } as const;

    expect(
      subagentScopeDoesNotEscalate(parent, {
        subagentId: "child-safe",
        parentTurnId: "turn-1",
        profileId: "reviewer",
        permissions: ["chat:reply"],
        tools: ["web.search"],
        writableRoots: [],
        memoryLayers: ["L0", "L1"],
        maxTurns: 2,
      }),
    ).toBe(true);

    expect(
      subagentScopeDoesNotEscalate(parent, {
        subagentId: "child-unsafe",
        parentTurnId: "turn-1",
        profileId: "runner",
        permissions: ["chat:reply", "secrets:read"],
        tools: ["web.search", "terminal.exec"],
        writableRoots: ["/repo", "/tmp"],
        memoryLayers: ["L0", "L1", "L2", "L3"],
        maxTurns: 8,
      }),
    ).toBe(false);
  });

  it("creates bounded AgentTool delegation envelopes and parent-visible results", () => {
    const parent = {
      subagentId: "parent",
      parentTurnId: "turn-1",
      profileId: "operator",
      permissions: ["chat:reply", "workspace:write"],
      tools: ["web.search", "file.patch"],
      writableRoots: ["/repo"],
      memoryLayers: ["L0", "L1", "L2"],
      maxTurns: 5,
    } as const;
    const profile = {
      profileId: "reviewer",
      role: "reviewer",
      instructions: "Review a bounded implementation slice.",
      permissions: ["chat:reply"],
      tools: ["web.search"],
      writableRoots: [],
      memoryLayers: ["L0", "L1"],
      maxTurns: 2,
      budget: {
        maxModelCalls: 1,
        maxToolCalls: 2,
      },
    } as const;

    expect(isAgentOsSubagentProfile(profile)).toBe(true);

    const envelope = createAgentToolDelegationEnvelope({
      parent,
      profile,
      request: {
        requestId: "delegate-1",
        parentTurnId: "turn-1",
        task: "Review the task projection contract.",
        expectedOutput: "A concise pass/fail summary.",
        allowedTools: ["web.search"],
        allowedPermissions: ["chat:reply"],
        writableRoots: [],
        memoryLayers: ["L0"],
        maxTurns: 1,
        artifactsRequested: ["summary.md"],
      },
      now: "2026-05-09T10:00:00.000Z",
    });

    expect(envelope).toMatchObject({
      subagentId: "subagent_delegate-1",
      parentTurnId: "turn-1",
      profileId: "reviewer",
      delegationRequestId: "delegate-1",
      isolatedContext: true,
      permissions: ["chat:reply"],
      tools: ["web.search"],
      writableRoots: [],
      memoryLayers: ["L0"],
      maxTurns: 1,
      status: "queued",
      createdAt: "2026-05-09T10:00:00.000Z",
    });
    expect(subagentScopeDoesNotEscalate(parent, envelope)).toBe(true);

    expect(() =>
      createAgentToolDelegationEnvelope({
        parent,
        profile,
        request: {
          requestId: "delegate-unsafe",
          parentTurnId: "turn-1",
          task: "Write outside the parent scope.",
          expectedOutput: "Patch",
          allowedTools: ["terminal.exec"],
          allowedPermissions: ["secrets:read"],
          writableRoots: ["/tmp"],
          memoryLayers: ["L3"],
          maxTurns: 8,
        },
        now: "2026-05-09T10:00:00.000Z",
      }),
    ).toThrow("Subagent scope escalation blocked");

    const parentVisible = createParentVisibleSubagentResult({
      envelope,
      status: "completed",
      summary: "Reviewed projection contract and found no blockers.",
      artifacts: [
        {
          artifactId: "artifact-summary",
          kind: "markdown",
          label: "Review summary",
          uri: "session://turn-1/subagent_delegate-1/summary.md",
          parentVisible: true,
        },
        {
          artifactId: "artifact-private",
          kind: "trace",
          label: "Internal scratchpad",
          uri: "session://turn-1/subagent_delegate-1/private.trace",
          parentVisible: false,
        },
      ],
      completedAt: "2026-05-09T10:02:00.000Z",
    });

    expect(parentVisible).toEqual({
      subagentId: "subagent_delegate-1",
      parentTurnId: "turn-1",
      delegationRequestId: "delegate-1",
      profileId: "reviewer",
      status: "completed",
      summary: "Reviewed projection contract and found no blockers.",
      artifacts: [
        {
          artifactId: "artifact-summary",
          kind: "markdown",
          label: "Review summary",
          uri: "session://turn-1/subagent_delegate-1/summary.md",
          parentVisible: true,
        },
      ],
      completedAt: "2026-05-09T10:02:00.000Z",
    });
  });
});
