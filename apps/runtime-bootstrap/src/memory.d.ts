import type { MemoryCoreManager } from "@hotflow/memory-core";
import type {
  MempalaceCommandExecutor,
  MempalaceHealthProbeResult,
} from "@hotflow/mempalace-adapter";
export interface CreateRuntimeMemoryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: MempalaceCommandExecutor;
  readonly now?: () => number;
}
export interface CreateRuntimeDoctorMempalaceProbeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: MempalaceCommandExecutor;
}
export declare function createDefaultRuntimeMemory(
  options?: CreateRuntimeMemoryOptions,
): MemoryCoreManager;
export declare function createRuntimeDoctorMempalaceProbe(
  options?: CreateRuntimeDoctorMempalaceProbeOptions,
): () => MempalaceHealthProbeResult;
//# sourceMappingURL=memory.d.ts.map
