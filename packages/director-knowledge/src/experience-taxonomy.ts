import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExperienceCandidate } from "@hotflow/contracts";

export const DIRECTOR_EXPERIENCE_TAXONOMY_SCHEMA_VERSION =
  "director.experience.taxonomy.v1" as const;

export interface ExperienceTaxonomyStoreOptions {
  readonly experienceDir: string;
}

export interface ExperienceCategoryRecord {
  readonly categoryId: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface ExperienceTagRecord {
  readonly tagId: string;
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface ExperienceCandidateTaxonomyRecord {
  readonly candidateId: string;
  readonly categoryId?: string;
  readonly tagIds: readonly string[];
  readonly updatedAtMs: number;
  readonly updatedBy?: string;
}

export interface ExperienceTaxonomyDocument {
  readonly schemaVersion: typeof DIRECTOR_EXPERIENCE_TAXONOMY_SCHEMA_VERSION;
  readonly categories: readonly ExperienceCategoryRecord[];
  readonly tags: readonly ExperienceTagRecord[];
  readonly candidates: readonly ExperienceCandidateTaxonomyRecord[];
}

export interface ExperienceTaxonomySnapshot extends ExperienceTaxonomyDocument {}

export interface UpsertExperienceCategoryInput {
  readonly categoryId?: string;
  readonly name: string;
  readonly description?: string;
  readonly parentId?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

export interface UpsertExperienceTagInput {
  readonly tagId?: string;
  readonly name: string;
  readonly description?: string;
  readonly color?: string;
  readonly nowMs?: number;
}

export interface UpdateCandidateTaxonomyInput {
  readonly candidateId: string;
  readonly categoryId?: string;
  readonly tagIds?: readonly string[];
  readonly updatedBy?: string;
  readonly nowMs?: number;
}

export interface ExperiencePromotionMetadata {
  readonly candidateId: string;
  readonly groupId?: string;
  readonly categoryId?: string;
  readonly categoryName?: string;
  readonly tagIds: readonly string[];
  readonly tagNames: readonly string[];
  readonly tags: readonly string[];
}

export interface ExperiencePromotionMetadataResolver {
  resolveExperiencePromotionMetadata(
    candidate: ExperienceCandidate,
  ): Promise<ExperiencePromotionMetadata | null> | ExperiencePromotionMetadata | null;
}

const DEFAULT_CREATED_AT_MS = 0;

const DEFAULT_CATEGORIES: readonly ExperienceCategoryRecord[] = [
  category("all", "全部经验", "经验库总览。"),
  category("director-shot", "导演镜头", "镜头语言、景别、构图、光影和运镜经验。"),
  category("short-drama-production", "短剧制作", "短剧制作流程、脚本和制作规范。"),
  category("web-capture", "网页抓取", "网页、飞书、公众号等外部资料抓取经验。"),
  category("tool-usage", "工具使用", "外部工具、CLI 和平台适配经验。"),
  category("uncategorized", "待分类", "尚未人工分类的经验。"),
];

const DEFAULT_TAGS: readonly ExperienceTagRecord[] = [
  tag("shot-size", "景别"),
  tag("composition", "构图"),
  tag("lighting", "光影"),
  tag("camera-movement", "运镜"),
  tag("feishu", "飞书"),
  tag("image-evidence", "图片证据"),
];

const KNOWN_CATEGORY_IDS = new Map(
  DEFAULT_CATEGORIES.map((entry) => [normalizeNameKey(entry.name), entry.categoryId]),
);

const KNOWN_TAG_IDS = new Map(
  DEFAULT_TAGS.map((entry) => [normalizeNameKey(entry.name), entry.tagId]),
);

export class FileExperienceTaxonomyStore implements ExperiencePromotionMetadataResolver {
  public constructor(private readonly options: ExperienceTaxonomyStoreOptions) {}

  public async inspectTaxonomy(): Promise<ExperienceTaxonomySnapshot> {
    return this.loadDocument();
  }

  public async upsertCategory(
    input: UpsertExperienceCategoryInput,
  ): Promise<ExperienceCategoryRecord> {
    const document = await this.loadDocument();
    const nowMs = input.nowMs ?? Date.now();
    const categoryId = normalizeId(input.categoryId ?? resolveCategoryId(input.name));
    const existing = document.categories.find((entry) => entry.categoryId === categoryId);
    const next: ExperienceCategoryRecord = {
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
      categories: upsertById(document.categories, next, "categoryId"),
    });
    return next;
  }

  public async upsertTag(input: UpsertExperienceTagInput): Promise<ExperienceTagRecord> {
    const document = await this.loadDocument();
    const nowMs = input.nowMs ?? Date.now();
    const tagId = normalizeId(input.tagId ?? resolveTagId(input.name));
    const existing = document.tags.find((entry) => entry.tagId === tagId);
    const next: ExperienceTagRecord = {
      tagId,
      name: normalizeDisplayName(input.name),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.color === undefined ? {} : { color: input.color.trim() }),
      createdAtMs: existing?.createdAtMs ?? nowMs,
      updatedAtMs: nowMs,
    };

    await this.writeDocument({
      ...document,
      tags: upsertById(document.tags, next, "tagId"),
    });
    return next;
  }

  public async updateCandidateTaxonomy(
    input: UpdateCandidateTaxonomyInput,
  ): Promise<ExperienceCandidateTaxonomyRecord> {
    const document = await this.loadDocument();
    const categoryId =
      input.categoryId === undefined || input.categoryId.trim().length === 0
        ? undefined
        : normalizeId(input.categoryId);
    if (
      categoryId !== undefined &&
      !document.categories.some((entry) => entry.categoryId === categoryId)
    ) {
      throw new Error(`Unknown experience category: ${categoryId}`);
    }

    const tagIds = dedupeStrings((input.tagIds ?? []).map(normalizeId));
    const missingTag = tagIds.find(
      (tagId) => !document.tags.some((entry) => entry.tagId === tagId),
    );
    if (missingTag !== undefined) {
      throw new Error(`Unknown experience tag: ${missingTag}`);
    }

    const existing = document.candidates.find((entry) => entry.candidateId === input.candidateId);
    const next: ExperienceCandidateTaxonomyRecord = {
      candidateId: input.candidateId,
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
      candidates: upsertById(document.candidates, next, "candidateId"),
    });
    return next;
  }

  public async getCandidateTaxonomy(
    candidateId: string,
  ): Promise<ExperienceCandidateTaxonomyRecord | null> {
    const document = await this.loadDocument();
    return document.candidates.find((entry) => entry.candidateId === candidateId) ?? null;
  }

  public async resolveExperiencePromotionMetadata(
    candidate: ExperienceCandidate,
  ): Promise<ExperiencePromotionMetadata | null> {
    const document = await this.loadDocument();
    const binding = document.candidates.find(
      (entry) => entry.candidateId === candidate.candidateId,
    );
    if (binding === undefined) {
      return null;
    }

    const category = document.categories.find((entry) => entry.categoryId === binding.categoryId);
    const tags = binding.tagIds
      .map((tagId) => document.tags.find((entry) => entry.tagId === tagId))
      .filter((entry): entry is ExperienceTagRecord => entry !== undefined);

    return {
      candidateId: candidate.candidateId,
      ...(category === undefined
        ? {}
        : {
            groupId: category.categoryId,
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

  private taxonomyPath(): string {
    return join(this.options.experienceDir, "taxonomy.json");
  }

  private async loadDocument(): Promise<ExperienceTaxonomyDocument> {
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

  private async writeDocument(document: ExperienceTaxonomyDocument): Promise<void> {
    const normalized = normalizeDocument(document);
    const path = this.taxonomyPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  }
}

function category(categoryId: string, name: string, description: string): ExperienceCategoryRecord {
  return {
    categoryId,
    name,
    description,
    createdAtMs: DEFAULT_CREATED_AT_MS,
    updatedAtMs: DEFAULT_CREATED_AT_MS,
  };
}

function tag(tagId: string, name: string): ExperienceTagRecord {
  return {
    tagId,
    name,
    createdAtMs: DEFAULT_CREATED_AT_MS,
    updatedAtMs: DEFAULT_CREATED_AT_MS,
  };
}

function normalizeDocument(value: unknown): ExperienceTaxonomyDocument {
  const record = isRecord(value) ? value : {};
  const categories = Array.isArray(record.categories)
    ? record.categories.filter(isCategoryRecord)
    : [];
  const tags = Array.isArray(record.tags) ? record.tags.filter(isTagRecord) : [];
  const candidates = Array.isArray(record.candidates)
    ? record.candidates.filter(isCandidateTaxonomyRecord)
    : [];

  return {
    schemaVersion: DIRECTOR_EXPERIENCE_TAXONOMY_SCHEMA_VERSION,
    categories: sortCategories(mergeDefaults(DEFAULT_CATEGORIES, categories, "categoryId")),
    tags: sortTags(mergeDefaults(DEFAULT_TAGS, tags, "tagId")),
    candidates: sortCandidateBindings(candidates),
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

function isCategoryRecord(value: unknown): value is ExperienceCategoryRecord {
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

function isTagRecord(value: unknown): value is ExperienceTagRecord {
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

function isCandidateTaxonomyRecord(value: unknown): value is ExperienceCandidateTaxonomyRecord {
  return (
    isRecord(value) &&
    typeof value.candidateId === "string" &&
    (value.categoryId === undefined || typeof value.categoryId === "string") &&
    Array.isArray(value.tagIds) &&
    value.tagIds.every((entry) => typeof entry === "string") &&
    typeof value.updatedAtMs === "number" &&
    (value.updatedBy === undefined || typeof value.updatedBy === "string")
  );
}

function sortCategories(values: readonly ExperienceCategoryRecord[]): ExperienceCategoryRecord[] {
  return [...values].sort((left, right) => left.categoryId.localeCompare(right.categoryId));
}

function sortTags(values: readonly ExperienceTagRecord[]): ExperienceTagRecord[] {
  return [...values].sort((left, right) => left.tagId.localeCompare(right.tagId));
}

function sortCandidateBindings(
  values: readonly ExperienceCandidateTaxonomyRecord[],
): ExperienceCandidateTaxonomyRecord[] {
  return [...values].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function resolveCategoryId(name: string): string {
  const known = KNOWN_CATEGORY_IDS.get(normalizeNameKey(name));
  return known ?? slugify(name);
}

function resolveTagId(name: string): string {
  const known = KNOWN_TAG_IDS.get(normalizeNameKey(name));
  return known ?? slugify(name);
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("Experience taxonomy name cannot be empty.");
  }
  return normalized;
}

function normalizeId(value: string): string {
  const normalized = slugify(value);
  if (normalized.length === 0) {
    throw new Error("Experience taxonomy id cannot be empty.");
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
    .replace(/\p{M}/gu, "")
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
