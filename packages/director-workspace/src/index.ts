import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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

export function resolveDirectorWorkspace(
  options: DirectorWorkspaceOptions = {},
): DirectorWorkspacePaths {
  const base = options.root ?? process.cwd();
  const directorRoot = resolve(base, ".director-angel");
  const knowledgeRoot = resolve(directorRoot, "knowledge");
  const adaptersRoot = resolve(directorRoot, "adapters");

  return {
    root: directorRoot,
    knowledge: knowledgeRoot,
    adapters: adaptersRoot,
    runtime: resolve(directorRoot, "runtime"),
    workspace: resolve(directorRoot, "workspace"),
    knowledgeCandidate: resolve(knowledgeRoot, "candidate"),
    knowledgeReview: resolve(knowledgeRoot, "review"),
    knowledgePublished: resolve(knowledgeRoot, "published"),
    knowledgeHistory: resolve(knowledgeRoot, "history"),
    knowledgeRollback: resolve(knowledgeRoot, "rollback"),
    adaptersRegistry: resolve(adaptersRoot, "registry"),
  };
}

export function ensureDirectorWorkspace(
  options: DirectorWorkspaceOptions = {},
): DirectorWorkspacePaths {
  const paths = resolveDirectorWorkspace(options);

  for (const dir of Object.values(paths)) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  return paths;
}
