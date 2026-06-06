import type { ConversationRuntimeToolHook } from "./tool-hooks.js";

export interface ConversationRuntimeToolFileSafetyHookOptions {
  readonly name?: string;
  readonly extraRules?: readonly ConversationRuntimeToolFileSafetyRule[];
}

export interface ConversationRuntimeToolFileSafetyRule {
  readonly ruleId: string;
  readonly match: (path: string) => boolean;
}

interface StringArgCandidate {
  readonly argPath: string;
  readonly value: string;
}

const DEFAULT_FILE_SAFETY_RULES: readonly ConversationRuntimeToolFileSafetyRule[] = [
  {
    ruleId: "env-file",
    match: (path) => /(?:^|\/)\.env(?:$|[./_-])/u.test(path),
  },
  {
    ruleId: "ssh-private-key",
    match: (path) => /(?:^|\/)\.ssh\/(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:$|[.\s])/u.test(path),
  },
  {
    ruleId: "aws-credentials",
    match: (path) => /(?:^|\/)\.aws\/credentials(?:$|[.\s])/u.test(path),
  },
  {
    ruleId: "credential-file",
    match: (path) =>
      /(?:^|\/)(?:credentials?|secrets?|private[_-]?key)(?:\.(?:json|ya?ml|toml|ini|txt|pem))?$/u.test(
        path,
      ),
  },
  {
    ruleId: "shell-credential-file",
    match: (path) => /(?:^|\/)(?:\.npmrc|\.pypirc|\.netrc)$/u.test(path),
  },
  {
    ruleId: "gcloud-application-default-credentials",
    match: (path) => /(?:^|\/)application_default_credentials\.json$/u.test(path),
  },
];

export function createConversationRuntimeToolFileSafetyHook(
  options: ConversationRuntimeToolFileSafetyHookOptions = {},
): ConversationRuntimeToolHook {
  const rules = [...DEFAULT_FILE_SAFETY_RULES, ...(options.extraRules ?? [])];
  return {
    name: options.name ?? "tool-file-safety",
    beforeCall: ({ call }) => {
      const candidates = collectStringArgCandidates(call.args);
      for (const candidate of candidates) {
        if (!looksLikeLocalPath(candidate.value)) {
          continue;
        }
        const normalized = normalizePathForSafety(candidate.value);
        const rule = rules.find((item) => item.match(normalized));
        if (rule !== undefined) {
          return {
            status: "deny",
            reason: "tool-file-safety-denylist",
            metadata: {
              ruleId: rule.ruleId,
              argPath: candidate.argPath,
              matchedPath: candidate.value,
            },
          };
        }
      }
      return { status: "allow", reason: "tool-file-safety-clear" };
    },
  };
}

function collectStringArgCandidates(value: unknown, argPath = "$"): readonly StringArgCandidate[] {
  if (typeof value === "string") {
    return [{ argPath, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStringArgCandidates(item, `${argPath}[${index}]`));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      collectStringArgCandidates(item, `${argPath}.${key}`),
    );
  }
  return [];
}

function looksLikeLocalPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || isPublicWebUrl(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("./") ||
    trimmed.includes("\\") ||
    /(?:^|\/)\.(?:env|ssh)\b/u.test(trimmed) ||
    /(?:^|\/)(?:credentials?|secrets?|private[_-]?key)(?:\.|$)/iu.test(trimmed)
  );
}

function normalizePathForSafety(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/\/+/gu, "/").toLocaleLowerCase();
}

function isPublicWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
