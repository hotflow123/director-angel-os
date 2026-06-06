import { describe, expect, it } from "vitest";

import {
  createChannelAdapterContractReport,
  createChannelAdapterV2TemplateReport,
  createSecondChannelAdapterV2Template,
  defineChannelAdapterContract,
  defineChannelAdapterV2Template,
} from "../src/channel-adapter-contract.js";

describe("channel adapter contract", () => {
  it("accepts a Weixin-style adapter that uses the unified runtime and recoverable approvals", () => {
    const contract = defineChannelAdapterContract({
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
    });

    const report = createChannelAdapterContractReport(contract);

    expect(report.ready).toBe(true);
    expect(report.requiredMissing).toEqual([]);
    expect(report.riskLevel).toBe("low");
  });

  it("blocks a future Feishu/Telegram adapter plan when approval recovery is missing", () => {
    const contract = defineChannelAdapterContract({
      channel: "telegram",
      adapterId: "telegram-gateway",
      transport: {
        ingress: "webhook",
        supportsDirect: true,
        supportsGroups: true,
        supportsThreads: false,
        supportsAttachments: true,
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
        persistsRuntimeApprovals: false,
        routesApproveRejectBeforeChat: false,
        expiresStaleApprovals: false,
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
    });

    const report = createChannelAdapterContractReport(contract);

    expect(report.ready).toBe(false);
    expect(report.requiredMissing).toEqual([
      "approval.persistsRuntimeApprovals",
      "approval.routesApproveRejectBeforeChat",
      "approval.expiresStaleApprovals",
    ]);
    expect(report.riskLevel).toBe("high");
    expect(report.nextActions[0]).toContain("runtime.approval");
  });

  it("treats direct chat without dynamic capability context as a hard architecture miss", () => {
    const report = createChannelAdapterContractReport(
      defineChannelAdapterContract({
        channel: "feishu",
        adapterId: "feishu-gateway",
        transport: {
          ingress: "webhook",
          supportsDirect: true,
          supportsGroups: true,
          supportsThreads: true,
          supportsAttachments: true,
          supportsStreaming: true,
        },
        runtime: {
          usesUnifiedConversationRuntime: true,
          usesDynamicCapabilityContext: false,
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

    expect(report.ready).toBe(false);
    expect(report.requiredMissing).toContain("runtime.usesDynamicCapabilityContext");
    expect(report.nextActions).toContain(
      "接入动态能力上下文：已发布经验、启用 Skill、记忆和外部工具必须由运行时自动召回。",
    );
  });

  it("creates a second-channel adapter v2 template on the shared runtime contract", () => {
    const template = createSecondChannelAdapterV2Template({
      channel: "telegram",
      adapterId: "telegram-gateway-template",
      notes: ["Local template only; no live Telegram bot process is started."],
    });
    const report = createChannelAdapterV2TemplateReport(template);

    expect(template).toMatchObject({
      schemaId: "director.channel-adapter-v2-template.v1",
      templateId: "telegram-second-channel-template",
      lifecycle: "second-channel-template",
      channel: "telegram",
      adapterId: "telegram-gateway-template",
      runtimeBinding: {
        usesUnifiedConversationRuntime: true,
        usesDynamicCapabilityContext: true,
        requiresSharedToolExecutor: true,
        forbidsChannelSpecificToolSideDoor: true,
        noCredentialProfileAccessWithoutOperatorScope: true,
      },
    });
    expect(template.forbiddenSideDoors).toEqual(
      expect.arrayContaining([
        "channel-specific-tool-executor",
        "direct-child-process-runner",
        "credential-profile-access-without-operator-scope",
      ]),
    );
    expect(report.ready).toBe(true);
    expect(report.requiredMissing).toEqual([]);
    expect(report.riskLevel).toBe("low");
  });

  it("rejects channel adapter v2 templates with tool side doors", () => {
    const template = defineChannelAdapterV2Template({
      ...createSecondChannelAdapterV2Template({
        channel: "feishu",
        adapterId: "feishu-gateway-template",
      }),
      runtimeBinding: {
        usesUnifiedConversationRuntime: true,
        usesDynamicCapabilityContext: true,
        recordsOperatorTrace: true,
        emitsRuntimeEvents: true,
        resultFirstReplies: true,
        requiresSharedToolExecutor: false,
        forbidsChannelSpecificToolSideDoor: false,
        noCredentialProfileAccessWithoutOperatorScope: false,
      },
      forbiddenSideDoors: ["allowed:channel-specific-tool-executor"],
    });
    const report = createChannelAdapterV2TemplateReport(template);

    expect(report.ready).toBe(false);
    expect(report.requiredMissing).toEqual([
      "runtime.requiresSharedToolExecutor",
      "runtime.forbidsChannelSpecificToolSideDoor",
      "runtime.noCredentialProfileAccessWithoutOperatorScope",
    ]);
    expect(report.forbiddenSideDoorHits).toEqual(["allowed:channel-specific-tool-executor"]);
    expect(report.riskLevel).toBe("high");
    expect(report.nextActions).toEqual(
      expect.arrayContaining([
        "通道只能提交共享 runtime tool call，执行必须回到共享工具执行器。",
        "禁止通道 adapter 自建工具执行旁路、浏览器旁路或本地进程旁路。",
      ]),
    );
  });
});
