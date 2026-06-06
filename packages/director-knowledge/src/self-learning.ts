import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type CanonicalJsonValue,
  type ExperienceCandidate,
  type ExperiencePrivacyClassification,
  type ExperienceQuarantineRecord,
  type ExperienceSourceAdapterDeclaration,
  type ExperienceSourceArtifact,
  type ExperienceTransformationDeclaration,
  createExperienceCandidate,
  createExperienceSourceAdapterDeclaration,
} from "@hotflow/contracts";

import {
  type ExperienceAdmissionAdapter,
  type ExperienceAdmissionDecision,
  HeuristicExperienceAdmissionAdapter,
  buildExperienceCursor,
  buildExperienceSourceDigest,
  limitExperienceTextByBytes,
  previewExperienceText,
  shortHash,
  slugify,
} from "./experience-admission.js";
import {
  type ExperienceDistiller,
  distillExperienceDraftWithAdapter,
} from "./experience-distillation.js";
import type { FileExperienceStore } from "./experience-store.js";

export interface ExperienceSourceIngestInput {
  readonly sinceCursor?: string;
}

export interface ExperienceSourceIngestResult {
  readonly status: "ok";
  readonly adapter: ExperienceSourceAdapterDeclaration;
  readonly cursor: string;
  readonly artifacts: readonly ExperienceSourceArtifact[];
  readonly candidates: readonly ExperienceCandidate[];
  readonly quarantined: readonly ExperienceQuarantineRecord[];
  readonly notes: readonly string[];
}

export interface ExperienceSourceIngestAdapter {
  readonly adapterId: string;
  ingest(input?: ExperienceSourceIngestInput): Promise<ExperienceSourceIngestResult>;
}

export interface LocalDirectoryExperienceAdapterOptions {
  readonly sourceId: string;
  readonly directoryRoot: string;
  readonly sourceRef?: string;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly transformations?: readonly ExperienceTransformationDeclaration[];
  readonly provenance?: string;
  readonly nowMs?: () => number;
  readonly includeExtensions?: readonly string[];
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxBytesPerFile?: number;
  readonly admission?: ExperienceAdmissionAdapter;
  readonly distiller?: ExperienceDistiller;
}

export interface WebExperienceFetchResult {
  readonly url: string;
  readonly body: string;
  readonly contentType?: string;
  readonly structuredContent?: CanonicalJsonValue;
}

export type WebExperienceFetchText = (url: string) => Promise<WebExperienceFetchResult>;

export interface WebExperienceSourceAdapterOptions {
  readonly sourceId: string;
  readonly urls: readonly string[];
  readonly sourceRef?: string;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly transformations?: readonly ExperienceTransformationDeclaration[];
  readonly provenance?: string;
  readonly nowMs?: () => number;
  readonly fetchText?: WebExperienceFetchText;
  readonly maxBytesPerPage?: number;
  readonly admission?: ExperienceAdmissionAdapter;
  readonly distiller?: ExperienceDistiller;
}

export interface WebSearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet?: string;
}

export type WebExperienceSearch = (
  query: string,
  options: {
    readonly maxResults: number;
  },
) => Promise<readonly WebSearchResult[]>;

export interface WebSearchExperienceAdapterOptions {
  readonly sourceId: string;
  readonly queries: readonly string[];
  readonly sourceRef?: string;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly transformations?: readonly ExperienceTransformationDeclaration[];
  readonly provenance?: string;
  readonly nowMs?: () => number;
  readonly search?: WebExperienceSearch;
  readonly fetchText?: WebExperienceFetchText;
  readonly maxResultsPerQuery?: number;
  readonly maxBytesPerPage?: number;
  readonly admission?: ExperienceAdmissionAdapter;
  readonly distiller?: ExperienceDistiller;
}

export interface PastedTextExperienceSource {
  readonly title?: string;
  readonly content: string;
  readonly sourceRef?: string;
  readonly contentType?: string;
}

export interface PastedTextExperienceAdapterOptions {
  readonly sourceId: string;
  readonly texts: readonly PastedTextExperienceSource[];
  readonly sourceRef?: string;
  readonly privacy?: ExperiencePrivacyClassification;
  readonly transformations?: readonly ExperienceTransformationDeclaration[];
  readonly provenance?: string;
  readonly nowMs?: () => number;
  readonly maxBytesPerText?: number;
  readonly admission?: ExperienceAdmissionAdapter;
  readonly distiller?: ExperienceDistiller;
}

export interface SelfLearningOrchestratorOptions {
  readonly store: FileExperienceStore;
  readonly adapters: readonly ExperienceSourceIngestAdapter[];
}

export interface SelfLearningRunInput {
  readonly sinceCursors?: Readonly<Record<string, string>>;
}

export interface SelfLearningRunResult {
  readonly status: "ok" | "degraded";
  readonly candidateCount: number;
  readonly artifactCount: number;
  readonly quarantineCount: number;
  readonly candidateIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly quarantineIds: readonly string[];
  readonly nextCursors: Readonly<Record<string, string>>;
  readonly adapterReports: readonly SelfLearningAdapterReport[];
  readonly notes: readonly string[];
}

export interface SelfLearningAdapterReport {
  readonly adapterId: string;
  readonly sourceKind: string;
  readonly cursor: string;
  readonly artifactCount: number;
  readonly storedArtifactCount: number;
  readonly candidateCount: number;
  readonly storedCount: number;
  readonly candidateIds: readonly string[];
  readonly quarantineCount: number;
  readonly storedQuarantineCount: number;
  readonly artifactIds: readonly string[];
  readonly quarantineIds: readonly string[];
  readonly notes: readonly string[];
}

interface LoadedExperienceDocument {
  readonly relativePath: string;
  readonly title: string;
  readonly content: string;
  readonly digest: string;
  readonly bytes: number;
}

interface LoadedWebPage {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly digest: string;
  readonly bytes: number;
  readonly artifact: ExperienceSourceArtifact;
  readonly contentType?: string;
}

interface LoadedWebSearchPage extends LoadedWebPage {
  readonly query: string;
  readonly rank: number;
  readonly resultTitle: string;
  readonly snippet?: string;
}

interface LoadedPastedText {
  readonly relativePath: string;
  readonly title: string;
  readonly content: string;
  readonly digest: string;
  readonly bytes: number;
  readonly sourceRef: string;
  readonly artifact: ExperienceSourceArtifact;
  readonly contentType?: string;
}

const DEFAULT_PRIVACY: ExperiencePrivacyClassification = "internal";
const DEFAULT_DIRECTORY_PROVENANCE = "director-knowledge/local-directory-self-learning";
const DEFAULT_WEB_PROVENANCE = "director-knowledge/web-self-learning";
const DEFAULT_WEB_SEARCH_PROVENANCE = "director-knowledge/web-search-self-learning";
const DEFAULT_PASTED_TEXT_PROVENANCE = "director-knowledge/pasted-text-self-learning";
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILES = 80;
const DEFAULT_MAX_BYTES_PER_FILE = 128 * 1024;
const DEFAULT_MAX_BYTES_PER_TEXT = 192 * 1024;
const DEFAULT_MAX_BYTES_PER_PAGE = 256 * 1024;
const DEFAULT_MAX_RESULTS_PER_QUERY = 5;
const DEFAULT_CANDIDATE_EVIDENCE_PREVIEW_CHARS = 800;
const DEFAULT_TEXT_EXTENSIONS = [
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
] as const;
const DEFAULT_IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build"]);

export class LocalDirectoryExperienceAdapter implements ExperienceSourceIngestAdapter {
  public readonly adapterId: string;

  private readonly directoryRoot: string;
  private readonly sourceRef: string;
  private readonly privacy: ExperiencePrivacyClassification;
  private readonly provenance: string;
  private readonly nowMs: () => number;
  private readonly includeExtensions: ReadonlySet<string>;
  private readonly maxDepth: number;
  private readonly maxFiles: number;
  private readonly maxBytesPerFile: number;
  private readonly admission: ExperienceAdmissionAdapter;

  public constructor(private readonly options: LocalDirectoryExperienceAdapterOptions) {
    this.adapterId = `local_directory_${slugify(options.sourceId)}`;
    this.directoryRoot = resolve(options.directoryRoot);
    this.sourceRef = options.sourceRef ?? pathToFileURL(this.directoryRoot).href;
    this.privacy = options.privacy ?? DEFAULT_PRIVACY;
    this.provenance = options.provenance ?? DEFAULT_DIRECTORY_PROVENANCE;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.includeExtensions = new Set(
      (options.includeExtensions ?? DEFAULT_TEXT_EXTENSIONS).map((extension) =>
        normalizeExtension(extension),
      ),
    );
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
    this.admission = options.admission ?? new HeuristicExperienceAdmissionAdapter();
  }

  public async ingest(
    input: ExperienceSourceIngestInput = {},
  ): Promise<ExperienceSourceIngestResult> {
    const loaded = await this.loadDocuments();
    const cursor = buildExperienceCursor(
      loaded.documents.map((document) => `${document.relativePath}:${document.digest}`),
    );
    const adapter = this.createAdapterDeclaration(cursor);
    const decisions = loaded.documents.map((document) => this.admitDocument(document));
    const artifacts = decisions.map((decision) => decision.artifact);
    const candidates: ExperienceCandidate[] = [];
    const quarantined: ExperienceQuarantineRecord[] = [];
    const notes: string[] = [];
    for (const [index, document] of loaded.documents.entries()) {
      const decision = decisions[index] as ExperienceAdmissionDecision;
      if (decision.status === "quarantined") {
        quarantined.push(decision.quarantine);
        notes.push(...decision.notes);
        continue;
      }
      candidates.push(await this.createCandidate(adapter, document, decision));
    }

    if (input.sinceCursor === cursor) {
      return {
        status: "ok",
        adapter,
        cursor,
        artifacts: [],
        candidates: [],
        quarantined: [],
        notes: ["No local directory changes detected.", ...loaded.notes],
      };
    }

    return {
      status: "ok",
      adapter,
      cursor,
      artifacts,
      candidates,
      quarantined,
      notes: [
        `Materialized ${candidates.length} local directory experience candidate(s).`,
        ...notes,
        ...loaded.notes,
      ],
    };
  }

  private async loadDocuments(): Promise<{
    readonly documents: readonly LoadedExperienceDocument[];
    readonly notes: readonly string[];
  }> {
    const notes: string[] = [];
    const rootStat = await stat(this.directoryRoot);
    const paths = rootStat.isFile()
      ? this.includeExtensions.has(normalizeExtension(extname(this.directoryRoot)))
        ? [this.directoryRoot]
        : []
      : await this.scanDirectory(this.directoryRoot, 0, notes);
    if (rootStat.isFile() && paths.length === 0) {
      notes.push(`Skipped ${basename(this.directoryRoot)}: unsupported file extension.`);
    }
    const limitedPaths = paths.slice(0, this.maxFiles);
    if (paths.length > limitedPaths.length) {
      notes.push(`Skipped ${paths.length - limitedPaths.length} file(s) over maxFiles.`);
    }

    const documents: LoadedExperienceDocument[] = [];
    for (const path of limitedPaths) {
      const relativePath = rootStat.isFile() ? basename(path) : relative(this.directoryRoot, path);
      const fileStat = await stat(path);
      if (fileStat.size > this.maxBytesPerFile) {
        notes.push(`Skipped ${relativePath}: larger than maxBytesPerFile.`);
        continue;
      }

      const content = await readFile(path, "utf8");
      documents.push({
        relativePath,
        title: basename(relativePath),
        content,
        digest: buildExperienceSourceDigest(content),
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }

    return {
      documents: documents.sort(compareDocuments),
      notes,
    };
  }

  private async scanDirectory(root: string, depth: number, notes: string[]): Promise<string[]> {
    if (depth > this.maxDepth) {
      return [];
    }

    const entries = await readdir(root, { withFileTypes: true });
    const paths: string[] = [];

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const resolved = resolve(root, entry.name);
      if (!this.isInsideRoot(resolved)) {
        notes.push(`Skipped ${entry.name}: outside source root.`);
        continue;
      }
      if (entry.isSymbolicLink()) {
        notes.push(`Skipped ${entry.name}: symbolic links are not followed.`);
        continue;
      }
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        paths.push(...(await this.scanDirectory(resolved, depth + 1, notes)));
        continue;
      }
      if (entry.isFile() && this.includeExtensions.has(normalizeExtension(extname(entry.name)))) {
        paths.push(resolved);
      }
    }

    return paths;
  }

  private isInsideRoot(path: string): boolean {
    const relativePath = relative(this.directoryRoot, path);
    return relativePath.length > 0 && !relativePath.startsWith("..") && relativePath !== "..";
  }

  private createAdapterDeclaration(cursor: string): ExperienceSourceAdapterDeclaration {
    return createExperienceSourceAdapterDeclaration({
      adapterId: this.adapterId,
      sourceKind: "local-directory",
      sourceRef: this.sourceRef,
      privacy: this.privacy,
      incremental: {
        cursor,
        fingerprint: cursor,
      },
      transformations: this.options.transformations ?? [
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable direction patterns from user-provided local files.",
          privacyImpact: this.privacy,
        },
        {
          transformId: "distill-experience",
          kind: "extract-pattern",
          summary: "Distill raw local source content into reviewable operating experience.",
          privacyImpact: this.privacy,
        },
        {
          transformId: "summarize",
          kind: "summarize",
          summary: "Summarize local directory files into review-gated experience candidates.",
        },
      ],
    });
  }

  private admitDocument(document: LoadedExperienceDocument): ExperienceAdmissionDecision {
    const sourceRef = `${this.sourceRef}#${document.relativePath}`;
    return this.admission.admit({
      profile: "local-text",
      sourceId: this.options.sourceId,
      sourceKind: "local-directory",
      sourceRef,
      title: document.title,
      path: document.relativePath,
      rawContent: document.content,
      privacy: this.privacy,
      provenance: this.provenance,
      capturedAtMs: this.nowMs(),
      quarantineNotes: ["Local learning requires reusable text before candidate creation."],
    });
  }

  private async createCandidate(
    adapter: ExperienceSourceAdapterDeclaration,
    document: LoadedExperienceDocument,
    decision: Extract<ExperienceAdmissionDecision, { readonly status: "accepted" }>,
  ): Promise<ExperienceCandidate> {
    const extension = normalizeExtension(extname(document.relativePath)).replace(/^\./u, "");
    const artifact = decision.artifact;
    const draft = await distillExperienceDraftWithAdapter(
      {
        sourceKind: "local-directory",
        sourceId: this.options.sourceId,
        title: document.title,
        content: decision.readableContent,
        privacy: this.privacy,
        fallbackApplicability:
          "Use when Director Angel needs reusable operating experience from user-provided local files.",
        baseRisks: [
          "User-provided local content may contain private or stale guidance until reviewed.",
          `Privacy classification: ${this.privacy}.`,
        ],
        baseTags: [
          "external-reference",
          "source:local-directory",
          `directory:${slugify(this.options.sourceId)}`,
          ...(extension.length === 0 ? [] : [`file:${extension}`]),
        ],
      },
      this.options.distiller,
    );
    return createExperienceCandidate({
      candidateId: `experience_${slugify(this.options.sourceId)}_${shortHash(
        `${document.relativePath}:${document.digest}`,
      )}`,
      sourceAdapter: adapter,
      title: `Local lesson: ${document.title}`,
      summary: draft.summary,
      applicability: draft.applicability,
      risks: draft.risks,
      tags: draft.tags,
      evidence: [
        {
          evidenceId: `evidence_${slugify(this.options.sourceId)}_${shortHash(document.relativePath)}`,
          sourceRef: `${this.sourceRef}#${document.relativePath}`,
          path: document.relativePath,
          summary: draft.evidenceSummary,
          attributes: {
            digest: artifact.digest,
            bytes: document.bytes,
            artifactId: artifact.artifactId,
            qualityScore: artifact.quality.score,
          },
        },
      ],
      sourceArtifactId: artifact.artifactId,
      sourceDigest: artifact.digest,
      evidencePreview: previewExperienceText(
        decision.readableContent,
        DEFAULT_CANDIDATE_EVIDENCE_PREVIEW_CHARS,
      ),
      quality: artifact.quality,
      privacy: this.privacy,
      provenance: this.provenance,
      createdAtMs: this.nowMs(),
    });
  }
}

export class PastedTextExperienceAdapter implements ExperienceSourceIngestAdapter {
  public readonly adapterId: string;

  private readonly sourceRef: string;
  private readonly privacy: ExperiencePrivacyClassification;
  private readonly provenance: string;
  private readonly nowMs: () => number;
  private readonly maxBytesPerText: number;
  private readonly admission: ExperienceAdmissionAdapter;

  public constructor(private readonly options: PastedTextExperienceAdapterOptions) {
    this.adapterId = `pasted_text_${slugify(options.sourceId)}`;
    this.sourceRef = options.sourceRef ?? `pasted://${slugify(options.sourceId)}`;
    this.privacy = options.privacy ?? DEFAULT_PRIVACY;
    this.provenance = options.provenance ?? DEFAULT_PASTED_TEXT_PROVENANCE;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.maxBytesPerText = options.maxBytesPerText ?? DEFAULT_MAX_BYTES_PER_TEXT;
    this.admission = options.admission ?? new HeuristicExperienceAdmissionAdapter();
  }

  public async ingest(
    input: ExperienceSourceIngestInput = {},
  ): Promise<ExperienceSourceIngestResult> {
    const loaded = this.loadTexts();
    const cursor = buildExperienceCursor(
      loaded.texts.map((text) => `${text.sourceRef}:${text.digest}`),
    );
    const adapter = this.createAdapterDeclaration(cursor);

    if (input.sinceCursor === cursor) {
      return {
        status: "ok",
        adapter,
        cursor,
        artifacts: [],
        candidates: [],
        quarantined: [],
        notes: ["No pasted text changes detected.", ...loaded.notes],
      };
    }

    return {
      status: "ok",
      adapter,
      cursor,
      artifacts: loaded.artifacts,
      candidates: await Promise.all(
        loaded.texts.map((text) => this.createCandidate(adapter, text)),
      ),
      quarantined: loaded.quarantined,
      notes: [
        `Materialized ${loaded.texts.length} pasted text experience candidate(s).`,
        ...loaded.notes,
      ],
    };
  }

  private loadTexts(): {
    readonly texts: readonly LoadedPastedText[];
    readonly artifacts: readonly ExperienceSourceArtifact[];
    readonly quarantined: readonly ExperienceQuarantineRecord[];
    readonly notes: readonly string[];
  } {
    const inputs = this.options.texts
      .map((text, index) => ({ text, index }))
      .filter(({ text }) => text.content.trim().length > 0);
    if (inputs.length === 0) {
      throw new Error("Pasted text experience adapter requires at least one non-empty text.");
    }

    const texts: LoadedPastedText[] = [];
    const artifacts: ExperienceSourceArtifact[] = [];
    const quarantined: ExperienceQuarantineRecord[] = [];
    const notes: string[] = [];

    for (const { text, index } of inputs) {
      const title = text.title?.trim() || `Pasted text ${index + 1}`;
      const content = limitExperienceTextByBytes(text.content.trim(), this.maxBytesPerText);
      if (Buffer.byteLength(text.content, "utf8") > this.maxBytesPerText) {
        notes.push(`Truncated pasted text ${index + 1}: larger than maxBytesPerText.`);
      }
      const relativePath = `${String(index + 1).padStart(2, "0")}-${slugify(title)}.txt`;
      const sourceRef = text.sourceRef ?? `${this.sourceRef}#${relativePath}`;
      const decision = this.admission.admit({
        profile: "local-text",
        sourceId: this.options.sourceId,
        sourceKind: "pasted-text",
        sourceRef,
        title,
        path: relativePath,
        ...(text.contentType === undefined ? {} : { contentType: text.contentType }),
        rawContent: content,
        privacy: this.privacy,
        provenance: this.provenance,
        capturedAtMs: this.nowMs(),
        quarantineNotes: ["Pasted text requires reusable content before candidate creation."],
      });
      artifacts.push(decision.artifact);
      if (decision.status === "quarantined") {
        quarantined.push(decision.quarantine);
        notes.push(...decision.notes);
        continue;
      }
      texts.push({
        relativePath,
        title,
        content: decision.readableContent,
        digest: decision.artifact.digest,
        bytes: decision.artifact.bytes,
        sourceRef,
        artifact: decision.artifact,
        ...(text.contentType === undefined ? {} : { contentType: text.contentType }),
      });
    }

    return {
      texts,
      artifacts,
      quarantined,
      notes,
    };
  }

  private createAdapterDeclaration(cursor: string): ExperienceSourceAdapterDeclaration {
    return createExperienceSourceAdapterDeclaration({
      adapterId: this.adapterId,
      sourceKind: "pasted-text",
      sourceRef: this.sourceRef,
      privacy: this.privacy,
      incremental: {
        cursor,
        fingerprint: cursor,
      },
      transformations: this.options.transformations ?? [
        {
          transformId: "normalize",
          kind: "normalize",
          summary: "Normalize user-pasted text into a preserved source snapshot.",
          privacyImpact: this.privacy,
        },
        {
          transformId: "distill-experience",
          kind: "extract-pattern",
          summary: "Distill pasted source text into reviewable operating experience.",
          privacyImpact: this.privacy,
        },
        {
          transformId: "summarize",
          kind: "summarize",
          summary: "Summarize pasted user text into review-gated experience candidates.",
        },
      ],
    });
  }

  private async createCandidate(
    adapter: ExperienceSourceAdapterDeclaration,
    text: LoadedPastedText,
  ): Promise<ExperienceCandidate> {
    const draft = await distillExperienceDraftWithAdapter(
      {
        sourceKind: "pasted-text",
        sourceId: this.options.sourceId,
        title: text.title,
        content: text.content,
        privacy: this.privacy,
        fallbackApplicability:
          "Use when Director Angel needs reusable operating experience from user-pasted material.",
        baseRisks: [
          "Pasted material may include private, stale, or unattributed guidance until reviewed.",
          `Privacy classification: ${this.privacy}.`,
        ],
        baseTags: [
          "external-reference",
          "source:pasted-text",
          `pasted:${slugify(this.options.sourceId)}`,
        ],
      },
      this.options.distiller,
    );
    return createExperienceCandidate({
      candidateId: `experience_${slugify(this.options.sourceId)}_${shortHash(
        `${text.sourceRef}:${text.digest}`,
      )}`,
      sourceAdapter: adapter,
      title: `Pasted lesson: ${text.title}`,
      summary: draft.summary,
      applicability: draft.applicability,
      risks: draft.risks,
      tags: draft.tags,
      evidence: [
        {
          evidenceId: `evidence_${slugify(this.options.sourceId)}_${shortHash(text.sourceRef)}`,
          sourceRef: text.sourceRef,
          path: text.relativePath,
          summary: draft.evidenceSummary,
          attributes: {
            digest: text.digest,
            bytes: text.bytes,
            artifactId: text.artifact.artifactId,
            qualityScore: text.artifact.quality.score,
            ...(text.contentType === undefined ? {} : { contentType: text.contentType }),
          },
        },
      ],
      sourceArtifactId: text.artifact.artifactId,
      sourceDigest: text.digest,
      evidencePreview: previewExperienceText(
        text.content,
        DEFAULT_CANDIDATE_EVIDENCE_PREVIEW_CHARS,
      ),
      quality: text.artifact.quality,
      privacy: this.privacy,
      provenance: this.provenance,
      createdAtMs: this.nowMs(),
    });
  }
}

export class WebExperienceSourceAdapter implements ExperienceSourceIngestAdapter {
  public readonly adapterId: string;

  private readonly sourceRef: string;
  private readonly privacy: ExperiencePrivacyClassification;
  private readonly provenance: string;
  private readonly nowMs: () => number;
  private readonly fetchText: WebExperienceFetchText;
  private readonly maxBytesPerPage: number;
  private readonly admission: ExperienceAdmissionAdapter;

  public constructor(private readonly options: WebExperienceSourceAdapterOptions) {
    this.adapterId = `web_page_${slugify(options.sourceId)}`;
    this.sourceRef = options.sourceRef ?? `web://${slugify(options.sourceId)}`;
    this.privacy = options.privacy ?? "public";
    this.provenance = options.provenance ?? DEFAULT_WEB_PROVENANCE;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.fetchText = options.fetchText ?? fetchWebText;
    this.maxBytesPerPage = options.maxBytesPerPage ?? DEFAULT_MAX_BYTES_PER_PAGE;
    this.admission = options.admission ?? new HeuristicExperienceAdmissionAdapter();
  }

  public async ingest(
    input: ExperienceSourceIngestInput = {},
  ): Promise<ExperienceSourceIngestResult> {
    const loaded = await this.loadPages();
    const pages = loaded.pages;
    const cursor = buildExperienceCursor(
      loaded.artifacts.map((artifact) => `${artifact.sourceRef}:${artifact.digest}`),
    );
    const adapter = this.createAdapterDeclaration(cursor);

    if (input.sinceCursor === cursor) {
      return {
        status: "ok",
        adapter,
        cursor,
        artifacts: [],
        candidates: [],
        quarantined: [],
        notes: ["No web page changes detected.", ...loaded.notes],
      };
    }

    return {
      status: "ok",
      adapter,
      cursor,
      artifacts: loaded.artifacts,
      candidates: await Promise.all(pages.map((page) => this.createCandidate(adapter, page))),
      quarantined: loaded.quarantined,
      notes: [`Materialized ${pages.length} web page experience candidate(s).`, ...loaded.notes],
    };
  }

  private async loadPages(): Promise<{
    readonly pages: readonly LoadedWebPage[];
    readonly artifacts: readonly ExperienceSourceArtifact[];
    readonly quarantined: readonly ExperienceQuarantineRecord[];
    readonly notes: readonly string[];
  }> {
    const urls = [...new Set(this.options.urls)].sort((left, right) => left.localeCompare(right));
    const pages: LoadedWebPage[] = [];
    const artifacts: ExperienceSourceArtifact[] = [];
    const quarantined: ExperienceQuarantineRecord[] = [];
    const notes: string[] = [];

    for (const url of urls) {
      assertSafeWebUrl(url);
      let fetched: WebExperienceFetchResult;
      try {
        fetched = await this.fetchText(url);
      } catch (error) {
        const decision = this.admitFetchFailure(url, error);
        artifacts.push(decision.artifact);
        if (decision.status === "quarantined") {
          quarantined.push(decision.quarantine);
        }
        notes.push(`${decision.notes.join(" ")} (${toErrorMessage(error)}).`);
        continue;
      }
      const body = limitExperienceTextByBytes(fetched.body, this.maxBytesPerPage);
      const decision = this.admission.admit({
        profile: "web-text",
        sourceId: this.options.sourceId,
        sourceKind: "web-page",
        sourceRef: fetched.url,
        title: extractTitle(body) ?? hostLabel(url),
        ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType }),
        rawContent: body,
        ...(fetched.structuredContent === undefined
          ? {}
          : { structuredContent: fetched.structuredContent }),
        privacy: this.privacy,
        provenance: this.provenance,
        capturedAtMs: this.nowMs(),
        quarantineNotes: [
          "Direct URL learning requires readable source content before candidate creation.",
        ],
      });
      artifacts.push(decision.artifact);
      if (decision.status === "quarantined") {
        quarantined.push(decision.quarantine);
        notes.push(...decision.notes);
        continue;
      }
      pages.push({
        url: fetched.url,
        title: extractTitle(body) ?? hostLabel(url),
        content: decision.readableContent,
        digest: decision.artifact.digest,
        bytes: decision.artifact.bytes,
        artifact: decision.artifact,
        ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType }),
      });
    }

    return {
      pages,
      artifacts,
      quarantined,
      notes,
    };
  }

  private createAdapterDeclaration(cursor: string): ExperienceSourceAdapterDeclaration {
    return createExperienceSourceAdapterDeclaration({
      adapterId: this.adapterId,
      sourceKind: "web-page",
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
          summary: "Summarize selected web pages into review-gated experience candidates.",
        },
        {
          transformId: "distill-experience",
          kind: "extract-pattern",
          summary: "Distill raw web source content into reviewable operating experience.",
          privacyImpact: this.privacy,
        },
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable direction patterns from public web references.",
          privacyImpact: this.privacy,
        },
      ],
    });
  }

  private async createCandidate(
    adapter: ExperienceSourceAdapterDeclaration,
    page: LoadedWebPage,
  ): Promise<ExperienceCandidate> {
    const artifactId = page.artifact.artifactId;
    const draft = await distillExperienceDraftWithAdapter(
      {
        sourceKind: "web-page",
        sourceId: this.options.sourceId,
        title: page.title,
        content: page.content,
        privacy: this.privacy,
        fallbackApplicability:
          "Use when Director Angel needs reusable operating experience from selected web references.",
        baseRisks: [
          "Web content is untrusted until reviewed.",
          "Web guidance may be stale, promotional, or incompatible with local policy.",
        ],
        baseTags: [
          "external-reference",
          "source:web-page",
          `web:${slugify(this.options.sourceId)}`,
        ],
      },
      this.options.distiller,
    );
    return createExperienceCandidate({
      candidateId: `experience_${slugify(this.options.sourceId)}_${shortHash(
        `${page.url}:${page.digest}`,
      )}`,
      sourceAdapter: adapter,
      title: `Web lesson: ${page.title}`,
      summary: draft.summary,
      applicability: draft.applicability,
      risks: draft.risks,
      tags: draft.tags,
      evidence: [
        {
          evidenceId: `evidence_${slugify(this.options.sourceId)}_${shortHash(page.url)}`,
          sourceRef: page.url,
          summary: draft.evidenceSummary,
          attributes: {
            digest: page.digest,
            bytes: page.bytes,
            artifactId,
            qualityScore: page.artifact.quality.score,
            ...(page.contentType === undefined ? {} : { contentType: page.contentType }),
          },
        },
      ],
      sourceArtifactId: artifactId,
      sourceDigest: page.digest,
      evidencePreview: previewExperienceText(
        page.content,
        DEFAULT_CANDIDATE_EVIDENCE_PREVIEW_CHARS,
      ),
      quality: page.artifact.quality,
      privacy: this.privacy,
      provenance: this.provenance,
      createdAtMs: this.nowMs(),
    });
  }

  private admitFetchFailure(url: string, error: unknown): ExperienceAdmissionDecision {
    const rawContent = `Fetch failed for ${url}: ${toErrorMessage(error)}`;
    return this.admission.admit({
      profile: "fetch-failure",
      sourceId: this.options.sourceId,
      sourceKind: "web-page",
      sourceRef: url,
      title: hostLabel(url),
      rawContent,
      fetchErrorMessage: toErrorMessage(error),
      privacy: this.privacy,
      provenance: this.provenance,
      capturedAtMs: this.nowMs(),
      quarantineNotes: [
        "Direct URL learning requires readable source content before candidate creation.",
      ],
    });
  }
}

export class WebSearchExperienceAdapter implements ExperienceSourceIngestAdapter {
  public readonly adapterId: string;

  private readonly sourceRef: string;
  private readonly privacy: ExperiencePrivacyClassification;
  private readonly provenance: string;
  private readonly nowMs: () => number;
  private readonly search: WebExperienceSearch;
  private readonly fetchText: WebExperienceFetchText;
  private readonly maxResultsPerQuery: number;
  private readonly maxBytesPerPage: number;
  private readonly admission: ExperienceAdmissionAdapter;

  public constructor(private readonly options: WebSearchExperienceAdapterOptions) {
    this.adapterId = `web_search_${slugify(options.sourceId)}`;
    this.sourceRef = options.sourceRef ?? `search://${slugify(options.sourceId)}`;
    this.privacy = options.privacy ?? "public";
    this.provenance = options.provenance ?? DEFAULT_WEB_SEARCH_PROVENANCE;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.search = options.search ?? fetchDuckDuckGoSearchResults;
    this.fetchText = options.fetchText ?? fetchWebText;
    this.maxResultsPerQuery = options.maxResultsPerQuery ?? DEFAULT_MAX_RESULTS_PER_QUERY;
    this.maxBytesPerPage = options.maxBytesPerPage ?? DEFAULT_MAX_BYTES_PER_PAGE;
    this.admission = options.admission ?? new HeuristicExperienceAdmissionAdapter();
  }

  public async ingest(
    input: ExperienceSourceIngestInput = {},
  ): Promise<ExperienceSourceIngestResult> {
    const loaded = await this.loadPages();
    const pages = loaded.pages;
    const cursor = buildExperienceCursor(
      loaded.artifacts.map((artifact) => `${artifact.sourceRef}:${artifact.digest}`),
    );
    const adapter = this.createAdapterDeclaration(cursor);

    if (input.sinceCursor === cursor) {
      return {
        status: "ok",
        adapter,
        cursor,
        artifacts: [],
        candidates: [],
        quarantined: [],
        notes: ["No web search result changes detected.", ...loaded.notes],
      };
    }

    return {
      status: "ok",
      adapter,
      cursor,
      artifacts: loaded.artifacts,
      candidates: await Promise.all(pages.map((page) => this.createCandidate(adapter, page))),
      quarantined: loaded.quarantined,
      notes: [`Materialized ${pages.length} web search experience candidate(s).`, ...loaded.notes],
    };
  }

  private async loadPages(): Promise<{
    readonly pages: readonly LoadedWebSearchPage[];
    readonly artifacts: readonly ExperienceSourceArtifact[];
    readonly quarantined: readonly ExperienceQuarantineRecord[];
    readonly notes: readonly string[];
  }> {
    const queries = [...new Set(this.options.queries.map((query) => query.trim()))]
      .filter((query) => query.length > 0)
      .sort((left, right) => left.localeCompare(right));
    if (queries.length === 0) {
      throw new Error("Web search experience adapter requires at least one non-empty query.");
    }

    const pages: LoadedWebSearchPage[] = [];
    const artifacts: ExperienceSourceArtifact[] = [];
    const quarantined: ExperienceQuarantineRecord[] = [];
    const notes: string[] = [];
    const seenUrls = new Set<string>();

    for (const query of queries) {
      const results = await this.search(query, {
        maxResults: this.maxResultsPerQuery,
      });
      const limitedResults = results.slice(0, this.maxResultsPerQuery);

      for (const [index, result] of limitedResults.entries()) {
        assertSafeWebUrl(result.url);
        if (seenUrls.has(result.url)) {
          continue;
        }
        seenUrls.add(result.url);

        let fetched: WebExperienceFetchResult;
        try {
          fetched = await this.fetchText(result.url);
        } catch (error) {
          const decision = this.admitFetchFailure(result, query, index + 1, error);
          artifacts.push(decision.artifact);
          if (decision.status === "quarantined") {
            quarantined.push(decision.quarantine);
          }
          notes.push(`${decision.notes.join(" ")} (${toErrorMessage(error)}).`);
          continue;
        }
        const body = limitExperienceTextByBytes(fetched.body, this.maxBytesPerPage);
        const decision = this.admission.admit({
          profile: "web-text",
          sourceId: this.options.sourceId,
          sourceKind: "web-search",
          sourceRef: fetched.url,
          title: extractTitle(body) ?? result.title,
          ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType }),
          rawContent: body,
          ...(fetched.structuredContent === undefined
            ? {}
            : { structuredContent: fetched.structuredContent }),
          privacy: this.privacy,
          provenance: this.provenance,
          capturedAtMs: this.nowMs(),
          quarantineNotes: [
            `Search query: ${query}`,
            `Search rank: ${index + 1}`,
            "Search results must pass readable-content gates before candidate creation.",
          ],
        });
        artifacts.push(decision.artifact);
        if (decision.status === "quarantined") {
          quarantined.push(decision.quarantine);
          notes.push(...decision.notes);
          continue;
        }
        pages.push({
          query,
          rank: index + 1,
          url: fetched.url,
          title: extractTitle(body) ?? result.title,
          resultTitle: result.title,
          ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
          content: decision.readableContent,
          digest: decision.artifact.digest,
          bytes: decision.artifact.bytes,
          artifact: decision.artifact,
          ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType }),
        });
      }
    }

    return {
      pages: pages.sort(compareSearchPages),
      artifacts: artifacts.sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
      quarantined: quarantined.sort((left, right) =>
        left.quarantineId.localeCompare(right.quarantineId),
      ),
      notes,
    };
  }

  private createAdapterDeclaration(cursor: string): ExperienceSourceAdapterDeclaration {
    return createExperienceSourceAdapterDeclaration({
      adapterId: this.adapterId,
      sourceKind: "web-search",
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
          summary: "Summarize searched web pages into review-gated experience candidates.",
        },
        {
          transformId: "distill-experience",
          kind: "extract-pattern",
          summary: "Distill raw searched web content into reviewable operating experience.",
          privacyImpact: this.privacy,
        },
        {
          transformId: "extract-pattern",
          kind: "extract-pattern",
          summary: "Extract reusable operating patterns from searched web references.",
          privacyImpact: this.privacy,
        },
      ],
    });
  }

  private async createCandidate(
    adapter: ExperienceSourceAdapterDeclaration,
    page: LoadedWebSearchPage,
  ): Promise<ExperienceCandidate> {
    const artifactId = page.artifact.artifactId;
    const draft = await distillExperienceDraftWithAdapter(
      {
        sourceKind: "web-search",
        sourceId: this.options.sourceId,
        title: page.title,
        content: page.content,
        privacy: this.privacy,
        fallbackApplicability:
          "Use when Director Angel needs reusable operating experience discovered from web search.",
        baseRisks: [
          "Search results are untrusted until reviewed.",
          "Search ranking may be noisy, promotional, stale, or incompatible with local policy.",
        ],
        baseTags: [
          "external-reference",
          "source:web-search",
          `web:${slugify(this.options.sourceId)}`,
          `query:${slugify(page.query)}`,
        ],
      },
      this.options.distiller,
    );
    return createExperienceCandidate({
      candidateId: `experience_${slugify(this.options.sourceId)}_${shortHash(
        `${page.query}:${page.url}:${page.digest}`,
      )}`,
      sourceAdapter: adapter,
      title: `Search lesson: ${page.title}`,
      summary: draft.summary,
      applicability: draft.applicability,
      risks: draft.risks,
      tags: draft.tags,
      evidence: [
        {
          evidenceId: `evidence_${slugify(this.options.sourceId)}_${shortHash(
            `${page.query}:${page.url}`,
          )}`,
          sourceRef: page.url,
          summary: draft.evidenceSummary,
          attributes: {
            digest: page.digest,
            bytes: page.bytes,
            artifactId,
            qualityScore: page.artifact.quality.score,
            query: page.query,
            rank: page.rank,
            resultTitle: page.resultTitle,
            ...(page.snippet === undefined ? {} : { snippet: page.snippet }),
            ...(page.contentType === undefined ? {} : { contentType: page.contentType }),
          },
        },
      ],
      sourceArtifactId: artifactId,
      sourceDigest: page.digest,
      evidencePreview: previewExperienceText(
        page.content,
        DEFAULT_CANDIDATE_EVIDENCE_PREVIEW_CHARS,
      ),
      quality: page.artifact.quality,
      privacy: this.privacy,
      provenance: this.provenance,
      createdAtMs: this.nowMs(),
    });
  }

  private admitFetchFailure(
    result: WebSearchResult,
    query: string,
    rank: number,
    error: unknown,
  ): ExperienceAdmissionDecision {
    const rawContent = `Fetch failed for search result ${rank} (${query}) ${result.url}: ${toErrorMessage(error)}`;
    return this.admission.admit({
      profile: "fetch-failure",
      sourceId: this.options.sourceId,
      sourceKind: "web-search",
      sourceRef: result.url,
      title: result.title,
      rawContent,
      fetchErrorMessage: toErrorMessage(error),
      privacy: this.privacy,
      provenance: this.provenance,
      capturedAtMs: this.nowMs(),
      quarantineNotes: [
        `Search query: ${query}`,
        `Search rank: ${rank}`,
        "Search results must pass readable-content gates before candidate creation.",
      ],
    });
  }
}

export class SelfLearningOrchestrator {
  public constructor(private readonly options: SelfLearningOrchestratorOptions) {}

  public async learn(input: SelfLearningRunInput = {}): Promise<SelfLearningRunResult> {
    const reports: SelfLearningAdapterReport[] = [];
    const nextCursors: Record<string, string> = {};
    const notes: string[] = [];
    const candidateIds: string[] = [];
    const artifactIds: string[] = [];
    const quarantineIds: string[] = [];
    let candidateCount = 0;
    let artifactCount = 0;
    let quarantineCount = 0;
    let degraded = false;

    for (const adapter of this.options.adapters) {
      try {
        const sinceCursor = input.sinceCursors?.[adapter.adapterId];
        const result = await adapter.ingest(
          sinceCursor === undefined
            ? {}
            : {
                sinceCursor,
              },
        );
        const adapterArtifactIds = result.artifacts.map((artifact) => artifact.artifactId);
        const adapterCandidateIds = result.candidates.map((candidate) => candidate.candidateId);
        const adapterQuarantineIds = result.quarantined.map((record) => record.quarantineId);
        let storedArtifactCount = 0;
        for (const artifact of result.artifacts) {
          const write = await this.options.store.writeSourceArtifact(artifact);
          notes.push(...write.notes);
          if (write.status === "ok") {
            storedArtifactCount += 1;
          } else {
            degraded = true;
          }
        }
        let storedCount = 0;
        for (const candidate of result.candidates) {
          const write = await this.options.store.writeCandidate(candidate);
          notes.push(...write.notes);
          if (write.status === "ok") {
            storedCount += 1;
          } else {
            degraded = true;
          }
        }
        let storedQuarantineCount = 0;
        for (const record of result.quarantined) {
          const write = await this.options.store.writeQuarantineRecord(record);
          notes.push(...write.notes);
          if (write.status === "ok") {
            storedQuarantineCount += 1;
          } else {
            degraded = true;
          }
        }

        nextCursors[adapter.adapterId] = result.cursor;
        artifactCount += result.artifacts.length;
        candidateCount += result.candidates.length;
        quarantineCount += result.quarantined.length;
        artifactIds.push(...adapterArtifactIds);
        candidateIds.push(...adapterCandidateIds);
        quarantineIds.push(...adapterQuarantineIds);
        reports.push({
          adapterId: adapter.adapterId,
          sourceKind: result.adapter.sourceKind,
          cursor: result.cursor,
          artifactCount: result.artifacts.length,
          storedArtifactCount,
          candidateCount: result.candidates.length,
          storedCount,
          candidateIds: adapterCandidateIds,
          quarantineCount: result.quarantined.length,
          storedQuarantineCount,
          artifactIds: adapterArtifactIds,
          quarantineIds: adapterQuarantineIds,
          notes: result.notes,
        });
      } catch (error) {
        degraded = true;
        notes.push(
          `Self-learning adapter ${adapter.adapterId} degraded: ${toErrorMessage(error)}.`,
        );
      }
    }

    return {
      status: degraded ? "degraded" : "ok",
      candidateCount,
      artifactCount,
      quarantineCount,
      candidateIds: sortUniqueStrings(candidateIds),
      artifactIds: sortUniqueStrings(artifactIds),
      quarantineIds: sortUniqueStrings(quarantineIds),
      nextCursors,
      adapterReports: reports,
      notes,
    };
  }
}

async function fetchWebText(url: string): Promise<WebExperienceFetchResult> {
  assertSafeWebUrl(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Web source fetch failed for ${url}: HTTP ${response.status}.`);
  }

  return {
    url: response.url || url,
    body: await response.text(),
    ...(response.headers.get("content-type") === null
      ? {}
      : { contentType: response.headers.get("content-type") as string }),
  };
}

async function fetchDuckDuckGoSearchResults(
  query: string,
  options: {
    readonly maxResults: number;
  },
): Promise<readonly WebSearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "user-agent": "DirectorAngelSelfLearning/0.1",
    },
  });
  if (!response.ok) {
    throw new Error(`Web search failed for "${query}": HTTP ${response.status}.`);
  }

  return parseDuckDuckGoHtml(await response.text()).slice(0, options.maxResults);
}

function parseDuckDuckGoHtml(html: string): readonly WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const anchorPattern =
    /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = decodeHtmlEntity(match[1] ?? "");
    const url = resolveSearchResultUrl(rawHref);
    if (url === null) {
      continue;
    }
    try {
      assertSafeWebUrl(url);
    } catch {
      continue;
    }
    const title = normalizeWhitespace((match[2] ?? "").replace(/<[^>]+>/gu, " "));
    if (title.length === 0) {
      continue;
    }
    results.push({
      url,
      title,
    });
  }
  return dedupeSearchResults(results);
}

function resolveSearchResultUrl(rawHref: string): string | null {
  if (rawHref.length === 0) {
    return null;
  }
  try {
    const url = rawHref.startsWith("//")
      ? new URL(`https:${rawHref}`)
      : new URL(rawHref, "https://html.duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    return redirected ?? url.href;
  } catch {
    return null;
  }
}

function dedupeSearchResults(results: readonly WebSearchResult[]): readonly WebSearchResult[] {
  const byUrl = new Map<string, WebSearchResult>();
  for (const result of results) {
    if (!byUrl.has(result.url)) {
      byUrl.set(result.url, result);
    }
  }
  return [...byUrl.values()];
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
}

function assertSafeWebUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Web experience source URL is invalid: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Web experience source URL must use http or https.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Web experience source URL must not include credentials.");
  }
}

function extractTitle(body: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(body);
  if (match?.[1] === undefined) {
    return null;
  }
  const title = normalizeWhitespace(match[1]);
  return title.length === 0 ? null : title;
}

function normalizeWhitespace(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function compareDocuments(left: LoadedExperienceDocument, right: LoadedExperienceDocument): number {
  return left.relativePath.localeCompare(right.relativePath);
}

function compareSearchPages(left: LoadedWebSearchPage, right: LoadedWebSearchPage): number {
  return (
    left.query.localeCompare(right.query) ||
    left.rank - right.rank ||
    left.url.localeCompare(right.url)
  );
}

function sortUniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
