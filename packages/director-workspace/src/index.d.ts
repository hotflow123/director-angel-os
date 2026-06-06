export interface DirectorWorkspacePaths {
  root: string;
  knowledge: string;
  adapters: string;
  runtime: string;
  workspace: string;
  knowledgeCandidate: string;
  knowledgeReview: string;
  knowledgePublished: string;
  knowledgeHistory: string;
  knowledgeRollback: string;
  adaptersRegistry: string;
}
export interface DirectorWorkspaceOptions {
  root?: string;
}
export declare function resolveDirectorWorkspace(
  options?: DirectorWorkspaceOptions,
): DirectorWorkspacePaths;
export declare function ensureDirectorWorkspace(
  options?: DirectorWorkspaceOptions,
): DirectorWorkspacePaths;
//# sourceMappingURL=index.d.ts.map
