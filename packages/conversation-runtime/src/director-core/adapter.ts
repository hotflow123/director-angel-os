import { buildDirectorControlResult, buildExecutionPlan } from "@hotflow/director-core";
import type { DirectorContext, DirectorControlResult, ExecutionPlan } from "@hotflow/director-core";

import {
  type DirectorCoreSidecarSnapshot,
  createDirectorContextFromSidecarSnapshot,
} from "./context.js";
import { type DirectorConsoleProjection, buildDirectorConsoleProjection } from "./plan.js";

export interface DirectorCoreSidecarResult {
  context: DirectorContext;
  control: DirectorControlResult;
  executionPlan: ExecutionPlan;
  console: DirectorConsoleProjection;
}

export function runDirectorCoreSidecar(
  snapshot: DirectorCoreSidecarSnapshot,
): DirectorCoreSidecarResult {
  const context = createDirectorContextFromSidecarSnapshot(snapshot);
  const control = buildDirectorControlResult(context);
  const executionPlan = buildExecutionPlan(context, control.plan);
  const console = buildDirectorConsoleProjection({ context, control, executionPlan });

  return {
    context,
    control,
    executionPlan,
    console,
  };
}

export { buildDirectorConsoleProjection, createDirectorContextFromSidecarSnapshot };
export type { DirectorCoreSidecarSnapshot } from "./context.js";
export type {
  DirectorConsoleDecisionAction,
  DirectorConsoleDecisionActionId,
  DirectorConsoleProjection,
  DirectorConsoleRecommendation,
  DirectorConsoleReviewGate,
  DirectorConsoleRiskLevel,
} from "./plan.js";
