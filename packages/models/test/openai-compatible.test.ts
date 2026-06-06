import { describe, expect, it } from "vitest";

import {
  OpenAICompatibleProvider,
  adaptOpenAIChunkToProviderEvents,
} from "../src/adapters/openai-compatible.js";

describe("OpenAICompatibleProvider", () => {
  it("parses generate response from openai-compatible payload", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "stubbed-response",
                tool_calls: [
                  {
                    id: "tool-1",
                    function: { name: "filesystem.read_text", arguments: '{"path":"README.md"}' },
                  },
                ],
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 9,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.invalid/v1",
      fetchImpl,
    });

    const result = await provider.generate({
      model: "gpt-stub",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.text).toBe("stubbed-response");
    expect(result.toolCalls?.[0]?.name).toBe("filesystem.read_text");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 9 });
  });

  it("serializes tool schema surface into openai-compatible request body", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "stubbed-response",
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.invalid/v1",
      fetchImpl,
    });

    await provider.generate({
      model: "gpt-stub",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          name: "filesystem.read_text",
          description: "Read a UTF-8 text file from the workspace.",
          toolset: "filesystem",
          readOnly: true,
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
              },
            },
            required: ["path"],
          },
        },
      ],
    });

    expect(requestBody).toMatchObject({
      model: "gpt-stub",
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "filesystem.read_text",
            description: "Read a UTF-8 text file from the workspace.",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                },
              },
              required: ["path"],
            },
          },
        },
      ],
    });
  });

  it("serializes structured assistant/tool continuation messages", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "final answer",
              },
              finish_reason: "stop",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.invalid/v1",
      fetchImpl,
    });

    await provider.generate({
      model: "gpt-stub",
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "I need to inspect the file first.",
          toolCalls: [
            {
              id: "call-1",
              name: "filesystem.read_text",
              argumentsJson: '{"path":"README.md"}',
            },
          ],
        },
        {
          role: "tool",
          name: "filesystem.read_text",
          toolCallId: "call-1",
          content: '{"ok":true,"output":"Agent OS repository details..."}',
        },
      ],
    });

    expect(requestBody).toMatchObject({
      model: "gpt-stub",
      messages: [
        {
          role: "user",
          content: "hello",
        },
        {
          role: "assistant",
          content: "I need to inspect the file first.",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "filesystem.read_text",
                arguments: '{"path":"README.md"}',
              },
            },
          ],
        },
        {
          role: "tool",
          name: "filesystem.read_text",
          tool_call_id: "call-1",
          content: '{"ok":true,"output":"Agent OS repository details..."}',
        },
      ],
    });
  });

  it("adapts openai chunk events", () => {
    const events = adaptOpenAIChunkToProviderEvents({
      id: "resp-1",
      choices: [
        {
          delta: {
            content: "hello",
            tool_calls: [{ id: "t1", function: { name: "tasks.todo_write", arguments: "{}" } }],
          },
          finish_reason: "stop",
        },
      ],
    });

    expect(events.map((event) => event.type)).toEqual([
      "text.delta",
      "tool.call",
      "response.completed",
    ]);
  });

  it("streams openai-compatible SSE chunks incrementally", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const encoder = new TextEncoder();
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"id":"resp-1","choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'data: {"id":"resp-1","choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n',
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    };

    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.invalid/v1",
      fetchImpl,
    });

    const events = [];
    for await (const event of provider.stream({
      model: "gpt-stub",
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(event);
    }

    expect(requestBody).toMatchObject({ stream: true });
    expect(events).toEqual([
      { type: "response.started" },
      { type: "text.delta", text: "你", responseId: "resp-1" },
      { type: "text.delta", text: "好", responseId: "resp-1" },
      { type: "response.completed", finishReason: "stop", responseId: "resp-1" },
    ]);
  });

  it("classifies 429 as retryable provider transient failure", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "content-type": "text/plain" },
      });
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.invalid/v1",
      fetchImpl,
    });

    await expect(
      provider.generate({
        model: "gpt-stub",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      name: "ModelProviderError",
      code: "HTTP_429",
      retryable: true,
      statusCode: 429,
    });
  });

  it("classifies 400 as non-retryable provider failure", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("bad request", {
        status: 400,
        headers: { "content-type": "text/plain" },
      });
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.invalid/v1",
      fetchImpl,
    });

    await expect(
      provider.generate({
        model: "gpt-stub",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      name: "ModelProviderError",
      code: "HTTP_4XX",
      retryable: false,
      statusCode: 400,
    });
  });
});
