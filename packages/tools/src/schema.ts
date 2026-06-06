import type { ToolInputSchema } from "./contracts.js";

export type UnknownRecord = Record<string, unknown>;

export class ToolInputValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ToolInputValidationError";
  }
}

export function defineToolInputSchema<TArgs>(
  parse: (input: unknown) => TArgs,
): ToolInputSchema<TArgs> {
  return {
    parse,
  };
}

export function expectObject(input: unknown, label = "args"): UnknownRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputValidationError(`Expected ${label} to be an object.`);
  }

  return input as UnknownRecord;
}

export function expectString(record: UnknownRecord, key: string, label = `args.${key}`): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ToolInputValidationError(`Expected ${label} to be a string.`);
  }

  return value;
}

export function expectArray(record: UnknownRecord, key: string, label = `args.${key}`): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ToolInputValidationError(`Expected ${label} to be an array.`);
  }

  return value;
}

export function expectOptionalStringEnum<TValue extends string>(
  record: UnknownRecord,
  key: string,
  candidates: readonly TValue[],
  label = `args.${key}`,
): TValue | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  return expectStringEnumValue(value, candidates, label);
}

export function expectStringEnumValue<TValue extends string>(
  value: unknown,
  candidates: readonly TValue[],
  label: string,
): TValue {
  if (typeof value !== "string" || !candidates.includes(value as TValue)) {
    throw new ToolInputValidationError(`Expected ${label} to be one of: ${candidates.join(", ")}.`);
  }

  return value as TValue;
}
