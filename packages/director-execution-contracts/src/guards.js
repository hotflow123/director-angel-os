export const isString = (value) => typeof value === "string";
export const isBoolean = (value) => typeof value === "boolean";
export const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isArrayOfStrings = (value) => Array.isArray(value) && value.every(isString);
export const isArrayOf = (value, guard) => Array.isArray(value) && value.every(guard);
export const isOptional = (value, guard) => value === undefined || guard(value);
export const isOneOf = (value, candidates) => candidates.includes(value);
export const isStringRecord = (value) => isObject(value) && Object.values(value).every(isString);
//# sourceMappingURL=guards.js.map
