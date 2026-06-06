import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const SKILL_TAXONOMY_SCHEMA_VERSION = "skills.taxonomy.v1" as const;

export interface SkillTaxonomyStoreOptions {
  readonly skillsDir: string;
}

export interface SkillCategoryRecord {
  readonly categoryId: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface SkillTagRecord {
  readonly tagId: string;
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface SkillTaxonomyRecord {
  readonly skillId: string;
  readonly categoryId?: string;
  readonly tagIds: readonly string[];
  readonly updatedAtMs: number;
  readonly updatedBy?: string;
}

export interface SkillTaxonomyDocument {
  readonly schemaVersion: typeof SKILL_TAXONOMY_SCHEMA_VERSION;
  readonly categories: readonly SkillCategoryRecord[];
  readonly tags: readonly SkillTagRecord[];
  readonly skills: readonly SkillTaxonomyRecord[];
}

export interface SkillTaxonomySnapshot extends SkillTaxonomyDocument {}

export interface UpsertSkillCategoryInput {
  readonly categoryId?: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

export interface UpsertSkillTagInput {
  readonly tagId?: string;
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

export interface UpdateSkillTaxonomyInput {
  readonly skillId: string;
  readonly categoryId?: string;
  readonly tagIds?: readonly string[];
  readonly updatedBy?: string;
  readonly nowMs?: number;
}

export interface ResolvedSkillTaxonomy {
  readonly skillId: string;
  readonly categoryId?: string;
  readonly categoryName?: string;
  readonly tagIds: readonly string[];
  readonly tagNames: readonly string[];
  readonly tags: readonly string[];
}

const DEFAULT_CREATED_AT_MS = 0;

const DEFAULT_CATEGORIES: readonly SkillCategoryRecord[] = [
  category("all", "All skills", "Skill library overview."),
  category("workflow", "Workflow", "Reusable process and orchestration skills."),
  category("coding", "Coding", "Implementation, review, and verification skills."),
  category("research", "Research", "Discovery, retrieval, and synthesis skills."),
  category("uncategorized", "Uncategorized", "Skills that still need classification."),
];

const DEFAULT_TAGS: readonly SkillTagRecord[] = [];

const KNOWN_CATEGORY_IDS = new Map(
  DEFAULT_CATEGORIES.map((entry) => [normalizeNameKey(entry.name), entry.categoryId]),
);

export class FileSkillTaxonomyStore {
  public constructor(private readonly options: SkillTaxonomyStoreOptions) {}

  public async readTaxonomy(): Promise<SkillTaxonomySnapshot> {
    return this.loadDocument();
  }

  public async inspectTaxonomy(): Promise<SkillTaxonomySnapshot> {
    return this.readTaxonomy();
  }

  public async listCategories(): Promise<readonly SkillCategoryRecord[]> {
    return (await this.loadDocument()).categories;
  }

  public async listTags(): Promise<readonly SkillTagRecord[]> {
    return (await this.loadDocument()).tags;
  }

  public async listSkillTaxonomies(): Promise<readonly SkillTaxonomyRecord[]> {
    return (await this.loadDocument()).skills;
  }

  public async upsertCategory(input: UpsertSkillCategoryInput): Promise<SkillCategoryRecord> {
    const document = await this.loadDocument();
    const nowMs = input.nowMs ?? Date.now();
    const categoryId = normalizeId(input.categoryId ?? resolveCategoryId(input.name));
    const existing = document.categories.find((entry) => entry.categoryId === categoryId);
    const next: SkillCategoryRecord = {
      categoryId,
      name: normalizeDisplayName(input.name),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.parentId === undefined ? {} : { parentId: normalizeId(input.parentId) }),
      ...(input.color === undefined ? {} : { color: input.color.trim() }),
      createdAtMs: existing?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
    };

    await this.writeDocument({
      ...document,
      categories: sortCategories(upsertById(document.categories, next, "categoryId")),
    });
    return next;
  }

  public async upsertTag(input: UpsertSkillTagInput): Promise<SkillTagRecord> {
    const document = await this.loadDocument();
    const nowMs = input.nowMs ?? Date.now();
    const tagId = normalizeId(input.tagId ?? input.name);
    const existing = document.tags.find((entry) => entry.tagId === tagId);
    const next: SkillTagRecord = {
      tagId,
      name: normalizeDisplayName(input.name),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.color === undefined ? {} : { color: input.color.trim() }),
      createdAtMs: existing?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
    };

    await this.writeDocument({
      ...document,
      tags: sortTags(upsertById(document.tags, next, "tagId")),
    });
    return next;
  }

  public async updateSkillTaxonomy(input: UpdateSkillTaxonomyInput): Promise<SkillTaxonomyRecord> {
    const document = await this.loadDocument();
    const skillId = normalizeRequiredText(input.skillId, "Skill id");
    const categoryId =
      input.categoryId === undefined || input.categoryId.trim().length === 0
        ? undefined
        : normalizeId(input.categoryId);

    if (
      categoryId !== undefined &&
      !document.categories.some((entry) => entry.categoryId === categoryId)
    ) {
      throw new Error(`Unknown skill category: ${categoryId}`);
    }

    const tagIds = dedupeStrings((input.tagIds ?? []).map(normalizeId));
    const missingTag = tagIds.find(
      (tagId) => !document.tags.some((entry) => entry.tagId === tagId),
    );
    if (missingTag !== undefined) {
      throw new Error(`Unknown skill tag: ${missingTag}`);
    }

    const existing = document.skills.find((entry) => entry.skillId === skillId);
    const next: SkillTaxonomyRecord = {
      skillId,
      ...(categoryId === undefined ? {} : { categoryId }),
      tagIds,
      updatedAtMs: input.nowMs ?? Date.now(),
      ...(input.updatedBy === undefined
        ? existing?.updatedBy === undefined
          ? {}
          : { updatedBy: existing.updatedBy }
        : { updatedBy: input.updatedBy }),
    };

    await this.writeDocument({
      ...document,
      skills: sortSkillTaxonomies(upsertById(document.skills, next, "skillId")),
    });
    return next;
  }

  public async readSkillTaxonomy(skillId: string): Promise<SkillTaxonomyRecord | null> {
    const normalizedSkillId = normalizeRequiredText(skillId, "Skill id");
    const document = await this.loadDocument();
    return document.skills.find((entry) => entry.skillId === normalizedSkillId) ?? null;
  }

  public async resolveSkillTaxonomy(skillId: string): Promise<ResolvedSkillTaxonomy | null> {
    const normalizedSkillId = normalizeRequiredText(skillId, "Skill id");
    const document = await this.loadDocument();
    const binding = document.skills.find((entry) => entry.skillId === normalizedSkillId);
    if (binding === undefined) {
      return null;
    }

    const category = document.categories.find((entry) => entry.categoryId === binding.categoryId);
    const tags = binding.tagIds
      .map((tagId) => document.tags.find((entry) => entry.tagId === tagId))
      .filter((entry): entry is SkillTagRecord => entry !== undefined);

    return {
      skillId: binding.skillId,
      ...(category === undefined
        ? {}
        : {
            categoryId: category.categoryId,
            categoryName: category.name,
          }),
      tagIds: tags.map((entry) => entry.tagId),
      tagNames: tags.map((entry) => entry.name),
      tags: [
        ...(category === undefined ? [] : [`category:${category.categoryId}`]),
        ...tags.map((entry) => `user-tag:${entry.tagId}`),
      ],
    };
  }

  public async pruneSkillTaxonomies(skillIds: readonly string[]): Promise<SkillTaxonomySnapshot> {
    const allowed = new Set(skillIds.map((skillId) => normalizeRequiredText(skillId, "Skill id")));
    const document = await this.loadDocument();
    const nextDocument = {
      ...document,
      skills: document.skills.filter((entry) => allowed.has(entry.skillId)),
    };
    await this.writeDocument(nextDocument);
    return this.readTaxonomy();
  }

  private taxonomyPath(): string {
    return join(this.options.skillsDir, "taxonomy.json");
  }

  private async loadDocument(): Promise<SkillTaxonomyDocument> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.taxonomyPath(), "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      parsed = null;
    }
    return normalizeDocument(parsed);
  }

  private async writeDocument(document: SkillTaxonomyDocument): Promise<void> {
    const normalized = normalizeDocument(document);
    const path = this.taxonomyPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }
}

export function resolveSkillTaxonomyPath(
  config: { dataDir: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HOTFLOW_SKILLS_TAXONOMY_PATH?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(join(config.dataDir, "skills", "taxonomy.json"));
}

function category(categoryId: string, name: string, description: string): SkillCategoryRecord {
  return {
    categoryId,
    name,
    description,
    createdAtMs: DEFAULT_CREATED_AT_MS,
    updatedAtMs: DEFAULT_CREATED_AT_MS,
  };
}

function normalizeDocument(value: unknown): SkillTaxonomyDocument {
  const record = isRecord(value) ? value : {};
  const categories = Array.isArray(record.categories)
    ? record.categories.filter(isCategoryRecord)
    : [];
  const tags = Array.isArray(record.tags) ? record.tags.filter(isTagRecord) : [];
  const skills = Array.isArray(record.skills) ? record.skills.filter(isSkillTaxonomyRecord) : [];

  return {
    schemaVersion: SKILL_TAXONOMY_SCHEMA_VERSION,
    categories: sortCategories(mergeDefaults(DEFAULT_CATEGORIES, categories, "categoryId")),
    tags: sortTags(mergeDefaults(DEFAULT_TAGS, tags, "tagId")),
    skills: sortSkillTaxonomies(skills),
  };
}

function mergeDefaults<T extends Record<K, string>, K extends keyof T>(
  defaults: readonly T[],
  values: readonly T[],
  key: K,
): T[] {
  const merged = new Map<string, T>();
  for (const entry of defaults) {
    merged.set(entry[key], entry);
  }
  for (const entry of values) {
    merged.set(entry[key], entry);
  }
  return [...merged.values()];
}

function upsertById<T extends Record<K, string>, K extends keyof T>(
  values: readonly T[],
  next: T,
  key: K,
): T[] {
  const without = values.filter((entry) => entry[key] !== next[key]);
  return [...without, next];
}

function isCategoryRecord(value: unknown): value is SkillCategoryRecord {
  return (
    isRecord(value) &&
    typeof value.categoryId === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAtMs === "number" &&
    typeof value.updatedAtMs === "number" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.parentId === undefined || typeof value.parentId === "string") &&
    (value.color === undefined || typeof value.color === "string")
  );
}

function isTagRecord(value: unknown): value is SkillTagRecord {
  return (
    isRecord(value) &&
    typeof value.tagId === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAtMs === "number" &&
    typeof value.updatedAtMs === "number" &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.color === undefined || typeof value.color === "string")
  );
}

function isSkillTaxonomyRecord(value: unknown): value is SkillTaxonomyRecord {
  return (
    isRecord(value) &&
    typeof value.skillId === "string" &&
    (value.categoryId === undefined || typeof value.categoryId === "string") &&
    Array.isArray(value.tagIds) &&
    value.tagIds.every((entry) => typeof entry === "string") &&
    typeof value.updatedAtMs === "number" &&
    (value.updatedBy === undefined || typeof value.updatedBy === "string")
  );
}

function sortCategories(values: readonly SkillCategoryRecord[]): SkillCategoryRecord[] {
  return [...values].sort((left, right) => left.categoryId.localeCompare(right.categoryId));
}

function sortTags(values: readonly SkillTagRecord[]): SkillTagRecord[] {
  return [...values].sort((left, right) => left.tagId.localeCompare(right.tagId));
}

function sortSkillTaxonomies(values: readonly SkillTaxonomyRecord[]): SkillTaxonomyRecord[] {
  return [...values].sort((left, right) => left.skillId.localeCompare(right.skillId));
}

function resolveCategoryId(name: string): string {
  const known = KNOWN_CATEGORY_IDS.get(normalizeNameKey(name));
  return known ?? slugify(name);
}

function normalizeDisplayName(value: string): string {
  return normalizeRequiredText(value, "Skill taxonomy name");
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
  return normalized;
}

function normalizeId(value: string): string {
  const normalized = slugify(value);
  if (normalized.length === 0) {
    throw new Error("Skill taxonomy id cannot be empty.");
  }
  return normalized;
}

function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase();
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (slug.length > 0) {
    return slug;
  }
  return `custom-${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
