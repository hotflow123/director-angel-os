import type { MemoryRecallLike, RecallBlock, RecallInput } from "./contracts.js";

export type RecallResponder =
  | readonly RecallBlock[]
  | ((input: RecallInput) => Promise<readonly RecallBlock[]> | readonly RecallBlock[]);

export interface FakeRecallOptions {
  readonly responder?: RecallResponder;
}

export class FakeRecall implements MemoryRecallLike {
  readonly inputs: RecallInput[] = [];
  private readonly responder: RecallResponder;

  constructor(options: FakeRecallOptions = {}) {
    this.responder = options.responder ?? [];
  }

  async recall(input: RecallInput): Promise<readonly RecallBlock[]> {
    this.inputs.push(input);
    if (typeof this.responder === "function") {
      return this.responder(input);
    }
    return this.responder;
  }
}
