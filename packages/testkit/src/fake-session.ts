import type { SessionLike, SessionSnapshot } from "./contracts.js";

export interface FakeSessionOptions {
  readonly id?: string;
  readonly initialTurn?: number;
  readonly initialState?: Record<string, unknown>;
}

function nextSessionId(): string {
  return `session_${Math.random().toString(36).slice(2, 10)}`;
}

export class FakeSession implements SessionLike {
  readonly id: string;
  private turn: number;
  private readonly state: Record<string, unknown>;

  constructor(options: FakeSessionOptions = {}) {
    this.id = options.id ?? nextSessionId();
    this.turn = options.initialTurn ?? 0;
    this.state = { ...(options.initialState ?? {}) };
  }

  snapshot(): SessionSnapshot {
    return {
      id: this.id,
      turn: this.turn,
      state: { ...this.state },
    };
  }

  advanceTurn(): SessionSnapshot {
    this.turn += 1;
    return this.snapshot();
  }

  setState(key: string, value: unknown): void {
    this.state[key] = value;
  }

  getState<T>(key: string): T | undefined {
    return this.state[key] as T | undefined;
  }
}
