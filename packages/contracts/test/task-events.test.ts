import { describe, expect, it } from "vitest";

import {
  TASK_EVENTS_DOMAIN_VERSION,
  createTaskEvent,
  decodeTaskEvent,
  isTaskEventType,
  isTaskEventsDomainVersionCompatible,
} from "../src/index.js";

describe("task events contract", () => {
  it("recognizes task event vocabulary", () => {
    expect(isTaskEventType("tasks.todo_write")).toBe(true);
    expect(isTaskEventType("tasks.notification_emitted")).toBe(true);
    expect(isTaskEventType("tasks.unknown")).toBe(false);
  });

  it("decodes canonical flat todo_write payload", () => {
    const event = decodeTaskEvent({
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "t1", content: "Write docs", status: "todo" }],
        updatedAtMs: 1000,
      },
    });

    expect(event?.eventType).toBe("tasks.todo_write");
    expect(event?.domainVersion).toBe(TASK_EVENTS_DOMAIN_VERSION);
    if (!event || event.eventType !== "tasks.todo_write") {
      throw new Error("unexpected todo_write decode result");
    }
    expect(event.payload.items[0]?.content).toBe("Write docs");
    expect(event.payload.updatedAtMs).toBe(1000);
  });

  it("decodes legacy wrapped todo_write payload as canonical flat state", () => {
    const event = decodeTaskEvent({
      eventType: "tasks.todo_write",
      payload: {
        todos: {
          items: [{ id: "t1", content: "Legacy todo", status: "doing", priority: "high" }],
          updatedAtMs: 2100,
        },
        updatedAtMs: 2200,
      },
    });

    expect(event?.eventType).toBe("tasks.todo_write");
    if (!event || event.eventType !== "tasks.todo_write") {
      throw new Error("unexpected legacy todo_write decode result");
    }
    expect(event.payload.items[0]?.content).toBe("Legacy todo");
    expect(event.payload.items[0]?.priority).toBe("high");
    expect(event.payload.updatedAtMs).toBe(2100);
  });

  it("normalizes proposal_outbox_drained legacy payload into drainedIds contract", () => {
    const event = decodeTaskEvent({
      eventType: "tasks.proposal_outbox_drained",
      payload: {
        drained: [
          {
            id: "outbox_1",
            eventType: "proposal.enqueued",
            proposalId: "p1",
            status: "pending",
            schemaVersion: "0.1.0",
            createdAtMs: 500,
          },
        ],
        updatedAtMs: 2500,
      },
    });

    expect(event?.eventType).toBe("tasks.proposal_outbox_drained");
    if (!event || event.eventType !== "tasks.proposal_outbox_drained") {
      throw new Error("unexpected outbox drain decode result");
    }
    expect(event.payload.drainedIds).toEqual(["outbox_1"]);
    expect(event.payload.drainedAtMs).toBe(2500);
    expect(event.payload.updatedAtMs).toBe(2500);
  });

  it("creates typed task event envelopes through shared encoder authority", () => {
    const event = createTaskEvent({
      eventType: "tasks.todo_write",
      payload: {
        items: [{ id: "t1", content: "Shared encoder", status: "done" }],
        updatedAtMs: 3200,
      },
    });

    expect(event.eventType).toBe("tasks.todo_write");
    expect(event.domainVersion).toBe(TASK_EVENTS_DOMAIN_VERSION);
    expect(event.payload.items[0]?.status).toBe("done");
  });

  it("decodes delegation payloads with persisted verification handoff contract", () => {
    const event = decodeTaskEvent({
      eventType: "tasks.delegation_upserted",
      payload: {
        record: {
          id: "d1",
          taskId: "todo_1",
          workerId: "worker-a",
          instruction: "Implement bounded handoff flow.",
          fromAgent: "director",
          contextSnapshot: "focus=delegation protocol",
          specialization: "plan",
          targetAgent: "plan-agent",
          verificationRequest: {
            verificationId: "v1",
            verifierId: "verify-a",
            requirement: "Bounded handoff flow passes.",
          },
          status: "queued",
          createdAtMs: 3300,
          updatedAtMs: 3400,
        },
        updatedAtMs: 3400,
      },
    });

    expect(event?.eventType).toBe("tasks.delegation_upserted");
    if (!event || event.eventType !== "tasks.delegation_upserted") {
      throw new Error("unexpected delegation_upserted decode result");
    }
    expect(event.payload.record.verificationRequest).toEqual({
      verificationId: "v1",
      verifierId: "verify-a",
      requirement: "Bounded handoff flow passes.",
    });
    expect(event.payload.record.specialization).toBe("plan");
    expect(event.payload.record.targetAgent).toBe("plan-agent");
  });

  it("rejects delegation targetAgent payloads without specialization", () => {
    const event = decodeTaskEvent({
      eventType: "tasks.delegation_upserted",
      payload: {
        record: {
          id: "d_invalid_target",
          taskId: "todo_1",
          workerId: "worker-a",
          instruction: "Implement bounded handoff flow.",
          targetAgent: "plan-agent",
          status: "queued",
          createdAtMs: 3300,
          updatedAtMs: 3400,
        },
        updatedAtMs: 3400,
      },
    });

    expect(event).toBeNull();
  });

  it("decodes verification gate payloads with structured verdict metadata", () => {
    const event = decodeTaskEvent({
      eventType: "tasks.verification_upserted",
      payload: {
        record: {
          id: "v1",
          taskId: "todo_1",
          verifierId: "verify-agent",
          verifiedBy: "verify-agent",
          requirement: "Build, tests, and replay all pass",
          status: "partial",
          verdict: "partial",
          verdictSummary: "Build passed, but replay still needs manual inspection.",
          checks: [
            {
              id: "build",
              status: "pass",
              summary: "Build completed successfully.",
            },
            {
              id: "replay",
              status: "partial",
              summary: "Replay needs one more manual inspection.",
              detail: "Golden path covered, edge path still pending.",
            },
          ],
          createdAtMs: 4100,
          updatedAtMs: 4200,
        },
        updatedAtMs: 4200,
      },
    });

    expect(event?.eventType).toBe("tasks.verification_upserted");
    if (!event || event.eventType !== "tasks.verification_upserted") {
      throw new Error("unexpected verification_upserted decode result");
    }
    expect(event.payload.record.status).toBe("partial");
    expect(event.payload.record.verdict).toBe("partial");
    expect(event.payload.record.verifiedBy).toBe("verify-agent");
    expect(event.payload.record.checks).toEqual([
      {
        id: "build",
        status: "pass",
        summary: "Build completed successfully.",
      },
      {
        id: "replay",
        status: "partial",
        summary: "Replay needs one more manual inspection.",
        detail: "Golden path covered, edge path still pending.",
      },
    ]);
  });

  it("decodes notification payloads with recipient and acknowledgement metadata", () => {
    const event = decodeTaskEvent({
      eventType: "tasks.notification_status_set",
      payload: {
        record: {
          id: "notification_delegation_d1",
          kind: "delegation_assigned",
          recipientKind: "worker",
          recipientId: "worker-a",
          status: "acknowledged",
          summary: "Delegation d1 is queued for worker worker-a.",
          taskId: "todo_1",
          delegationId: "d1",
          createdAtMs: 5100,
          updatedAtMs: 5200,
          acknowledgedAtMs: 5200,
        },
        updatedAtMs: 5200,
        fromStatus: "pending",
        toStatus: "acknowledged",
        reason: "delegation_claimed",
      },
    });

    expect(event?.eventType).toBe("tasks.notification_status_set");
    if (!event || event.eventType !== "tasks.notification_status_set") {
      throw new Error("unexpected notification_status_set decode result");
    }
    expect(event.payload.record.recipientKind).toBe("worker");
    expect(event.payload.record.status).toBe("acknowledged");
    expect(event.payload.record.acknowledgedAtMs).toBe(5200);
    expect(event.payload.fromStatus).toBe("pending");
    expect(event.payload.toStatus).toBe("acknowledged");
    expect(event.payload.reason).toBe("delegation_claimed");
  });

  it("checks domain version compatibility and rejects incompatible versions", () => {
    expect(isTaskEventsDomainVersionCompatible("tasks/v1")).toBe(true);
    expect(isTaskEventsDomainVersionCompatible("tasks/v1.4")).toBe(true);
    expect(isTaskEventsDomainVersionCompatible("tasks/v2")).toBe(false);
    expect(isTaskEventsDomainVersionCompatible("other/v1")).toBe(false);

    const decoded = decodeTaskEvent({
      eventType: "tasks.todo_write",
      payload: { items: [] },
      domainVersion: "tasks/v2",
    });
    expect(decoded).toBeNull();
  });
});
