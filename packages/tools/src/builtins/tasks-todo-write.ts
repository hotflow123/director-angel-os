import type { TaskItem, TaskState } from "@hotflow/contracts";

import type { TodoWritePort, ToolContext, ToolDefinition } from "../contracts.js";
import {
  defineToolInputSchema,
  expectArray,
  expectObject,
  expectOptionalStringEnum,
  expectString,
  expectStringEnumValue,
} from "../schema.js";

export interface TodoWriteArgs {
  items: TaskItem[];
}

const TASK_ITEM_STATUSES = ["todo", "doing", "done"] as const;
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export function createTasksTodoWriteTool(
  port: TodoWritePort,
): ToolDefinition<TodoWriteArgs, TaskState> {
  return {
    name: "tasks.todo_write",
    description: "Persist the current todo list for the active session.",
    timeoutMs: 2_000,
    readOnly: false,
    schema: {
      type: "object",
      description: "Arguments for persisting the session todo list.",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          description: "Todo items to persist for the active session.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
                description: "Stable todo identifier.",
              },
              content: {
                type: "string",
                description: "Human-readable todo content.",
              },
              status: {
                type: "string",
                description: "Current todo state.",
                enum: [...TASK_ITEM_STATUSES],
              },
              priority: {
                type: "string",
                description: "Optional todo priority.",
                enum: [...TASK_PRIORITIES],
              },
            },
            required: ["id", "content", "status"],
          },
        },
      },
      required: ["items"],
    },
    toolset: "tasks",
    toolsetDescription: "Task board mutation tools.",
    toolsetEnabledByDefault: true,
    inputSchema: defineToolInputSchema<TodoWriteArgs>((input) => {
      const record = expectObject(input);
      const items = expectArray(record, "items").map((entry, index) =>
        parseTaskItem(entry, `args.items[${index}]`),
      );
      return { items };
    }),
    capabilities: ["tasks.write"],
    riskLevel: "medium",
    async execute(args: TodoWriteArgs, context: ToolContext) {
      const output = await port.write(args.items);
      return {
        toolCallId: context.turnId ?? "tasks.todo_write",
        toolName: "tasks.todo_write",
        ok: true,
        output,
      };
    },
  };
}

function parseTaskItem(input: unknown, label: string): TaskItem {
  const record = expectObject(input, label);
  const priority = expectOptionalStringEnum(
    record,
    "priority",
    TASK_PRIORITIES,
    `${label}.priority`,
  );
  return {
    id: expectString(record, "id", `${label}.id`),
    content: expectString(record, "content", `${label}.content`),
    status: expectStringEnumValue(record.status, TASK_ITEM_STATUSES, `${label}.status`),
    ...(priority === undefined ? {} : { priority }),
  };
}
