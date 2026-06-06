export type ConversationRuntimeQueuedInputMode =
  | "prompt"
  | "command"
  | "approval"
  | "task-notification"
  | "system"
  | (string & {});

export type ConversationRuntimeQueuedInputOrigin =
  | "user"
  | "runtime"
  | "bridge"
  | "task"
  | "agent"
  | (string & {});

export type ConversationRuntimeQueuePriority = "now" | "next" | "later";

export interface ConversationRuntimeQueuedInput {
  readonly id: string;
  readonly sessionKey: string;
  readonly value: string;
  readonly mode: ConversationRuntimeQueuedInputMode;
  readonly priority: ConversationRuntimeQueuePriority;
  readonly origin: ConversationRuntimeQueuedInputOrigin;
  readonly agentId?: string;
  readonly isMeta?: boolean;
  readonly workload?: "interactive" | "background" | (string & {});
  readonly skipSlashCommands?: boolean;
  readonly bridgeOrigin?: boolean;
  readonly createdAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeQueueOperation {
  readonly operation: "enqueue" | "dequeue" | "remove" | "clear" | "drain";
  readonly queueId?: string;
  readonly sessionKey?: string;
  readonly priority?: ConversationRuntimeQueuePriority;
  readonly occurredAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeQueueSnapshot {
  readonly sessionKey: string;
  readonly items: readonly ConversationRuntimeQueuedInput[];
  readonly length: number;
}

export interface ConversationRuntimeDequeueOptions {
  readonly sessionKey?: string;
  readonly agentId?: string;
  readonly includeMeta?: boolean;
  readonly excludeSlashCommands?: boolean;
  readonly mode?: ConversationRuntimeQueuedInputMode;
}

const QUEUE_PRIORITY_ORDER: Readonly<Record<ConversationRuntimeQueuePriority, number>> = {
  now: 0,
  next: 1,
  later: 2,
};

export function compareConversationRuntimeQueuedInputs(
  left: ConversationRuntimeQueuedInput,
  right: ConversationRuntimeQueuedInput,
): number {
  const priorityDelta = QUEUE_PRIORITY_ORDER[left.priority] - QUEUE_PRIORITY_ORDER[right.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return left.createdAtMs - right.createdAtMs;
}

export function compareConversationRuntimeQueuedInputsChronologically(
  left: ConversationRuntimeQueuedInput,
  right: ConversationRuntimeQueuedInput,
): number {
  const createdAtDelta = left.createdAtMs - right.createdAtMs;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }
  return left.id.localeCompare(right.id);
}

export function isConversationRuntimeSlashQueuedInput(
  input: ConversationRuntimeQueuedInput,
): boolean {
  return input.value.trimStart().startsWith("/");
}

export class ConversationRuntimeSessionQueue {
  private readonly items: ConversationRuntimeQueuedInput[] = [];

  enqueue(input: ConversationRuntimeQueuedInput): ConversationRuntimeQueueOperation {
    this.items.push(input);
    return {
      operation: "enqueue",
      queueId: input.id,
      sessionKey: input.sessionKey,
      priority: input.priority,
      occurredAtMs: input.createdAtMs,
    };
  }

  peek(
    options: ConversationRuntimeDequeueOptions = {},
  ): ConversationRuntimeQueuedInput | undefined {
    return this.findNextIndex(options) === -1 ? undefined : this.items[this.findNextIndex(options)];
  }

  dequeue(
    options: ConversationRuntimeDequeueOptions = {},
  ): ConversationRuntimeQueuedInput | undefined {
    const index = this.findNextIndex(options);
    if (index === -1) {
      return undefined;
    }
    return this.items.splice(index, 1)[0];
  }

  drain(
    options: ConversationRuntimeDequeueOptions = {},
  ): readonly ConversationRuntimeQueuedInput[] {
    const drained: ConversationRuntimeQueuedInput[] = [];
    let next = this.dequeue(options);
    while (next !== undefined) {
      drained.push(next);
      next = this.dequeue(options);
    }
    return drained;
  }

  removeById(id: string): ConversationRuntimeQueuedInput | undefined {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      return undefined;
    }
    return this.items.splice(index, 1)[0];
  }

  clear(sessionKey?: string): readonly ConversationRuntimeQueuedInput[] {
    if (sessionKey === undefined) {
      return this.items.splice(0);
    }
    const removed: ConversationRuntimeQueuedInput[] = [];
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (this.items[index]?.sessionKey === sessionKey) {
        removed.unshift(this.items.splice(index, 1)[0] as ConversationRuntimeQueuedInput);
      }
    }
    return removed;
  }

  snapshot(sessionKey: string): ConversationRuntimeQueueSnapshot {
    const items = this.items
      .filter((item) => item.sessionKey === sessionKey)
      .toSorted(compareConversationRuntimeQueuedInputsChronologically);
    return {
      sessionKey,
      items,
      length: items.length,
    };
  }

  length(sessionKey?: string): number {
    if (sessionKey === undefined) {
      return this.items.length;
    }
    return this.items.filter((item) => item.sessionKey === sessionKey).length;
  }

  private findNextIndex(options: ConversationRuntimeDequeueOptions): number {
    let bestIndex = -1;
    let bestItem: ConversationRuntimeQueuedInput | undefined;
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      if (item === undefined || !matchesDequeueOptions(item, options)) {
        continue;
      }
      if (bestItem === undefined || compareConversationRuntimeQueuedInputs(item, bestItem) < 0) {
        bestIndex = index;
        bestItem = item;
      }
    }
    return bestIndex;
  }
}

function matchesDequeueOptions(
  item: ConversationRuntimeQueuedInput,
  options: ConversationRuntimeDequeueOptions,
): boolean {
  if (options.sessionKey !== undefined && item.sessionKey !== options.sessionKey) {
    return false;
  }
  if (options.agentId !== undefined && item.agentId !== options.agentId) {
    return false;
  }
  if (options.includeMeta !== true && item.isMeta === true) {
    return false;
  }
  if (options.excludeSlashCommands === true && isConversationRuntimeSlashQueuedInput(item)) {
    return false;
  }
  if (options.mode !== undefined && item.mode !== options.mode) {
    return false;
  }
  return true;
}
