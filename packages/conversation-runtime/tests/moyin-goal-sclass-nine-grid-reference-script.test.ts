import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Moyin S-Class nine-grid goal script", () => {
  it("codifies the second-step UI path and stops before video generation", () => {
    const scriptUrl = new URL(
      "../../../scripts/moyin-goal-sclass-nine-grid-reference.mjs",
      import.meta.url,
    );
    const source = readFileSync(scriptUrl, "utf8");

    expect(source).toContain("分组生成-九宫格分组（更连贯）");
    expect(source).toContain("生成构图方案");
    expect(source).toContain("生成九宫格参考图");
    expect(source).toContain("复核九宫格图");
    expect(source).not.toContain("sclass.group-video");
    expect(source).not.toContain("sclass.batch-video");
  });

  it("builds a sealed request before executing the paid S-Class grid image step", () => {
    const scriptUrl = new URL(
      "../../../scripts/moyin-goal-sclass-nine-grid-reference.mjs",
      import.meta.url,
    );
    const source = readFileSync(scriptUrl, "utf8");
    const gridRunCall = source.match(
      /const gridRun = await createSingleStepRun\([\s\S]*?const gridExecution = await executeWorkflowStep/,
    )?.[0];

    expect(gridRunCall).toContain('stepId: "group-grid-image"');
    expect(gridRunCall).toContain('command: "sclass.group-grid-image"');
    expect(gridRunCall).toContain("requiresApproval: true");
    expect(gridRunCall).toContain("prepareWorkflowStepSealedRequest");
    expect(source).toContain('item.source !== "orchestrator" || item.event === undefined');
  });

  it("executes the Moyin review gate after the grid image without generating video", () => {
    const scriptUrl = new URL(
      "../../../scripts/moyin-goal-sclass-nine-grid-reference.mjs",
      import.meta.url,
    );
    const source = readFileSync(scriptUrl, "utf8");
    const reviewRunCall = source.match(
      /const reviewRun = await createSingleStepRun\([\s\S]*?const reviewExecution = await executeWorkflowStep/,
    )?.[0];

    expect(reviewRunCall).toContain('stepId: "group-grid-review"');
    expect(reviewRunCall).toContain('command: "sclass.group-grid-review"');
    expect(reviewRunCall).toContain("requiresApproval: false");
    expect(source).toContain("boardReviewStatus");
    expect(source).toContain("boardReviewAcceptable");
  });

  it("reuses an existing completed Moyin grid image unless regeneration is explicitly forced", () => {
    const scriptUrl = new URL(
      "../../../scripts/moyin-goal-sclass-nine-grid-reference.mjs",
      import.meta.url,
    );
    const source = readFileSync(scriptUrl, "utf8");

    expect(source).toContain("MOYIN_GOAL_FORCE_REGENERATE_GRID");
    expect(source).toContain("isReusableNineGridReference");
    expect(source).toContain("reuseExistingGridReference");
    expect(source).toContain('status: "skipped"');
    expect(source).toContain('const existingGridReferenceReason = "existing-moyin-grid-reference"');
    expect(source).toContain("reason: existingGridReferenceReason");
  });
});
