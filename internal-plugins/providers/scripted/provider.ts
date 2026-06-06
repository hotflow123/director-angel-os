import type {
  ModelGenerateResult,
  ModelProvider,
  ModelRequest,
  ProviderStreamEvent,
} from "@hotflow/models";

function extractFilePath(messages: ModelRequest["messages"]): string {
  const prompt = messages.map((message) => message.content).join("\n");
  const match =
    /read\s+["']?([^\s,"']+)["']?/iu.exec(prompt) ??
    /path["':\s]+["']?([^\s,"']+)["']?/iu.exec(prompt);
  return match?.[1] ?? "README.md";
}

function extractToolPayload(
  messages: ModelRequest["messages"],
  toolName: string,
): string | undefined {
  const prompt = messages.map((message) => message.content).join("\n");
  const marker = `Tool: ${toolName}`;
  const index = prompt.lastIndexOf(marker);
  if (index === -1) {
    return undefined;
  }
  return prompt.slice(index);
}

function buildTodoItems() {
  return [
    {
      id: "todo_1",
      content: "Inspect the runtime contracts and package boundaries",
      status: "todo" as const,
    },
    {
      id: "todo_2",
      content: "Wire the Golden Path session flow end-to-end",
      status: "todo" as const,
    },
    {
      id: "todo_3",
      content: "Run typecheck and tests, then fix regressions",
      status: "todo" as const,
    },
  ];
}

export class ScriptedGoldenPathProviderPlugin implements ModelProvider {
  public readonly id = "scripted";

  public async generate(request: ModelRequest): Promise<ModelGenerateResult> {
    const prompt = request.messages.map((message) => message.content).join("\n");

    if (prompt.includes("Tool: tasks.todo_write")) {
      return {
        text: [
          "Summary: this repository is a TypeScript-first Agent OS skeleton.",
          "It focuses on contracts, sessions, tools, memory, and a CLI golden path.",
          "Todo list has been persisted for the session.",
        ].join(" "),
        finishReason: "stop",
      };
    }

    if (prompt.includes("Tool: filesystem.read_text")) {
      const fileSnippet = extractToolPayload(request.messages, "filesystem.read_text") ?? "";
      return {
        text: fileSnippet.includes("Agent OS")
          ? "I found an Agent OS style repository. I will persist a three-step todo list now."
          : "I read the requested file and will persist a three-step todo list now.",
        toolCalls: [
          {
            id: "todo_write_1",
            name: "tasks.todo_write",
            argumentsJson: JSON.stringify({
              items: buildTodoItems(),
            }),
          },
        ],
        finishReason: "tool_calls",
      };
    }

    const path = extractFilePath(request.messages);
    return {
      text: `I need to inspect ${path} before I can summarize it.`,
      toolCalls: [
        {
          id: "read_text_1",
          name: "filesystem.read_text",
          argumentsJson: JSON.stringify({ path }),
        },
      ],
      finishReason: "tool_calls",
    };
  }

  public async *stream(request: ModelRequest): AsyncIterable<ProviderStreamEvent> {
    const result = await this.generate(request);
    yield { type: "response.started" };
    if (result.text.length > 0) {
      yield { type: "text.delta", text: result.text };
    }
    for (const toolCall of result.toolCalls ?? []) {
      yield { type: "tool.call", toolCall };
    }
    if (result.finishReason) {
      yield { type: "response.completed", finishReason: result.finishReason };
      return;
    }
    yield { type: "response.completed" };
  }
}
