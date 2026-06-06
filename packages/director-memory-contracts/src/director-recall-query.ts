import { isArrayOfStrings, isObject, isOptional, isString } from "./guards.js";

export interface DirectorRecallQuery {
  readonly projectId: string;
  readonly groupId?: string;
  readonly anchorIds?: readonly string[];
  readonly selectedAdapters?: readonly string[];
  readonly generationType?: string;
  readonly generationStyle?: string;
  readonly knowledgeSignalTags?: readonly string[];
  readonly maxHits: number;
}

export function isDirectorRecallQuery(value: unknown): value is DirectorRecallQuery {
  return (
    isObject(value) &&
    isString(value.projectId) &&
    isOptional(value.groupId, isString) &&
    isOptional(value.anchorIds, isArrayOfStrings) &&
    isOptional(value.selectedAdapters, isArrayOfStrings) &&
    isOptional(value.generationType, isString) &&
    isOptional(value.generationStyle, isString) &&
    isOptional(value.knowledgeSignalTags, isArrayOfStrings) &&
    typeof value.maxHits === "number" &&
    Number.isInteger(value.maxHits) &&
    value.maxHits > 0
  );
}
