import type { InternalToolPlugin } from "@hotflow/plugin-runtime";
import { createFilesystemReadTextTool } from "@hotflow/tools";

export const filesystemReadToolPlugin: InternalToolPlugin = {
  manifest: {
    id: "tool.filesystem-read",
    kind: "tool",
    version: "0.1.0",
    displayName: "Filesystem Read Tool",
    description: "Registers the workspace-scoped filesystem.read_text tool.",
    capabilities: ["tool.register", "filesystem.read"],
  },
  register(context) {
    const tool = createFilesystemReadTextTool({
      allowedRoots: [context.config.workspaceRoot],
    });
    context.registry.register(tool);
    return [tool.name];
  },
};
