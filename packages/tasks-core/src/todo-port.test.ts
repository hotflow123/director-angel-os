import { describe, expect, test } from "vitest";

import { TaskBoard } from "./task-board.js";
import { TaskBoardTodoWritePort } from "./todo-port.js";

describe("TaskBoardTodoWritePort", () => {
  test("writes todos through task board", async () => {
    const board = new TaskBoard();
    const port = new TaskBoardTodoWritePort(board);

    const state = await port.write([
      { id: "t1", content: "plan", status: "todo" },
      { id: "t2", content: "run", status: "doing", priority: "high" },
    ]);

    expect(state.items).toHaveLength(2);
    expect(board.answerFirstStep()).toBe("plan");
  });
});
