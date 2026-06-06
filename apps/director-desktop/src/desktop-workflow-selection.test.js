import { describe, expect, it } from "vitest";

import { resolveWorkflowIdForCommandSelection } from "./desktop-workflow-selection.js";

const workflows = Object.freeze([
  { id: "workbench", commandIds: ["workspace.status", "workspace.doctor"] },
  { id: "skills", commandIds: ["task.proposalList"] },
  { id: "review", commandIds: ["task.proposalList", "run.audit"] },
  { id: "settings", commandIds: ["workspace.doctor", "workspace.switches"] },
]);

describe("desktop workflow selection", () => {
  it("keeps the current non-workbench surface when it owns a shared command", () => {
    expect(
      resolveWorkflowIdForCommandSelection({
        workflows,
        activeWorkflowId: "settings",
        commandId: "workspace.doctor",
      }),
    ).toBe("settings");
    expect(
      resolveWorkflowIdForCommandSelection({
        workflows,
        activeWorkflowId: "review",
        commandId: "task.proposalList",
      }),
    ).toBe("review");
  });

  it("falls back to the first owning surface when the active surface does not own the command", () => {
    expect(
      resolveWorkflowIdForCommandSelection({
        workflows,
        activeWorkflowId: "settings",
        commandId: "task.proposalList",
      }),
    ).toBe("skills");
  });

  it("preserves the active surface when the command has no owning surface", () => {
    expect(
      resolveWorkflowIdForCommandSelection({
        workflows,
        activeWorkflowId: "review",
        commandId: "missing.command",
      }),
    ).toBe("review");
  });
});
