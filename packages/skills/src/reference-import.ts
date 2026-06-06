import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { SkillSnapshotFileStore, resolveApprovedSkillSnapshotPath } from "./file-store.js";
import { SkillManagementStore, resolveSkillManagementPath } from "./management.js";
import type { SkillSnapshot } from "./repository.js";
import { FileSkillTaxonomyStore } from "./taxonomy.js";

export interface ReferenceSkillRepository {
  readonly repoId: string;
  readonly root: string;
  readonly includeDirs?: readonly string[];
}

export interface ReferenceSkillImportOptions {
  readonly dataDir: string;
  readonly repositories: readonly ReferenceSkillRepository[];
  readonly enabledSkillIds?: readonly string[];
  readonly maxSkills?: number;
  readonly nowMs?: number;
  readonly actor?: string;
}

export interface ReferenceSkillImportResult {
  readonly scannedCount: number;
  readonly importedCount: number;
  readonly enabledCount: number;
  readonly disabledCount: number;
  readonly snapshotVersion: number;
  readonly skillIds: readonly string[];
}

interface ParsedReferenceSkill {
  readonly skill: SkillSnapshot;
  readonly categoryId: string;
  readonly tagIds: readonly string[];
}

interface FrontmatterParseResult {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

const DISALLOWED_FUTURE_REFERENCE_REPOSITORY_IDS = new Set(["mempalace"]);

const DEFAULT_ENABLED_REFERENCE_SKILL_IDS = new Set([
  "external.hermes-agent.skills.creative.creative-ideation",
  "external.hermes-agent.skills.creative.design-md",
  "external.hermes-agent.skills.media.youtube-content",
  "external.hermes-agent.optional-skills.research.domain-intel",
  "external.hermes-agent.optional-skills.research.duckduckgo-search",
  "external.hermes-agent.skills.software-development.subagent-driven-development",
  "external.hermes-agent.skills.software-development.test-driven-development",
  "external.hermes-agent.skills.software-development.writing-plans",
  "external.mempalace.codex-plugin.skills.search",
  "external.mempalace.integrations.openclaw",
  "external.openclaw.extensions.browser.skills.browser-automation",
  "external.openclaw.extensions.feishu.skills.feishu-doc",
  "external.openclaw.extensions.feishu.skills.feishu-drive",
  "external.openclaw.extensions.feishu.skills.feishu-wiki",
  "external.openclaw.skills.summarize",
  "external.openclaw.skills.video-frames",
]);

const DEFAULT_REFERENCE_CATEGORIES = [
  {
    categoryId: "director-production",
    name: "导演制作",
    description: "剧本、分镜、创意、视频制作相关外部 Skill。",
  },
  {
    categoryId: "web-learning",
    name: "网页与资料学习",
    description: "网页抓取、飞书、YouTube、资料总结相关外部 Skill。",
  },
  {
    categoryId: "memory",
    name: "记忆与知识",
    description: "长期记忆、知识库、检索和沉淀相关外部 Skill。",
  },
  {
    categoryId: "automation",
    name: "自动化与外部工具",
    description: "浏览器、CLI、平台自动化和工具桥接相关外部 Skill。",
  },
  {
    categoryId: "agent-workflow",
    name: "智能体工作流",
    description: "多智能体、计划、测试、代码审查和工程协作相关外部 Skill。",
  },
  {
    categoryId: "external-general",
    name: "外部通用",
    description: "暂未细分的参考仓库外部 Skill。",
  },
] as const;

export async function importReferenceSkills(
  options: ReferenceSkillImportOptions,
): Promise<ReferenceSkillImportResult> {
  const nowMs = options.nowMs ?? Date.now();
  const actor = normalizeOptionalText(options.actor) ?? "reference-skill-import";
  const enabledSkillIds = new Set(options.enabledSkillIds ?? DEFAULT_ENABLED_REFERENCE_SKILL_IDS);
  const parsedSkills = scanReferenceSkillFiles(options.repositories, options.maxSkills).map(
    (entry) => parseReferenceSkill(entry, nowMs),
  );
  const management = new SkillManagementStore(
    resolveSkillManagementPath({ dataDir: options.dataDir }),
  );
  const managementBeforeImport = management.readDocument();
  const existingDecisions = new Map(
    managementBeforeImport.decisions.map((decision) => [decision.skillId, decision] as const),
  );
  const removedSkillIds = new Set(managementBeforeImport.removedSkillIds);
  const importableSkills = parsedSkills.filter((entry) => !removedSkillIds.has(entry.skill.id));

  const store = new SkillSnapshotFileStore(
    resolveApprovedSkillSnapshotPath({ dataDir: options.dataDir }),
  );
  const existing = store.readApproved().filter((skill) => !isReferenceRepositorySkill(skill));
  const nextById = new Map(existing.map((skill) => [skill.id, skill] as const));
  for (const parsed of importableSkills) {
    nextById.set(parsed.skill.id, parsed.skill);
  }
  const written = store.writeApproved([...nextById.values()].sort(compareSkillSnapshot), {
    changeKind: "manual",
  });

  management.pruneSkills(
    written.skills.map((skill) => skill.id),
    {
      actor,
      nowMs,
    },
  );
  for (const parsed of importableSkills) {
    if (existingDecisions.has(parsed.skill.id)) {
      continue;
    }
    const enabled = enabledSkillIds.has(parsed.skill.id);
    management.setSkillEnabled(parsed.skill.id, enabled, {
      actor,
      nowMs,
      note: enabled
        ? "参考仓库核心 Skill 默认开启"
        : "参考仓库外部 Skill 默认关闭，按需开启后参与召回",
    });
  }

  const taxonomyStore = new FileSkillTaxonomyStore({
    skillsDir: join(options.dataDir, "skills"),
  });
  await taxonomyStore.pruneSkillTaxonomies(written.skills.map((skill) => skill.id));
  await upsertReferenceSkillTaxonomy(taxonomyStore, importableSkills, nowMs, actor);

  const latestManagement = management.readDocument();
  const enabledCount = importableSkills.filter(
    (entry) => !latestManagement.disabledSkillIds.includes(entry.skill.id),
  ).length;
  return {
    scannedCount: parsedSkills.length,
    importedCount: importableSkills.length,
    enabledCount,
    disabledCount: importableSkills.length - enabledCount,
    snapshotVersion: written.version,
    skillIds: importableSkills.map((entry) => entry.skill.id).sort(),
  };
}

function scanReferenceSkillFiles(
  repositories: readonly ReferenceSkillRepository[],
  maxSkills: number | undefined,
): Array<{ readonly repo: ReferenceSkillRepository; readonly path: string }> {
  const results: Array<{ readonly repo: ReferenceSkillRepository; readonly path: string }> = [];
  for (const repo of repositories) {
    if (isDisallowedFutureReferenceRepository(repo)) {
      continue;
    }
    const root = resolve(repo.root);
    if (!existsSync(root)) {
      continue;
    }
    const roots = (repo.includeDirs ?? [""]).map((entry) => resolve(root, entry));
    for (const includeRoot of roots) {
      collectSkillFiles(repo, includeRoot, results, maxSkills);
      if (maxSkills !== undefined && results.length >= maxSkills) {
        return results.slice(0, maxSkills);
      }
    }
  }
  return results;
}

function isDisallowedFutureReferenceRepository(repo: ReferenceSkillRepository): boolean {
  const repoId = normalizeId(repo.repoId);
  const rootName = normalizeId(basename(resolve(repo.root)));
  return (
    DISALLOWED_FUTURE_REFERENCE_REPOSITORY_IDS.has(repoId) ||
    DISALLOWED_FUTURE_REFERENCE_REPOSITORY_IDS.has(rootName)
  );
}

function collectSkillFiles(
  repo: ReferenceSkillRepository,
  directory: string,
  results: Array<{ readonly repo: ReferenceSkillRepository; readonly path: string }>,
  maxSkills: number | undefined,
): void {
  if (!existsSync(directory)) {
    return;
  }
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (maxSkills !== undefined && results.length >= maxSkills) {
      return;
    }
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith("._")) {
      continue;
    }
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSkillFiles(repo, entryPath, results, maxSkills);
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      results.push({ repo, path: entryPath });
    }
  }
}

function parseReferenceSkill(
  entry: { readonly repo: ReferenceSkillRepository; readonly path: string },
  nowMs: number,
): ParsedReferenceSkill {
  const raw = readFileSync(entry.path, "utf8");
  const parsed = parseFrontmatter(raw);
  const rel = normalizeRelativePath(relative(entry.repo.root, entry.path));
  const name =
    normalizeOptionalText(readString(parsed.frontmatter.name)) ?? basename(dirname(entry.path));
  const title = normalizeOptionalText(readString(parsed.frontmatter.title)) ?? toTitleCase(name);
  const description =
    normalizeOptionalText(readString(parsed.frontmatter.description)) ??
    extractFirstParagraph(parsed.body) ??
    `Imported external Skill from ${entry.repo.repoId}.`;
  const frontmatterCategory = normalizeOptionalText(readString(parsed.frontmatter.category));
  const tags = uniqueStrings([
    "external",
    "reference-skill",
    entry.repo.repoId,
    ...pathSegments(rel).slice(0, -1),
    ...(frontmatterCategory === undefined ? [] : [frontmatterCategory]),
    ...readFrontmatterTags(parsed.frontmatter),
  ]);
  const categoryId = inferCategoryId({
    tags,
    content: raw,
    path: rel,
    ...(frontmatterCategory === undefined ? {} : { frontmatterCategory }),
  });
  const id = createSkillId(entry.repo.repoId, rel, name);
  return {
    skill: {
      id,
      version: normalizeOptionalText(readString(parsed.frontmatter.version)) ?? "external-1.0.0",
      title,
      description,
      content: raw.trim(),
      tags,
      toolNames: inferToolNames(raw, tags),
      priority: DEFAULT_ENABLED_REFERENCE_SKILL_IDS.has(id) ? 72 : 45,
      updatedAtMs: nowMs,
      metadata: {
        source: "reference-repository",
        sourceRepo: entry.repo.repoId,
        sourcePath: entry.path,
        relativePath: rel,
        auditStatus: "reviewed",
        trustStatus: "untrusted",
        riskLevel: inferRiskLevel(raw, tags),
      },
    },
    categoryId,
    tagIds: tags.map(normalizeId).slice(0, 16),
  };
}

async function upsertReferenceSkillTaxonomy(
  store: FileSkillTaxonomyStore,
  parsedSkills: readonly ParsedReferenceSkill[],
  nowMs: number,
  actor: string,
): Promise<void> {
  for (const category of DEFAULT_REFERENCE_CATEGORIES) {
    await store.upsertCategory({ ...category, nowMs });
  }
  const tagIds = uniqueStrings(parsedSkills.flatMap((entry) => entry.tagIds));
  for (const tagId of tagIds) {
    await store.upsertTag({
      tagId,
      name: toTitleCase(tagId),
      nowMs,
    });
  }
  for (const entry of parsedSkills) {
    await store.updateSkillTaxonomy({
      skillId: entry.skill.id,
      categoryId: entry.categoryId,
      tagIds: entry.tagIds,
      updatedBy: actor,
      nowMs,
    });
  }
}

function parseFrontmatter(raw: string): FrontmatterParseResult {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatterText = raw.slice(4, end);
  const body = raw.slice(end + 4).trimStart();
  return {
    frontmatter: parseSimpleYaml(frontmatterText),
    body,
  };
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/u);
  let activeArrayKey: string | null = null;
  for (const line of lines) {
    const listMatch = /^\s*-\s*(.+)$/u.exec(line);
    if (listMatch !== null && activeArrayKey !== null) {
      const item = listMatch[1]?.trim();
      if (item !== undefined && item.length > 0) {
        const current = Array.isArray(result[activeArrayKey])
          ? (result[activeArrayKey] as unknown[])
          : [];
        result[activeArrayKey] = [...current, parseYamlScalar(item)];
      }
      continue;
    }

    const match = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }
    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined || rawValue.trim().length === 0) {
      activeArrayKey = key === "tags" ? key : null;
      if (activeArrayKey !== null && !Array.isArray(result[activeArrayKey])) {
        result[activeArrayKey] = [];
      }
      continue;
    }
    result[key] = parseYamlScalar(rawValue.trim());
    activeArrayKey = null;
  }
  return result;
}

function parseYamlScalar(value: string): unknown {
  const unquoted = value.replace(/^["']|["']$/gu, "");
  if (unquoted.startsWith("[") && unquoted.endsWith("]")) {
    return unquoted
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim().replace(/^["']|["']$/gu, ""))
      .filter(Boolean);
  }
  return unquoted;
}

function readFrontmatterTags(frontmatter: Record<string, unknown>): readonly string[] {
  const direct = frontmatter.tags;
  if (Array.isArray(direct)) {
    return direct.filter((entry): entry is string => typeof entry === "string");
  }
  const metadata = frontmatter.metadata;
  if (typeof metadata === "object" && metadata !== null && "tags" in metadata) {
    const tags = (metadata as { tags?: unknown }).tags;
    return Array.isArray(tags)
      ? tags.filter((entry): entry is string => typeof entry === "string")
      : [];
  }
  return [];
}

function inferCategoryId(input: {
  readonly tags: readonly string[];
  readonly content: string;
  readonly path: string;
  readonly frontmatterCategory?: string;
}): string {
  const explicitCategory = normalizeId(input.frontmatterCategory ?? "");
  if (
    /creative|media|video|image|audio|design|story|comfyui|stable-diffusion|flux/u.test(
      explicitCategory,
    )
  ) {
    return "director-production";
  }
  if (/memory|knowledge|recall|obsidian|mempalace/u.test(explicitCategory)) {
    return "memory";
  }
  if (/agent|workflow|software|devops|test|code/u.test(explicitCategory)) {
    return "agent-workflow";
  }
  if (/automation|cli|tool|mcp|browser/u.test(explicitCategory)) {
    return "automation";
  }
  if (/web|research|doc|wiki|url|browser|feishu|youtube/u.test(explicitCategory)) {
    return "web-learning";
  }

  const text = `${input.path}\n${input.tags.join(" ")}\n${input.content}`.toLowerCase();
  if (
    /comfyui|image-generation|video-generation|stable-diffusion|diffusion|flux|sdxl|sd3|wan-video|hunyuan|inpaint|img2img|txt2img|media|video|frame|music|creative|ideation|design|story|content/u.test(
      text,
    )
  ) {
    return "director-production";
  }
  if (/memory|mempalace|obsidian|wiki|knowledge|recall/u.test(text)) {
    return "memory";
  }
  if (/feishu|browser|youtube|summarize|transcript|web|url|doc|wiki/u.test(text)) {
    return "web-learning";
  }
  if (/subagent|plan|test-driven|code-review|workflow|agent/u.test(text)) {
    return "agent-workflow";
  }
  if (/cli|automation|github|tool|mcp|slack|discord|apple/u.test(text)) {
    return "automation";
  }
  return "external-general";
}

function inferToolNames(content: string, tags: readonly string[]): readonly string[] {
  const text = `${content}\n${tags.join(" ")}`.toLowerCase();
  const tools: string[] = [];
  for (const [pattern, tool] of [
    [/feishu/u, "feishu_doc"],
    [/browser|playwright|chromium/u, "browser"],
    [/youtube|transcript/u, "youtube-transcript"],
    [/ffmpeg|video-frames/u, "ffmpeg"],
    [/summarize/u, "summarize"],
    [/mempalace/u, "mempalace"],
    [/git|github/u, "git"],
    [/python/u, "python"],
    [/bash|cli|command/u, "bash"],
  ] as const) {
    if (pattern.test(text)) {
      tools.push(tool);
    }
  }
  return uniqueStrings(tools);
}

function inferRiskLevel(content: string, tags: readonly string[]): "low" | "medium" | "high" {
  const text = `${content}\n${tags.join(" ")}`.toLowerCase();
  if (/write|delete|permission|token|secret|deploy|payment|blockchain|security/u.test(text)) {
    return "high";
  }
  if (/browser|network|api|cli|bash|python|file|github|feishu/u.test(text)) {
    return "medium";
  }
  return "low";
}

function createSkillId(repoId: string, rel: string, name: string): string {
  const segments = pathSegments(rel)
    .filter((segment) => segment !== "SKILL.md")
    .map((segment) => normalizeId(segment.replace(/^\.+/u, "")))
    .filter(Boolean);
  const suffix = segments.length > 0 ? segments.join(".") : normalizeId(name);
  return `external.${normalizeId(repoId)}.${suffix}`;
}

function isReferenceRepositorySkill(skill: SkillSnapshot): boolean {
  return skill.metadata?.source === "reference-repository";
}

function compareSkillSnapshot(left: SkillSnapshot, right: SkillSnapshot): number {
  return left.id.localeCompare(right.id);
}

function extractFirstParagraph(body: string): string | undefined {
  return body
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/^#+\s*/u, "").trim())
    .find((paragraph) => paragraph.length > 0);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function pathSegments(value: string): readonly string[] {
  return value.split("/").filter((entry) => entry.length > 0);
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function toTitleCase(value: string): string {
  const acronymOverrides = new Map([
    ["api", "API"],
    ["cli", "CLI"],
    ["comfyui", "ComfyUI"],
    ["mcp", "MCP"],
    ["sdxl", "SDXL"],
    ["ui", "UI"],
  ]);
  return value
    .split(/[-_./\s]+/u)
    .filter(Boolean)
    .map(
      (part) =>
        acronymOverrides.get(part.toLowerCase()) ?? part.slice(0, 1).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeId).filter(Boolean))].sort();
}
