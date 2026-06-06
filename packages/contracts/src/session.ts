export type SessionState = "open" | "closed" | "failed";

export interface SessionContract {
  readonly id: string;
  readonly userId?: string;
  readonly state: SessionState;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly tags?: readonly string[];
}
