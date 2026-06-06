import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CheckpointRecord,
  JournalEntry,
  JsonObject,
  JsonValue,
  ListCheckpointsOptions,
  ListJournalOptions,
  SessionRecord,
  SessionSearchHit,
  SessionSearchQuery,
} from "./types.js";

interface SessionRow {
  session_id: string;
  metadata_json: string;
  status: SessionRecord["status"];
  schema_version: string;
  created_at_ms: number;
  updated_at_ms: number;
  archived_at_ms: number | null;
  archive_reason: string | null;
}

interface JournalRow {
  row_id: number;
  session_id: string;
  seq: number;
  event_type: string;
  turn_id: string | null;
  payload_json: string;
  schema_version: string;
  created_at_ms: number;
}

interface CheckpointRow {
  checkpoint_id: number;
  session_id: string;
  upto_seq: number;
  state_json: string;
  metadata_json: string;
  schema_version: string;
  created_at_ms: number;
}

interface TableInfoRow {
  name: string;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface CreateSessionRowInput {
  sessionId: string;
  metadata: JsonObject;
  schemaVersion: string;
}

export interface InsertJournalRowInput {
  sessionId: string;
  seq: number;
  eventType: string;
  turnId: string | null;
  payload: JsonValue;
  schemaVersion: string;
  createdAtMs: number;
}

export interface InsertCheckpointRowInput {
  sessionId: string;
  uptoSeq: number;
  state: JsonValue;
  metadata: JsonObject;
  schemaVersion: string;
  createdAtMs: number;
}

export interface SQLiteSessionStorageOptions {
  dbPath: string;
  now?: () => number;
}

export interface SessionStorage {
  now(): number;
  close(): void;
  transaction<T>(operation: () => T): T;
  createSession(input: CreateSessionRowInput): SessionRecord;
  getSession(sessionId: string): SessionRecord | null;
  updateSessionMetadata(
    sessionId: string,
    metadata: JsonObject,
    updatedAtMs: number,
  ): SessionRecord | null;
  setSessionArchived(
    sessionId: string,
    reason: string | null,
    archivedAtMs: number,
  ): SessionRecord | null;
  deleteSession(sessionId: string): boolean;
  getNextJournalSeq(sessionId: string): number;
  getLatestJournalSeq(sessionId: string): number;
  getLatestTurnId(sessionId: string): string | null;
  insertJournalEntry(input: InsertJournalRowInput): JournalEntry;
  listJournalEntries(sessionId: string, options?: ListJournalOptions): JournalEntry[];
  insertCheckpoint(input: InsertCheckpointRowInput): CheckpointRecord;
  getCheckpoint(sessionId: string, checkpointId: number): CheckpointRecord | null;
  getLatestCheckpoint(sessionId: string): CheckpointRecord | null;
  listCheckpoints(sessionId: string, options?: ListCheckpointsOptions): CheckpointRecord[];
  searchSessions(query: SessionSearchQuery): SessionSearchHit[];
}

const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_PRAGMA_RETRY_ATTEMPTS = 20;
const SQLITE_PRAGMA_RETRY_DELAY_MS = 25;

export class SQLiteSessionStorage implements SessionStorage {
  private readonly db: DatabaseSync;

  private readonly clock: () => number;

  constructor(options: SQLiteSessionStorageOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new DatabaseSync(options.dbPath);
    this.clock = options.now ?? Date.now;
    this.configurePragmas();
    this.migrate();
  }

  now(): number {
    return this.clock();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures and surface the original error.
      }
      throw error;
    }
  }

  createSession(input: CreateSessionRowInput): SessionRecord {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO sessions
         (session_id, metadata_json, status, schema_version, created_at_ms, updated_at_ms, archived_at_ms, archive_reason)
         VALUES (?, ?, 'active', ?, ?, ?, NULL, NULL)`,
      )
      .run(input.sessionId, JSON.stringify(input.metadata), input.schemaVersion, now, now);

    const session = this.getSession(input.sessionId);
    if (!session) {
      throw new Error(
        `Session insert succeeded but session "${input.sessionId}" cannot be reloaded`,
      );
    }
    return session;
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT session_id, metadata_json, status, schema_version, created_at_ms, updated_at_ms, archived_at_ms, archive_reason
         FROM sessions WHERE session_id = ?`,
      )
      .get(sessionId) as SessionRow | undefined;
    return row ? this.decodeSessionRow(row) : null;
  }

  updateSessionMetadata(
    sessionId: string,
    metadata: JsonObject,
    updatedAtMs: number,
  ): SessionRecord | null {
    this.db
      .prepare("UPDATE sessions SET metadata_json = ?, updated_at_ms = ? WHERE session_id = ?")
      .run(JSON.stringify(metadata), updatedAtMs, sessionId);
    return this.getSession(sessionId);
  }

  setSessionArchived(
    sessionId: string,
    reason: string | null,
    archivedAtMs: number,
  ): SessionRecord | null {
    this.db
      .prepare(
        `UPDATE sessions
         SET status = 'archived',
             archive_reason = COALESCE(archive_reason, ?),
             archived_at_ms = COALESCE(archived_at_ms, ?),
             updated_at_ms = ?
         WHERE session_id = ?`,
      )
      .run(reason, archivedAtMs, archivedAtMs, sessionId);
    return this.getSession(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM sessions WHERE session_id = ?")
      .run(sessionId) as RunResult;
    return result.changes > 0;
  }

  getNextJournalSeq(sessionId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM journal_entries WHERE session_id = ?",
      )
      .get(sessionId) as { next_seq: number } | undefined;
    return row?.next_seq ?? 1;
  }

  getLatestJournalSeq(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM journal_entries WHERE session_id = ?")
      .get(sessionId) as { max_seq: number } | undefined;
    return row?.max_seq ?? 0;
  }

  getLatestTurnId(sessionId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT turn_id
         FROM journal_entries
         WHERE session_id = ? AND turn_id IS NOT NULL AND turn_id <> ''
         ORDER BY seq DESC, row_id DESC
         LIMIT 1`,
      )
      .get(sessionId) as { turn_id: string | null } | undefined;
    return row?.turn_id ?? null;
  }

  insertJournalEntry(input: InsertJournalRowInput): JournalEntry {
    const result = this.db
      .prepare(
        `INSERT INTO journal_entries
         (session_id, seq, event_type, turn_id, payload_json, schema_version, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.seq,
        input.eventType,
        input.turnId,
        JSON.stringify(input.payload),
        input.schemaVersion,
        input.createdAtMs,
      ) as RunResult;

    const rowId = Number(result.lastInsertRowid);
    const row = this.db
      .prepare(
        `SELECT row_id, session_id, seq, event_type, turn_id, payload_json, schema_version, created_at_ms
         FROM journal_entries WHERE row_id = ?`,
      )
      .get(rowId) as JournalRow | undefined;
    if (!row) {
      throw new Error(`Journal insert succeeded but row "${rowId}" cannot be reloaded`);
    }
    this.touchSessionUpdatedAt(input.sessionId, input.createdAtMs);
    return this.decodeJournalRow(row);
  }

  listJournalEntries(sessionId: string, options: ListJournalOptions = {}): JournalEntry[] {
    const afterSeq = options.afterSeq ?? 0;
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      throw new RangeError(`afterSeq must be a non-negative integer; received ${afterSeq}`);
    }
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
      throw new RangeError(`limit must be a positive integer; received ${options.limit}`);
    }

    if (options.limit === undefined) {
      const rows = this.db
        .prepare(
          `SELECT row_id, session_id, seq, event_type, turn_id, payload_json, schema_version, created_at_ms
           FROM journal_entries
           WHERE session_id = ? AND seq > ?
           ORDER BY seq ASC`,
        )
        .all(sessionId, afterSeq) as unknown as JournalRow[];
      return rows.map((row) => this.decodeJournalRow(row));
    }

    const rows = this.db
      .prepare(
        `SELECT row_id, session_id, seq, event_type, turn_id, payload_json, schema_version, created_at_ms
         FROM journal_entries
         WHERE session_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(sessionId, afterSeq, options.limit) as unknown as JournalRow[];
    return rows.map((row) => this.decodeJournalRow(row));
  }

  insertCheckpoint(input: InsertCheckpointRowInput): CheckpointRecord {
    const result = this.db
      .prepare(
        `INSERT INTO checkpoints
         (session_id, upto_seq, state_json, metadata_json, schema_version, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.uptoSeq,
        JSON.stringify(input.state),
        JSON.stringify(input.metadata),
        input.schemaVersion,
        input.createdAtMs,
      ) as RunResult;

    const checkpointId = Number(result.lastInsertRowid);
    const row = this.db
      .prepare(
        `SELECT checkpoint_id, session_id, upto_seq, state_json, metadata_json, schema_version, created_at_ms
         FROM checkpoints WHERE checkpoint_id = ?`,
      )
      .get(checkpointId) as CheckpointRow | undefined;
    if (!row) {
      throw new Error(`Checkpoint insert succeeded but row "${checkpointId}" cannot be reloaded`);
    }
    this.touchSessionUpdatedAt(input.sessionId, input.createdAtMs);
    return this.decodeCheckpointRow(row);
  }

  getCheckpoint(sessionId: string, checkpointId: number): CheckpointRecord | null {
    if (!Number.isInteger(checkpointId) || checkpointId <= 0) {
      throw new RangeError(`checkpointId must be a positive integer; received ${checkpointId}`);
    }
    const row = this.db
      .prepare(
        `SELECT checkpoint_id, session_id, upto_seq, state_json, metadata_json, schema_version, created_at_ms
         FROM checkpoints
         WHERE session_id = ? AND checkpoint_id = ?
         LIMIT 1`,
      )
      .get(sessionId, checkpointId) as CheckpointRow | undefined;
    return row ? this.decodeCheckpointRow(row) : null;
  }

  getLatestCheckpoint(sessionId: string): CheckpointRecord | null {
    const row = this.db
      .prepare(
        `SELECT checkpoint_id, session_id, upto_seq, state_json, metadata_json, schema_version, created_at_ms
         FROM checkpoints
         WHERE session_id = ?
         ORDER BY upto_seq DESC, checkpoint_id DESC
         LIMIT 1`,
      )
      .get(sessionId) as CheckpointRow | undefined;
    return row ? this.decodeCheckpointRow(row) : null;
  }

  listCheckpoints(sessionId: string, options: ListCheckpointsOptions = {}): CheckpointRecord[] {
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
      throw new RangeError(`limit must be a positive integer; received ${options.limit}`);
    }

    if (options.limit === undefined) {
      const rows = this.db
        .prepare(
          `SELECT checkpoint_id, session_id, upto_seq, state_json, metadata_json, schema_version, created_at_ms
           FROM checkpoints
           WHERE session_id = ?
           ORDER BY upto_seq DESC, checkpoint_id DESC`,
        )
        .all(sessionId) as unknown as CheckpointRow[];
      return rows.map((row) => this.decodeCheckpointRow(row));
    }

    const rows = this.db
      .prepare(
        `SELECT checkpoint_id, session_id, upto_seq, state_json, metadata_json, schema_version, created_at_ms
         FROM checkpoints
         WHERE session_id = ?
         ORDER BY upto_seq DESC, checkpoint_id DESC
         LIMIT ?`,
      )
      .all(sessionId, options.limit) as unknown as CheckpointRow[];
    return rows.map((row) => this.decodeCheckpointRow(row));
  }

  searchSessions(query: SessionSearchQuery): SessionSearchHit[] {
    const normalizedQuery = query.query.trim();
    if (normalizedQuery.length === 0) {
      return [];
    }
    const limit = normalizeSearchLimit(query.limit);
    const terms = extractSearchTerms(normalizedQuery);
    if (terms.length === 0) {
      return [];
    }
    const status = query.status ?? "all";
    const eventTypes = new Set(
      (query.eventTypes ?? [])
        .map((eventType) => eventType.trim())
        .filter((eventType) => eventType.length > 0),
    );

    const sessionRows = this.db
      .prepare(
        `SELECT session_id, metadata_json, status, schema_version, created_at_ms, updated_at_ms, archived_at_ms, archive_reason
         FROM sessions
         WHERE (? IS NULL OR session_id = ?)
           AND (? = 'all' OR status = ?)
         ORDER BY updated_at_ms DESC, created_at_ms DESC`,
      )
      .all(
        query.sessionId ?? null,
        query.sessionId ?? null,
        status,
        status,
      ) as unknown as SessionRow[];

    const hits: SessionSearchHit[] = [];
    for (const sessionRow of sessionRows) {
      const session = this.decodeSessionRow(sessionRow);
      this.collectSessionLevelSearchHits(hits, session, session.sessionId, "session-id", terms);
      this.collectSessionLevelSearchHits(
        hits,
        session,
        sessionRow.metadata_json,
        "session-metadata",
        terms,
      );

      const journalRows = this.db
        .prepare(
          `SELECT row_id, session_id, seq, event_type, turn_id, payload_json, schema_version, created_at_ms
           FROM journal_entries
           WHERE session_id = ?
           ORDER BY seq DESC, row_id DESC`,
        )
        .all(session.sessionId) as unknown as JournalRow[];
      for (const journalRow of journalRows) {
        if (eventTypes.size > 0 && !eventTypes.has(journalRow.event_type)) {
          continue;
        }
        const entry = this.decodeJournalRow(journalRow);
        this.collectJournalSearchHits(
          hits,
          session,
          entry,
          journalRow.event_type,
          "journal-event-type",
          terms,
        );
        if (journalRow.turn_id) {
          this.collectJournalSearchHits(
            hits,
            session,
            entry,
            journalRow.turn_id,
            "journal-turn-id",
            terms,
          );
        }
        this.collectJournalSearchHits(
          hits,
          session,
          entry,
          journalRow.payload_json,
          "journal-payload",
          terms,
        );
      }
    }

    hits.sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leftTime = left.entry?.createdAtMs ?? left.session.updatedAtMs;
      const rightTime = right.entry?.createdAtMs ?? right.session.updatedAtMs;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      const leftSeq = left.entry?.seq ?? 0;
      const rightSeq = right.entry?.seq ?? 0;
      return rightSeq - leftSeq;
    });

    return hits.slice(0, limit);
  }

  private configurePragmas(): void {
    this.execWithBusyRetry(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    this.execWithBusyRetry("PRAGMA foreign_keys = ON");
    this.execWithBusyRetry("PRAGMA journal_mode = WAL");
    this.execWithBusyRetry("PRAGMA synchronous = FULL");
  }

  private execWithBusyRetry(sql: string): void {
    for (let attempt = 0; attempt < SQLITE_PRAGMA_RETRY_ATTEMPTS; attempt += 1) {
      try {
        this.db.exec(sql);
        return;
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt === SQLITE_PRAGMA_RETRY_ATTEMPTS - 1) {
          throw error;
        }
        sleepSync(SQLITE_PRAGMA_RETRY_DELAY_MS);
      }
    }
  }

  private touchSessionUpdatedAt(sessionId: string, updatedAtMs: number): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET updated_at_ms = CASE
           WHEN updated_at_ms < ? THEN ?
           ELSE updated_at_ms
         END
         WHERE session_id = ?`,
      )
      .run(updatedAtMs, updatedAtMs, sessionId);
  }

  private migrate(): void {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        schema_version TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        archived_at_ms INTEGER,
        archive_reason TEXT
      )`,
    );

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS journal_entries (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL CHECK (seq > 0),
        event_type TEXT NOT NULL,
        turn_id TEXT,
        payload_json TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        UNIQUE(session_id, seq)
      )`,
    );

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        upto_seq INTEGER NOT NULL CHECK (upto_seq >= 0),
        state_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        schema_version TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        UNIQUE(session_id, upto_seq)
      )`,
    );

    if (!this.hasColumn("checkpoints", "metadata_json")) {
      this.db.exec("ALTER TABLE checkpoints ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
    }

    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_journal_entries_session_seq ON journal_entries(session_id, seq)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_checkpoints_session_seq ON checkpoints(session_id, upto_seq)",
    );
  }

  private decodeSessionRow(row: SessionRow): SessionRecord {
    return {
      sessionId: row.session_id,
      metadata: this.parseJsonObject(row.metadata_json, "session metadata"),
      status: row.status,
      schemaVersion: row.schema_version,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
      archivedAtMs: row.archived_at_ms,
      archiveReason: row.archive_reason,
    };
  }

  private decodeJournalRow(row: JournalRow): JournalEntry {
    return {
      rowId: row.row_id,
      sessionId: row.session_id,
      seq: row.seq,
      eventType: row.event_type,
      turnId: row.turn_id,
      payload: this.parseJsonValue(row.payload_json, "journal payload"),
      schemaVersion: row.schema_version,
      createdAtMs: row.created_at_ms,
    };
  }

  private decodeCheckpointRow(row: CheckpointRow): CheckpointRecord {
    return {
      checkpointId: row.checkpoint_id,
      sessionId: row.session_id,
      uptoSeq: row.upto_seq,
      state: this.parseJsonValue(row.state_json, "checkpoint state"),
      metadata: this.parseJsonObject(row.metadata_json, "checkpoint metadata"),
      schemaVersion: row.schema_version,
      createdAtMs: row.created_at_ms,
    };
  }

  private collectSessionLevelSearchHits(
    hits: SessionSearchHit[],
    session: SessionRecord,
    text: string,
    source: SessionSearchHit["source"],
    terms: readonly string[],
  ): void {
    const match = scoreSearchText(text, terms);
    if (!match) {
      return;
    }
    hits.push({
      session,
      entry: null,
      source,
      score: match.score,
      matchedText: createSearchSnippet(text, match.matchedTerms),
      matchedTerms: match.matchedTerms,
    });
  }

  private collectJournalSearchHits(
    hits: SessionSearchHit[],
    session: SessionRecord,
    entry: JournalEntry,
    text: string,
    source: SessionSearchHit["source"],
    terms: readonly string[],
  ): void {
    const match = scoreSearchText(text, terms);
    if (!match) {
      return;
    }
    hits.push({
      session,
      entry,
      source,
      score: match.score + entry.seq / 100_000,
      matchedText: createSearchSnippet(text, match.matchedTerms),
      matchedTerms: match.matchedTerms,
    });
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as unknown as TableInfoRow[];
    return rows.some((row) => row.name === columnName);
  }

  private parseJsonValue(raw: string, context: string): JsonValue {
    try {
      return JSON.parse(raw) as JsonValue;
    } catch (error) {
      throw new Error(`Failed to parse ${context}: ${String(error)}`);
    }
  }

  private parseJsonObject(raw: string, context: string): JsonObject {
    const value = this.parseJsonValue(raw, context);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error(`${context} must be a JSON object`);
    }
    return value as JsonObject;
  }
}

interface SearchScore {
  score: number;
  matchedTerms: string[];
}

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const SEARCH_SNIPPET_RADIUS = 80;
const CJK_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TOKEN_SPLIT_PATTERN = /[^\p{Letter}\p{Number}_]+/u;

function normalizeSearchLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_SEARCH_LIMIT;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(`limit must be a positive integer; received ${limit}`);
  }
  return Math.min(limit, MAX_SEARCH_LIMIT);
}

function extractSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) {
    return [];
  }
  addSearchTerm(terms, normalizedQuery);

  for (const part of normalizedQuery.split(TOKEN_SPLIT_PATTERN)) {
    const token = part.trim();
    if (token.length === 0) {
      continue;
    }
    addSearchTerm(terms, token);
    if (containsCjk(token)) {
      for (const gram of buildCharacterNgrams(token, 2)) {
        addSearchTerm(terms, gram);
      }
      for (const gram of buildCharacterNgrams(token, 3)) {
        addSearchTerm(terms, gram);
      }
    }
  }

  return [...terms].sort((left, right) => right.length - left.length);
}

function addSearchTerm(terms: Set<string>, term: string): void {
  const normalized = normalizeSearchText(term);
  if (normalized.length < 2 || normalized.length > 64) {
    return;
  }
  terms.add(normalized);
}

function buildCharacterNgrams(value: string, size: number): string[] {
  const chars = [...value].filter((char) => !TOKEN_SPLIT_PATTERN.test(char));
  if (chars.length < size) {
    return [];
  }
  const grams: string[] = [];
  for (let index = 0; index <= chars.length - size; index += 1) {
    grams.push(chars.slice(index, index + size).join(""));
  }
  return grams;
}

function scoreSearchText(text: string, terms: readonly string[]): SearchScore | null {
  const normalizedText = normalizeSearchText(text);
  if (normalizedText.length === 0) {
    return null;
  }
  const matchedTerms = terms.filter((term) => normalizedText.includes(term));
  if (matchedTerms.length === 0) {
    return null;
  }
  const uniqueMatchedTerms = [...new Set(matchedTerms)];
  const coverage = uniqueMatchedTerms.reduce((total, term) => total + term.length, 0);
  const exactPhraseBonus = terms[0] && normalizedText.includes(terms[0]) ? terms[0].length * 3 : 0;
  return {
    score: coverage + exactPhraseBonus + uniqueMatchedTerms.length,
    matchedTerms: uniqueMatchedTerms,
  };
}

function createSearchSnippet(text: string, matchedTerms: readonly string[]): string {
  if (text.length <= SEARCH_SNIPPET_RADIUS * 2) {
    return text;
  }
  const normalizedText = normalizeSearchText(text);
  const firstTerm = matchedTerms[0] ?? "";
  const normalizedIndex = firstTerm ? normalizedText.indexOf(firstTerm) : -1;
  if (normalizedIndex < 0) {
    return `${text.slice(0, SEARCH_SNIPPET_RADIUS * 2).trim()}...`;
  }
  const start = Math.max(0, normalizedIndex - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(text.length, normalizedIndex + firstTerm.length + SEARCH_SNIPPET_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function containsCjk(value: string): boolean {
  return CJK_CHARACTER_PATTERN.test(value);
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; errcode?: unknown; message?: unknown };
  return (
    candidate.code === "ERR_SQLITE_ERROR" &&
    candidate.errcode === 5 &&
    typeof candidate.message === "string" &&
    candidate.message.includes("database is locked")
  );
}

function sleepSync(delayMs: number): void {
  const start = Date.now();
  while (Date.now() - start < delayMs) {
    // The sqlite constructor path is synchronous; keep this wait local to startup retry.
  }
}
