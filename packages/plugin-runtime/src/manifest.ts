export type InternalPluginKind = "provider" | "tool";

export interface InternalPluginManifestBase {
  readonly id: string;
  readonly kind: InternalPluginKind;
  readonly version: string;
  readonly description?: string;
  readonly capabilities?: readonly string[];
}

export interface InternalProviderPluginManifest extends InternalPluginManifestBase {
  readonly kind: "provider";
  readonly providerId: string;
}

export interface InternalToolPluginManifest extends InternalPluginManifestBase {
  readonly kind: "tool";
  readonly toolName: string;
}

export type InternalPluginManifest = InternalProviderPluginManifest | InternalToolPluginManifest;

export function isInternalPluginManifest(value: unknown): value is InternalPluginManifest {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.version) ||
    !isNonEmptyString(value.kind)
  ) {
    return false;
  }

  if (value.capabilities !== undefined && !isStringArray(value.capabilities)) {
    return false;
  }

  if (value.description !== undefined && typeof value.description !== "string") {
    return false;
  }

  if (value.kind === "provider") {
    return isNonEmptyString(value.providerId);
  }

  if (value.kind === "tool") {
    return isNonEmptyString(value.toolName);
  }

  return false;
}

export function assertInternalPluginManifest(value: unknown): InternalPluginManifest {
  if (!isInternalPluginManifest(value)) {
    throw new TypeError("Invalid internal plugin manifest.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
