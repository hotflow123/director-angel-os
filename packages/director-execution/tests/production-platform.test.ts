import { describe, expect, it } from "vitest";

import {
  buildProductionPlatformRunReport,
  createMockProductionPlatformAdapter,
  runProductionPlatformVerticalSlice,
} from "../src/production-platform.ts";

describe("production platform mock adapter", () => {
  it("runs create project, upload asset, and render preview as dry-run traces by default", async () => {
    const adapter = createMockProductionPlatformAdapter({
      adapterId: "mock-production-platform",
      now: createClock([
        "2026-04-25T10:00:00.000Z",
        "2026-04-25T10:00:01.000Z",
        "2026-04-25T10:00:02.000Z",
      ]),
    });

    const project = await adapter.createProject({
      title: "Launch teaser",
      brief: "Cut a short preview for operator review.",
    });
    const asset = await adapter.uploadAsset({
      projectRef: project.output?.projectRef ?? "missing",
      assetName: "storyboard.md",
      artifactKind: "document",
      contentDigest: "sha256:storyboard",
    });
    const preview = await adapter.renderPreview({
      projectRef: project.output?.projectRef ?? "missing",
      assetRefs: [asset.output?.assetRef ?? "missing"],
      profile: "vertical-short",
    });

    expect(project.status).toBe("dry_run");
    expect(asset.status).toBe("dry_run");
    expect(preview.status).toBe("dry_run");
    expect(preview.output?.previewRef).toContain("preview");
    expect(adapter.listTraces().map((trace) => trace.action)).toEqual([
      "create_project",
      "upload_asset",
      "render_preview",
    ]);
    expect(adapter.listTraces().every((trace) => trace.externalSideEffect === false)).toBe(true);
    expect(adapter.listTraces().every((trace) => trace.proposalRequired === true)).toBe(true);

    const report = buildProductionPlatformRunReport({
      reportId: "report-dry-run",
      adapterId: adapter.adapterId,
      recordedAt: "2026-04-25T10:00:03.000Z",
      traces: adapter.listTraces(),
    });

    expect(report.status).toBe("ok");
    expect(report.flags).toContain("dry-run-only");
    expect(report.summary.join("\n")).toContain("create_project=1");
    expect(report.summary.join("\n")).toContain("render_preview=1");
  });

  it("blocks operator-approved actions unless an operator approval id is present", async () => {
    const adapter = createMockProductionPlatformAdapter({
      now: () => "2026-04-25T10:05:00.000Z",
    });

    const blocked = await adapter.createProject(
      {
        title: "Approved write attempt",
      },
      {
        mode: "operator-approved",
      },
    );

    expect(blocked.status).toBe("blocked");
    expect(blocked.failure).toMatchObject({
      reason: "permission_denied",
      retryable: false,
    });
    expect(blocked.operatorApprovalRequired).toBe(true);

    const report = buildProductionPlatformRunReport({
      reportId: "report-permission-denied",
      adapterId: adapter.adapterId,
      recordedAt: "2026-04-25T10:05:01.000Z",
      traces: adapter.listTraces(),
    });

    expect(report.status).toBe("blocked");
    expect(report.flags).toContain("operator-approval-required");
    expect(report.nextActions[0]).toContain("operator approval");
  });

  it("retries a retryable preview failure and reports the recovered attempt", async () => {
    const adapter = createMockProductionPlatformAdapter({
      now: createClock([
        "2026-04-25T10:10:00.000Z",
        "2026-04-25T10:10:01.000Z",
        "2026-04-25T10:10:02.000Z",
        "2026-04-25T10:10:03.000Z",
      ]),
      failurePlan: {
        render_preview: [
          {
            reason: "provider_error",
            message: "Mock preview renderer is temporarily busy.",
            retryable: true,
          },
        ],
      },
    });

    const report = await runProductionPlatformVerticalSlice(adapter, {
      title: "Retryable preview",
      assets: [
        {
          assetName: "shot-list.json",
          artifactKind: "json",
          contentDigest: "sha256:shot-list",
        },
      ],
      previewProfile: "director-review",
      maxRetries: 1,
      reportId: "report-retry",
      recordedAt: "2026-04-25T10:10:04.000Z",
    });

    expect(report.status).toBe("ok");
    expect(report.flags).toContain("retry-recovered");
    expect(report.summary.join("\n")).toContain("retried render_preview after provider_error");
    expect(
      report.traces
        .filter((trace) => trace.action === "render_preview")
        .map((trace) => trace.status),
    ).toEqual(["failed", "dry_run"]);
  });
});

function createClock(values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1];
    index += 1;
    return value;
  };
}
