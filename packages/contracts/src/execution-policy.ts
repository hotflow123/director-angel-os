export type PolicyVerdict = "allow" | "deny" | "ask" | "degrade";

export type ToolRiskLevel =
  | "read-only"
  | "local-side-effect"
  | "shell"
  | "network"
  | "browser"
  | "remote";

export interface ToolCapabilityDescriptor {
  readonly capabilityId: string;
  readonly riskLevel: ToolRiskLevel;
  readonly readOnly: boolean;
  readonly hasExternalSideEffect: boolean;
  readonly requiresApproval?: boolean;
  readonly retryable?: boolean;
  readonly failoverAllowed?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExecutionEligibility {
  readonly canRetry: boolean;
  readonly canFailover: boolean;
  readonly canDegrade: boolean;
}

export interface ExecutionPolicy {
  readonly verdict: PolicyVerdict;
  readonly reason: string;
  readonly riskLevel?: ToolRiskLevel;
  readonly requiresApproval?: boolean;
  readonly degradedCapabilities?: readonly string[];
  readonly redactions?: readonly string[];
  readonly eligibility: ExecutionEligibility;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createExecutionPolicy(
  input: Omit<ExecutionPolicy, "eligibility"> & {
    readonly eligibility?: Partial<ExecutionEligibility>;
  },
): ExecutionPolicy {
  const { eligibility, ...rest } = input;

  return {
    ...rest,
    eligibility: {
      canRetry: eligibility?.canRetry ?? false,
      canFailover: eligibility?.canFailover ?? false,
      canDegrade: eligibility?.canDegrade ?? input.verdict === "degrade",
    },
  };
}
