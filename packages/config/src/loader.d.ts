import type { HotflowConfig } from "./schema.js";
export interface LoadConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}
export declare function loadConfig(options?: LoadConfigOptions): HotflowConfig;
export declare function derivePaths(config: HotflowConfig): {
  workspaceRoot: string;
  dataDir: string;
  sessionDbPath: string;
  sessionDir: string;
  benchmarkDir: string;
  docsDir: string;
};
//# sourceMappingURL=loader.d.ts.map
