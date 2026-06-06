import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const SKILL_USAGE_SCHEMA_VERSION = "skills.usage.v1" as const;

export type SkillUsageAction = "view" | "use" | "failure" | "patch" | "archive";
export type SkillLifecycleState = "active" | "stale" | "archived";

export interface SkillUsageEvent {
  readonly action: SkillUsageAction;
  readonly occurredAtMs: number;
  readonly actor: string;
  readonly reason?: string;
}

export interface SkillUsageRecord {
  readonly skillId: string;
  readonly viewCount: number;
  readonly useCount: number;
  readonly failureCount: number;
  readonly patchCount: number;
  readonly createdAtMs: number;
  readonly lastViewedAtMs: number | null;
  readonly lastUsedAtMs: number | null;
  readonly lastFailedAtMs: number | null;
  readonly lastPatchedAtMs: number | null;
  readonly lastActivityAtMs: number | null;
  readonly state: SkillLifecycleState;
  readonly pinned: boolean;
  readonly archivedAtMs: number | null;
  readonly events: readonly SkillUsageEvent[];
}

export interface SkillUsageDocument {
  readonly schemaVersion: typeof SKILL_USAGE_SCHEMA_VERSION;
  readonly updatedAtMs: number;
  readonly updatedBy: string;
  readonly records: Readonly<Record<string, SkillUsageRecord>>;
}

export interface SkillUsageStoreOptions {
  readonly now?: () => number;
  readonly maxEventsPerSkill?: number;
}

export interface RecordSkillUsageOptions {
  readonly actor?: string;
  readonly reason?: string;
  readonly nowMs?: number;
}

export class SkillUsageStore {
  private readonly now: () => number;
  private readonly maxEventsPerSkill: number;

  public constructor(
    public readonly filePath: string,
    options: SkillUsageStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxEventsPerSkill = Math.max(0, Math.trunc(options.maxEventsPerSkill ?? 20));
  }

  public readDocument(): SkillUsageDocument {
    if (!existsSync(this.filePath)) {
      return createEmptySkillUsageDocument();
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      return cloneSkillUsageDocument(parseSkillUsageDocument(raw));
    } catch {
      return createEmptySkillUsageDocument();
    }
  }

  public readRecord(skillId: string): SkillUsageRecord | null {
    return this.readDocument().records[normalizeSkillId(skillId)] ?? null;
  }

  public recordView(skillId: string, options: RecordSkillUsageOptions = {}): SkillUsageRecord {
    return this.record(skillId, "view", options);
  }

  public recordUse(skillId: string, options: RecordSkillUsageOptions = {}): SkillUsageRecord {
    return this.record(skillId, "use", options);
  }

  public recordFailure(skillId: string, options: RecordSkillUsageOptions = {}): SkillUsageRecord {
    return this.record(skillId, "failure", options);
  }

  public recordPatch(skillId: string, options: RecordSkillUsageOptions = {}): SkillUsageRecord {
    return this.record(skillId, "patch", options);
  }

  public resetFailures(skillId: string, options: RecordSkillUsageOptions = {}): SkillUsageRecord {
    const normalizedSkillId = normalizeSkillId(skillId);
    const occurredAtMs = normalizeNowMs(options.nowMs, this.now);
    const actor = normalizeActor(options.actor);
    const reason = normalizeOptionalText(options.reason);
    const document = this.readDocument();
    const current =
      document.records[normalizedSkillId] ??
      createEmptySkillUsageRecord(normalizedSkillId, occurredAtMs);
    const patched = applyUsageEvent(
      current,
      {
        action: "patch",
        occurredAtMs,
        actor,
        ...(reason === undefined ? {} : { reason }),
      },
      this.maxEventsPerSkill,
    );
    const nextRecord: SkillUsageRecord = {
      ...patched,
      failureCount: 0,
      lastFailedAtMs: null,
      state: "active",
      archivedAtMs: null,
    };
    this.writeDocument({
      schemaVersion: SKILL_USAGE_SCHEMA_VERSION,
      updatedAtMs: occurredAtMs,
      updatedBy: actor,
      records: {
        ...document.records,
        [normalizedSkillId]: nextRecord,
      },
    });
    return cloneSkillUsageRecord(nextRecord);
  }

  public archive(skillId: string, options: RecordSkillUsageOptions = {}): SkillUsageRecord {
    const normalizedSkillId = normalizeSkillId(skillId);
    const occurredAtMs = normalizeNowMs(options.nowMs, this.now);
    const actor = normalizeActor(options.actor);
    const reason = normalizeOptionalText(options.reason);
    const document = this.readDocument();
    const current =
      document.records[normalizedSkillId] ??
      createEmptySkillUsageRecord(normalizedSkillId, occurredAtMs);
    const archived = applyUsageEvent(
      current,
      {
        action: "archive",
        occurredAtMs,
        actor,
        ...(reason === undefined ? {} : { reason }),
      },
      this.maxEventsPerSkill,
    );
    const nextRecord: SkillUsageRecord = {
      ...archived,
      state: "archived",
      archivedAtMs: occurredAtMs,
    };
    this.writeDocument({
      schemaVersion: SKILL_USAGE_SCHEMA_VERSION,
      updatedAtMs: occurredAtMs,
      updatedBy: actor,
      records: {
        ...document.records,
        [normalizedSkillId]: nextRecord,
      },
    });
    return cloneSkillUsageRecord(nextRecord);
  }

  public forget(
    skillId: string,
    options: Pick<RecordSkillUsageOptions, "actor" | "nowMs"> = {},
  ): SkillUsageDocument {
    const normalizedSkillId = normalizeSkillId(skillId);
    const document = this.readDocument();
    const records = { ...document.records };
    delete records[normalizedSkillId];
    const updatedAtMs = normalizeNowMs(options.nowMs, this.now);
    const nextDocument: SkillUsageDocument = {
      schemaVersion: SKILL_USAGE_SCHEMA_VERSION,
      updatedAtMs,
      updatedBy: normalizeActor(options.actor),
      records,
    };
    this.writeDocument(nextDocument);
    return cloneSkillUsageDocument(nextDocument);
  }

  private record(
    skillId: string,
    action: SkillUsageAction,
    options: RecordSkillUsageOptions,
  ): SkillUsageRecord {
    const normalizedSkillId = normalizeSkillId(skillId);
    const occurredAtMs = normalizeNowMs(options.nowMs, this.now);
    const actor = normalizeActor(options.actor);
    const reason = normalizeOptionalText(options.reason);
    const document = this.readDocument();
    const current =
      document.records[normalizedSkillId] ??
      createEmptySkillUsageRecord(normalizedSkillId, occurredAtMs);
    const nextRecord = applyUsageEvent(
      current,
      {
        action,
        occurredAtMs,
        actor,
        ...(reason === undefined ? {} : { reason }),
      },
      this.maxEventsPerSkill,
    );
    const nextDocument: SkillUsageDocument = {
      schemaVersion: SKILL_USAGE_SCHEMA_VERSION,
      updatedAtMs: occurredAtMs,
      updatedBy: actor,
      records: {
        ...document.records,
        [normalizedSkillId]: nextRecord,
      },
    };
    this.writeDocument(nextDocument);
    return cloneSkillUsageRecord(nextRecord);
  }

  private writeDocument(document: SkillUsageDocument): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${document.updatedAtMs}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
  }
}

export function resolveSkillUsagePath(
  config: { dataDir: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HOTFLOW_SKILLS_USAGE_PATH?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(join(config.dataDir, "skills", "usage.json"));
}

function createEmptySkillUsageDocument(): SkillUsageDocument {
  return {
    schemaVersion: SKILL_USAGE_SCHEMA_VERSION,
    updatedAtMs: 0,
    updatedBy: "system",
    records: {},
  };
}

function createEmptySkillUsageRecord(skillId: string, nowMs: number): SkillUsageRecord {
  return {
    skillId,
    viewCount: 0,
    useCount: 0,
    failureCount: 0,
    patchCount: 0,
    createdAtMs: nowMs,
    lastViewedAtMs: null,
    lastUsedAtMs: null,
    lastFailedAtMs: null,
    lastPatchedAtMs: null,
    lastActivityAtMs: null,
    state: "active",
    pinned: false,
    archivedAtMs: null,
    events: [],
  };
}

function applyUsageEvent(
  record: SkillUsageRecord,
  event: SkillUsageEvent,
  maxEvents: number,
): SkillUsageRecord {
  const viewCount = record.viewCount + (event.action === "view" ? 1 : 0);
  const useCount = record.useCount + (event.action === "use" ? 1 : 0);
  const failureCount = record.failureCount + (event.action === "failure" ? 1 : 0);
  const patchCount = record.patchCount + (event.action === "patch" ? 1 : 0);
  const events = maxEvents <= 0 ? [] : [...record.events, event].slice(-maxEvents);
  return {
    ...record,
    viewCount,
    useCount,
    failureCount,
    patchCount,
    lastViewedAtMs: event.action === "view" ? event.occurredAtMs : record.lastViewedAtMs,
    lastUsedAtMs: event.action === "use" ? event.occurredAtMs : record.lastUsedAtMs,
    lastFailedAtMs: event.action === "failure" ? event.occurredAtMs : record.lastFailedAtMs,
    lastPatchedAtMs: event.action === "patch" ? event.occurredAtMs : record.lastPatchedAtMs,
    lastActivityAtMs: event.occurredAtMs,
    events,
  };
}

function parseSkillUsageDocument(value: unknown): SkillUsageDocument {
  if (!isRecord(value) || value.schemaVersion !== SKILL_USAGE_SCHEMA_VERSION) {
    return createEmptySkillUsageDocument();
  }
  const updatedAtMs = typeof value.updatedAtMs === "number" ? value.updatedAtMs : 0;
  const updatedBy = typeof value.updatedBy === "string" ? value.updatedBy : "system";
  const rawRecords = isRecord(value.records) ? value.records : {};
  const records: Record<string, SkillUsageRecord> = {};
  for (const [skillId, rawRecord] of Object.entries(rawRecords)) {
    const record = parseSkillUsageRecord(rawRecord, skillId);
    if (record !== null) {
      records[record.skillId] = record;
    }
  }
  return {
    schemaVersion: SKILL_USAGE_SCHEMA_VERSION,
    updatedAtMs,
    updatedBy,
    records,
  };
}

function parseSkillUsageRecord(value: unknown, fallbackSkillId: string): SkillUsageRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const skillId =
    typeof value.skillId === "string" && value.skillId.trim().length > 0
      ? value.skillId.trim()
      : fallbackSkillId.trim();
  if (skillId.length === 0) {
    return null;
  }
  const base = createEmptySkillUsageRecord(skillId, readNumber(value.createdAtMs) ?? 0);
  return {
    ...base,
    viewCount: readCount(value.viewCount),
    useCount: readCount(value.useCount),
    failureCount: readCount(value.failureCount),
    patchCount: readCount(value.patchCount),
    createdAtMs: readNumber(value.createdAtMs) ?? base.createdAtMs,
    lastViewedAtMs: readNullableNumber(value.lastViewedAtMs),
    lastUsedAtMs: readNullableNumber(value.lastUsedAtMs),
    lastFailedAtMs: readNullableNumber(value.lastFailedAtMs),
    lastPatchedAtMs: readNullableNumber(value.lastPatchedAtMs),
    lastActivityAtMs: readNullableNumber(value.lastActivityAtMs),
    state: parseLifecycleState(value.state),
    pinned: value.pinned === true,
    archivedAtMs: readNullableNumber(value.archivedAtMs),
    events: Array.isArray(value.events)
      ? value.events
          .map(parseSkillUsageEvent)
          .filter((event): event is SkillUsageEvent => event !== null)
      : [],
  };
}

function parseSkillUsageEvent(value: unknown): SkillUsageEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const action = parseUsageAction(value.action);
  const occurredAtMs = readNumber(value.occurredAtMs);
  if (action === null || occurredAtMs === null) {
    return null;
  }
  const actor =
    typeof value.actor === "string" && value.actor.trim().length > 0 ? value.actor : "system";
  const reason = normalizeOptionalText(typeof value.reason === "string" ? value.reason : undefined);
  return {
    action,
    occurredAtMs,
    actor,
    ...(reason === undefined ? {} : { reason }),
  };
}

function parseUsageAction(value: unknown): SkillUsageAction | null {
  return value === "view" ||
    value === "use" ||
    value === "failure" ||
    value === "patch" ||
    value === "archive"
    ? value
    : null;
}

function parseLifecycleState(value: unknown): SkillLifecycleState {
  return value === "stale" || value === "archived" ? value : "active";
}

function cloneSkillUsageDocument(document: SkillUsageDocument): SkillUsageDocument {
  const records: Record<string, SkillUsageRecord> = {};
  for (const [skillId, record] of Object.entries(document.records)) {
    records[skillId] = cloneSkillUsageRecord(record);
  }
  return {
    schemaVersion: document.schemaVersion,
    updatedAtMs: document.updatedAtMs,
    updatedBy: document.updatedBy,
    records,
  };
}

function cloneSkillUsageRecord(record: SkillUsageRecord): SkillUsageRecord {
  return {
    ...record,
    events: record.events.map((event) => ({ ...event })),
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
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : Math.trunc(fallback());
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function readNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : readNumber(value);
}

function readCount(value: unknown): number {
  const number = readNumber(value);
  return number === null ? 0 : Math.max(0, number);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
