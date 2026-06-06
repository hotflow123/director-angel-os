import { ensureDirectorWorkspace } from "@hotflow/director-workspace";

export interface DirectorBootstrapSummary {
  readonly knowledgePath: string;
  readonly adaptersPath: string;
  readonly runtimePath: string;
  readonly workspacePath: string;
}

export function bootstrapDirectorWorkspace(workspaceRoot: string): string {
  const paths = ensureDirectorWorkspace({ root: workspaceRoot });
  const summaryLines: string[] = [
    "Director workspace bootstrap complete.",
    `  knowledge: ${paths.knowledge}`,
    `  adapters: ${paths.adapters}`,
    `  runtime: ${paths.runtime}`,
    `  workspace: ${paths.workspace}`,
  ];
  return summaryLines.join("\n");
}
