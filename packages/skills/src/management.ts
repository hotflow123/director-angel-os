import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const SKILL_MANAGEMENT_SCHEMA_VERSION = "skills.management.v1" as const;

export interface SkillEnablementDecision {
  readonly skillId: string;
  readonly enabled: boolean;
  readonly decidedAtMs: number;
  readonly decidedBy: string;
  readonly note?: string;
}

export interface SkillManagementDocument {
  readonly schemaVersion: typeof SKILL_MANAGEMENT_SCHEMA_VERSION;
  readonly updatedAtMs: number;
  readonly updatedBy: string;
  readonly disabledSkillIds: readonly string[];
  readonly removedSkillIds: readonly string[];
  readonly decisions: readonly SkillEnablementDecision[];
}

export interface SkillManagementStoreOptions {
  readonly now?: () => number;
}

export interface SetSkillEnabledOptions {
  readonly actor?: string;
  readonly note?: string;
  readonly nowMs?: number;
}

export class SkillManagementStore {
  private readonly now: () => number;

  public constructor(
    public readonly filePath: string,
    options: SkillManagementStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  public readDocument(): SkillManagementDocument {
    if (!existsSync(this.filePath)) {
      return createEmptySkillManagementDocument();
    }

    const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    const document = parseSkillManagementDocument(raw);
    if (document === null) {
      throw new Error(`Invalid skill management document: ${this.filePath}`);
    }
    return cloneSkillManagementDocument(document);
  }

  public isSkillEnabled(skillId: string): boolean {
    return !this.readDocument().disabledSkillIds.includes(skillId);
  }

  public getDecision(skillId: string): SkillEnablementDecision | null {
    return this.readDocument().decisions.find((decision) => decision.skillId === skillId) ?? null;
  }

  public setSkillEnabled(
    skillId: string,
    enabled: boolean,
    options: SetSkillEnabledOptions = {},
  ): SkillEnablementDecision {
    const normalizedSkillId = normalizeSkillId(skillId);
    const decidedAtMs = normalizeNowMs(options.nowMs, this.now);
    const decidedBy = normalizeActor(options.actor);
    const note = normalizeOptionalText(options.note);
    const document = this.readDocument();
    const disabledSkillIds = new Set(document.disabledSkillIds);
    const removedSkillIds = new Set(document.removedSkillIds);
    if (enabled) {
      disabledSkillIds.delete(normalizedSkillId);
    } else {
      disabledSkillIds.add(normalizedSkillId);
    }
    removedSkillIds.delete(normalizedSkillId);

    const decision: SkillEnablementDecision = {
      skillId: normalizedSkillId,
      enabled,
      decidedAtMs,
      decidedBy,
      ...(note === undefined ? {} : { note }),
    };
    const decisions = [
      ...document.decisions.filter((entry) => entry.skillId !== normalizedSkillId),
      decision,
    ].sort(compareDecision);

    this.writeDocument({
      schemaVersion: SKILL_MANAGEMENT_SCHEMA_VERSION,
      updatedAtMs: decidedAtMs,
      updatedBy: decidedBy,
      disabledSkillIds: [...disabledSkillIds].sort(),
      removedSkillIds: [...removedSkillIds].sort(),
      decisions,
    });
    return { ...decision };
  }

  public removeSkill(
    skillId: string,
    options: Pick<SetSkillEnabledOptions, "actor" | "nowMs"> = {},
  ): SkillManagementDocument {
    const normalizedSkillId = normalizeSkillId(skillId);
    const updatedAtMs = normalizeNowMs(options.nowMs, this.now);
    const updatedBy = normalizeActor(options.actor);
    const document = this.readDocument();
    const disabledSkillIds = document.disabledSkillIds.filter(
      (entry) => entry !== normalizedSkillId,
    );
    const removedSkillIds = [...new Set([...document.removedSkillIds, normalizedSkillId])].sort();
    const decisions = document.decisions.filter(
      (decision) => decision.skillId !== normalizedSkillId,
    );
    const nextDocument: SkillManagementDocument = {
      schemaVersion: SKILL_MANAGEMENT_SCHEMA_VERSION,
      updatedAtMs,
      updatedBy,
      disabledSkillIds,
      removedSkillIds,
      decisions,
    };
    this.writeDocument(nextDocument);
    return cloneSkillManagementDocument(nextDocument);
  }

  public pruneSkills(
    skillIds: readonly string[],
    options: Pick<SetSkillEnabledOptions, "actor" | "nowMs"> = {},
  ): SkillManagementDocument {
    const allowed = new Set(skillIds.map(normalizeSkillId));
    const updatedAtMs = normalizeNowMs(options.nowMs, this.now);
    const updatedBy = normalizeActor(options.actor);
    const document = this.readDocument();
    const nextDocument: SkillManagementDocument = {
      schemaVersion: SKILL_MANAGEMENT_SCHEMA_VERSION,
      updatedAtMs,
      updatedBy,
      disabledSkillIds: document.disabledSkillIds.filter((entry) => allowed.has(entry)),
      removedSkillIds: document.removedSkillIds,
      decisions: document.decisions.filter((decision) => allowed.has(decision.skillId)),
    };
    this.writeDocument(nextDocument);
    return cloneSkillManagementDocument(nextDocument);
  }

  private writeDocument(document: SkillManagementDocument): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${document.updatedAtMs}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
  }
}

export function resolveSkillManagementPath(
  config: { dataDir: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HOTFLOW_SKILLS_MANAGEMENT_PATH?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(join(config.dataDir, "skills", "management.json"));
}

function createEmptySkillManagementDocument(): SkillManagementDocument {
  return {
    schemaVersion: SKILL_MANAGEMENT_SCHEMA_VERSION,
    updatedAtMs: 0,
    updatedBy: "system",
    disabledSkillIds: [],
    removedSkillIds: [],
    decisions: [],
  };
}

function parseSkillManagementDocument(value: unknown): SkillManagementDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.schemaVersion !== SKILL_MANAGEMENT_SCHEMA_VERSION ||
    typeof value.updatedAtMs !== "number" ||
    typeof value.updatedBy !== "string" ||
    !isStringArray(value.disabledSkillIds) ||
    (value.removedSkillIds !== undefined && !isStringArray(value.removedSkillIds)) ||
    !Array.isArray(value.decisions)
  ) {
    return null;
  }
  const decisions = value.decisions.map(parseSkillEnablementDecision);
  if (decisions.some((decision) => decision === null)) {
    return null;
  }
  return {
    schemaVersion: SKILL_MANAGEMENT_SCHEMA_VERSION,
    updatedAtMs: value.updatedAtMs,
    updatedBy: value.updatedBy,
    disabledSkillIds: [...uniqueStrings(value.disabledSkillIds)].sort(),
    removedSkillIds: [...uniqueStrings(value.removedSkillIds ?? [])].sort(),
    decisions: decisions.filter(
      (decision): decision is SkillEnablementDecision => decision !== null,
    ),
  };
}

function parseSkillEnablementDecision(value: unknown): SkillEnablementDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.skillId !== "string" ||
    value.skillId.trim().length === 0 ||
    typeof value.enabled !== "boolean" ||
    typeof value.decidedAtMs !== "number" ||
    typeof value.decidedBy !== "string"
  ) {
    return null;
  }
  if (value.note !== undefined && typeof value.note !== "string") {
    return null;
  }
  return {
    skillId: value.skillId,
    enabled: value.enabled,
    decidedAtMs: value.decidedAtMs,
    decidedBy: value.decidedBy,
    ...(value.note === undefined ? {} : { note: value.note }),
  };
}

function cloneSkillManagementDocument(document: SkillManagementDocument): SkillManagementDocument {
  return {
    schemaVersion: document.schemaVersion,
    updatedAtMs: document.updatedAtMs,
    updatedBy: document.updatedBy,
    disabledSkillIds: [...document.disabledSkillIds],
    removedSkillIds: [...document.removedSkillIds],
    decisions: document.decisions.map((decision) => ({ ...decision })),
  };
}

function normalizeSkillId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Skill id must not be empty.");
  }
  return trimmed;
}

function normalizeActor(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "director";
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNowMs(value: number | undefined, fallback: () => number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback();
}

function compareDecision(left: SkillEnablementDecision, right: SkillEnablementDecision): number {
  return left.skillId.localeCompare(right.skillId);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
