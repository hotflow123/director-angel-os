import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

import {
  type ExperienceCandidate,
  type ExperiencePrivacyClassification,
  type ExperienceSourceAdapterDeclaration,
  type ExperienceTransformationDeclaration,
  createExperienceCandidate,
  createExperienceSourceAdapterDeclaration,
} from "@hotflow/contracts";

export interface LocalReferenceRepositoryExperienceAdapterOptions {
  readonly repoId: string;
  readonly sourceRoot: string;
  readonly include: readonly string[];
  readonly sourceRef?: string;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly transformations?: readonly ExperienceTransformationDeclaration[];
  readonly provenance?: string;
  readonly nowMs?: () => number;
}

export interface LocalReferenceRepositoryIngestInput {
  readonly sinceCursor?: string;
}

export interface LocalReferenceRepositoryIngestResult {
  readonly status: "ok";
  readonly adapter: ExperienceSourceAdapterDeclaration;
  readonly cursor: string;
  readonly candidates: readonly ExperienceCandidate[];
  readonly notes: readonly string[];
}

interface LoadedReferenceFile {
  readonly relativePath: string;
  readonly content: string;
  readonly digest: string;
}

const DEFAULT_PRIVACY: ExperiencePrivacyClassification = "internal";
const DEFAULT_PROVENANCE = "director-knowledge/local-reference-repository";

export class LocalReferenceRepositoryExperienceAdapter {
  private readonly sourceRoot: string;
  private readonly sourceRef: string;
  private readonly privacy: ExperiencePrivacyClassification;
  private readonly provenance: string;
  private readonly nowMs: () => number;

  public constructor(private readonly options: LocalReferenceRepositoryExperienceAdapterOptions) {
    this.sourceRoot = resolve(options.sourceRoot);
    this.sourceRef = options.sourceRef ?? `repo://${slugify(options.repoId)}`;
    this.privacy = options.privacy ?? DEFAULT_PRIVACY;
    this.provenance = options.provenance ?? DEFAULT_PROVENANCE;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  public async ingest(
    input: LocalReferenceRepositoryIngestInput = {},
  ): Promise<LocalReferenceRepositoryIngestResult> {
    const files = await this.loadFiles();
    const cursor = buildCursor(files);
    const adapter = this.createAdapterDeclaration(cursor);

    if (input.sinceCursor === cursor) {
      return {
        status: "ok",
        adapter,
        cursor,
        candidates: [],
        notes: ["No local reference repository changes detected."],
      };
    }

    return {
      status: "ok",
      adapter,
      cursor,
      candidates: files.map((file) => this.createCandidate(adapter, file)),
      notes: [`Materialized ${files.length} local reference experience candidate(s).`],
    };
  }

  private async loadFiles(): Promise<readonly LoadedReferenceFile[]> {
    const uniquePaths = [...new Set(this.options.include)].sort(comparePathForStableIngest);
    const files: LoadedReferenceFile[] = [];

    for (const path of uniquePaths) {
      const resolved = this.resolveIncludedPath(path);
      const content = await readFile(resolved, "utf8");
      files.push({
        relativePath: path,
        content,
        digest: sha256(content),
      });
    }

    return files;
  }

  private resolveIncludedPath(path: string): string {
    const resolved = resolve(this.sourceRoot, path);
    const relativePath = relative(this.sourceRoot, resolved);
    if (
      path.startsWith("/") ||
      relativePath.startsWith("..") ||
      relativePath === ".." ||
      relativePath.length === 0
    ) {
      throw new Error(`Local reference repository include is outside source root: ${path}`);
    }
    return resolved;
  }

  private createAdapterDeclaration(cursor: string): ExperienceSourceAdapterDeclaration {
    return createExperienceSourceAdapterDeclaration({
      adapterId: `local_reference_repo_${slugify(this.options.repoId)}`,
      sourceKind: "local-repository",
      sourceRef: this.sourceRef,
      privacy: this.privacy,
      incremental: {
        cursor,
        fingerprint: cursor,
      },
      transformations: this.options.transformations ?? [
        {
          transformId: "summarize",
          kind: "summarize",
          summary:
            "Summarize local reference repository files into review-gated experience candidates.",
        },
      ],
    });
  }

  private createCandidate(
    adapter: ExperienceSourceAdapterDeclaration,
    file: LoadedReferenceFile,
  ): ExperienceCandidate {
    const extension = extname(file.relativePath).replace(/^\./u, "");
    const tags = [
      "external-reference",
      `repo:${slugify(this.options.repoId)}`,
      "source:local-repository",
      ...(extension.length === 0 ? [] : [`file:${extension}`]),
    ];

    return createExperienceCandidate({
      candidateId: `experience_${slugify(this.options.repoId)}_${shortHash(
        `${file.relativePath}:${file.digest}`,
      )}`,
      sourceAdapter: adapter,
      title: `Local repo pattern: ${basename(file.relativePath)}`,
      summary: summarizeContent(file.content),
      applicability: `Use when Director Angel needs external implementation patterns from ${this.options.repoId}.`,
      risks: [
        "External reference content is untrusted until reviewed.",
        `Privacy classification: ${this.privacy}.`,
      ],
      tags,
      evidence: [
        {
          evidenceId: `evidence_${slugify(this.options.repoId)}_${shortHash(file.relativePath)}`,
          sourceRef: `${this.sourceRef}#${file.relativePath}`,
          path: file.relativePath,
          summary: `Reference file ${file.relativePath} from ${this.options.repoId}.`,
          attributes: {
            digest: file.digest,
            bytes: file.content.length,
          },
        },
      ],
      privacy: this.privacy,
      provenance: this.provenance,
      createdAtMs: this.nowMs(),
    });
  }
}

function buildCursor(files: readonly LoadedReferenceFile[]): string {
  return `sha256:${sha256(files.map((file) => `${file.relativePath}:${file.digest}`).join("\n"))}`;
}

function summarizeContent(content: string): string {
  const normalized = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return sha256(value).slice(0, 12);
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+/u, "")
    .replace(/_+$/u, "");
  return slug.length === 0 ? "source" : slug;
}

function comparePathForStableIngest(left: string, right: string): number {
  const leftBase = basename(left).toLowerCase();
  const rightBase = basename(right).toLowerCase();
  if (leftBase === "readme.md" && rightBase !== "readme.md") {
    return -1;
  }
  if (rightBase === "readme.md" && leftBase !== "readme.md") {
    return 1;
  }
  return left.toLowerCase().localeCompare(right.toLowerCase()) || left.localeCompare(right);
}
