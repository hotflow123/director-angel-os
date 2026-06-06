import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import { type UserMemoryHygieneDecision, classifyUserMemoryInput } from "@hotflow/memory-core";

export type LongTermMemoryTarget = "auto" | "memory" | "user";

export interface LongTermMemoryAdmitInput {
  readonly text: string;
  readonly target?: LongTermMemoryTarget;
  readonly nowMs?: number;
}

export interface LongTermMemoryAdmitResult {
  readonly apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  readonly schemaId: "director.host.long-term-memory-admission.v1";
  readonly admitted: boolean;
  readonly quarantined: boolean;
  readonly targetFile?: "MEMORY.md" | "USER.md";
  readonly path?: string;
  readonly entry?: string;
  readonly redactedContent: string;
  readonly decision: UserMemoryHygieneDecision;
  readonly budget: {
    readonly maxChars?: number;
    readonly usedChars?: number;
  };
}

const MEMORY_BUDGET_CHARS = 2200;
const USER_BUDGET_CHARS = 1375;

export function admitLongTermMemory(
  workspaceRoot: string,
  input: LongTermMemoryAdmitInput,
): LongTermMemoryAdmitResult {
  const decision = classifyUserMemoryInput(input.text);
  if (decision.retention === "quarantine") {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.long-term-memory-admission.v1",
      admitted: false,
      quarantined: true,
      redactedContent: decision.redactedContent,
      decision,
      budget: {},
    };
  }

  const targetFile = resolveLongTermMemoryTarget(decision, input.target ?? "auto");
  if (targetFile === null) {
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      schemaId: "director.host.long-term-memory-admission.v1",
      admitted: false,
      quarantined: false,
      redactedContent: decision.redactedContent,
      decision,
      budget: {},
    };
  }

  const memoryDir = join(workspaceRoot, ".director-angel", "memory");
  const filePath = join(memoryDir, targetFile);
  const entry = formatLongTermMemoryEntry(decision, input.text, targetFile);
  const maxChars = targetFile === "USER.md" ? USER_BUDGET_CHARS : MEMORY_BUDGET_CHARS;
  const nextContent = appendLongTermMemoryEntry(filePath, targetFile, entry, maxChars);
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(filePath, nextContent, "utf8");

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    schemaId: "director.host.long-term-memory-admission.v1",
    admitted: true,
    quarantined: false,
    targetFile,
    path: filePath,
    entry,
    redactedContent: decision.redactedContent,
    decision,
    budget: {
      maxChars,
      usedChars: nextContent.length,
    },
  };
}

function resolveLongTermMemoryTarget(
  decision: UserMemoryHygieneDecision,
  requestedTarget: LongTermMemoryTarget,
): "MEMORY.md" | "USER.md" | null {
  if (decision.status !== "store" || decision.retention === "none") {
    return null;
  }
  if (requestedTarget === "user") {
    return decision.retention === "user" ? "USER.md" : null;
  }
  if (requestedTarget === "memory") {
    return decision.safety.safe ? "MEMORY.md" : null;
  }
  if (decision.category === "user-preference" || decision.category === "user-profile") {
    return "USER.md";
  }
  return null;
}

function formatLongTermMemoryEntry(
  decision: UserMemoryHygieneDecision,
  text: string,
  targetFile: "MEMORY.md" | "USER.md",
): string {
  const clean = stripMemoryDirective(decision.redactedContent || text);
  if (targetFile === "MEMORY.md") {
    return `项目记忆：${clean}`;
  }
  if (decision.category === "user-profile") {
    return `用户画像：${clean}`;
  }
  return `偏好：${clean}`;
}

function stripMemoryDirective(value: string): string {
  return value
    .trim()
    .replace(/^记住(?:一下)?[：:\s]*/u, "")
    .replace(/^请(?:你)?记住(?:一下)?[：:\s]*/u, "")
    .replace(/^以后(?:都)?[：:\s]*/u, "")
    .trim();
}

function appendLongTermMemoryEntry(
  filePath: string,
  targetFile: "MEMORY.md" | "USER.md",
  entry: string,
  maxChars: number,
): string {
  const existingEntries = existsSync(filePath)
    ? parseLongTermMemoryEntries(readFileSync(filePath, "utf8"))
    : [];
  const entries = uniqueNewestEntries([...existingEntries, entry]);
  return renderBudgetedLongTermMemory(targetFile, entries, maxChars);
}

function parseLongTermMemoryEntries(content: string): string[] {
  return content
    .split("§")
    .map((entry) =>
      entry
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .join(" "),
    )
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueNewestEntries(entries: readonly string[]): string[] {
  const newestFirst = [...entries].reverse();
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of newestFirst) {
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return unique.reverse();
}

function renderBudgetedLongTermMemory(
  targetFile: "MEMORY.md" | "USER.md",
  entries: readonly string[],
  maxChars: number,
): string {
  const header = targetFile === "USER.md" ? "# USER" : "# MEMORY";
  let kept = [...entries];
  let content = renderLongTermMemoryContent(header, kept);
  while (content.length > maxChars && kept.length > 1) {
    kept = kept.slice(1);
    content = renderLongTermMemoryContent(header, kept);
  }
  if (content.length <= maxChars) {
    return content;
  }
  const last = kept.at(-1) ?? "";
  return renderLongTermMemoryContent(header, [truncateEntry(last, maxChars - header.length - 4)]);
}

function renderLongTermMemoryContent(header: string, entries: readonly string[]): string {
  return `${header}\n\n${entries.map((entry) => `§ ${entry}`).join("\n")}\n`;
}

function truncateEntry(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
