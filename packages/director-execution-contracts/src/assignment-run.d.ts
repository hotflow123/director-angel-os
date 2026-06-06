import type {
  DirectorActionClass,
  DirectorApprovalMode,
  DirectorCrewRole,
} from "@hotflow/director-host-contracts";
import type { AssignmentResult } from "./assignment-result.js";
import type { AssignmentRunStatus } from "./assignment-run-status.js";
export interface AssignmentRun {
  readonly runId: string;
  readonly assignmentId: string;
  readonly role: DirectorCrewRole;
  readonly objective: string;
  readonly deliverable: string;
  readonly actionClass: DirectorActionClass;
  readonly approvalMode: DirectorApprovalMode;
  readonly dependsOn: readonly string[];
  readonly status: AssignmentRunStatus;
  readonly selectedAdapter?: string | null;
  readonly allowedAdapters?: readonly string[];
  readonly blockingReason?: string;
  readonly timeoutMs?: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly result?: AssignmentResult;
  readonly notes?: readonly string[];
}
export declare function isAssignmentRun(value: unknown): value is AssignmentRun;
//# sourceMappingURL=assignment-run.d.ts.map
