import type { ToolLike } from "./contracts.js";

export interface ToolInvocation {
  readonly args: unknown;
  readonly timestamp: number;
}

export interface FakeToolOptions {
  readonly name: string;
  readonly handler?: (args: unknown) => Promise<unknown> | unknown;
}

export class FakeTool implements ToolLike {
  readonly name: string;
  readonly calls: ToolInvocation[] = [];

  private readonly handler: ((args: unknown) => Promise<unknown> | unknown) | undefined;

  constructor(options: FakeToolOptions) {
    this.name = options.name;
    this.handler = options.handler;
  }

  async invoke(args: unknown): Promise<unknown> {
    this.calls.push({ args, timestamp: Date.now() });
    if (!this.handler) {
      return undefined;
    }
    return this.handler(args);
  }
}

export function createFakeTool(options: FakeToolOptions): FakeTool {
  return new FakeTool(options);
}
