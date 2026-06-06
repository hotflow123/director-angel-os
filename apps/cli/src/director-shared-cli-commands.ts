import { parseChannelSlashCommand } from "@hotflow/channels-core";

type DirectorCliSharedCommandMappingKind = "argv";

type DirectorCliSharedCommandArgMode =
  | { readonly type: "none" }
  | { readonly type: "all"; readonly flag?: string; readonly required?: boolean }
  | {
      readonly type: "text-prefixed";
      readonly flag: string;
      readonly prefix: string;
      readonly required?: boolean;
    }
  | { readonly type: "learn-auto" }
  | { readonly type: "first"; readonly flag: string; readonly required?: boolean }
  | {
      readonly type: "first-and-rest";
      readonly firstFlag: string;
      readonly restFlag: string;
      readonly required?: boolean;
    }
  | {
      readonly type: "two";
      readonly firstFlag: string;
      readonly secondFlag: string;
      readonly required?: boolean;
    }
  | {
      readonly type: "first-second-rest";
      readonly firstFlag: string;
      readonly secondFlag: string;
      readonly restFlag: string;
      readonly required?: boolean;
    }
  | {
      readonly type: "first-rest-many";
      readonly firstFlag: string;
      readonly restFlag: string;
      readonly required?: boolean;
    }
  | { readonly type: "provider-setting" };

export interface DirectorCliSharedCommandMapping {
  readonly commandId: string;
  readonly kind: DirectorCliSharedCommandMappingKind;
  readonly argv?: readonly string[];
  readonly argMode?: DirectorCliSharedCommandArgMode;
  readonly note: string;
}

const DIRECTOR_CLI_SHARED_COMMAND_MAPPINGS: readonly DirectorCliSharedCommandMapping[] = [
  argv(
    "production.start",
    ["message"],
    textPrefixed("--text", "/制作 ", true),
    "制作任务走 Host API entry session。",
  ),
  argv(
    "media.comfyui.run",
    ["message"],
    textPrefixed("--text", "/ComfyUI ", true),
    "ComfyUI 运行走 Host API entry session。",
  ),
  argv(
    "learning.admit",
    ["knowledge", "learn"],
    learnAuto(),
    "按输入自动选择 URL、目录或主题学习。",
  ),
  argv("learning.directory", ["knowledge", "learn"], all("--directory", true), "从目录学习。"),
  argv("learning.url", ["knowledge", "learn"], all("--url", true), "从 URL 学习。"),
  argv("learning.query", ["knowledge", "learn"], all("--query", true), "从主题学习。"),
  argv("experience.list", ["knowledge", "experience-list"], none(), "列出经验候选。"),
  argv(
    "experience.view",
    ["knowledge", "experience-explain"],
    first("--candidate-id", true),
    "查看经验候选详情。",
  ),
  argv(
    "experience.accept",
    ["knowledge", "experience-accept"],
    firstAndRest("--candidate-id", "--note", true),
    "接受经验候选。",
  ),
  argv(
    "experience.reject",
    ["knowledge", "experience-reject"],
    firstAndRest("--candidate-id", "--note", true),
    "拒绝经验候选。",
  ),
  argv(
    "experience.promote",
    ["knowledge", "experience-promote"],
    firstAndRest("--candidate-id", "--note", true),
    "晋升经验候选。",
  ),
  argv(
    "experience.classify",
    ["knowledge", "experience-classify"],
    firstSecondRest("--candidate-id", "--category-id", "--tag-id", true),
    "保存经验分类和可选标签到经验 taxonomy。",
  ),
  argv(
    "experience.tag",
    ["knowledge", "experience-tag"],
    firstRestMany("--candidate-id", "--tag-id", true),
    "保存经验标签到经验 taxonomy，并保留原分类。",
  ),
  argv("experience.fromRunReport", ["reflect"], first("--run-id", true), "从运行复盘沉淀经验。"),
  argv(
    "experience.fromTraceProposal",
    ["knowledge", "experience-from-trace-proposal"],
    first("--proposal-id", true),
    "从 trace proposal 生成 review-gated 经验候选。",
  ),
  argv("knowledge.candidates", ["knowledge", "candidate-list"], none(), "列出知识候选。"),
  argv(
    "knowledge.accept",
    ["knowledge", "accept"],
    firstAndRest("--pack-id", "--note", true),
    "接受知识候选。",
  ),
  argv(
    "knowledge.reject",
    ["knowledge", "reject"],
    firstAndRest("--pack-id", "--note", true),
    "拒绝知识候选。",
  ),
  argv(
    "knowledge.publish",
    ["knowledge", "publish"],
    firstAndRest("--pack-id", "--note", true),
    "发布知识候选。",
  ),
  argv(
    "knowledge.recallPreview",
    ["knowledge", "recall-preview"],
    all("--project-id", true),
    "预览知识召回；简单参数作为 projectId。",
  ),
  argv("knowledge.explain", ["knowledge", "explain"], first("--pack-id", true), "解释知识包。"),
  argv("knowledge.diff", ["knowledge", "diff"], first("--pack-id", true), "查看知识候选差异。"),
  argv(
    "knowledge.rollback",
    ["knowledge", "rollback"],
    firstAndRest("--pack-id", "--version", true),
    "回滚知识包。",
  ),
  argv("skills.list", ["skills", "list"], none(), "列出 approved Skill 和待审 Skill proposal。"),
  argv(
    "skills.proposeFromExperience",
    ["skills", "propose-from-experience"],
    first("--candidate-id", true),
    "从已接受经验生成 review-gated Skill proposal。",
  ),
  argv(
    "skills.accept",
    ["skills", "accept"],
    firstAndRest("--proposal-id", "--note", true),
    "接受本地 Skill proposal。",
  ),
  argv(
    "skills.reject",
    ["skills", "reject"],
    firstAndRest("--proposal-id", "--note", true),
    "拒绝本地 Skill proposal。",
  ),
  argv(
    "skills.apply",
    ["skills", "apply"],
    first("--proposal-id", true),
    "把已接受 Skill proposal 安全应用到 approved snapshot。",
  ),
  argv(
    "skills.classify",
    ["skills", "classify"],
    firstSecondRest("--skill-id", "--category-id", "--tag-id", true),
    "保存 Skill 分类和可选标签到 Skill taxonomy。",
  ),
  argv(
    "skills.tag",
    ["skills", "tag"],
    firstRestMany("--skill-id", "--tag-id", true),
    "保存 Skill 标签到 Skill taxonomy，并保留原分类。",
  ),
  argv("tools.list", ["adapters", "list"], none(), "列出外部工具/适配器。"),
  argv(
    "tools.register",
    ["adapters", "register"],
    all("--manifest", true),
    "注册外部工具 manifest。",
  ),
  argv("tools.enable", ["adapters", "enable"], first("--adapter-id", true), "启用外部工具。"),
  argv("tools.disable", ["adapters", "disable"], first("--adapter-id", true), "停用外部工具。"),
  argv(
    "tools.capabilities",
    ["adapters", "explain"],
    first("--adapter-id", true),
    "查看工具能力和边界。",
  ),
  argv(
    "run.confirm",
    ["message"],
    textPrefixed("--text", "确认执行"),
    "确认执行走同一 Host API entry session，默认使用 CLI peer 上下文。",
  ),
  argv("run.status", ["run", "status"], first("--run-id", true), "查看运行状态。"),
  argv("run.start", ["run", "start"], first("--run-id", true), "启动运行。"),
  argv("run.once", ["run", "once"], first("--run-id"), "执行一次运行 worker。"),
  argv(
    "run.continue",
    ["message"],
    textPrefixed("--text", "继续运行"),
    "继续运行走同一 Host API entry session，默认使用 CLI peer 上下文。",
  ),
  argv("run.pause", ["run", "pause"], first("--run-id", true), "暂停运行。"),
  argv("run.resume", ["run", "resume"], first("--run-id", true), "恢复运行。"),
  argv("run.abort", ["run", "abort"], first("--run-id", true), "终止运行。"),
  argv("run.report", ["run", "report"], first("--run-id", true), "查看运行报告。"),
  argv("run.explain", ["run", "explain"], first("--run-id", true), "解释运行。"),
  argv("run.audit", ["run", "audit"], first("--run-id", true), "审计运行。"),
  argv("run.retry", ["run", "retry"], two("--run-id", "--assignment-id", true), "重试运行项。"),
  argv("run.approve", ["run", "approve"], two("--run-id", "--assignment-id", true), "批准运行项。"),
  argv(
    "run.approvePending",
    ["message"],
    textPrefixed("--text", "批准待审项"),
    "批量批准走同一 Host API entry session，默认使用 CLI peer 上下文。",
  ),
  argv(
    "run.reroute",
    ["run", "reroute"],
    two("--run-id", "--assignment-id", true),
    "重路由运行项；adapterId 仍需使用完整 CLI 传入。",
  ),
  argv("run.reflect", ["reflect"], first("--run-id", true), "对运行做复盘反思。"),
  argv("run.review", ["run", "report"], first("--run-id", true), "查看运行审查材料。"),
  argv("settings.providers", ["api-providers", "list"], none(), "列出本地 API 供应方配置。"),
  argv(
    "settings.provider.set",
    ["api-providers", "set"],
    providerSetting(),
    "写入本地 API 供应方配置。",
  ),
  argv(
    "settings.provider.test",
    ["api-providers", "test"],
    firstAndRest("--provider-id", "--api-key", true),
    "测试 API 供应方连接。",
  ),
  argv(
    "settings.textModel",
    ["api-providers", "set", "--key", "defaultTextModel"],
    firstAndRest("--provider-id", "--value", true),
    "设置默认文本模型。",
  ),
  argv(
    "settings.imageModel",
    ["api-providers", "set", "--key", "defaultImageModel"],
    firstAndRest("--provider-id", "--value", true),
    "设置默认图片模型。",
  ),
  argv("settings.switches", ["switches", "show"], none(), "查看功能开关。"),
  argv("settings.doctor", ["doctor"], none(), "运行设置诊断。"),
  argv("workspace.status", ["status"], none(), "查看工作区状态。"),
  argv("workspace.settings", ["switches", "show"], none(), "查看本地设置概览。"),
  argv("memory.status", ["memory", "status"], none(), "查看记忆状态。"),
  argv(
    "memory.recallPreview",
    ["memory", "recall-preview"],
    all("--project-id", true),
    "预览记忆召回；简单参数作为 projectId。",
  ),
  argv(
    "maintenance.preview",
    ["message"],
    textPrefixed("--text", "/维护"),
    "维护预览走同一 Host API entry session。",
  ),
  argv(
    "maintenance.apply",
    ["message"],
    textPrefixed("--text", "/维护 执行"),
    "执行维护走同一 Host API entry session。",
  ),
  argv("heartbeat.status", ["heartbeat", "latest"], none(), "查看最新心跳快照。"),
  argv("selfReflection.daily", ["self-reflect", "daily"], all("--date"), "生成每日自省报告。"),
  argv(
    "heartbeat.start",
    ["switches", "set", "--feature", "heartbeat.enabled", "--enabled", "true"],
    none(),
    "启动心跳功能开关。",
  ),
  argv(
    "heartbeat.stop",
    ["switches", "set", "--feature", "heartbeat.enabled", "--enabled", "false"],
    none(),
    "停止心跳功能开关。",
  ),
  argv("soul.status", ["soul", "view"], none(), "读取本地 SOUL 文档。"),
  argv("soul.view", ["soul", "view"], none(), "查看本地 SOUL 文档全文。"),
];

export function getDirectorCliSharedCommandMappings(): readonly DirectorCliSharedCommandMapping[] {
  return DIRECTOR_CLI_SHARED_COMMAND_MAPPINGS;
}

export function resolveDirectorCliSharedCommandArgs(text: string): readonly string[] | null {
  const command = parseChannelSlashCommand(text);
  if (command === null) {
    return null;
  }
  const mapping = DIRECTOR_CLI_SHARED_COMMAND_MAPPINGS.find(
    (candidate) => candidate.commandId === command.commandId,
  );
  if (mapping?.kind !== "argv" || mapping.argv === undefined) {
    return null;
  }
  const extraArgs = applyArgMode(mapping.argMode ?? none(), command.args);
  if (extraArgs === null) {
    return null;
  }
  return [...mapping.argv, ...extraArgs];
}

function argv(
  commandId: string,
  baseArgv: readonly string[],
  argMode: DirectorCliSharedCommandArgMode,
  note: string,
): DirectorCliSharedCommandMapping {
  return { commandId, kind: "argv", argv: [...baseArgv], argMode, note };
}

function none(): DirectorCliSharedCommandArgMode {
  return { type: "none" };
}

function all(flag?: string, required = false): DirectorCliSharedCommandArgMode {
  return flag === undefined ? { type: "all", required } : { type: "all", flag, required };
}

function textPrefixed(
  flag: string,
  prefix: string,
  required = false,
): DirectorCliSharedCommandArgMode {
  return { type: "text-prefixed", flag, prefix, required };
}

function learnAuto(): DirectorCliSharedCommandArgMode {
  return { type: "learn-auto" };
}

function first(flag: string, required = false): DirectorCliSharedCommandArgMode {
  return { type: "first", flag, required };
}

function firstAndRest(
  firstFlag: string,
  restFlag: string,
  required = false,
): DirectorCliSharedCommandArgMode {
  return { type: "first-and-rest", firstFlag, restFlag, required };
}

function two(
  firstFlag: string,
  secondFlag: string,
  required = false,
): DirectorCliSharedCommandArgMode {
  return { type: "two", firstFlag, secondFlag, required };
}

function firstSecondRest(
  firstFlag: string,
  secondFlag: string,
  restFlag: string,
  required = false,
): DirectorCliSharedCommandArgMode {
  return { type: "first-second-rest", firstFlag, secondFlag, restFlag, required };
}

function firstRestMany(
  firstFlag: string,
  restFlag: string,
  required = false,
): DirectorCliSharedCommandArgMode {
  return { type: "first-rest-many", firstFlag, restFlag, required };
}

function providerSetting(): DirectorCliSharedCommandArgMode {
  return { type: "provider-setting" };
}

function applyArgMode(
  mode: DirectorCliSharedCommandArgMode,
  rawArgs: string,
): readonly string[] | null {
  const args = rawArgs.trim();
  const tokens = tokenizeSharedCommandArgs(args);
  switch (mode.type) {
    case "none":
      return [];
    case "all":
      if (args.length === 0) {
        return mode.required === true ? null : [];
      }
      return mode.flag === undefined ? [args] : [mode.flag, args];
    case "text-prefixed":
      if (args.length === 0 && mode.required === true) {
        return null;
      }
      if (args.length === 0) {
        return [mode.flag, mode.prefix.trim()];
      }
      return [
        mode.flag,
        mode.prefix.endsWith(" ") ? `${mode.prefix}${args}`.trim() : `${mode.prefix} ${args}`,
      ];
    case "learn-auto":
      if (args.length === 0) {
        return null;
      }
      return [inferLearningFlag(args), args];
    case "first": {
      const firstToken = tokens[0];
      if (firstToken === undefined) {
        return mode.required === true ? null : [];
      }
      return [mode.flag, firstToken];
    }
    case "first-and-rest": {
      const firstToken = tokens[0];
      if (firstToken === undefined) {
        return mode.required === true ? null : [];
      }
      const rest = tokens.slice(1).join(" ").trim();
      return rest.length === 0
        ? [mode.firstFlag, firstToken]
        : [mode.firstFlag, firstToken, mode.restFlag, rest];
    }
    case "two": {
      const [firstToken, secondToken] = tokens;
      if (firstToken === undefined || secondToken === undefined) {
        return mode.required === true ? null : [];
      }
      return [mode.firstFlag, firstToken, mode.secondFlag, secondToken];
    }
    case "first-second-rest": {
      const [firstToken, secondToken, ...restTokens] = tokens;
      if (firstToken === undefined || secondToken === undefined) {
        return mode.required === true ? null : [];
      }
      return [
        mode.firstFlag,
        firstToken,
        mode.secondFlag,
        secondToken,
        ...flatMapFlagValues(mode.restFlag, restTokens),
      ];
    }
    case "first-rest-many": {
      const [firstToken, ...restTokens] = tokens;
      if (firstToken === undefined || restTokens.length === 0) {
        return mode.required === true ? null : [];
      }
      return [mode.firstFlag, firstToken, ...flatMapFlagValues(mode.restFlag, restTokens)];
    }
    case "provider-setting": {
      const [providerId, key, ...valueTokens] = tokens;
      const value = valueTokens.join(" ").trim();
      if (providerId === undefined || key === undefined || value.length === 0) {
        return null;
      }
      return ["--provider-id", providerId, "--key", key, "--value", value];
    }
    default:
      return assertNever(mode);
  }
}

function flatMapFlagValues(flag: string, values: readonly string[]): readonly string[] {
  return values.flatMap((value) => [flag, value]);
}

function inferLearningFlag(value: string): "--directory" | "--query" | "--url" {
  if (/^https?:\/\//iu.test(value)) {
    return "--url";
  }
  if (/^(?:\/|\.{1,2}\/|~\/)/u.test(value)) {
    return "--directory";
  }
  return "--query";
}

function tokenizeSharedCommandArgs(value: string): readonly string[] {
  return value.match(/\S+/gu) ?? [];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled shared CLI command arg mode: ${String(value)}`);
}
