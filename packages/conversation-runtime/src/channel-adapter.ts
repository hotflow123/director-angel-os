import type {
  ConversationRuntimeAdmission,
  ConversationRuntimeEventClass,
  ConversationRuntimeNormalizedTurnInput,
  ConversationRuntimeTurnLogEvent,
} from "./channel-turn.js";
import type { RunConversationRuntimeTurnOptions } from "./runtime.js";
import { runConversationRuntimeTurn } from "./runtime.js";
import type {
  ConversationRuntimeAngelRoleProfile,
  ConversationRuntimeEvent,
  ConversationRuntimeInput,
  ConversationRuntimeResult,
  ConversationRuntimeTraceItem,
} from "./types.js";

export interface ConversationRuntimeChannelApprovalAction {
  readonly id: string;
  readonly approvalId: string;
  readonly action: "approve" | "reject" | "cancel" | (string & {});
  readonly messageId?: string;
  readonly senderId?: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeChannelDeliveryResult {
  readonly eventId: string;
  readonly delivered: boolean;
  readonly channelMessageId?: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeChannelFinalizeResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeChannelAdapter<
  TransportEvent = unknown,
  ApprovalResult = unknown,
> {
  readonly id: string;
  readonly channel: string;
  readonly ingest: (
    event: TransportEvent,
  ) => Promise<ConversationRuntimeNormalizedTurnInput> | ConversationRuntimeNormalizedTurnInput;
  readonly classifyTransportEvent: (
    input: ConversationRuntimeNormalizedTurnInput,
  ) => Promise<ConversationRuntimeEventClass> | ConversationRuntimeEventClass;
  readonly admit?: (
    input: ConversationRuntimeNormalizedTurnInput,
    eventClass: ConversationRuntimeEventClass,
  ) => Promise<ConversationRuntimeAdmission> | ConversationRuntimeAdmission;
  readonly buildRuntimeInput?: (
    input: ConversationRuntimeNormalizedTurnInput,
  ) => ConversationRuntimeInput;
  readonly deliverEvent?: (
    event: ConversationRuntimeEvent,
    input: ConversationRuntimeNormalizedTurnInput,
    result: ConversationRuntimeResult,
  ) => Promise<ConversationRuntimeChannelDeliveryResult> | ConversationRuntimeChannelDeliveryResult;
  readonly handleApprovalAction?: (
    action: ConversationRuntimeChannelApprovalAction,
    input: ConversationRuntimeNormalizedTurnInput,
  ) => Promise<ApprovalResult> | ApprovalResult;
  readonly finalize?: (
    input: ConversationRuntimeNormalizedTurnInput,
    result: ConversationRuntimeChannelTurnRunResult<ApprovalResult>,
  ) => Promise<ConversationRuntimeChannelFinalizeResult> | ConversationRuntimeChannelFinalizeResult;
}

export interface RunConversationRuntimeChannelTurnOptions<
  TransportEvent = unknown,
  ApprovalResult = unknown,
> {
  readonly adapter: ConversationRuntimeChannelAdapter<TransportEvent, ApprovalResult>;
  readonly runtime: RunConversationRuntimeTurnOptions;
  readonly nowMs?: () => number;
}

export interface ConversationRuntimeChannelTurnRunResult<ApprovalResult = unknown> {
  readonly adapterId: string;
  readonly channel: string;
  readonly input?: ConversationRuntimeNormalizedTurnInput;
  readonly runtimeInput?: ConversationRuntimeInput;
  readonly eventClass?: ConversationRuntimeEventClass;
  readonly admission: ConversationRuntimeAdmission;
  readonly runtimeResult?: ConversationRuntimeResult;
  readonly deliveries: readonly ConversationRuntimeChannelDeliveryResult[];
  readonly approvalResult?: ApprovalResult;
  readonly finalizeResult?: ConversationRuntimeChannelFinalizeResult;
  readonly log: readonly ConversationRuntimeTurnLogEvent[];
  readonly operatorTrace: readonly ConversationRuntimeTraceItem[];
}

export async function runConversationRuntimeChannelTurn<
  TransportEvent = unknown,
  ApprovalResult = unknown,
>(
  event: TransportEvent,
  options: RunConversationRuntimeChannelTurnOptions<TransportEvent, ApprovalResult>,
): Promise<ConversationRuntimeChannelTurnRunResult<ApprovalResult>> {
  const nowMs = options.nowMs ?? options.runtime.nowMs ?? (() => Date.now());
  const adapter = options.adapter;
  const log: ConversationRuntimeTurnLogEvent[] = [];
  const deliveries: ConversationRuntimeChannelDeliveryResult[] = [];
  const operatorTrace: ConversationRuntimeTraceItem[] = [];

  let input: ConversationRuntimeNormalizedTurnInput | undefined;
  let eventClass: ConversationRuntimeEventClass | undefined;
  let admission: ConversationRuntimeAdmission = { kind: "drop", reason: "not-ingested" };
  let runtimeInput: ConversationRuntimeInput | undefined;
  let runtimeResult: ConversationRuntimeResult | undefined;

  try {
    input = await adapter.ingest(event);
    pushLog(log, input, "ingest", "done", nowMs);

    eventClass = await adapter.classifyTransportEvent(input);
    pushLog(
      log,
      input,
      "classify",
      "done",
      nowMs,
      eventClass.reason === undefined ? {} : { reason: eventClass.reason },
    );

    admission =
      (await adapter.admit?.(input, eventClass)) ?? defaultAdmissionForEventClass(eventClass);
    pushLog(log, input, "preflight", admission.kind, nowMs, {
      admission: admission.kind,
      ...(admission.reason === undefined ? {} : { reason: admission.reason }),
    });

    if (admission.kind !== "dispatch") {
      const result: ConversationRuntimeChannelTurnRunResult<ApprovalResult> = {
        adapterId: adapter.id,
        channel: adapter.channel,
        input,
        eventClass,
        admission,
        deliveries,
        log,
        operatorTrace,
      };
      const finalizeResult = await adapter.finalize?.(input, result);
      const finalizeReason = finalizeResult?.reason ?? admission.reason;
      pushLog(
        log,
        input,
        "finalize",
        finalizeResult?.ok === false ? "error" : "done",
        nowMs,
        finalizeReason === undefined ? {} : { reason: finalizeReason },
      );
      return finalizeResult === undefined ? result : { ...result, finalizeResult };
    }

    runtimeInput =
      adapter.buildRuntimeInput?.(input) ?? buildRuntimeInputFromNormalizedTurnInput(input);
    pushLog(log, input, "assemble", "done", nowMs);

    runtimeResult = await runConversationRuntimeTurn(runtimeInput, options.runtime);
    operatorTrace.push(...runtimeResult.operatorTrace.items);
    pushLog(log, input, "dispatch", "done", nowMs);

    for (const runtimeEvent of runtimeResult.events) {
      if (adapter.deliverEvent === undefined) {
        continue;
      }
      deliveries.push(await adapter.deliverEvent(runtimeEvent, input, runtimeResult));
    }

    const result: ConversationRuntimeChannelTurnRunResult<ApprovalResult> = {
      adapterId: adapter.id,
      channel: adapter.channel,
      input,
      runtimeInput,
      eventClass,
      admission,
      runtimeResult,
      deliveries,
      log,
      operatorTrace,
    };
    const finalizeResult = await adapter.finalize?.(input, result);
    pushLog(
      log,
      input,
      "finalize",
      finalizeResult?.ok === false ? "error" : "done",
      nowMs,
      finalizeResult?.reason === undefined ? {} : { reason: finalizeResult.reason },
    );
    return finalizeResult === undefined ? result : { ...result, finalizeResult };
  } catch (error) {
    const fallbackInput = input;
    pushLog(
      log,
      fallbackInput,
      fallbackInput === undefined ? "ingest" : "finalize",
      "error",
      nowMs,
      {
        error,
      },
    );
    return {
      adapterId: adapter.id,
      channel: adapter.channel,
      ...(input === undefined ? {} : { input }),
      ...(runtimeInput === undefined ? {} : { runtimeInput }),
      ...(eventClass === undefined ? {} : { eventClass }),
      admission,
      ...(runtimeResult === undefined ? {} : { runtimeResult }),
      deliveries,
      log,
      operatorTrace,
    };
  }
}

export function buildRuntimeInputFromNormalizedTurnInput(
  input: ConversationRuntimeNormalizedTurnInput,
): ConversationRuntimeInput {
  const text =
    input.message.bodyForAgent ??
    input.message.commandBody ??
    input.message.body ??
    input.message.rawBody;
  const displayName = input.sender.displayLabel ?? input.sender.name;
  const angelRoleProfile = input.angelRoleProfile ?? readAngelRoleProfile(input.metadata);
  return {
    surface: input.surface,
    channel: input.channel,
    messageId: input.message.id,
    sessionKey: input.route.dispatchSessionKey ?? input.route.sessionKey,
    text,
    ...(input.message.timestampMs === undefined ? {} : { receivedAtMs: input.message.timestampMs }),
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    sender: {
      id: input.sender.id,
      ...(displayName === undefined ? {} : { displayName }),
      ...(input.sender.username === undefined ? {} : { username: input.sender.username }),
      metadata: {
        ...(input.sender.roles === undefined ? {} : { roles: input.sender.roles }),
        ...(input.sender.tag === undefined ? {} : { tag: input.sender.tag }),
        ...(input.sender.metadata ?? {}),
      },
    },
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
    ...(input.supplemental?.quote === undefined
      ? {}
      : {
          quotedContext: {
            ...(input.supplemental.quote.id === undefined
              ? {}
              : { messageId: input.supplemental.quote.id }),
            ...(input.supplemental.quote.sender === undefined
              ? {}
              : { senderId: input.supplemental.quote.sender }),
            ...(input.supplemental.quote.body === undefined
              ? {}
              : { text: input.supplemental.quote.body }),
          },
        }),
    trustedContext: {
      ...(input.route.accountId === undefined ? {} : { accountId: input.route.accountId }),
      ...(angelRoleProfile === undefined ? {} : { angelRoleProfile }),
      metadata: {
        route: input.route,
        conversation: input.conversation,
        reply: input.reply,
        access: input.access,
      },
    },
    untrustedChannelContext: {
      channel: input.channel,
      rawMessageId: input.message.id,
      ...(input.conversation.threadId === undefined
        ? {}
        : { rawThreadId: input.conversation.threadId }),
      rawSenderId: input.sender.id,
      payload: {
        supplemental: input.supplemental,
        metadata: input.metadata,
      },
    },
    metadata: {
      normalizedChannelInput: true,
      ...(input.metadata ?? {}),
    },
  };
}

function readAngelRoleProfile(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ConversationRuntimeAngelRoleProfile | undefined {
  const value = metadata?.angelRoleProfile;
  if (!isRecord(value) || typeof value.roleId !== "string" || value.roleId.trim().length === 0) {
    return undefined;
  }
  return {
    roleId: value.roleId.trim(),
    ...optionalStringField("title", value.title),
    ...optionalStringField("domain", value.domain),
    ...optionalStringArrayField("responsibilities", value.responsibilities),
    ...optionalStringArrayField("learningScope", value.learningScope),
    ...optionalStringArrayField("controllableSystems", value.controllableSystems),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStringField<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === "string" && value.trim().length > 0
    ? ({ [key]: value.trim() } as Partial<Record<K, string>>)
    : {};
}

function optionalStringArrayField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, readonly string[]>> {
  if (!Array.isArray(value)) {
    return {};
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length === 0
    ? {}
    : ({ [key]: items } as unknown as Partial<Record<K, readonly string[]>>);
}

function defaultAdmissionForEventClass(
  eventClass: ConversationRuntimeEventClass,
): ConversationRuntimeAdmission {
  if (eventClass.canStartAgentTurn) {
    return eventClass.reason === undefined
      ? { kind: "dispatch" }
      : { kind: "dispatch", reason: eventClass.reason };
  }
  if (eventClass.kind === "delivery" || eventClass.kind === "reaction") {
    return {
      kind: "observe-only",
      reason: eventClass.reason ?? `${eventClass.kind} does not start an agent turn`,
    };
  }
  return {
    kind: "drop",
    reason: eventClass.reason ?? `${eventClass.kind} cannot start an agent turn`,
  };
}

function pushLog(
  log: ConversationRuntimeTurnLogEvent[],
  input: ConversationRuntimeNormalizedTurnInput | undefined,
  stage: ConversationRuntimeTurnLogEvent["stage"],
  event: ConversationRuntimeTurnLogEvent["event"],
  nowMs: () => number,
  extra: Partial<ConversationRuntimeTurnLogEvent> = {},
): void {
  log.push({
    stage,
    event,
    channel: input?.channel ?? "unknown",
    occurredAtMs: nowMs(),
    ...(input?.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input?.message.id === undefined ? {} : { messageId: input.message.id }),
    ...(input?.route.sessionKey === undefined ? {} : { sessionKey: input.route.sessionKey }),
    ...extra,
  });
}
