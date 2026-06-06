export type UnknownRecord = Record<string, unknown>;
export declare const isString: (value: unknown) => value is string;
export declare const isBoolean: (value: unknown) => value is boolean;
export declare const isObject: (value: unknown) => value is UnknownRecord;
export declare const isArrayOfStrings: (value: unknown) => value is string[];
export declare const isArrayOf: <T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
) => value is readonly T[];
export declare const isOptional: <T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
) => value is T | undefined;
export declare const isOneOf: <T extends string>(
  value: unknown,
  candidates: readonly T[],
) => value is T;
export declare const isStringRecord: (value: unknown) => value is Record<string, string>;
//# sourceMappingURL=guards.d.ts.map
