import { AsyncLocalStorage } from "node:async_hooks";

import type { RunContext, RunContextValues } from "./contracts.js";

const RUN_CONTEXT_STORAGE = new AsyncLocalStorage<RunContext>();

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function mergeValues(current: RunContextValues, incoming: RunContextValues): RunContextValues {
  return { ...current, ...incoming };
}

export interface RunContextSeed {
  readonly runId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly values?: RunContextValues;
}

export function createRunContext(seed: RunContextSeed = {}): RunContext {
  return {
    runId: seed.runId ?? nextId("run"),
    ...(seed.traceId ? { traceId: seed.traceId } : {}),
    ...(seed.spanId ? { spanId: seed.spanId } : {}),
    values: seed.values ?? {},
  };
}

export function getRunContext(): RunContext | undefined {
  return RUN_CONTEXT_STORAGE.getStore();
}

export function requireRunContext(): RunContext {
  const context = getRunContext();
  if (!context) {
    throw new Error("No run context is active");
  }
  return context;
}

export function withRunContextValue<T>(
  key: string,
  value: unknown,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return runWithContext({ values: { [key]: value } }, fn);
}

export function setRunContextValue(key: string, value: unknown): void {
  const current = requireRunContext();
  const updated: RunContext = {
    ...current,
    values: mergeValues(current.values, { [key]: value }),
  };
  RUN_CONTEXT_STORAGE.enterWith(updated);
}

export function runWithContext<T>(seed: RunContextSeed, fn: () => T | Promise<T>): T | Promise<T> {
  const parent = getRunContext();
  const runId = seed.runId ?? parent?.runId;
  const traceId = seed.traceId ?? parent?.traceId;
  const spanId = seed.spanId ?? parent?.spanId;

  const mergedSeed: RunContextSeed = {
    ...(runId ? { runId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(spanId ? { spanId } : {}),
    values: mergeValues(parent?.values ?? {}, seed.values ?? {}),
  };

  const merged = createRunContext(mergedSeed);
  return RUN_CONTEXT_STORAGE.run(merged, fn);
}
