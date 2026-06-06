import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";

import {
  type SkillRepositoryPort,
  type SkillSnapshot,
  cloneSkillSnapshot,
  parseSkillSnapshot,
} from "./repository.js";
import { SkillValidator } from "./validator.js";

export const APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION = "skills.approved.v2" as const;
const LEGACY_APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION = "skills.approved.v1" as const;

export type ApprovedSkillSnapshotChangeKind = "apply" | "rollback" | "manual";

export interface ApprovedSkillSnapshotDocument {
  readonly schemaVersion: typeof APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION;
  readonly version: number;
  readonly updatedAtMs: number;
  readonly appliedAtMs: number;
  readonly appliedFromProposalId: string | null;
  readonly changeKind: ApprovedSkillSnapshotChangeKind;
  readonly previousVersion: number | null;
  readonly restoredFromVersion: number | null;
  readonly skills: readonly SkillSnapshot[];
}

export interface SkillSnapshotFileStoreOptions {
  readonly now?: () => number;
  readonly validator?: SkillValidator;
}

export interface WriteApprovedSkillSnapshotOptions {
  readonly appliedFromProposalId?: string | null;
  readonly changeKind?: ApprovedSkillSnapshotChangeKind;
  readonly restoredFromVersion?: number | null;
}

export class SkillSnapshotFileStore {
  private readonly now: () => number;
  private readonly validator: SkillValidator;

  public constructor(
    public readonly filePath: string,
    options: SkillSnapshotFileStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.validator = options.validator ?? new SkillValidator();
  }

  public readApproved(): readonly SkillSnapshot[] {
    return this.readHead()?.skills.map((snapshot) => cloneSkillSnapshot(snapshot)) ?? [];
  }

  public readHead(): ApprovedSkillSnapshotDocument | null {
    if (!existsSync(this.filePath)) {
      return null;
    }

    const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    const document = parseApprovedSkillSnapshotDocument(raw);
    if (document === null) {
      throw new Error(`Invalid approved skill snapshot document: ${this.filePath}`);
    }

    return cloneApprovedSkillSnapshotDocument(document);
  }

  public readVersion(version: number): ApprovedSkillSnapshotDocument | null {
    const versionPath = this.resolveVersionFilePath(version);
    if (!existsSync(versionPath)) {
      return null;
    }

    const raw = JSON.parse(readFileSync(versionPath, "utf8")) as unknown;
    const document = parseApprovedSkillSnapshotDocument(raw);
    if (document === null) {
      throw new Error(`Invalid approved skill snapshot history document: ${versionPath}`);
    }

    return cloneApprovedSkillSnapshotDocument(document);
  }

  public listHistory(): readonly ApprovedSkillSnapshotDocument[] {
    const historyDir = this.resolveHistoryDirectoryPath();
    if (!existsSync(historyDir)) {
      const head = this.readHead();
      return head === null ? [] : [head];
    }

    return readdirSync(historyDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => join(historyDir, entry))
      .map((entryPath) => {
        const raw = JSON.parse(readFileSync(entryPath, "utf8")) as unknown;
        const document = parseApprovedSkillSnapshotDocument(raw);
        if (document === null) {
          throw new Error(`Invalid approved skill snapshot history document: ${entryPath}`);
        }
        return document;
      })
      .sort((left, right) => left.version - right.version)
      .map((document) => cloneApprovedSkillSnapshotDocument(document));
  }

  public writeApproved(
    skills: readonly SkillSnapshot[],
    options: WriteApprovedSkillSnapshotOptions = {},
  ): ApprovedSkillSnapshotDocument {
    const normalized = skills.map((snapshot) => {
      const validation = this.validator.validateSnapshot(snapshot);
      if (!validation.ok) {
        throw new Error(
          `Invalid approved skill snapshot ${snapshot.id}: ${validation.issues
            .map((issue) => `${issue.field}: ${issue.message}`)
            .join("; ")}`,
        );
      }
      if (validation.value === undefined) {
        throw new Error(
          `Invalid approved skill snapshot ${snapshot.id}: missing normalized value.`,
        );
      }
      return cloneSkillSnapshot(validation.value);
    });

    const currentHead = this.readHead();
    if (currentHead !== null) {
      this.writeHistorySnapshotIfMissing(currentHead);
    }

    const writtenAtMs = this.now();
    const document: ApprovedSkillSnapshotDocument = {
      schemaVersion: APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION,
      version: (currentHead?.version ?? 0) + 1,
      updatedAtMs: writtenAtMs,
      appliedAtMs: writtenAtMs,
      appliedFromProposalId: options.appliedFromProposalId ?? null,
      changeKind:
        options.changeKind ?? (options.appliedFromProposalId === undefined ? "manual" : "apply"),
      previousVersion: currentHead?.version ?? null,
      restoredFromVersion: options.restoredFromVersion ?? null,
      skills: normalized,
    };

    mkdirSync(dirname(this.filePath), { recursive: true });
    this.writeDocumentAtomically(this.filePath, document);
    this.writeHistorySnapshotIfMissing(document);
    return cloneApprovedSkillSnapshotDocument(document);
  }

  public restoreApprovedVersion(
    version: number,
    options: Omit<WriteApprovedSkillSnapshotOptions, "changeKind" | "restoredFromVersion"> = {},
  ): ApprovedSkillSnapshotDocument {
    const target = this.readVersion(version);
    if (target === null) {
      throw new Error(`Unknown approved skill snapshot version: ${version}`);
    }

    return this.writeApproved(target.skills, {
      ...options,
      changeKind: "rollback",
      restoredFromVersion: version,
    });
  }

  public recoverHead(
    previousHead: ApprovedSkillSnapshotDocument | null,
    failedVersion: number,
  ): void {
    if (previousHead === null) {
      rmSync(this.filePath, { force: true });
    } else {
      this.writeDocumentAtomically(this.filePath, previousHead);
    }

    rmSync(this.resolveVersionFilePath(failedVersion), { force: true });
  }

  public readPreviousVersion(): ApprovedSkillSnapshotDocument | null {
    const head = this.readHead();
    if (head?.previousVersion === null || head?.previousVersion === undefined) {
      return null;
    }
    return this.readVersion(head.previousVersion);
  }

  private writeHistorySnapshotIfMissing(document: ApprovedSkillSnapshotDocument): void {
    const historyPath = this.resolveVersionFilePath(document.version);
    if (existsSync(historyPath)) {
      return;
    }
    mkdirSync(this.resolveHistoryDirectoryPath(), { recursive: true });
    this.writeDocumentAtomically(historyPath, document);
  }

  private writeDocumentAtomically(path: string, document: ApprovedSkillSnapshotDocument): void {
    mkdirSync(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${document.updatedAtMs}.${document.version}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    renameSync(tempPath, path);
  }

  private resolveHistoryDirectoryPath(): string {
    return join(dirname(this.filePath), `${basename(this.filePath)}.history`);
  }

  private resolveVersionFilePath(version: number): string {
    const parsed = parse(this.filePath);
    const suffix = String(version).padStart(6, "0");
    const baseName = parsed.ext.length > 0 ? parsed.name : basename(this.filePath);
    return join(this.resolveHistoryDirectoryPath(), `${baseName}.v${suffix}.json`);
  }
}

export class FileBackedSkillRepository implements SkillRepositoryPort {
  public constructor(private readonly store: SkillSnapshotFileStore) {}

  public getApproved(skillId: string): SkillSnapshot | undefined {
    return this.listApproved().find((skill) => skill.id === skillId);
  }

  public listApproved(): readonly SkillSnapshot[] {
    return this.store.readApproved().map((skill) => cloneSkillSnapshot(skill));
  }

  public replaceApproved(skills: readonly SkillSnapshot[]): void {
    this.store.writeApproved(skills);
  }

  public upsertApproved(skill: SkillSnapshot): void {
    const current = new Map(this.store.readApproved().map((entry) => [entry.id, entry] as const));
    current.set(skill.id, cloneSkillSnapshot(skill));
    this.store.writeApproved([...current.values()]);
  }
}

export function resolveApprovedSkillSnapshotPath(
  config: { dataDir: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HOTFLOW_SKILLS_SNAPSHOT_PATH?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(join(config.dataDir, "skills", "approved-skills.json"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseApprovedSkillSnapshotDocument(value: unknown): ApprovedSkillSnapshotDocument | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.updatedAtMs !== "number" || !Array.isArray(value.skills)) {
    return null;
  }

  const skills = value.skills
    .map((entry) => parseSkillSnapshot(entry))
    .filter((entry): entry is SkillSnapshot => entry !== null);

  if (skills.length !== value.skills.length) {
    return null;
  }

  if (value.schemaVersion === LEGACY_APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION) {
    return {
      schemaVersion: APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION,
      version: 1,
      updatedAtMs: value.updatedAtMs,
      appliedAtMs: value.updatedAtMs,
      appliedFromProposalId: null,
      changeKind: "manual",
      previousVersion: null,
      restoredFromVersion: null,
      skills,
    };
  }

  if (
    value.schemaVersion !== APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    typeof value.appliedAtMs !== "number" ||
    (value.appliedFromProposalId !== null && typeof value.appliedFromProposalId !== "string") ||
    (value.changeKind !== "apply" &&
      value.changeKind !== "rollback" &&
      value.changeKind !== "manual") ||
    (value.previousVersion !== null &&
      (typeof value.previousVersion !== "number" ||
        !Number.isInteger(value.previousVersion) ||
        value.previousVersion < 1)) ||
    (value.restoredFromVersion !== null &&
      (typeof value.restoredFromVersion !== "number" ||
        !Number.isInteger(value.restoredFromVersion) ||
        value.restoredFromVersion < 1))
  ) {
    return null;
  }

  return {
    schemaVersion: APPROVED_SKILL_SNAPSHOT_SCHEMA_VERSION,
    version: value.version,
    updatedAtMs: value.updatedAtMs,
    appliedAtMs: value.appliedAtMs,
    appliedFromProposalId: value.appliedFromProposalId,
    changeKind: value.changeKind,
    previousVersion: value.previousVersion,
    restoredFromVersion: value.restoredFromVersion,
    skills,
  };
}

function cloneApprovedSkillSnapshotDocument(
  document: ApprovedSkillSnapshotDocument,
): ApprovedSkillSnapshotDocument {
  return {
    schemaVersion: document.schemaVersion,
    version: document.version,
    updatedAtMs: document.updatedAtMs,
    appliedAtMs: document.appliedAtMs,
    appliedFromProposalId: document.appliedFromProposalId,
    changeKind: document.changeKind,
    previousVersion: document.previousVersion,
    restoredFromVersion: document.restoredFromVersion,
    skills: document.skills.map((snapshot) => cloneSkillSnapshot(snapshot)),
  };
}
