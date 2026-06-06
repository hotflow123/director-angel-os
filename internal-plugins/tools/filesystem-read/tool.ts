import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ToolContext, ToolDefinition } from "@hotflow/tools";

export interface FilesystemReadTextArgs {
  path: string;
}

export interface CreateFilesystemReadTextInternalToolOptions {
  allowedRoots: readonly string[];
}

function normalizeRoots(roots: readonly string[]): string[] {
  return roots.map((root) => resolve(root));
}

function isWithinAllowedRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

export function createFilesystemReadTextInternalTool(
  options: CreateFilesystemReadTextInternalToolOptions,
): ToolDefinition<FilesystemReadTextArgs, string> {
  const allowedRoots = normalizeRoots(options.allowedRoots);

  return {
    name: "filesystem.read_text",
    description: "Read a UTF-8 text file from the workspace.",
    timeoutMs: 5_000,
    readOnly: true,
    capabilities: ["filesystem.read"],
    riskLevel: "low",
    async execute(args: FilesystemReadTextArgs, context: ToolContext) {
      const resolvedPath = resolve(args.path);
      if (!isWithinAllowedRoots(resolvedPath, allowedRoots)) {
        return {
          toolCallId: "filesystem.read_text",
          toolName: "filesystem.read_text",
          ok: false,
          error: `Path is outside allowed roots: ${resolvedPath}`,
        };
      }

      const output = await readFile(resolvedPath, "utf8");
      return {
        toolCallId: context.turnId ?? "filesystem.read_text",
        toolName: "filesystem.read_text",
        ok: true,
        output,
      };
    },
  };
}
