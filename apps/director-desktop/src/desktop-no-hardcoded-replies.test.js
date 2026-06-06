import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const adapterSources = [
  ["desktop-bridge-facade.js", new URL("./desktop-bridge-facade.js", import.meta.url)],
  ["desktop-system-handlers.js", new URL("./desktop-system-handlers.js", import.meta.url)],
  ["weixin-gateway/adapter.ts", new URL("../../weixin-gateway/src/adapter.ts", import.meta.url)],
  ["cli/shell.ts", new URL("../../cli/src/shell.ts", import.meta.url)],
];

const forbiddenAdapterReplyPatterns = [
  {
    pattern: /\blooksLikeNaturalLearningSearchQuery\b/u,
    reason: "natural learning searches must be handled by the model/tool loop, not adapter routing",
  },
  {
    pattern: /\bextractNaturalLearningSearchQuery\b/u,
    reason: "natural learning searches must be handled by the model/tool loop, not adapter routing",
  },
  {
    pattern: /\bselectLocalProductionSummary\b|\bparseAssignmentCountSummary\b/u,
    reason: "production finals must come from model/runtime output, not local summaries",
  },
  {
    pattern:
      /\bfinalText\s*=\s*[^\n;]*modelDraft\?\.message|\bproductionRun\.workbenchOutput\s*\?\?\s*productionRun\.modelDraft\?\.message/u,
    reason: "model draft status/error messages must not be promoted into runtime final text",
  },
  {
    pattern:
      /\bformatWeixinStructuredStatusReply\b|\bcreateWeixinRuntimeApprovalReply\b|\bbuildChannelRuntimeToolApprovalReply\b/u,
    reason: "channel adapters must use conversation-runtime structured renderers",
  },
  {
    pattern: /请发|请带上|请在\s*\//u,
    reason: "missing-argument guidance must be structured status, not adapter-owned prompt prose",
  },
  {
    pattern:
      /\bformatDirectorGatewayReply\b|本轮对话已记录|我先把这句话|已记住上下文|执行入口在工作台|当前板块只用于|请回到工作台/u,
    reason: "natural entry points must not expose Host API intake or context-only prose",
  },
  {
    pattern:
      /已继续推进上一版|已完成 [0-9]+\/[0-9]+|已生成 [0-9]+ 条经验候选|没有生成可入库经验候选|等待人工审查后才能沉淀/u,
    reason: "adapter-local learning/production natural summaries are forbidden",
  },
  {
    pattern: /没有待确认的工具操作|我会重新判断|已确认并执行|确认后执行失败/u,
    reason: "runtime tool approval decisions must be shared structured status, not Weixin prose",
  },
  {
    pattern:
      /\bisWeixinCapabilityHelpText\b|\brenderWeixinCapabilityHelpReply\b|\brenderWeixinGatewayStatusReply\b|\brenderWeixinLearningStatusReply\b/u,
    reason: "Weixin must not short-circuit capability, status, or learning status replies before the shared runtime",
  },
  {
    pattern:
      /\breadWeixinLearningIntentUrl\b|\bextractRepeatedWeixinLearningUrl\b|\bhandleWeixinUrlLearningArtifactFollowup\b|\blooksLikeWeixinLearningArtifactFollowUp\b/u,
    reason: "Weixin URL learning and follow-up decisions must be handled by conversation-runtime, not peer-cache heuristics",
  },
  {
    pattern:
      /\bPeerLearningArtifactState\b|\bcreateWeixinRuntimeLearningArtifactStateFromResult\b|\brenderWeixinLearningArtifactReply\b|\bcreateWeixinLearningToolObservation\b/u,
    reason: "Weixin must not project replies from peer learning shadow state; learning output must come from conversation-runtime artifacts/projections",
  },
  {
    pattern: /weixin returned local capability help|weixin returned local learning status|weixin returned local gateway status/u,
    reason: "local Weixin business replies must not bypass the shared runtime",
  },
];

describe("adapter hardcoded reply guard", () => {
  it("keeps banned conversational fallback patterns out of channel adapter sources", () => {
    const violations = [];

    for (const [name, url] of adapterSources) {
      const source = readFileSync(url, "utf8");
      for (const { pattern, reason } of forbiddenAdapterReplyPatterns) {
        const match = source.match(pattern);
        if (match) {
          violations.push(`${name}: ${reason}: ${match[0]}`);
        }
      }
    }
    const desktopFacade = readFileSync(new URL("./desktop-bridge-facade.js", import.meta.url), "utf8");
    const commandIntentStart = desktopFacade.indexOf("function commandIntent");
    const commandIntentEnd = desktopFacade.indexOf("function productionTaskIntent", commandIntentStart);
    const commandIntentSource =
      commandIntentStart === -1 || commandIntentEnd === -1
        ? ""
        : desktopFacade.slice(commandIntentStart, commandIntentEnd);
    if (/\n\s*body,\n/u.test(commandIntentSource) || commandIntentSource.includes("intent: ${body")) {
      violations.push(
        "desktop-bridge-facade.js: desktop slash command previews must render typed structured command status, not callsite prose",
      );
    }
    for (const marker of [
      'body: "Angel 会把这条输入发送到已配置的 API 供应方',
      'body: "Angel 会创建 Director 制作蓝图',
    ]) {
      if (desktopFacade.includes(marker)) {
        violations.push(
          `desktop-bridge-facade.js: desktop action fallbacks must be structured runtime state, not adapter prose: ${marker}`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
