import { createConversationRuntimeToolFileSafetyHook } from "./tool-file-safety.js";
import type { ConversationRuntimeToolHook } from "./tool-hooks.js";
import { createConversationRuntimeToolLoopDetector } from "./tool-hooks.js";
import { createConversationRuntimeToolRedactionHook } from "./tool-redaction.js";

export interface DefaultConversationRuntimeToolHooksOptions {
  readonly maxLoopRepeats?: number;
}

export function createDefaultConversationRuntimeToolHooks(
  options: DefaultConversationRuntimeToolHooksOptions = {},
): readonly ConversationRuntimeToolHook[] {
  return [
    createConversationRuntimeToolFileSafetyHook(),
    createConversationRuntimeToolRedactionHook(),
    createConversationRuntimeToolLoopDetector({
      scope: "turn",
      maxRepeats: options.maxLoopRepeats ?? 8,
    }),
  ];
}
