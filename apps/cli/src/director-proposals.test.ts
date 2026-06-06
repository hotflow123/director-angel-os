import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acceptDirectorTraceProposal,
  describeDirectorTraceProposalStatus,
  explainDirectorTraceProposal,
  listDirectorTraceProposals,
  previewDirectorTraceProposal,
  rejectDirectorTraceProposal,
  replayDirectorTraceProposal,
  reviewDirectorTraceProposalForOperator,
} from "./director-proposals.js";

describe("director trace proposal helpers", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("describes proposal lane status and lists stored proposals", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-proposal-status-"));
    tempRoots.push(workspaceRoot);
    writeProposalFixture(workspaceRoot, {
      proposalId: "proposal-1",
      status: "pending",
      projectId: "project-1",
      groupId: "group-1",
      title: "Director method: Build teaser",
      riskLevel: "low",
      confidence: 0.88,
      updatedAt: "2026-04-12T20:00:00.000Z",
    });

    const statusOutput = await describeDirectorTraceProposalStatus(workspaceRoot);
    const listOutput = await listDirectorTraceProposals(workspaceRoot, {
      status: "pending",
      projectId: "project-1",
    });

    expect(statusOutput).toContain("Director trace proposals:");
    expect(statusOutput).toContain("status: ok");
    expect(statusOutput).toContain("proposal count: 1");
    expect(listOutput).toContain("Director trace proposal list:");
    expect(listOutput).toContain("proposal-1 status=pending risk=low confidence=0.88");
    expect(listOutput).toContain("project/group: project-1/group-1");
  });

  it("explains one stored proposal in operator-readable form", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-proposal-explain-"));
    tempRoots.push(workspaceRoot);
    writeProposalFixture(workspaceRoot, {
      proposalId: "proposal-2",
      status: "pending",
      projectId: "project-2",
      groupId: "group-2",
      title: "Director method: Shot-first continuity pass",
      riskLevel: "medium",
      confidence: 0.61,
      updatedAt: "2026-04-12T20:10:00.000Z",
    });

    const output = await explainDirectorTraceProposal(workspaceRoot, "proposal-2");

    expect(output).toContain("Director trace proposal:");
    expect(output).toContain("proposal id: proposal-2");
    expect(output).toContain("risk: medium");
    expect(output).toContain("confidence: 0.61");
    expect(output).toContain("provenance: director-worker/proposal-ingest");
    expect(output).toContain("evidence:");
  });

  it("reviews and decides stored proposals with visible decision state", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-proposal-review-"));
    tempRoots.push(workspaceRoot);
    writeProposalFixture(workspaceRoot, {
      proposalId: "proposal-3",
      status: "pending",
      projectId: "project-3",
      groupId: "group-3",
      title: "Director method: Reusable opener",
      riskLevel: "low",
      confidence: 0.9,
      updatedAt: "2026-04-12T20:20:00.000Z",
    });
    writeProposalFixture(workspaceRoot, {
      proposalId: "proposal-4",
      status: "pending",
      projectId: "project-4",
      groupId: "group-4",
      title: "Director method: Risky fallback",
      riskLevel: "high",
      confidence: 0.31,
      updatedAt: "2026-04-12T20:25:00.000Z",
    });

    const reviewOutput = await reviewDirectorTraceProposalForOperator(workspaceRoot, "proposal-3");
    const acceptOutput = await acceptDirectorTraceProposal(workspaceRoot, {
      proposalId: "proposal-3",
      note: "Approved for director reuse.",
    });
    const explainAccepted = await explainDirectorTraceProposal(workspaceRoot, "proposal-3");
    const rejectOutput = await rejectDirectorTraceProposal(workspaceRoot, {
      proposalId: "proposal-4",
      note: "Evidence is too weak.",
    });

    expect(reviewOutput).toContain("Director trace proposal review:");
    expect(reviewOutput).toContain("recommendation: accept");
    expect(acceptOutput).toContain("Director trace proposal decision:");
    expect(acceptOutput).toContain("next status: accepted");
    expect(explainAccepted).toContain("latest decision: accepted");
    expect(explainAccepted).toContain("latest decision note: Approved for director reuse.");
    expect(rejectOutput).toContain("next status: rejected");
  });

  it("previews and replays an accepted proposal with audit-visible output", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-proposal-replay-"));
    tempRoots.push(workspaceRoot);
    writeProposalFixture(workspaceRoot, {
      proposalId: "proposal-5",
      status: "pending",
      projectId: "project-5",
      groupId: "group-5",
      title: "Director method: Replay-safe teaser",
      riskLevel: "low",
      confidence: 0.89,
      updatedAt: "2026-04-12T20:30:00.000Z",
    });

    await acceptDirectorTraceProposal(workspaceRoot, {
      proposalId: "proposal-5",
      note: "Approved for mock replay.",
    });

    const previewOutput = await previewDirectorTraceProposal(workspaceRoot, "proposal-5");
    const replayOutput = await replayDirectorTraceProposal(workspaceRoot, {
      proposalId: "proposal-5",
      workerId: "proposal-replay-test",
    });

    expect(previewOutput).toContain("Director trace proposal preview:");
    expect(previewOutput).toContain("proposal id: proposal-5");
    expect(previewOutput).toContain("status: accepted");
    expect(previewOutput).toContain("mode: mock-only synthetic replay");
    expect(previewOutput).toContain("assignments:");
    expect(replayOutput).toContain("Director trace proposal replay:");
    expect(replayOutput).toContain("proposal id: proposal-5");
    expect(replayOutput).toContain("worker id: proposal-replay-test");
    expect(replayOutput).toContain("run status: completed");
    expect(replayOutput).toContain("flags: preview-only");

    const executionRuns = readdirSync(
      join(workspaceRoot, ".director-angel", "runtime", "execution", "runs"),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(executionRuns.length).toBe(1);

    const auditPath = join(
      workspaceRoot,
      ".director-angel",
      "runtime",
      "proposals",
      "audits",
      "proposal-5.ndjson",
    );
    const auditLog = readFileSync(auditPath, "utf8");
    expect(auditLog).toContain('"action":"decision"');
    expect(auditLog).toContain('"action":"previewed"');
    expect(auditLog).toContain('"action":"replayed"');
  });
});

function writeProposalFixture(
  workspaceRoot: string,
  overrides: {
    readonly proposalId: string;
    readonly status: "pending" | "accepted" | "rejected";
    readonly projectId: string;
    readonly groupId: string;
    readonly title: string;
    readonly riskLevel: "low" | "medium" | "high";
    readonly confidence: number;
    readonly updatedAt: string;
  },
): void {
  const rootPath = join(workspaceRoot, ".director-angel", "runtime", "proposals");
  mkdirSync(join(rootPath, "records"), { recursive: true });
  writeFileSync(
    join(rootPath, "index.json"),
    JSON.stringify({
      schemaVersion: "director.proposal.index.v1",
      updatedAt: overrides.updatedAt,
      entries: [
        {
          proposalId: overrides.proposalId,
          kind: "director.trace_capture",
          status: overrides.status,
          projectId: overrides.projectId,
          groupId: overrides.groupId,
          title: overrides.title,
          riskLevel: overrides.riskLevel,
          confidence: overrides.confidence,
          updatedAt: overrides.updatedAt,
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(rootPath, "records", `${overrides.proposalId}.json`),
    JSON.stringify({
      schemaVersion: "director.proposal.v1",
      proposalId: overrides.proposalId,
      kind: "director.trace_capture",
      status: overrides.status,
      provenance: "director-worker/proposal-ingest",
      recordId: `record-${overrides.proposalId}`,
      digestId: `digest-${overrides.proposalId}`,
      runId: `run-${overrides.proposalId}`,
      reportId: `report-${overrides.proposalId}`,
      projectId: overrides.projectId,
      groupId: overrides.groupId,
      title: overrides.title,
      summary: "completed immersive new run",
      trigger: `When planning a run for project ${overrides.projectId}.`,
      evidenceSummary: "status=completed | roles=researcher, script-planner",
      explanation: "Completed run suggests a reusable director method.",
      confidence: overrides.confidence,
      riskLevel: overrides.riskLevel,
      dedupeKey: `${overrides.projectId}__${overrides.groupId}`,
      tags: ["director-trace", "continuity"],
      roles: ["researcher", "script-planner"],
      selectedAdapters: ["scripted"],
      createdAt: overrides.updatedAt,
      updatedAt: overrides.updatedAt,
      sourceRecord: {
        schemaVersion: "director.memory.record.v1",
        recordId: `record-${overrides.proposalId}`,
        digestId: `digest-${overrides.proposalId}`,
        projectId: overrides.projectId,
        groupId: overrides.groupId,
        anchorIds: ["anchor-a"],
        selectedAdapters: ["scripted"],
        tags: ["continuity"],
        status: "completed",
        recordedAt: overrides.updatedAt,
        digest: {
          schemaVersion: "director.memory.trace-digest.v1",
          digestId: `digest-${overrides.proposalId}`,
          runId: `run-${overrides.proposalId}`,
          reportId: `report-${overrides.proposalId}`,
          snapshotId: `snapshot-${overrides.proposalId}`,
          runtimeId: "runtime-1",
          blueprintId: `blueprint-${overrides.proposalId}`,
          handoffId: `handoff-${overrides.proposalId}`,
          actionGraphId: `graph-${overrides.proposalId}`,
          projectId: overrides.projectId,
          groupId: overrides.groupId,
          goal: "Create a continuity-safe teaser.",
          previewSummary: "Preview-safe run completed successfully.",
          status: "completed",
          roles: ["researcher", "script-planner"],
          anchorIds: ["anchor-a"],
          selectedAdapters: ["scripted"],
          observationRefs: [
            {
              observationId: "observation-evaluation-1",
              source: "evaluation",
              recordedAt: overrides.updatedAt,
            },
          ],
          assignmentStats: {
            total: 2,
            completed: 2,
            failed: 0,
            aborted: 0,
            skipped: 0,
            blocked: 0,
          },
          flags: [],
          eventTypes: ["run-created", "assignment-status-changed"],
          createdAt: overrides.updatedAt,
          startedAt: overrides.updatedAt,
          completedAt: overrides.updatedAt,
          recordedAt: overrides.updatedAt,
          generationType: "new",
          generationStyle: "immersive",
          knowledgeSignalTags: ["continuity"],
        },
      },
    }),
    "utf8",
  );
}
