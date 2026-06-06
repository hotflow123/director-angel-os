export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type SessionStatus = "active" | "archived";

export interface SessionRecord<Meta extends JsonObject = JsonObject> {
  sessionId: string;
  metadata: Meta;
  status: SessionStatus;
  schemaVersion: string;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
  archiveReason: string | null;
}

export interface CreateSessionInput<Meta extends JsonObject = JsonObject> {
  sessionId?: string;
  metadata?: Meta;
  schemaVersion?: string;
}

export interface AppendJournalInput<Payload extends JsonValue = JsonValue> {
  eventType: string;
  payload: Payload;
  turnId?: string;
  schemaVersion?: string;
  createdAtMs?: number;
}

export interface JournalEntry<Payload extends JsonValue = JsonValue> {
  rowId: number;
  sessionId: string;
  seq: number;
  eventType: string;
  turnId: string | null;
  payload: Payload;
  schemaVersion: string;
  createdAtMs: number;
}

export interface ListJournalOptions {
  afterSeq?: number;
  limit?: number;
}

export type DurableTranscriptEntryKind = "journal" | "step" | "stream" | "audit";
export type DurableTranscriptEntryChannel = "journal" | "step" | "stream" | "audit";

export interface DurableTranscriptOptions extends ListJournalOptions {
  turnId?: string;
  eventTypes?: readonly string[];
}

export interface DurableTranscriptEntry<Payload extends JsonValue = JsonValue> {
  seq: number;
  rowId: number;
  sessionId: string;
  turnId: string | null;
  eventType: string;
  schemaVersion: string;
  createdAtMs: number;
  kind: DurableTranscriptEntryKind;
  channel: DurableTranscriptEntryChannel;
  payload: Payload;
  rawPayload: JsonValue;
  stepIndex: number | null;
  eventId: string | null;
  envelopeKind: string | null;
  occurredAtMs: number | null;
}

export interface DurableTranscriptResumeAnchor {
  sessionId: string;
  latestTurnId: string | null;
  lastSeq: number;
  lastEventType: string | null;
  lastCreatedAtMs: number | null;
}

export interface DurableTranscript<Payload extends JsonValue = JsonValue> {
  schemaVersion: "sessions.durable-transcript/v1";
  sessionId: string;
  session: SessionRecord;
  latestTurnId: string | null;
  fromSeq: number;
  toSeq: number;
  entryCount: number;
  entries: DurableTranscriptEntry<Payload>[];
  resumeAnchor: DurableTranscriptResumeAnchor;
}

export interface HandoffSummaryPayload extends JsonObject {
  schemaVersion: "sessions.handoff-summary/v1";
  sessionId: string;
  lastSummarizedSeq: number;
  sourceFromSeq: number;
  sourceToSeq: number;
  latestTurnId: string | null;
  currentState: string;
  task: string;
  filesAndFunctions: string[];
  workflow: string[];
  errorsAndCorrections: string[];
  keyResults: string[];
  worklog: string[];
  nextActions: string[];
  createdAtMs: number;
}

export interface CreateHandoffSummaryInput {
  lastSummarizedSeq: number;
  sourceFromSeq: number;
  sourceToSeq: number;
  latestTurnId?: string | null;
  currentState: string;
  task: string;
  filesAndFunctions?: readonly string[];
  workflow?: readonly string[];
  errorsAndCorrections?: readonly string[];
  keyResults?: readonly string[];
  worklog?: readonly string[];
  nextActions?: readonly string[];
  schemaVersion?: string;
  createdAtMs?: number;
}

export interface HandoffSummaryRecord {
  summary: HandoffSummaryPayload;
  entry: JournalEntry<HandoffSummaryPayload>;
}

export type SessionSearchSource =
  | "session-id"
  | "session-metadata"
  | "journal-event-type"
  | "journal-turn-id"
  | "journal-payload";

export interface SessionSearchQuery {
  query: string;
  limit?: number;
  sessionId?: string;
  status?: SessionStatus | "all";
  eventTypes?: readonly string[];
}

export interface SessionSearchHit<Payload extends JsonValue = JsonValue> {
  session: SessionRecord;
  entry: JournalEntry<Payload> | null;
  source: SessionSearchSource;
  score: number;
  matchedText: string;
  matchedTerms: readonly string[];
}

export interface SessionSearchResult<Payload extends JsonValue = JsonValue> {
  query: SessionSearchQuery;
  hits: SessionSearchHit<Payload>[];
  totalHits: number;
}

export interface ListStepJournalOptions extends ListJournalOptions {
  turnId?: string;
}

export interface JournalEventEnvelope<Payload extends JsonValue = JsonValue> extends JsonObject {
  id: string;
  kind: string;
  schemaVersion: string;
  occurredAtMs: number;
  payload: Payload;
}

export interface AppendStreamJournalEventInput<Payload extends JsonValue = JsonValue> {
  event: JournalEventEnvelope<Payload>;
  turnId?: string;
  schemaVersion?: string;
  createdAtMs?: number;
}

export interface AppendAuditJournalEventInput<Payload extends JsonValue = JsonValue> {
  event: JournalEventEnvelope<Payload>;
  turnId?: string;
  schemaVersion?: string;
  createdAtMs?: number;
}

export interface ListScopedJournalEventOptions extends ListJournalOptions {
  turnId?: string;
}

export interface StreamJournalEventEntry<Payload extends JsonValue = JsonValue> {
  entry: JournalEntry<JournalEventEnvelope<Payload>>;
  event: JournalEventEnvelope<Payload>;
}

export interface AuditJournalEventEntry<Payload extends JsonValue = JsonValue> {
  entry: JournalEntry<JournalEventEnvelope<Payload>>;
  event: JournalEventEnvelope<Payload>;
}

export type RuntimeEvidenceKind =
  | "runtime.degraded"
  | "runtime.failed"
  | "provider.transient_failure"
  | "stream.degraded"
  | "stream.error"
  | "stream.aborted";

export type RuntimeEvidenceChannel = "audit" | "stream";
export type RuntimeEvidenceWriteChannel = RuntimeEvidenceChannel | "both";

export interface RecordRuntimeEvidenceInput<Payload extends JsonValue = JsonValue> {
  kind: RuntimeEvidenceKind;
  payload: Payload;
  turnId?: string;
  channel?: RuntimeEvidenceWriteChannel;
  schemaVersion?: string;
  occurredAtMs?: number;
  eventId?: string;
}

export interface ListRuntimeEvidenceOptions extends ListScopedJournalEventOptions {
  kinds?: readonly RuntimeEvidenceKind[];
  includeAudit?: boolean;
  includeStream?: boolean;
}

export interface RuntimeEvidenceEntry<Payload extends JsonValue = JsonValue> {
  channel: RuntimeEvidenceChannel;
  kind: RuntimeEvidenceKind;
  turnId: string | null;
  occurredAtMs: number;
  eventId: string;
  payload: Payload;
  entry: JournalEntry<JournalEventEnvelope<Payload>>;
}

export interface CreateCheckpointInput<
  State extends JsonValue = JsonValue,
  Meta extends JsonObject = JsonObject,
> {
  state: State;
  uptoSeq?: number;
  schemaVersion?: string;
  createdAtMs?: number;
  metadata?: Meta;
}

export interface CheckpointRecord<
  State extends JsonValue = JsonValue,
  Meta extends JsonObject = JsonObject,
> {
  checkpointId: number;
  sessionId: string;
  uptoSeq: number;
  state: State;
  schemaVersion: string;
  createdAtMs: number;
  metadata: Meta;
}

export interface ListCheckpointsOptions {
  limit?: number;
}

export interface RewindCheckpointMetadata extends JsonObject {
  scope: "rewind";
  latestTurnId: string | null;
  sourceCheckpointId: number;
  sourceUptoSeq: number;
  rewoundAtMs: number;
}

export interface RewindSessionInput {
  checkpointId?: number;
  createdAtMs?: number;
}

export interface RewindSessionResult {
  sessionId: string;
  requestedCheckpointId: number | null;
  selection: "explicit" | "previous";
  targetCheckpointId: number;
  targetUptoSeq: number;
  currentCheckpointId: number;
  currentUptoSeq: number;
  latestTurnId: string | null;
  clearedLatestTurn: boolean;
}

export interface ArchiveSessionInput {
  reason?: string;
}

export interface DeleteSessionInput extends ArchiveSessionInput {}

export interface DeleteSessionResult {
  sessionId: string;
  deleted: true;
  archivedSession: SessionRecord;
  transcript: DurableTranscript;
}

export interface LoadRecoveryOptions {
  expectedSchemaVersion?: string;
}

export interface RecoveryData<State extends JsonValue = JsonValue> {
  session: SessionRecord;
  checkpoint: CheckpointRecord<State> | null;
  journal: JournalEntry[];
}

export type SessionReplayReducer<State> = (state: State, event: JournalEntry) => State;

export interface RecoverSessionOptions<State> extends LoadRecoveryOptions {
  reducer?: SessionReplayReducer<State>;
  initialState?: State;
}

export interface RecoveryResult<State extends JsonValue | null = JsonValue | null>
  extends RecoveryData {
  state: State;
  lastAppliedSeq: number;
}

export type StepJournalEventType =
  | "step.context_built"
  | "step.model_output"
  | "step.tools_planned"
  | "step.tool_result"
  | "step.final_output";

export interface StepJournalPayload<Payload extends JsonValue = JsonValue> extends JsonObject {
  stepIndex: number;
  data: Payload;
}

export interface AppendStepJournalInput<Payload extends JsonValue = JsonValue> {
  turnId: string;
  stepIndex: number;
  eventType: StepJournalEventType;
  payload: Payload;
  schemaVersion?: string;
  createdAtMs?: number;
}

export interface StepJournalEntry<Payload extends JsonValue = JsonValue> {
  eventType: StepJournalEventType;
  entry: JournalEntry<StepJournalPayload<Payload>>;
  stepIndex: number;
  payload: Payload;
}

export type ToolResultArtifactStatus = "success" | "error" | "cancelled";

export interface ToolResultArtifactRef extends JsonObject {
  artifactId: string;
  relativePath: string;
  sha256: string;
  mimeType: string;
  originalSizeBytes: number;
}

export interface ToolResultContentProjection extends JsonObject {
  originalSizeBytes: number;
  preview: string;
  hasMore: boolean;
  isJson: boolean;
  replacement: string;
}

export interface ToolResultArtifactPayload extends JsonObject {
  toolUseId: string;
  toolName: string;
  status: ToolResultArtifactStatus;
  contentProjection: ToolResultContentProjection;
  artifactRef: ToolResultArtifactRef;
}

export interface AppendToolResultArtifactInput {
  turnId: string;
  stepIndex: number;
  toolUseId: string;
  toolName: string;
  status: ToolResultArtifactStatus;
  content: string;
  mimeType?: string;
  previewMaxChars?: number;
  replacement?: string;
  schemaVersion?: string;
  createdAtMs?: number;
}

export interface ToolResultArtifactRecord extends ToolResultArtifactRef {
  sessionId: string;
  absolutePath: string;
}

export interface AppendToolResultArtifactResult {
  artifact: ToolResultArtifactRecord;
  entry: JournalEntry<StepJournalPayload<ToolResultArtifactPayload>>;
}

export interface ReadToolResultArtifactResult {
  artifact: ToolResultArtifactRecord;
  content: string;
}

export interface StepReplayData<Payload extends JsonValue = JsonValue> {
  contextBuilt: StepJournalEntry<Payload>[];
  modelOutput: StepJournalEntry<Payload>[];
  plannedTools: StepJournalEntry<Payload>[];
  toolResults: StepJournalEntry<Payload>[];
  finalOutput: StepJournalEntry<Payload>[];
}

export type StepResumeAction =
  | "no-progress"
  | "continue-current-step"
  | "start-next-step"
  | "turn-complete";

export interface StepReplayWindow {
  fromSeqExclusive: number;
  toSeqInclusive: number;
}

export interface StepCheckpointMetadata extends JsonObject {
  scope: "step";
  turnId: string;
  stepIndex: number;
  eventType: StepJournalEventType;
}

export interface CreateStepCheckpointInput<State extends JsonValue = JsonValue> {
  turnId: string;
  stepIndex: number;
  eventType: StepJournalEventType;
  state: State;
  uptoSeq?: number;
  schemaVersion?: string;
  createdAtMs?: number;
}

export interface RecoverStepOptions<State extends JsonValue | null = JsonValue | null>
  extends RecoverSessionOptions<State> {
  turnId: string;
}

export interface RecoverLatestStepOptions<State extends JsonValue | null = JsonValue | null>
  extends RecoverSessionOptions<State> {
  turnId?: string;
}

export interface LatestStepRecoveryResult<
  State extends JsonValue | null = JsonValue | null,
  Payload extends JsonValue = JsonValue,
> {
  latestTurnId: string | null;
  stepRecovery: StepRecoveryResult<State, Payload> | null;
}

export interface StepRecoveryResult<
  State extends JsonValue | null = JsonValue | null,
  Payload extends JsonValue = JsonValue,
> extends RecoveryResult<State> {
  turnId: string;
  stepCheckpoint: CheckpointRecord<State, StepCheckpointMetadata> | null;
  stepJournal: StepJournalEntry<Payload>[];
  replay: StepReplayData<Payload>;
  replayWindow: StepReplayWindow;
  lastStepEvent: StepJournalEntry<Payload> | null;
  resumeAction: StepResumeAction;
  nextStepIndex: number;
}

export interface SessionStoreOptions {
  dbPath: string;
  schemaVersion?: string;
  now?: () => number;
  artifactRootDir?: string;
}
