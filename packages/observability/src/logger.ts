import type { LogFields, LogLevel, LogRecord, LogSink, Logger } from "./contracts.js";

export interface CreateLoggerOptions {
  readonly sink?: LogSink;
  readonly fields?: LogFields;
  readonly now?: () => number;
}

const DEFAULT_SINK: LogSink = (record) => {
  void record;
};

class MemoryLogger implements Logger {
  private readonly sink: LogSink;
  private readonly now: () => number;
  private readonly baseFields: LogFields;

  constructor({ sink = DEFAULT_SINK, fields = {}, now = Date.now }: CreateLoggerOptions = {}) {
    this.sink = sink;
    this.baseFields = fields;
    this.now = now;
  }

  log(level: LogLevel, message: string, fields: LogFields = {}): void {
    const record: LogRecord = {
      timestamp: this.now(),
      level,
      message,
      fields: { ...this.baseFields, ...fields },
    };
    this.sink(record);
  }

  debug(message: string, fields?: LogFields): void {
    this.log("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.log("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.log("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.log("error", message, fields);
  }

  child(fields: LogFields): Logger {
    return new MemoryLogger({
      sink: this.sink,
      now: this.now,
      fields: { ...this.baseFields, ...fields },
    });
  }
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return new MemoryLogger(options);
}
