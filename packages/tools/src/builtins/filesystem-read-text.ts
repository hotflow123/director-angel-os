import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { ToolContext, ToolDefinition } from "../contracts.js";
import { defineToolInputSchema, expectObject, expectString } from "../schema.js";

export interface ReadTextArgs {
  path: string;
}

export interface FilesystemReadTextOptions {
  allowedRoots: readonly string[];
}

function normalizeRoots(roots: readonly string[]): string[] {
  return roots.map((root) => resolve(root));
}

function isWithinAllowedRoots(targetPath: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const relativePath = relative(root, targetPath);
    return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  });
}

function resolveRequestedPath(path: string, workspaceRoot?: string): string {
  if (isAbsolute(path)) {
    return resolve(path);
  }

  if (workspaceRoot) {
    return resolve(workspaceRoot, path);
  }

  return resolve(path);
}

async function normalizeRealRoots(roots: readonly string[]): Promise<string[]> {
  return Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(root);
      } catch {
        return root;
      }
    }),
  );
}

export function createFilesystemReadTextTool(
  options: FilesystemReadTextOptions,
): ToolDefinition<ReadTextArgs, string> {
  const allowedRoots = normalizeRoots(options.allowedRoots);
  const realAllowedRootsPromise = normalizeRealRoots(allowedRoots);

  return {
    name: "filesystem.read_text",
    description: "Read a UTF-8 text file from the workspace.",
    timeoutMs: 5_000,
    readOnly: true,
    schema: {
      type: "object",
      description: "Arguments for reading a UTF-8 text file from the workspace.",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Absolute path or path relative to the active workspace root.",
        },
      },
      required: ["path"],
    },
    toolset: "filesystem",
    toolsetDescription: "Workspace-scoped file reading tools.",
    toolsetEnabledByDefault: true,
    inputSchema: defineToolInputSchema<ReadTextArgs>((input) => {
      const record = expectObject(input);
      return {
        path: expectString(record, "path"),
      };
    }),
    capabilities: ["filesystem.read"],
    riskLevel: "low",
    async execute(args: ReadTextArgs, context: ToolContext) {
      const resolvedPath = resolveRequestedPath(args.path, context.workspaceRoot);
      if (!isWithinAllowedRoots(resolvedPath, allowedRoots)) {
        return {
          toolCallId: "filesystem.read_text",
          toolName: "filesystem.read_text",
          ok: false,
          error: `Path is outside allowed roots: ${resolvedPath}`,
        };
      }

      // Check the canonical target as well so workspace symlinks cannot escape
      // the configured allowlist.
      const resolvedRealPath = await realpath(resolvedPath);
      const realAllowedRoots = await realAllowedRootsPromise;
      if (!isWithinAllowedRoots(resolvedRealPath, realAllowedRoots)) {
        return {
          toolCallId: "filesystem.read_text",
          toolName: "filesystem.read_text",
          ok: false,
          error: `Path is outside allowed roots: ${resolvedRealPath}`,
        };
      }

      const output = await readFile(resolvedRealPath, "utf8");
      return {
        toolCallId: context.turnId ?? "filesystem.read_text",
        toolName: "filesystem.read_text",
        ok: true,
        output,
      };
    },
  };
}
