import type { ToolRegistry } from "@hotflow/tools";

import type {
  InternalPluginManifest,
  InternalToolPluginRegistration,
} from "../../plugin-manifest.js";
import type { CreateFilesystemReadTextInternalToolOptions } from "./tool.js";
import { createFilesystemReadTextInternalTool } from "./tool.js";

const manifest: InternalPluginManifest = {
  id: "internal.tool.filesystem-read",
  kind: "tool",
  version: "0.1.0",
  entrypoint: "./index.ts",
  displayName: "Filesystem Read Text Tool",
  description: "Reads UTF-8 text files from approved workspace roots.",
  tags: ["internal", "tool", "filesystem", "read-only"],
  capabilities: ["filesystem.read"],
};

export interface RegisterFilesystemReadToolPluginInput
  extends CreateFilesystemReadTextInternalToolOptions {
  readonly toolRegistry: ToolRegistry;
}

export function registerFilesystemReadToolPlugin(
  input: RegisterFilesystemReadToolPluginInput,
): InternalToolPluginRegistration {
  const tool = createFilesystemReadTextInternalTool({
    allowedRoots: input.allowedRoots,
  });
  input.toolRegistry.register(tool);
  return {
    manifest,
    toolName: tool.name,
  };
}

export { createFilesystemReadTextInternalTool, manifest };
