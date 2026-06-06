import { classifyUserMemoryInput } from "./hygiene.js";
import { Layer0MemoryStore } from "./layer0.js";
import { Layer1MemoryStore } from "./layer1.js";
import { recallMemory } from "./recall.js";
import { retrieveScopedMemory } from "./scoped-retrieval.js";
import type {
  MemoryHit,
  MemoryRecallOptions,
  MemoryUpsertInput,
  ScopedRetrieveOptions,
  WorkingMemoryRecallBlock,
  WorkingMemoryRecallOptions,
} from "./types.js";
import { recallWorkingMemory as recallWorkingMemoryBlock } from "./working-memory.js";

export interface MemoryCoreManagerDeps {
  layer0?: Layer0MemoryStore;
  layer1?: Layer1MemoryStore;
}

export class MemoryCoreManager {
  readonly layer0: Layer0MemoryStore;
  readonly layer1: Layer1MemoryStore;

  constructor(deps: MemoryCoreManagerDeps = {}) {
    this.layer0 = deps.layer0 ?? new Layer0MemoryStore();
    this.layer1 = deps.layer1 ?? new Layer1MemoryStore();
  }

  writeLayer0(input: MemoryUpsertInput) {
    return this.layer0.upsert(applyLayer0AdmissionFallback(input));
  }

  writeLayer1(input: MemoryUpsertInput) {
    const fallback = applyLayer1AdmissionFallback(input);
    const admission = readMemoryAdmission(fallback.metadata);
    if (admission?.retention === "none" || admission?.retention === "quarantine") {
      return this.layer0.upsert(fallback);
    }

    return this.layer1.upsert(fallback);
  }

  retrieve(options: ScopedRetrieveOptions): MemoryHit[] {
    return retrieveScopedMemory(
      {
        layer0: this.layer0,
        layer1: this.layer1,
      },
      options,
    );
  }

  recall(options: MemoryRecallOptions): MemoryHit[] {
    return recallMemory(
      {
        layer0: this.layer0,
        layer1: this.layer1,
      },
      options,
    );
  }

  recallWorkingMemory(options: WorkingMemoryRecallOptions): WorkingMemoryRecallBlock {
    return recallWorkingMemoryBlock(
      {
        layer0: this.layer0,
        layer1: this.layer1,
      },
      options,
    );
  }
}

function applyLayer1AdmissionFallback(input: MemoryUpsertInput): MemoryUpsertInput {
  if (hasMemoryAdmission(input.metadata)) {
    return input;
  }

  const decision = classifyUserMemoryInput(input.content);
  if (!shouldApplyUserLayer1Admission(input, decision)) {
    return applySystemLayer1AdmissionFallback(input);
  }

  const quarantined = decision.retention === "quarantine";
  const discarded = decision.retention === "none";

  return {
    ...input,
    content: quarantined ? decision.redactedContent : input.content,
    scope:
      quarantined || discarded ? { ...input.scope, namespace: decision.namespace } : input.scope,
    tags: uniqueStrings([
      ...(input.tags ?? []),
      ...decision.tags,
      "memory:direct-layer1",
      `memory:${decision.category}`,
      ...(decision.status === "drop" ? ["memory:noise"] : []),
      ...(quarantined ? ["memory:quarantine", "memory:safety"] : []),
    ]),
    metadata: {
      ...(input.metadata ?? {}),
      memoryAdmission: {
        category: decision.category,
        retention: decision.retention,
        confidence: decision.confidence,
        score: decision.score,
        reason: `direct-layer1:${decision.reason}`,
        safety: decision.safety,
      },
    },
  };
}

function applySystemLayer1AdmissionFallback(input: MemoryUpsertInput): MemoryUpsertInput {
  return {
    ...input,
    tags: uniqueStrings([...(input.tags ?? []), "memory:direct-layer1", "memory:system"]),
    metadata: {
      ...(input.metadata ?? {}),
      memoryAdmission: {
        category: "system",
        retention: "user",
        confidence: 0.72,
        score: 0.72,
        reason: "direct-layer1:system",
        safety: {
          safe: true,
          findings: [],
        },
      },
    },
  };
}

function shouldApplyUserLayer1Admission(
  input: MemoryUpsertInput,
  decision: ReturnType<typeof classifyUserMemoryInput>,
): boolean {
  if (!decision.safety.safe) {
    return true;
  }

  if (isUserLayer1Input(input)) {
    return true;
  }

  if (decision.status === "store") {
    return true;
  }

  return decision.reason === "low-value-chatter" || decision.reason === "casual-self-report";
}

function applyLayer0AdmissionFallback(input: MemoryUpsertInput): MemoryUpsertInput {
  if (hasMemoryAdmission(input.metadata)) {
    return input;
  }

  const source = classifyLayer0Source(input);

  return {
    ...input,
    tags: uniqueStrings([...(input.tags ?? []), `memory:${source}`]),
    metadata: {
      ...(input.metadata ?? {}),
      memoryAdmission: {
        category: source,
        retention: "working",
        confidence: source === "casual" ? 0.9 : 0.7,
        score: source === "casual" ? 0.2 : 0.7,
        reason: `direct-layer0:${source}`,
      },
    },
  };
}

function hasMemoryAdmission(metadata: Record<string, unknown> | undefined): boolean {
  return readMemoryAdmission(metadata) !== undefined;
}

function readMemoryAdmission(
  metadata: Record<string, unknown> | undefined,
): { retention?: unknown } | undefined {
  const admission = metadata?.memoryAdmission;
  return typeof admission === "object" && admission !== null
    ? (admission as { retention?: unknown })
    : undefined;
}

function isUserLayer1Input(input: MemoryUpsertInput): boolean {
  const namespace = input.scope.namespace?.toLowerCase();
  if (
    namespace?.startsWith("user") ||
    namespace?.includes("user-memory") ||
    namespace?.includes("user-input") ||
    namespace?.startsWith("conversation")
  ) {
    return true;
  }

  const tags = input.tags ?? [];
  if (
    tags.some((tag) => {
      const normalized = tag.toLowerCase();
      return (
        normalized === "memory:user" ||
        normalized === "user-input" ||
        normalized.includes("user-memory") ||
        normalized.includes("conversation")
      );
    })
  ) {
    return true;
  }

  const role = input.metadata?.role;
  if (typeof role === "string" && role.toLowerCase() === "user") {
    return true;
  }

  const source = input.metadata?.source;
  return (
    typeof source === "string" &&
    ["user", "user-input", "conversation"].includes(source.toLowerCase())
  );
}

function classifyLayer0Source(input: MemoryUpsertInput): "working" | "system" | "casual" {
  if (isSystemLayer0Input(input)) {
    return "system";
  }

  const decision = classifyUserMemoryInput(input.content);
  if (decision.status === "drop" && shouldTreatLayer0DropAsCasual(input, decision)) {
    return "casual";
  }

  return "working";
}

function shouldTreatLayer0DropAsCasual(
  input: MemoryUpsertInput,
  decision: ReturnType<typeof classifyUserMemoryInput>,
): boolean {
  if (isUserLayer0Input(input)) {
    return true;
  }

  return decision.reason === "low-value-chatter" || decision.reason === "casual-self-report";
}

function isUserLayer0Input(input: MemoryUpsertInput): boolean {
  const namespace = input.scope.namespace?.toLowerCase();
  if (
    namespace?.startsWith("user") ||
    namespace?.includes("user-memory") ||
    namespace?.includes("user-input")
  ) {
    return true;
  }

  const tags = input.tags ?? [];
  if (
    tags.some((tag) => {
      const normalized = tag.toLowerCase();
      return (
        normalized === "memory:user" ||
        normalized === "user-input" ||
        normalized.includes("user-memory")
      );
    })
  ) {
    return true;
  }

  const role = input.metadata?.role;
  if (typeof role === "string" && role.toLowerCase() === "user") {
    return true;
  }

  const source = input.metadata?.source;
  return typeof source === "string" && ["user", "user-input"].includes(source.toLowerCase());
}

function isSystemLayer0Input(input: MemoryUpsertInput): boolean {
  const namespace = input.scope.namespace?.toLowerCase();
  if (namespace?.includes("system")) {
    return true;
  }

  const tags = input.tags ?? [];
  if (tags.some((tag) => tag.toLowerCase().includes("system"))) {
    return true;
  }

  const role = input.metadata?.role;
  return typeof role === "string" && role.toLowerCase() === "system";
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
