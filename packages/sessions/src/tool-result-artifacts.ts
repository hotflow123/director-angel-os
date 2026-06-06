import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import type {
  AppendToolResultArtifactInput,
  ReadToolResultArtifactResult,
  SessionRecord,
  ToolResultArtifactPayload,
  ToolResultArtifactRecord,
} from "./types.js";

export const DEFAULT_TOOL_RESULT_PREVIEW_MAX_CHARS = 4_000;

export class ToolResultArtifactStore {
  private readonly rootDir: string;

  public constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  public create(
    session: SessionRecord,
    input: AppendToolResultArtifactInput,
  ): {
    readonly artifact: ToolResultArtifactRecord;
    readonly payload: ToolResultArtifactPayload;
  } {
    const turnId = normalizeNonEmptyText(input.turnId, "turnId");
    const toolUseId = normalizeNonEmptyText(input.toolUseId, "toolUseId");
    const toolName = normalizeNonEmptyText(input.toolName, "toolName");
    const previewMaxChars = normalizePreviewMaxChars(input.previewMaxChars);
    const mimeType = normalizeOptionalText(input.mimeType) ?? "text/plain";
    const sha256 = hashContent(input.content);
    const artifactId = buildArtifactId(toolUseId, sha256);
    const relativePath = join(
      "tool-results",
      sanitizePathSegment(session.sessionId),
      `${artifactId}.txt`,
    );
    const absolutePath = resolve(this.rootDir, relativePath);
    assertInsideRoot(this.rootDir, absolutePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, input.content, "utf8");

    const originalSizeBytes = Buffer.byteLength(input.content, "utf8");
    const replacement =
      input.replacement ??
      `<persisted-output toolUseId="${escapeAttribute(toolUseId)}" artifactId="${escapeAttribute(
        artifactId,
      )}">${buildPreview(input.content, previewMaxChars)}</persisted-output>`;
    const artifact: ToolResultArtifactRecord = {
      sessionId: session.sessionId,
      artifactId,
      relativePath: normalizeRelativePath(relativePath),
      absolutePath,
      sha256,
      mimeType,
      originalSizeBytes,
    };
    const payload: ToolResultArtifactPayload = {
      toolUseId,
      toolName,
      status: input.status,
      contentProjection: {
        originalSizeBytes,
        preview: buildPreview(input.content, previewMaxChars),
        hasMore: input.content.length > previewMaxChars,
        isJson: isJsonContent(input.content, mimeType),
        replacement,
      },
      artifactRef: {
        artifactId,
        relativePath: artifact.relativePath,
        sha256,
        mimeType,
        originalSizeBytes,
      },
    };

    // turnId is validated here so callers get a single artifact-specific error surface.
    void turnId;
    return { artifact, payload };
  }

  public read(sessionId: string, artifactId: string): ReadToolResultArtifactResult {
    const safeSessionId = sanitizePathSegment(normalizeNonEmptyText(sessionId, "sessionId"));
    const safeArtifactId = sanitizePathSegment(normalizeNonEmptyText(artifactId, "artifactId"));
    const relativePath = join("tool-results", safeSessionId, `${safeArtifactId}.txt`);
    const absolutePath = resolve(this.rootDir, relativePath);
    assertInsideRoot(this.rootDir, absolutePath);
    const content = readFileSync(absolutePath, "utf8");
    const sha256 = hashContent(content);
    const hashPrefix = safeArtifactId.slice(safeArtifactId.lastIndexOf("_") + 1);
    if (hashPrefix.length > 0 && !sha256.startsWith(hashPrefix)) {
      throw new Error(`Tool result artifact hash mismatch for "${artifactId}"`);
    }
    const originalSizeBytes = Buffer.byteLength(content, "utf8");
    const artifact: ToolResultArtifactRecord = {
      sessionId,
      artifactId: safeArtifactId,
      relativePath: normalizeRelativePath(relativePath),
      absolutePath,
      sha256,
      mimeType: "text/plain",
      originalSizeBytes,
    };
    return { artifact, content };
  }

  public deleteSessionArtifacts(sessionId: string): void {
    const safeSessionId = sanitizePathSegment(normalizeNonEmptyText(sessionId, "sessionId"));
    const sessionDir = resolve(this.rootDir, join("tool-results", safeSessionId));
    assertInsideRoot(this.rootDir, sessionDir);
    rmSync(sessionDir, { recursive: true, force: true });
  }
}

function normalizePreviewMaxChars(value: number | undefined): number {
  const previewMaxChars = value ?? DEFAULT_TOOL_RESULT_PREVIEW_MAX_CHARS;
  if (!Number.isInteger(previewMaxChars) || previewMaxChars <= 0) {
    throw new RangeError(`previewMaxChars must be a positive integer; received ${previewMaxChars}`);
  }
  return previewMaxChars;
}

function normalizeNonEmptyText(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function buildArtifactId(toolUseId: string, sha256: string): string {
  return `${sanitizePathSegment(toolUseId)}_${sha256.slice(0, 16)}`;
}

function buildPreview(content: string, previewMaxChars: number): string {
  return content.length > previewMaxChars ? content.slice(0, previewMaxChars) : content;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isJsonContent(content: string, mimeType: string): boolean {
  if (/[/+]json\b/u.test(mimeType)) {
    return true;
  }
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 96);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
}

function assertInsideRoot(rootDir: string, absolutePath: string): void {
  const root = resolve(rootDir);
  const target = resolve(absolutePath);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "" || resolve(root, rel) !== target) {
    throw new Error(`Tool result artifact path escapes artifact root: ${absolutePath}`);
  }
}

function normalizeRelativePath(path: string): string {
  return path.split("\\").join("/");
}
