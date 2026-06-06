export type PrimitiveValue = string | number | boolean | null;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFieldValue =
  | PrimitiveValue
  | ReadonlyArray<PrimitiveValue>
  | Record<string, PrimitiveValue>
  | undefined;

export type LogFields = Record<string, LogFieldValue>;

export interface LogRecord {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type SpanAttributes = Record<string, PrimitiveValue>;

export interface SpanEvent {
  readonly name: string;
  readonly timestamp: number;
  readonly attributes: SpanAttributes;
}

export interface FinishedSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly durationMs: number;
  readonly attributes: SpanAttributes;
  readonly events: readonly SpanEvent[];
  readonly status?: "ok" | "error";
  readonly errorMessage?: string;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  setAttribute(key: string, value: PrimitiveValue): void;
  addEvent(name: string, attributes?: SpanAttributes): void;
  end(status?: "ok" | "error", errorMessage?: string): FinishedSpan;
}

export interface Tracer {
  startSpan(name: string, attributes?: SpanAttributes): Span;
  getFinishedSpans(): readonly FinishedSpan[];
  reset(): void;
}

export type RunContextValues = Record<string, unknown>;

export interface RunContext {
  readonly runId: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly values: RunContextValues;
}
