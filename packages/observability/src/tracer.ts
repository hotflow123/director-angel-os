import type {
  FinishedSpan,
  PrimitiveValue,
  Span,
  SpanAttributes,
  SpanEvent,
  Tracer,
} from "./contracts.js";
import { getRunContext } from "./run-context.js";

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreateTracerOptions {
  readonly now?: () => number;
}

class InMemorySpan implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;

  private readonly name: string;
  private readonly now: () => number;
  private readonly startTime: number;
  private readonly pushSpan: (span: FinishedSpan) => void;
  private ended = false;
  private readonly attributes: SpanAttributes;
  private readonly events: SpanEvent[] = [];

  constructor(input: {
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    attributes: SpanAttributes;
    now: () => number;
    pushSpan: (span: FinishedSpan) => void;
  }) {
    this.name = input.name;
    this.traceId = input.traceId;
    this.spanId = input.spanId;
    if (input.parentSpanId !== undefined) {
      this.parentSpanId = input.parentSpanId;
    }
    this.attributes = { ...input.attributes };
    this.now = input.now;
    this.pushSpan = input.pushSpan;
    this.startTime = input.now();
  }

  setAttribute(key: string, value: PrimitiveValue): void {
    this.attributes[key] = value;
  }

  addEvent(name: string, attributes: SpanAttributes = {}): void {
    this.events.push({
      name,
      timestamp: this.now(),
      attributes: { ...attributes },
    });
  }

  end(status: "ok" | "error" = "ok", errorMessage?: string): FinishedSpan {
    if (this.ended) {
      throw new Error(`Span "${this.name}" was already ended`);
    }
    this.ended = true;

    const endTime = this.now();
    const finished: FinishedSpan = {
      name: this.name,
      traceId: this.traceId,
      spanId: this.spanId,
      startTime: this.startTime,
      endTime,
      durationMs: endTime - this.startTime,
      attributes: { ...this.attributes },
      events: [...this.events],
      status,
      ...(this.parentSpanId ? { parentSpanId: this.parentSpanId } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };
    this.pushSpan(finished);
    return finished;
  }
}

class InMemoryTracer implements Tracer {
  private readonly now: () => number;
  private readonly finishedSpans: FinishedSpan[] = [];

  constructor(options: CreateTracerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  startSpan(name: string, attributes: SpanAttributes = {}): Span {
    const currentContext = getRunContext();
    const traceId = currentContext?.traceId ?? nextId("trace");
    const parentSpanId = currentContext?.spanId;
    const spanId = nextId("span");

    const input: ConstructorParameters<typeof InMemorySpan>[0] = {
      name,
      traceId,
      spanId,
      attributes,
      now: this.now,
      pushSpan: (span) => {
        this.finishedSpans.push(span);
      },
    };

    if (parentSpanId) {
      input.parentSpanId = parentSpanId;
    }

    return new InMemorySpan(input);
  }

  getFinishedSpans(): readonly FinishedSpan[] {
    return [...this.finishedSpans];
  }

  reset(): void {
    this.finishedSpans.length = 0;
  }
}

export function createTracer(options: CreateTracerOptions = {}): Tracer {
  return new InMemoryTracer(options);
}
