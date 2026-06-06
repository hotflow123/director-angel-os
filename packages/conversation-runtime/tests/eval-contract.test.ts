import { describe, expect, it } from "vitest";

import {
  type ConversationRuntimeResult,
  assertConversationRuntimeContract,
  evaluateConversationRuntimeContract,
} from "../src/index.js";

function result(overrides: Partial<ConversationRuntimeResult> = {}): ConversationRuntimeResult {
  return {
    turnId: "turn-1",
    sessionKey: "session-1",
    replySource: "tool-loop",
    events: [],
    finalText: "已基于工具观察回答。",
    capabilityPacket: {
      status: "hit",
      hits: [
        { id: "knowledge:wechat-route", source: "knowledge", status: "hit" },
        { id: "skill:comfyui", source: "skill", status: "hit" },
        { id: "memory:style", source: "memory", status: "used" },
      ],
    },
    operatorTrace: {
      items: [
        { source: "capability", stage: "capability.resolved", detail: "Resolved." },
        {
          source: "tool",
          stage: "tool.required",
          detail: "Runtime required grounding.",
          metadata: { toolName: "web_search", capability: "web.search" },
        },
        {
          source: "tool",
          stage: "tool.requested",
          detail: "Model requested Skill view.",
          metadata: { toolName: "director.skills.view", capability: "skill.view" },
        },
        {
          source: "tool",
          stage: "tool.completed",
          detail: "Skill view observation was returned.",
          metadata: { toolName: "director.skills.view", capability: "skill.view", ok: true },
        },
        {
          source: "model",
          stage: "model.loop.completed",
          detail: "Model/tool loop completed.",
        },
        {
          source: "model",
          stage: "model.repair.accepted",
          detail: "Accepted grounded repair.",
        },
      ],
    },
    ...overrides,
  };
}

describe("conversation runtime eval contract", () => {
  it("passes only when the required recall, tool, skill, memory and model-loop signals are present", () => {
    const report = assertConversationRuntimeContract(result(), {
      id: "desktop-weixin-source-search-contract",
      requirements: [
        { signal: "capability-resolved" },
        { signal: "knowledge-hit" },
        { signal: "memory-hit" },
        { signal: "skill-hit" },
        { signal: "tool-required", toolName: "web_search", capability: "web.search" },
        { signal: "skill-view" },
        { signal: "model-loop" },
        { signal: "grounded-repair" },
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.metrics).toEqual(
      expect.arrayContaining([
        { signal: "tool-required", count: 1 },
        { signal: "skill-view", count: 1 },
        { signal: "memory-hit", count: 1 },
      ]),
    );
  });

  it("fails loudly when a reply looks successful but skipped the tool loop", () => {
    const report = evaluateConversationRuntimeContract(
      result({
        replySource: "model",
        operatorTrace: {
          items: [{ source: "capability", stage: "capability.resolved", detail: "Resolved." }],
        },
      }),
      {
        id: "no-fake-search",
        requirements: [
          { signal: "tool-required", toolName: "web_search", capability: "web.search" },
          { signal: "model-loop" },
        ],
      },
    );

    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([
      expect.objectContaining({
        signal: "tool-required",
        expected: 1,
        actual: 0,
      }),
      expect.objectContaining({
        signal: "model-loop",
        expected: 1,
        actual: 0,
      }),
    ]);
  });

  it("does not count a Skill request as Skill use until a tool observation exists", () => {
    const report = evaluateConversationRuntimeContract(
      result({
        operatorTrace: {
          items: [
            {
              source: "tool",
              stage: "tool.requested",
              detail: "Model requested Skill view.",
              metadata: { toolName: "director.skills.view", capability: "skill.view" },
            },
            {
              source: "model",
              stage: "model.loop.completed",
              detail: "Model/tool loop completed.",
            },
          ],
        },
      }),
      {
        id: "skill-view-needs-observation",
        requirements: [{ signal: "skill-view" }],
      },
    );

    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([
      expect.objectContaining({
        signal: "skill-view",
        expected: 1,
        actual: 0,
      }),
    ]);
  });
});
