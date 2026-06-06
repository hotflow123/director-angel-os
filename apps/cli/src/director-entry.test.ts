import { describe, expect, it } from "vitest";

import { renderDirectorEntryMessageResult } from "./director-entry.js";

describe("director entry CLI rendering", () => {
  it("falls back to a result-first storyboard when only run state is available", () => {
    const output = renderDirectorEntryMessageResult({
      intake: {
        session: {
          entrySessionId: "entry-1",
          state: "run_in_progress",
        },
        intake: {
          alignmentLock: {
            objective: "/制作 生成一个15秒短剧分镜蓝图，主题：小猫旅游记",
            notes: [],
          },
        },
      },
      status: {
        session: {
          entrySessionId: "entry-1",
        },
        run: {
          runId: "run-1",
          status: "running",
        },
        report: {
          reportId: "report-1",
          operatorSurface: {
            operatorSummary:
              "/制作 生成一个15秒短剧分镜蓝图，主题：小猫旅游记 needs operator review before execution handoff.",
          },
        },
      },
    });

    expect(output).toContain("分镜蓝图");
    expect(output).toContain("0-5s");
    expect(output).not.toContain("状态：");
    expect(output).not.toContain("还缺：");
    expect(output).not.toContain("Run");
  });

  it("keeps active-session supplements when building the result-first storyboard", () => {
    const output = renderDirectorEntryMessageResult({
      intake: {
        session: {
          entrySessionId: "entry-1",
          state: "run_in_progress",
        },
        intake: {
          alignmentLock: {
            objective: [
              "生成一个15秒短剧分镜蓝图，主题：小猫旅游记",
              "补充内容：小猫从家里走到公园，遇见朋友后回家",
              "执行意图：这是对上一条任务的确认或补充，不要把确认话术当作新的制作目标。",
            ].join("\n"),
            notes: [],
          },
        },
      },
    });

    expect(output).toContain("分镜蓝图");
    expect(output).toContain("小猫从家里走到公园，遇见朋友后回家");
    expect(output).not.toContain("执行意图");
    expect(output).not.toContain("状态：");
  });
});
