import type {
  ConversationRuntimeCapabilityPacket,
  ConversationRuntimeOperatorTrace,
  ConversationRuntimeResult,
  ConversationRuntimeTraceItem,
} from "./types.js";

export type ConversationRuntimeEvalSignal =
  | "capability-resolved"
  | "model-loop"
  | "tool-required"
  | "tool-requested"
  | "tool-completed"
  | "tool-permission"
  | "skill-hit"
  | "skill-view"
  | "skill-use"
  | "memory-hit"
  | "knowledge-hit"
  | "production-dispatched"
  | "grounded-repair";

export interface ConversationRuntimeEvalRequirement {
  readonly signal: ConversationRuntimeEvalSignal;
  readonly minCount?: number;
  readonly toolName?: string;
  readonly capability?: string;
  readonly hitSource?: string;
}

export interface ConversationRuntimeEvalContract {
  readonly id: string;
  readonly description?: string;
  readonly requirements: readonly ConversationRuntimeEvalRequirement[];
}

export interface ConversationRuntimeEvalMetric {
  readonly signal: ConversationRuntimeEvalSignal;
  readonly count: number;
}

export interface ConversationRuntimeEvalFailure {
  readonly signal: ConversationRuntimeEvalSignal;
  readonly expected: number;
  readonly actual: number;
  readonly detail: string;
}

export interface ConversationRuntimeEvalReport {
  readonly contractId: string;
  readonly passed: boolean;
  readonly metrics: readonly ConversationRuntimeEvalMetric[];
  readonly failures: readonly ConversationRuntimeEvalFailure[];
}

export function evaluateConversationRuntimeContract(
  result: ConversationRuntimeResult,
  contract: ConversationRuntimeEvalContract,
): ConversationRuntimeEvalReport {
  const failures: ConversationRuntimeEvalFailure[] = [];
  const metrics = contract.requirements.map((requirement) => {
    const count = countConversationRuntimeEvalSignal(result, requirement);
    const expected = requirement.minCount ?? 1;
    if (count < expected) {
      failures.push({
        signal: requirement.signal,
        expected,
        actual: count,
        detail: describeEvalRequirement(requirement),
      });
    }
    return {
      signal: requirement.signal,
      count,
    };
  });

  return {
    contractId: contract.id,
    passed: failures.length === 0,
    metrics,
    failures,
  };
}

export function assertConversationRuntimeContract(
  result: ConversationRuntimeResult,
  contract: ConversationRuntimeEvalContract,
): ConversationRuntimeEvalReport {
  const report = evaluateConversationRuntimeContract(result, contract);
  if (!report.passed) {
    throw new Error(formatConversationRuntimeEvalReport(report));
  }
  return report;
}

export function formatConversationRuntimeEvalReport(report: ConversationRuntimeEvalReport): string {
  const metricText = report.metrics.map((metric) => `${metric.signal}=${metric.count}`).join(", ");
  if (report.passed) {
    return `Conversation runtime eval ${report.contractId} passed: ${metricText}`;
  }
  const failures = report.failures
    .map(
      (failure) =>
        `${failure.signal}: expected >=${failure.expected}, got ${failure.actual} (${failure.detail})`,
    )
    .join("; ");
  return `Conversation runtime eval ${report.contractId} failed: ${failures}; metrics: ${metricText}`;
}

function countConversationRuntimeEvalSignal(
  result: ConversationRuntimeResult,
  requirement: ConversationRuntimeEvalRequirement,
): number {
  const traceItems = flattenTrace(result.operatorTrace);
  switch (requirement.signal) {
    case "capability-resolved":
      return countTraceStages(traceItems, "capability.resolved");
    case "model-loop":
      return countTraceStages(traceItems, "model.loop.completed");
    case "tool-required":
      return countTraceStages(traceItems, "tool.required", requirement);
    case "tool-requested":
      return countTraceStages(traceItems, "tool.requested", requirement);
    case "tool-completed":
      return countTraceStages(traceItems, "tool.completed", requirement);
    case "tool-permission":
      return countTraceStages(traceItems, "tool.permission", requirement);
    case "skill-hit":
      return countCapabilityHits(result.capabilityPacket, "skill", requirement);
    case "skill-view":
      return countToolObservationTrace(traceItems, "director.skills.view", requirement);
    case "skill-use":
      return countToolObservationTrace(traceItems, "director.skills.use", requirement);
    case "memory-hit":
      return countCapabilityHits(result.capabilityPacket, "memory", requirement);
    case "knowledge-hit":
      return countCapabilityHits(result.capabilityPacket, "knowledge", requirement);
    case "production-dispatched":
      return countTraceStages(traceItems, "production.dispatched");
    case "grounded-repair":
      return (
        countTraceStages(traceItems, "model.repair.accepted") +
        countTraceStages(traceItems, "grounding.final.corrected") +
        countTraceStages(traceItems, "tool.observation.final.corrected")
      );
  }
}

function flattenTrace(
  trace: ConversationRuntimeOperatorTrace,
): readonly ConversationRuntimeTraceItem[] {
  return [...trace.items, ...(trace.turnTrace ?? [])];
}

function countTraceStages(
  traceItems: readonly ConversationRuntimeTraceItem[],
  stage: string,
  requirement: ConversationRuntimeEvalRequirement = { signal: "model-loop" },
): number {
  return traceItems.filter((item) => {
    if (item.stage !== stage) {
      return false;
    }
    return matchesToolRequirement(item, requirement);
  }).length;
}

function countToolTrace(
  traceItems: readonly ConversationRuntimeTraceItem[],
  toolName: string,
  requirement: ConversationRuntimeEvalRequirement,
): number {
  return traceItems.filter((item) => {
    if (readMetadataString(item.metadata, "toolName") !== toolName) {
      return false;
    }
    return matchesToolRequirement(item, requirement);
  }).length;
}

function countToolObservationTrace(
  traceItems: readonly ConversationRuntimeTraceItem[],
  toolName: string,
  requirement: ConversationRuntimeEvalRequirement,
): number {
  return traceItems.filter((item) => {
    if (item.stage !== "tool.completed") {
      return false;
    }
    if (readMetadataString(item.metadata, "toolName") !== toolName) {
      return false;
    }
    return matchesToolRequirement(item, requirement);
  }).length;
}

function matchesToolRequirement(
  item: ConversationRuntimeTraceItem,
  requirement: ConversationRuntimeEvalRequirement,
): boolean {
  if (
    requirement.toolName !== undefined &&
    readMetadataString(item.metadata, "toolName") !== requirement.toolName &&
    !metadataStringArrayContains(item.metadata, "toolNames", requirement.toolName) &&
    !metadataArrayContains(item.metadata, "requiredTools", "name", requirement.toolName)
  ) {
    return false;
  }
  if (
    requirement.capability !== undefined &&
    readMetadataString(item.metadata, "capability") !== requirement.capability &&
    !metadataArrayContains(item.metadata, "requiredTools", "capability", requirement.capability)
  ) {
    return false;
  }
  return true;
}

function countCapabilityHits(
  packet: ConversationRuntimeCapabilityPacket | undefined,
  source: string,
  requirement: ConversationRuntimeEvalRequirement,
): number {
  if (packet === undefined) {
    return 0;
  }
  const expectedSource = requirement.hitSource ?? source;
  return packet.hits.filter(
    (hit) => hit.source === expectedSource && (hit.status === "hit" || hit.status === "used"),
  ).length;
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function metadataArrayContains(
  metadata: Readonly<Record<string, unknown>> | undefined,
  arrayKey: string,
  itemKey: string,
  expected: string,
): boolean {
  const value = metadata?.[arrayKey];
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as Readonly<Record<string, unknown>>)[itemKey] === expected,
  );
}

function metadataStringArrayContains(
  metadata: Readonly<Record<string, unknown>> | undefined,
  arrayKey: string,
  expected: string,
): boolean {
  const value = metadata?.[arrayKey];
  return Array.isArray(value) && value.some((item) => item === expected);
}

function describeEvalRequirement(requirement: ConversationRuntimeEvalRequirement): string {
  return [
    `signal=${requirement.signal}`,
    requirement.toolName === undefined ? undefined : `tool=${requirement.toolName}`,
    requirement.capability === undefined ? undefined : `capability=${requirement.capability}`,
    requirement.hitSource === undefined ? undefined : `hitSource=${requirement.hitSource}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join(", ");
}
