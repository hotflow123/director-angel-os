import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { FileSystemDirectorProposalStore } from "../src/file-store.js";
import { generateDirectorProposalFromRecord } from "../src/generator.js";

describe("FileSystemDirectorProposalStore", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0, roots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes, lists, and reports proposal status", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-proposals-"));
    roots.push(root);
    const store = new FileSystemDirectorProposalStore({
      rootPath: join(root, "proposals"),
      clock: () => "2026-04-12T12:00:00.000Z",
    });
    const proposal = generateDirectorProposalFromRecord({
      record: {
        schemaVersion: "director.memory.record.v1",
        recordId: "record-run-1",
        digestId: "digest-run-1",
        projectId: "project-1",
        groupId: "group-1",
        anchorIds: ["anchor-a"],
        selectedAdapters: ["seedance"],
        status: "completed",
        recordedAt: "2026-04-12T10:00:00.000Z",
        digest: {
          schemaVersion: "director.memory.trace-digest.v1",
          digestId: "digest-run-1",
          runId: "run-1",
          reportId: "report-run-1",
          snapshotId: "snapshot-1",
          runtimeId: "runtime-1",
          blueprintId: "blueprint-1",
          handoffId: "handoff-1",
          actionGraphId: "graph-1",
          projectId: "project-1",
          groupId: "group-1",
          goal: "Create a continuity-safe teaser.",
          previewSummary: "Preview-safe teaser plan.",
          status: "completed",
          roles: ["researcher"],
          anchorIds: ["anchor-a"],
          selectedAdapters: ["seedance"],
          observationRefs: [
            {
              observationId: "observation-evaluation-1",
              source: "evaluation",
              recordedAt: "2026-04-12T09:59:00.000Z",
            },
          ],
          assignmentStats: {
            total: 1,
            completed: 1,
            failed: 0,
            aborted: 0,
            skipped: 0,
            blocked: 0,
          },
          flags: [],
          eventTypes: ["run-created"],
          createdAt: "2026-04-12T09:58:00.000Z",
          recordedAt: "2026-04-12T10:00:00.000Z",
        },
      },
      provenance: "director-worker/proposal-ingest",
      now: "2026-04-12T12:00:00.000Z",
    });

    const write = await store.writeProposal(proposal);
    const listed = await store.listProposals();
    const status = await store.getStatus();

    expect(write.status).toBe("ok");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.proposalId).toBe(proposal.proposalId);
    expect(status.proposalCount).toBe(1);
    expect(status.status).toBe("ok");
  });

  test("transitions a pending proposal to accepted and records an audit trail", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-proposals-transition-"));
    roots.push(root);
    const store = new FileSystemDirectorProposalStore({
      rootPath: join(root, "proposals"),
      clock: () => "2026-04-12T12:30:00.000Z",
    });
    const proposal = generateDirectorProposalFromRecord({
      record: {
        schemaVersion: "director.memory.record.v1",
        recordId: "record-run-2",
        digestId: "digest-run-2",
        projectId: "project-2",
        groupId: "group-2",
        anchorIds: ["anchor-a"],
        selectedAdapters: ["seedance"],
        status: "completed",
        recordedAt: "2026-04-12T10:30:00.000Z",
        digest: {
          schemaVersion: "director.memory.trace-digest.v1",
          digestId: "digest-run-2",
          runId: "run-2",
          reportId: "report-run-2",
          snapshotId: "snapshot-2",
          runtimeId: "runtime-2",
          blueprintId: "blueprint-2",
          handoffId: "handoff-2",
          actionGraphId: "graph-2",
          projectId: "project-2",
          groupId: "group-2",
          goal: "Create a second continuity-safe teaser.",
          previewSummary: "Preview-safe teaser plan.",
          status: "completed",
          roles: ["researcher"],
          anchorIds: ["anchor-a"],
          selectedAdapters: ["seedance"],
          observationRefs: [
            {
              observationId: "observation-evaluation-2",
              source: "evaluation",
              recordedAt: "2026-04-12T10:29:00.000Z",
            },
          ],
          assignmentStats: {
            total: 1,
            completed: 1,
            failed: 0,
            aborted: 0,
            skipped: 0,
            blocked: 0,
          },
          flags: [],
          eventTypes: ["run-created"],
          createdAt: "2026-04-12T10:28:00.000Z",
          recordedAt: "2026-04-12T10:30:00.000Z",
        },
      },
      provenance: "director-worker/proposal-ingest",
      now: "2026-04-12T12:00:00.000Z",
    });

    await store.writeProposal(proposal);
    const transition = await store.transitionProposal({
      proposalId: proposal.proposalId,
      nextStatus: "accepted",
      note: "Looks reusable.",
    });
    const updated = await store.getProposal(proposal.proposalId);
    const auditLog = readFileSync(
      join(root, "proposals", "audits", `${proposal.proposalId}.ndjson`),
      "utf8",
    );

    expect(transition.status).toBe("ok");
    expect(transition.previousStatus).toBe("pending");
    expect(updated?.status).toBe("accepted");
    expect(updated?.latestDecision?.decidedStatus).toBe("accepted");
    expect(updated?.latestDecision?.note).toBe("Looks reusable.");
    expect(auditLog).toContain('"nextStatus":"accepted"');
    expect(auditLog).toContain('"note":"Looks reusable."');
  });
});
