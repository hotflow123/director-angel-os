import type { PromptSection } from "@hotflow/context";
import type { TaskState } from "@hotflow/contracts";

import type { SkillRepositoryPort, SkillSnapshot } from "./repository.js";
import {
  type SkillRuntimeOperatorContext,
  resolveSkillRuntimeContract,
} from "./runtime-contract.js";
import type { SkillUsageStore } from "./usage.js";

export interface SkillPromptIndexInput {
  readonly userText: string;
  readonly taskState?: TaskState;
  readonly availableTools?: readonly string[];
  readonly availableToolsets?: readonly string[];
  readonly operator?: SkillRuntimeOperatorContext | null;
  readonly toolResults?: readonly {
    readonly toolName: string;
    readonly ok: boolean;
  }[];
  readonly limit?: number;
}

export interface SkillPromptIndexOptions {
  readonly isSkillEnabled?: (skill: SkillSnapshot) => boolean;
  readonly minScore?: number;
  readonly usageStore?: SkillUsageStore;
  readonly usageActor?: string;
}

interface HermesSkillConditions {
  readonly fallbackForTools: readonly string[];
  readonly fallbackForToolsets: readonly string[];
  readonly requiresTools: readonly string[];
  readonly requiresToolsets: readonly string[];
}

function tokenize(value: string): readonly string[] {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9._-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return [...tokens, ...expandChineseQueryAliases(value)];
}

function expandChineseQueryAliases(value: string): readonly string[] {
  const aliases: string[] = [];
  const rules: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    [
      /comfyui|stable\s*diffusion|sdxl|flux|生图|文生图|图生图|生成图片|图片生成|生成视频|视频生成|文生视频/iu,
      [
        "comfyui",
        "stable-diffusion",
        "image-generation",
        "video-generation",
        "flux",
        "sdxl",
        "wan-video",
        "creative",
        "media",
      ],
    ],
    [
      /飞书|lark|feishu|云文档|文档|wiki|表格|图片|素材|抓取|网页|链接|url/iu,
      ["feishu", "lark", "doc", "wiki", "browser", "automation", "summarize", "web", "url"],
    ],
    [
      /短剧|分镜|镜头|脚本|剧本|故事|创意|视频|导演|制作|画面|运镜/iu,
      ["creative", "ideation", "video", "frames", "story", "design", "content", "production"],
    ],
    [/moyin|魔因/iu, ["moyin", "external-tool", "workflow-run", "director-production"]],
    [
      /s[-\s]*class|s\s*级|剧本导入|导入剧本|导入.*剧本|生成剧本|写剧本|剧本.*工作流|工作流.*剧本/iu,
      [
        "script-import",
        "script-generate",
        "script-workflow-gate",
        "s-class",
        "first-gate",
        "story",
        "production",
      ],
    ],
    [
      /九宫格|构图方案|参考图|复核|图片过了|重新生成图|重生图/iu,
      [
        "moyin",
        "sclass-nine-grid",
        "composition-plan",
        "grid-image",
        "reference-image",
        "grid-review",
        "board-review",
        "reuse-existing-grid",
        "no-video",
      ],
    ],
    [
      /youtube|油管|字幕|转写|总结|摘要|播客|音频|转录/iu,
      ["youtube", "transcript", "summarize", "summary", "media", "content"],
    ],
    [
      /多智能体|子智能体|协作|并行|计划|开发|测试|审查|复盘/iu,
      ["subagent", "agent", "workflow", "plan", "test", "review", "development"],
    ],
    [
      /记忆|经验|知识|召回|检索|搜索|mempalace/iu,
      ["memory", "knowledge", "recall", "search", "mempalace", "wiki"],
    ],
  ];
  for (const [pattern, tokens] of rules) {
    if (pattern.test(value)) {
      aliases.push(...tokens);
    }
  }
  return aliases;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConditionNames(value: unknown): readonly string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function readHermesSkillConditions(skill: SkillSnapshot): HermesSkillConditions {
  const metadata = isRecord(skill.metadata) ? skill.metadata : {};
  const hermesValue = metadata.hermes;
  const hermes = isRecord(hermesValue) ? hermesValue : {};
  return {
    fallbackForTools: normalizeConditionNames(hermes.fallback_for_tools),
    fallbackForToolsets: normalizeConditionNames(hermes.fallback_for_toolsets),
    requiresTools: normalizeConditionNames(hermes.requires_tools),
    requiresToolsets: normalizeConditionNames(hermes.requires_toolsets),
  };
}

function normalizeNameSet(values: readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (values === undefined) {
    return undefined;
  }
  return new Set(values.map((value) => value.trim()).filter((value) => value.length > 0));
}

function hasAllCapabilities(
  requiredNames: readonly string[],
  availableNames: ReadonlySet<string>,
): boolean {
  return requiredNames.every((name) => availableNames.has(name));
}

function hasAnyCapability(names: readonly string[], availableNames: ReadonlySet<string>): boolean {
  return names.some((name) => availableNames.has(name));
}

function skillMatchesHermesConditions(
  skill: SkillSnapshot,
  availableTools: ReadonlySet<string> | undefined,
  availableToolsets: ReadonlySet<string> | undefined,
): boolean {
  if (availableTools === undefined && availableToolsets === undefined) {
    return true;
  }

  const conditions = readHermesSkillConditions(skill);
  const tools = availableTools ?? new Set<string>();
  const toolsets = availableToolsets ?? new Set<string>();

  if (hasAnyCapability(conditions.fallbackForTools, tools)) {
    return false;
  }
  if (hasAnyCapability(conditions.fallbackForToolsets, toolsets)) {
    return false;
  }
  if (!hasAllCapabilities(conditions.requiresTools, tools)) {
    return false;
  }
  if (!hasAllCapabilities(conditions.requiresToolsets, toolsets)) {
    return false;
  }

  return true;
}

function countUniqueTokenMatches(value: string, queryTokens: ReadonlySet<string>): number {
  const matchedTokens = new Set<string>();
  for (const token of tokenize(value)) {
    if (queryTokens.has(token)) {
      matchedTokens.add(token);
    }
  }
  return matchedTokens.size;
}

function isSkillModelInvocable(skill: SkillSnapshot): boolean {
  if (skill.disableModelInvocation === true) {
    return false;
  }
  const metadata = isRecord(skill.metadata) ? skill.metadata : {};
  return metadata.disableModelInvocation !== true;
}

function renderSkillSection(skill: SkillSnapshot, matchScore: number): PromptSection {
  const lines = [`Skill: ${skill.title}`];
  if (skill.description !== undefined) {
    lines.push(`Description: ${skill.description}`);
  }
  if (skill.tags !== undefined && skill.tags.length > 0) {
    lines.push(`Tags: ${skill.tags.join(", ")}`);
  }
  if (skill.toolNames !== undefined && skill.toolNames.length > 0) {
    lines.push(`Preferred tools: ${skill.toolNames.join(", ")}`);
  }
  lines.push(skill.content);

  return {
    id: `skill.${skill.id}`,
    cacheBucket: "dynamic",
    owner: "skill",
    priority: skill.priority ?? 65,
    content: lines.join("\n"),
    metadata: {
      skillId: skill.id,
      version: skill.version,
      updatedAtMs: skill.updatedAtMs,
      matchScore,
    },
  };
}

function scoreSkillMatch(
  skill: SkillSnapshot,
  queryTokens: ReadonlySet<string>,
  toolNames: ReadonlySet<string>,
): number {
  let score = 0;
  const exactFields = [skill.id, skill.title];
  for (const field of exactFields) {
    for (const token of tokenize(field)) {
      if (queryTokens.has(token)) {
        score += 4;
      }
    }
  }

  for (const tag of skill.tags ?? []) {
    for (const token of tokenize(tag)) {
      if (queryTokens.has(token)) {
        score += 3;
      }
    }
  }

  for (const toolName of skill.toolNames ?? []) {
    if (toolNames.has(toolName)) {
      score += 4;
    }
    for (const token of tokenize(toolName)) {
      if (queryTokens.has(token)) {
        score += 2;
      }
    }
  }

  score += countUniqueTokenMatches(skill.content, queryTokens);

  return score;
}

export class SkillPromptIndex {
  public constructor(
    private readonly repository: SkillRepositoryPort,
    private readonly options: SkillPromptIndexOptions = {},
  ) {}

  public buildSections(input: SkillPromptIndexInput): PromptSection[] {
    const queryTokens = new Set<string>(tokenize(input.userText));
    for (const item of input.taskState?.items ?? []) {
      for (const token of tokenize(item.content)) {
        queryTokens.add(token);
      }
    }

    const toolNames = new Set<string>(
      (input.toolResults ?? []).filter((result) => result.ok).map((result) => result.toolName),
    );
    const availableTools = normalizeNameSet(input.availableTools);
    const availableToolsets = normalizeNameSet(input.availableToolsets);

    const ranked = this.repository
      .listApproved()
      .filter((skill) => this.options.isSkillEnabled?.(skill) ?? true)
      .filter(isSkillModelInvocable)
      .filter((skill) => {
        const runtimeContract = resolveSkillRuntimeContract({
          skill,
          ...(input.availableTools === undefined ? {} : { availableTools: input.availableTools }),
          ...(input.availableToolsets === undefined
            ? {}
            : { availableToolsets: input.availableToolsets }),
          ...(input.operator === undefined ? {} : { operator: input.operator }),
        });
        return (
          (input.operator === undefined ? true : runtimeContract.guard.allowed) &&
          skillMatchesHermesConditions(skill, availableTools, availableToolsets)
        );
      })
      .map((skill) => ({
        skill,
        score: scoreSkillMatch(skill, queryTokens, toolNames),
      }))
      .filter((entry) => entry.score >= (this.options.minScore ?? 1))
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.skill.id.localeCompare(right.skill.id);
      });

    const limit = Math.max(0, input.limit ?? 3);
    return ranked.slice(0, limit).map((entry) => {
      this.recordSkillUse(entry.skill.id);
      return renderSkillSection(entry.skill, entry.score);
    });
  }

  private recordSkillUse(skillId: string): void {
    try {
      this.options.usageStore?.recordUse(skillId, {
        actor: this.options.usageActor ?? "skill-prompt-index",
        reason: "included in runtime prompt context",
      });
    } catch {
      // Usage telemetry follows Hermes' sidecar pattern: best effort only.
    }
  }
}
