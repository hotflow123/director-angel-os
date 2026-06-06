import type {
  ConversationRuntimeModelToolCall,
  ConversationRuntimeModelToolDefinition,
} from "./model-tool-loop.js";

export type ConversationRuntimeDefaultToolPolicy =
  | "allow-readonly-research"
  | "approval-required"
  | "deny";

const DEFAULT_RESEARCH_TOOL_NAMES = new Set([
  "tool.search",
  "web_search",
  "web_extract",
  "web_extract_artifact_read",
  "browser_navigate",
  "browser_snapshot",
  "browser_scroll",
  "browser_back",
  "browser_get_images",
  "browser_console",
]);

const DEFAULT_APPROVAL_TOOL_NAMES = new Set([
  "agent.delegate",
  "spawn_subagent",
  "director.learning.query",
  "director.learning.url",
  "director.learning.admit",
  "director.learning.media_understand",
  "director.skills.set_enabled",
  "director.mcp.server.upsert",
  "director.comfyui.create_workflow",
  "director.comfyui.run",
  "director.comfyui.lifecycle",
  "director.comfyui.install",
  "director.comfyui.fix_dependencies",
]);

export function resolveConversationRuntimeDefaultToolPolicy(input: {
  readonly call: ConversationRuntimeModelToolCall;
  readonly tool?: ConversationRuntimeModelToolDefinition;
}): ConversationRuntimeDefaultToolPolicy {
  const metadata = {
    ...(input.tool?.metadata ?? {}),
    ...(input.call.metadata ?? {}),
  };
  if (
    input.call.requiresApproval === true ||
    metadata.requiresApproval === true ||
    metadata.reviewGated === true ||
    metadata.approvalMode === "operator_approve" ||
    metadata.destructive === true
  ) {
    return "approval-required";
  }
  if (DEFAULT_APPROVAL_TOOL_NAMES.has(input.call.name)) {
    return "approval-required";
  }
  if (input.call.name === "run_subagent" && metadata.syncSubagent === true) {
    return "allow-readonly-research";
  }

  const capability = typeof metadata.capability === "string" ? metadata.capability.trim() : "";
  const source = typeof metadata.source === "string" ? metadata.source.trim() : "";
  const isReadOnly = input.call.readOnly ?? input.tool?.readOnly ?? false;
  if (
    DEFAULT_RESEARCH_TOOL_NAMES.has(input.call.name) ||
    capability === "web.search" ||
    capability === "web.extract" ||
    capability === "web.extract.artifact.read" ||
    capability === "browser.navigate" ||
    capability === "browser.snapshot" ||
    capability === "browser.scroll" ||
    capability === "browser.back" ||
    capability === "browser.images" ||
    capability === "browser.console"
  ) {
    return "allow-readonly-research";
  }
  if (source === "mcp" && isReadOnly) {
    return "allow-readonly-research";
  }
  return isReadOnly ? "allow-readonly-research" : "approval-required";
}

export function renderConversationRuntimeDefaultToolPolicySummary(): string {
  return [
    "默认工具策略：普通互联网查资料、搜索、读取网页、读取浏览器快照、只读 MCP 工具默认允许直接调用。",
    "子代理委托、写入经验库、生成待审经验候选、发布/启停 Skill、安装/更新 MCP、ComfyUI 执行/安装/启停等会改变系统状态的动作必须先确认。",
    "用户只说“查资料/搜索/看看网页”时，优先用 web_search、web_extract 或只读浏览器工具；只有用户明确要求“学习沉淀/收录为经验/发布/安装/执行”时才进入审查链路。",
  ].join("\n");
}
