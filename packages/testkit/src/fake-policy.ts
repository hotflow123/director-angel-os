import type { ExecutionPolicy, ExecutionPolicyInput, PolicyDecision } from "./contracts.js";

export type PolicyResponder =
  | PolicyDecision
  | ((input: ExecutionPolicyInput) => Promise<PolicyDecision> | PolicyDecision);

export interface FakePolicyOptions {
  readonly responders?: readonly PolicyResponder[];
  readonly fallback?: PolicyDecision;
}

export class FakeExecutionPolicy implements ExecutionPolicy {
  readonly inputs: ExecutionPolicyInput[] = [];
  private readonly queue: PolicyResponder[];
  private readonly fallback: PolicyDecision;

  constructor(options: FakePolicyOptions = {}) {
    this.queue = [...(options.responders ?? [])];
    this.fallback = options.fallback ?? { verdict: "allow" };
  }

  enqueue(responder: PolicyResponder): void {
    this.queue.push(responder);
  }

  async evaluateToolCall(input: ExecutionPolicyInput): Promise<PolicyDecision> {
    this.inputs.push(input);
    const responder = this.queue.shift();
    if (!responder) {
      return this.fallback;
    }
    if (typeof responder === "function") {
      return responder(input);
    }
    return responder;
  }
}
