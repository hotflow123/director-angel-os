export type UnknownRecord = Record<string, unknown>;

export const isString = (value: unknown): value is string => typeof value === "string";
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isObject = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isArrayOfStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

export const isArrayOf = <T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
): value is readonly T[] => Array.isArray(value) && value.every(guard);

export const isOptional = <T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
): value is T | undefined => value === undefined || guard(value);

export const isOneOf = <T extends string>(value: unknown, candidates: readonly T[]): value is T =>
  candidates.includes(value as T);

export const isStringRecord = (value: unknown): value is Record<string, string> =>
  isObject(value) && Object.values(value).every(isString);
