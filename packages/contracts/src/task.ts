export type TaskStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface TaskContract {
  readonly id: string;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly parentTaskId?: string;
  readonly kind: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly retries: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export type TaskItemStatus = "todo" | "doing" | "done";

export interface TaskItem {
  readonly id: string;
  readonly content: string;
  readonly status: TaskItemStatus;
  readonly priority?: TaskPriority;
}

export interface TaskState {
  readonly items: readonly TaskItem[];
  readonly updatedAtMs?: number;
}
