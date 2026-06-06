import type { TaskItem, TaskState } from "@hotflow/contracts";

import type { TaskBoard } from "./task-board.js";

export interface TodoWritePort {
  write(items: readonly TaskItem[]): Promise<TaskState>;
}

export class TaskBoardTodoWritePort implements TodoWritePort {
  public constructor(private readonly board: TaskBoard) {}

  public async write(items: readonly TaskItem[]): Promise<TaskState> {
    return this.board.writeTodos(items);
  }
}
