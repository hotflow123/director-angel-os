import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { listDelegationMailboxJob } from "./list-mailbox.js";
import { listVerifierMailboxJob } from "./list-verifier-mailbox.js";
import { runSkillProposalReconcileJob } from "./reconcile-skill-proposal.js";
import { runSkillProposalReviewJob } from "./review-skill-proposal.js";
import { runDelegationJob } from "./run-delegation.js";
import { runWorkerJobOnce } from "./run-once.js";
import { runVerificationJob } from "./run-verification.js";
import { runSchedulerExecutorJob } from "./scheduler-executor.js";
import { runSchedulerRecoveryJob } from "./scheduler-recovery.js";
import { runSchedulerTickJob } from "./scheduler-tick.js";

export { runSchedulerExecutorJob } from "./scheduler-executor.js";
export { runSchedulerRecoveryJob } from "./scheduler-recovery.js";

export interface WorkerJobsCliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface WorkerJobsCliOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly io?: WorkerJobsCliIo;
}

interface ParsedRunOnceCommand {
  readonly type: "run-once";
  readonly sessionId: string;
  readonly turnId: string;
  readonly proposalId?: string;
  readonly proposalKind?: string;
  readonly provenance?: string;
}

interface ParsedMailboxListCommand {
  readonly type: "mailbox-list";
  readonly sessionId: string;
  readonly workerId?: string;
}

interface ParsedVerifierMailboxListCommand {
  readonly type: "verifier-mailbox-list";
  readonly sessionId: string;
  readonly verifierId?: string;
}

interface ParsedRunDelegationCommand {
  readonly type: "run-delegation";
  readonly sessionId: string;
  readonly workerId: string;
  readonly verifierId?: string;
  readonly delegationId?: string;
  readonly verificationId?: string;
  readonly requirement?: string;
  readonly failureReason?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: "patch" | "diff" | "artifact";
  readonly observedWriteSetArtifact?: string;
  readonly observedWriteSetFromGitDiff?: boolean;
  readonly maxClaims?: number;
}

interface ParsedSchedulerTickCommand {
  readonly type: "scheduler-tick";
  readonly sessionId: string;
}

interface ParsedSchedulerExecutorCommand {
  readonly type: "scheduler-executor";
  readonly sessionId: string;
  readonly maxDispatches?: number;
}

interface ParsedSchedulerRecoveryCommand {
  readonly type: "scheduler-recovery";
  readonly sessionId: string;
  readonly actionId?: string;
  readonly confirmCancelObservedDrift?: boolean;
}

interface ParsedRunVerificationCommand {
  readonly type: "run-verification";
  readonly sessionId: string;
  readonly verifierId: string;
  readonly verificationId?: string;
  readonly verificationStatus?: "passed" | "failed" | "partial";
  readonly verdictSummary?: string;
}

interface ParsedReconcileSkillProposalCommand {
  readonly type: "reconcile-skill-proposal";
  readonly sessionId: string;
  readonly proposalId: string;
}

interface ParsedReviewSkillProposalCommand {
  readonly type: "review-skill-proposal";
  readonly sessionId: string;
  readonly proposalId: string;
  readonly reviewerId?: string;
}

type ParsedCommand =
  | ParsedRunOnceCommand
  | ParsedMailboxListCommand
  | ParsedVerifierMailboxListCommand
  | ParsedRunDelegationCommand
  | ParsedSchedulerTickCommand
  | ParsedSchedulerExecutorCommand
  | ParsedSchedulerRecoveryCommand
  | ParsedRunVerificationCommand
  | ParsedReconcileSkillProposalCommand
  | ParsedReviewSkillProposalCommand
  | { readonly type: "help" };

const HELP_TEXT = [
  "Usage:",
  "  worker-jobs run-once --session-id <id> --turn-id <id> [--proposal-id <id>] [--kind <kind>] [--provenance <value>]",
  "  worker-jobs mailbox-list --session-id <id> [--worker-id <id>]",
  "  worker-jobs verifier-mailbox-list --session-id <id> [--verifier-id <id>]",
  "  worker-jobs scheduler-tick --session-id <id>",
  "  worker-jobs scheduler-executor --session-id <id> [--max-dispatches <n>]",
  "  worker-jobs scheduler-recovery --session-id <id> [--action-id <id>] [--confirm-cancel-observed-drift]",
  "  worker-jobs run-delegation --session-id <id> --worker-id <id> [--delegation-id <id>] [--verifier-id <id>] [--verification-id <id>] [--requirement <text>] [--fail <reason>] [--observed-write-set <path[,path]>] [--observed-write-set-artifact <patch-or-diff-file>] [--observed-write-set-from-git-diff] [--observed-write-set-source <patch|diff|artifact>] [--max-claims <n>]",
  "  worker-jobs run-verification --session-id <id> --verifier-id <id> [--verification-id <id>] [--status <passed|failed|partial>] [--verdict <text>]",
  "  worker-jobs review-skill-proposal --session-id <id> --proposal-id <id> [--reviewer-id <id>]",
  "  worker-jobs reconcile-skill-proposal --session-id <id> --proposal-id <id>",
].join("\n");

export async function runWorkerJobsCli(
  argv: readonly string[],
  options: WorkerJobsCliOptions = {},
): Promise<number> {
  const io = options.io ?? {
    stdout(message: string) {
      process.stdout.write(message);
    },
    stderr(message: string) {
      process.stderr.write(message);
    },
  };

  const parsed = parseCommand(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n`);
    io.stderr(`${HELP_TEXT}\n`);
    return 1;
  }

  if (parsed.value.type === "help") {
    io.stdout(`${HELP_TEXT}\n`);
    return 0;
  }

  try {
    let report: unknown;
    if (parsed.value.type === "run-once") {
      report = await runWorkerJobOnce({
        sessionId: parsed.value.sessionId,
        turnId: parsed.value.turnId,
        ...(parsed.value.proposalId === undefined ? {} : { proposalId: parsed.value.proposalId }),
        ...(parsed.value.proposalKind === undefined
          ? {}
          : { proposalKind: parsed.value.proposalKind }),
        ...(parsed.value.provenance === undefined ? {} : { provenance: parsed.value.provenance }),
        ...(options.env ? { env: options.env } : {}),
      });
    } else if (parsed.value.type === "mailbox-list") {
      report = await listDelegationMailboxJob({
        sessionId: parsed.value.sessionId,
        ...(parsed.value.workerId === undefined ? {} : { workerId: parsed.value.workerId }),
        ...(options.env ? { env: options.env } : {}),
      });
    } else if (parsed.value.type === "verifier-mailbox-list") {
      report = await listVerifierMailboxJob({
        sessionId: parsed.value.sessionId,
        ...(parsed.value.verifierId === undefined ? {} : { verifierId: parsed.value.verifierId }),
        ...(options.env ? { env: options.env } : {}),
      });
    } else if (parsed.value.type === "scheduler-tick") {
      report = await runSchedulerTickJob({
        sessionId: parsed.value.sessionId,
        ...(options.env ? { env: options.env } : {}),
      });
    } else if (parsed.value.type === "scheduler-executor") {
      report = await runSchedulerExecutorJob({
        sessionId: parsed.value.sessionId,
        ...(parsed.value.maxDispatches === undefined
          ? {}
          : { maxDispatches: parsed.value.maxDispatches }),
        ...(options.env ? { env: options.env } : {}),
      });
    } else if (parsed.value.type === "scheduler-recovery") {
      report = await runSchedulerRecoveryJob({
        sessionId: parsed.value.sessionId,
        ...(parsed.value.actionId === undefined ? {} : { actionId: parsed.value.actionId }),
        ...(parsed.value.confirmCancelObservedDrift === undefined
          ? {}
          : { confirmCancelObservedDrift: parsed.value.confirmCancelObservedDrift }),
        ...(options.env ? { env: options.env } : {}),
      });
    } else if (parsed.value.type === "run-delegation") {
      report = await runDelegationJob({
        sessionId: parsed.value.sessionId,
        workerId: parsed.value.workerId,
        ...(parsed.value.verifierId === undefined ? {} : { verifierId: parsed.value.verifierId }),
        ...(parsed.value.delegationId === undefined
          ? {}
          : { delegationId: parsed.value.delegationId }),
        ...(parsed.value.verificationId === undefined
          ? {}
          : { verificationId: parsed.value.verificationId }),
        ...(parsed.value.requirement === undefined
          ? {}
          : { requirement: parsed.value.requirement }),
        ...(parsed.value.failureReason === undefined
          ? {}
          : { failureReason: parsed.value.failureReason }),
        ...(parsed.value.observedWriteSet === undefined
          ? {}
          : { observedWriteSet: parsed.value.observedWriteSet }),
        ...(parsed.value.observedWriteSetSource === undefined
          ? {}
          : { observedWriteSetSource: parsed.value.observedWriteSetSource }),
        ...(parsed.value.observedWriteSetArtifact === undefined
          ? {}
          : { observedWriteSetArtifact: parsed.value.observedWriteSetArtifact }),
        ...(parsed.value.observedWriteSetFromGitDiff === undefined
          ? {}
          : { observedWriteSetFromGitDiff: parsed.value.observedWriteSetFromGitDiff }),
        ...(parsed.value.maxClaims === undefined ? {} : { maxClaims: parsed.value.maxClaims }),
        ...(options.env ? { env: options.env } : {}),
      });
    } else {
      if (parsed.value.type === "run-verification") {
        report = await runVerificationJob({
          sessionId: parsed.value.sessionId,
          verifierId: parsed.value.verifierId,
          ...(parsed.value.verificationId === undefined
            ? {}
            : { verificationId: parsed.value.verificationId }),
          ...(parsed.value.verificationStatus === undefined
            ? {}
            : { status: parsed.value.verificationStatus }),
          ...(parsed.value.verdictSummary === undefined
            ? {}
            : { verdictSummary: parsed.value.verdictSummary }),
          ...(options.env ? { env: options.env } : {}),
        });
      } else if (parsed.value.type === "reconcile-skill-proposal") {
        report = await runSkillProposalReconcileJob({
          sessionId: parsed.value.sessionId,
          proposalId: parsed.value.proposalId,
          ...(options.env ? { env: options.env } : {}),
        });
      } else {
        report = await runSkillProposalReviewJob({
          sessionId: parsed.value.sessionId,
          proposalId: parsed.value.proposalId,
          ...(parsed.value.reviewerId === undefined ? {} : { reviewerId: parsed.value.reviewerId }),
          ...(options.env ? { env: options.env } : {}),
        });
      }
    }
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    io.stderr(`${normalizeError(error)}\n`);
    return 1;
  }
}

if (isExecutedAsScript()) {
  void runWorkerJobsCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

function parseCommand(argv: readonly string[]): ParseResult<ParsedCommand> {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = normalizedArgv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { ok: true, value: { type: "help" } };
  }

  if (command === "mailbox-list") {
    return parseMailboxListCommand(rest);
  }
  if (command === "verifier-mailbox-list") {
    return parseVerifierMailboxListCommand(rest);
  }
  if (command === "scheduler-tick") {
    return parseSchedulerTickCommand(rest);
  }
  if (command === "scheduler-executor") {
    return parseSchedulerExecutorCommand(rest);
  }
  if (command === "scheduler-recovery") {
    return parseSchedulerRecoveryCommand(rest);
  }
  if (command === "run-delegation") {
    return parseRunDelegationCommand(rest);
  }
  if (command === "run-verification") {
    return parseRunVerificationCommand(rest);
  }
  if (command === "reconcile-skill-proposal") {
    return parseReconcileSkillProposalCommand(rest);
  }
  if (command === "review-skill-proposal") {
    return parseReviewSkillProposalCommand(rest);
  }
  if (command !== "run-once") {
    return { ok: false, error: `Unknown worker-jobs command: ${command}` };
  }

  return parseRunOnceCommand(rest);
}

function parseMailboxListCommand(rest: readonly string[]): ParseResult<ParsedMailboxListCommand> {
  let sessionId: string | undefined;
  let workerId: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--worker-id" || token === "--worker") {
      if (!value) {
        return { ok: false, error: "Missing value for --worker-id." };
      }
      workerId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown mailbox-list option: ${token}` };
  }

  if (!sessionId) {
    return { ok: false, error: "mailbox-list requires --session-id." };
  }

  return {
    ok: true,
    value: {
      type: "mailbox-list",
      sessionId,
      ...(workerId === undefined ? {} : { workerId }),
    },
  };
}

function parseVerifierMailboxListCommand(
  rest: readonly string[],
): ParseResult<ParsedVerifierMailboxListCommand> {
  let sessionId: string | undefined;
  let verifierId: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--verifier-id" || token === "--verifier") {
      if (!value) {
        return { ok: false, error: "Missing value for --verifier-id." };
      }
      verifierId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown verifier-mailbox-list option: ${token}` };
  }

  if (!sessionId) {
    return { ok: false, error: "verifier-mailbox-list requires --session-id." };
  }

  return {
    ok: true,
    value: {
      type: "verifier-mailbox-list",
      sessionId,
      ...(verifierId === undefined ? {} : { verifierId }),
    },
  };
}

function parseSchedulerTickCommand(
  rest: readonly string[],
): ParseResult<ParsedSchedulerTickCommand> {
  let sessionId: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown scheduler-tick option: ${token}` };
  }

  if (!sessionId) {
    return { ok: false, error: "scheduler-tick requires --session-id." };
  }

  return {
    ok: true,
    value: {
      type: "scheduler-tick",
      sessionId,
    },
  };
}

function parseSchedulerExecutorCommand(
  rest: readonly string[],
): ParseResult<ParsedSchedulerExecutorCommand> {
  let sessionId: string | undefined;
  let maxDispatches: number | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--max-dispatches") {
      if (!value) {
        return { ok: false, error: "Missing value for --max-dispatches." };
      }
      const parsedMaxDispatches = Number.parseInt(value, 10);
      if (!Number.isInteger(parsedMaxDispatches) || String(parsedMaxDispatches) !== value) {
        return { ok: false, error: "--max-dispatches must be an integer." };
      }
      maxDispatches = parsedMaxDispatches;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown scheduler-executor option: ${token}` };
  }

  if (!sessionId) {
    return { ok: false, error: "scheduler-executor requires --session-id." };
  }

  return {
    ok: true,
    value: {
      type: "scheduler-executor",
      sessionId,
      ...(maxDispatches === undefined ? {} : { maxDispatches }),
    },
  };
}

function parseSchedulerRecoveryCommand(
  rest: readonly string[],
): ParseResult<ParsedSchedulerRecoveryCommand> {
  let sessionId: string | undefined;
  let actionId: string | undefined;
  let confirmCancelObservedDrift: boolean | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--action-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --action-id." };
      }
      actionId = value;
      index += 1;
      continue;
    }

    if (token === "--confirm-cancel-observed-drift") {
      confirmCancelObservedDrift = true;
      continue;
    }

    return { ok: false, error: `Unknown scheduler-recovery option: ${token}` };
  }

  if (!sessionId) {
    return { ok: false, error: "scheduler-recovery requires --session-id." };
  }

  return {
    ok: true,
    value: {
      type: "scheduler-recovery",
      sessionId,
      ...(actionId === undefined ? {} : { actionId }),
      ...(confirmCancelObservedDrift === undefined ? {} : { confirmCancelObservedDrift }),
    },
  };
}

function parseRunOnceCommand(rest: readonly string[]): ParseResult<ParsedRunOnceCommand> {
  let sessionId: string | undefined;
  let turnId: string | undefined;
  let proposalId: string | undefined;
  let proposalKind: string | undefined;
  let provenance: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--turn-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --turn-id." };
      }
      turnId = value;
      index += 1;
      continue;
    }

    if (token === "--proposal-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }

    if (token === "--kind") {
      if (!value) {
        return { ok: false, error: "Missing value for --kind." };
      }
      proposalKind = value;
      index += 1;
      continue;
    }

    if (token === "--provenance") {
      if (!value) {
        return { ok: false, error: "Missing value for --provenance." };
      }
      provenance = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown run-once option: ${token}` };
  }

  if (!sessionId || !turnId) {
    return { ok: false, error: "run-once requires --session-id and --turn-id." };
  }

  return {
    ok: true,
    value: {
      type: "run-once",
      sessionId,
      turnId,
      ...(proposalId === undefined ? {} : { proposalId }),
      ...(proposalKind === undefined ? {} : { proposalKind }),
      ...(provenance === undefined ? {} : { provenance }),
    },
  };
}

function parseReconcileSkillProposalCommand(
  rest: readonly string[],
): ParseResult<ParsedReconcileSkillProposalCommand> {
  let sessionId: string | undefined;
  let proposalId: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--proposal-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown reconcile-skill-proposal option: ${token}` };
  }

  if (!sessionId || !proposalId) {
    return {
      ok: false,
      error: "reconcile-skill-proposal requires --session-id and --proposal-id.",
    };
  }

  return {
    ok: true,
    value: {
      type: "reconcile-skill-proposal",
      sessionId,
      proposalId,
    },
  };
}

function parseReviewSkillProposalCommand(
  rest: readonly string[],
): ParseResult<ParsedReviewSkillProposalCommand> {
  let sessionId: string | undefined;
  let proposalId: string | undefined;
  let reviewerId: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--proposal-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }

    if (token === "--reviewer-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --reviewer-id." };
      }
      reviewerId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown review-skill-proposal option: ${token}` };
  }

  if (!sessionId || !proposalId) {
    return {
      ok: false,
      error: "review-skill-proposal requires --session-id and --proposal-id.",
    };
  }

  return {
    ok: true,
    value: {
      type: "review-skill-proposal",
      sessionId,
      proposalId,
      ...(reviewerId === undefined ? {} : { reviewerId }),
    },
  };
}

function parseRunDelegationCommand(
  rest: readonly string[],
): ParseResult<ParsedRunDelegationCommand> {
  let sessionId: string | undefined;
  let workerId: string | undefined;
  let verifierId: string | undefined;
  let delegationId: string | undefined;
  let verificationId: string | undefined;
  let requirement: string | undefined;
  let failureReason: string | undefined;
  let observedWriteSet: readonly string[] | undefined;
  let observedWriteSetSource: "patch" | "diff" | "artifact" | undefined;
  let observedWriteSetArtifact: string | undefined;
  let observedWriteSetFromGitDiff: boolean | undefined;
  let maxClaims: number | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--worker-id" || token === "--worker") {
      if (!value) {
        return { ok: false, error: "Missing value for --worker-id." };
      }
      workerId = value;
      index += 1;
      continue;
    }

    if (token === "--verifier-id" || token === "--verifier") {
      if (!value) {
        return { ok: false, error: "Missing value for --verifier-id." };
      }
      verifierId = value;
      index += 1;
      continue;
    }

    if (token === "--delegation-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --delegation-id." };
      }
      delegationId = value;
      index += 1;
      continue;
    }

    if (token === "--verification-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --verification-id." };
      }
      verificationId = value;
      index += 1;
      continue;
    }

    if (token === "--requirement") {
      if (!value) {
        return { ok: false, error: "Missing value for --requirement." };
      }
      requirement = value;
      index += 1;
      continue;
    }

    if (token === "--fail") {
      if (!value) {
        return { ok: false, error: "Missing value for --fail." };
      }
      failureReason = value;
      index += 1;
      continue;
    }

    if (token === "--observed-write-set") {
      if (!value) {
        return { ok: false, error: "Missing value for --observed-write-set." };
      }
      observedWriteSet = parseCommaSeparatedList(value);
      index += 1;
      continue;
    }

    if (token === "--observed-write-set-artifact") {
      if (!value) {
        return { ok: false, error: "Missing value for --observed-write-set-artifact." };
      }
      observedWriteSetArtifact = value;
      index += 1;
      continue;
    }

    if (token === "--observed-write-set-from-git-diff") {
      observedWriteSetFromGitDiff = true;
      continue;
    }

    if (token === "--observed-write-set-source") {
      if (!value) {
        return { ok: false, error: "Missing value for --observed-write-set-source." };
      }
      if (value !== "patch" && value !== "diff" && value !== "artifact") {
        return {
          ok: false,
          error: "--observed-write-set-source must be one of: patch, diff, artifact.",
        };
      }
      observedWriteSetSource = value;
      index += 1;
      continue;
    }

    if (token === "--max-claims") {
      if (!value) {
        return { ok: false, error: "Missing value for --max-claims." };
      }
      const parsedMaxClaims = Number.parseInt(value, 10);
      if (!Number.isInteger(parsedMaxClaims) || String(parsedMaxClaims) !== value) {
        return { ok: false, error: "--max-claims must be an integer." };
      }
      maxClaims = parsedMaxClaims;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown run-delegation option: ${token}` };
  }

  if (!sessionId || !workerId) {
    return { ok: false, error: "run-delegation requires --session-id and --worker-id." };
  }

  return {
    ok: true,
    value: {
      type: "run-delegation",
      sessionId,
      workerId,
      ...(verifierId === undefined ? {} : { verifierId }),
      ...(delegationId === undefined ? {} : { delegationId }),
      ...(verificationId === undefined ? {} : { verificationId }),
      ...(requirement === undefined ? {} : { requirement }),
      ...(failureReason === undefined ? {} : { failureReason }),
      ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
      ...(observedWriteSetSource === undefined ? {} : { observedWriteSetSource }),
      ...(observedWriteSetArtifact === undefined ? {} : { observedWriteSetArtifact }),
      ...(observedWriteSetFromGitDiff === undefined ? {} : { observedWriteSetFromGitDiff }),
      ...(maxClaims === undefined ? {} : { maxClaims }),
    },
  };
}

function parseCommaSeparatedList(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function parseRunVerificationCommand(
  rest: readonly string[],
): ParseResult<ParsedRunVerificationCommand> {
  let sessionId: string | undefined;
  let verifierId: string | undefined;
  let verificationId: string | undefined;
  let verificationStatus: "passed" | "failed" | "partial" | undefined;
  let verdictSummary: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    if (token === "--session-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --session-id." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--verifier-id" || token === "--verifier") {
      if (!value) {
        return { ok: false, error: "Missing value for --verifier-id." };
      }
      verifierId = value;
      index += 1;
      continue;
    }

    if (token === "--verification-id") {
      if (!value) {
        return { ok: false, error: "Missing value for --verification-id." };
      }
      verificationId = value;
      index += 1;
      continue;
    }

    if (token === "--status") {
      if (!value) {
        return { ok: false, error: "Missing value for --status." };
      }
      if (value !== "passed" && value !== "failed" && value !== "partial") {
        return {
          ok: false,
          error: "run-verification --status must be passed, failed, or partial.",
        };
      }
      verificationStatus = value;
      index += 1;
      continue;
    }

    if (token === "--verdict") {
      if (!value) {
        return { ok: false, error: "Missing value for --verdict." };
      }
      verdictSummary = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown run-verification option: ${token}` };
  }

  if (!sessionId || !verifierId) {
    return { ok: false, error: "run-verification requires --session-id and --verifier-id." };
  }

  return {
    ok: true,
    value: {
      type: "run-verification",
      sessionId,
      verifierId,
      ...(verificationId === undefined ? {} : { verificationId }),
      ...(verificationStatus === undefined ? {} : { verificationStatus }),
      ...(verdictSummary === undefined ? {} : { verdictSummary }),
    },
  };
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isExecutedAsScript(
  argv: readonly string[] = process.argv,
  moduleUrl: string = import.meta.url,
): boolean {
  const scriptPath = argv[1];
  if (!scriptPath) {
    return false;
  }

  return pathToFileURL(resolve(scriptPath)).href === moduleUrl;
}

type ParseResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: string };
