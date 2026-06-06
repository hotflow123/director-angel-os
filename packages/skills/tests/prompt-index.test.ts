import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { SkillPromptIndex } from "../src/prompt-index.js";
import { InMemorySkillRepository } from "../src/repository.js";
import { SkillUsageStore, resolveSkillUsagePath } from "../src/usage.js";

describe("SkillPromptIndex", () => {
  test("selects matching approved skills and renders skill prompt sections", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "readme-summary",
        version: "1.0.0",
        title: "Summarize README files",
        description: "Use this when the user asks for a repository summary.",
        content: "Read the target file first, summarize the purpose, then keep the answer concise.",
        tags: ["readme", "summary", "repository"],
        toolNames: ["filesystem.read_text"],
        updatedAtMs: 100,
      },
      {
        id: "todo-maintenance",
        version: "1.0.0",
        title: "Maintain todo state",
        content: "Persist a short todo list when the user asks for next steps.",
        tags: ["todo"],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      limit: 1,
      userText: "Read the README and summarize the repository.",
      toolResults: [{ toolName: "filesystem.read_text", ok: true }],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("skill.readme-summary");
    expect(sections[0]?.owner).toBe("skill");
    expect(sections[0]?.content).toContain("Summarize README files");
    expect(sections[0]?.metadata?.matchScore).toEqual(expect.any(Number));
  });

  test("skips approved skills disabled by the management layer", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "readme-summary",
        version: "1.0.0",
        title: "Summarize README files",
        content: "Read the target README and summarize the repository.",
        tags: ["readme", "summary"],
        updatedAtMs: 100,
      },
      {
        id: "todo-maintenance",
        version: "1.0.0",
        title: "Maintain todo state",
        content: "Persist a short todo list when the user asks for next steps.",
        tags: ["todo"],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository, {
      isSkillEnabled: (skill) => skill.id !== "readme-summary",
    });
    const sections = index.buildSections({
      limit: 2,
      userText: "README repository",
    });

    expect(sections).toEqual([]);
  });

  test("matches Chinese production and learning prompts against imported English skills", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "external.openclaw.extensions.feishu.skills.feishu-doc",
        version: "1.0.0",
        title: "Feishu Document Tool",
        content: "Read Feishu doc and list blocks with tables and images.",
        tags: ["feishu", "doc", "web-learning"],
        toolNames: ["feishu_doc"],
        updatedAtMs: 100,
      },
      {
        id: "external.hermes-agent.skills.creative.creative-ideation",
        version: "1.0.0",
        title: "Creative Ideation",
        content: "Generate story and video project ideas through constraints.",
        tags: ["creative", "ideation", "video"],
        updatedAtMs: 101,
      },
      {
        id: "external.hermes-agent.skills.software-development.subagent-driven-development",
        version: "1.0.0",
        title: "Subagent-Driven Development",
        content: "Dispatch subagents for implementation workflow and review.",
        tags: ["subagent", "workflow", "development"],
        updatedAtMs: 102,
      },
      {
        id: "external.hermes-agent.skills.creative.comfyui",
        version: "5.0.0",
        title: "ComfyUI",
        content: "Run ComfyUI workflows with REST API and workflow parameter injection.",
        tags: ["comfyui", "image-generation", "video-generation", "stable-diffusion", "flux"],
        updatedAtMs: 103,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    expect(
      index.buildSections({ userText: "去学习这个飞书文档，抓取表格和图片", limit: 1 })[0]?.metadata
        .skillId,
    ).toBe("external.openclaw.extensions.feishu.skills.feishu-doc");
    expect(
      index.buildSections({ userText: "生成一个15秒短剧分镜", limit: 1 })[0]?.metadata.skillId,
    ).toBe("external.hermes-agent.skills.creative.creative-ideation");
    expect(
      index.buildSections({ userText: "启动多智能体协作开发", limit: 1 })[0]?.metadata.skillId,
    ).toBe("external.hermes-agent.skills.software-development.subagent-driven-development");
    expect(
      index.buildSections({ userText: "用 ComfyUI 生成图片", limit: 1 })[0]?.metadata.skillId,
    ).toBe("external.hermes-agent.skills.creative.comfyui");
  });

  test("keeps exact Moyin script import skills above long generic production skills", () => {
    const repeatedGenericContent = Array.from(
      { length: 80 },
      () => "creative video story production workflow",
    ).join(" ");
    const repository = new InMemorySkillRepository([
      {
        id: "external.long-generic-production",
        version: "1.0.0",
        title: "Long Generic Production",
        content: repeatedGenericContent,
        tags: ["creative", "production", "video"],
        updatedAtMs: 100,
      },
      {
        id: "skill.moyin-script-import-sclass-first-gate",
        version: "1.0.0",
        title: "Moyin 剧本导入 S-Class 第一关",
        content:
          "Use Moyin provider to import scripts, run S-Class first gate, and verify real project store results.",
        tags: ["moyin", "script-import", "s-class", "first-gate", "external-tool", "workflow-run"],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      userText: "在魔因 Moyin 里导入剧本，后续走 S 级流程，先不要生成图片视频",
      limit: 1,
    });

    expect(sections[0]?.metadata.skillId).toBe("skill.moyin-script-import-sclass-first-gate");
  });

  test("recalls Moyin script workflow gate before media generation", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "external.generic-image-video",
        version: "1.0.0",
        title: "Generic Image Video",
        content: "Generate image video media workflow assets.",
        tags: ["image", "video", "workflow", "media"],
        updatedAtMs: 100,
      },
      {
        id: "skill.moyin-script-import-sclass-first-gate",
        version: "1.1.0",
        title: "Moyin 剧本导入 S-Class 第一关",
        content:
          "Moyin project store first. Create or select a Moyin project, import or generate script, run S-Class first gate, verify script.json and sclass.json, and do not generate images or videos before the script workflow passes.",
        tags: [
          "moyin",
          "script-import",
          "script-workflow-gate",
          "s-class",
          "project-store",
          "no-premature-media",
        ],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      userText: "先让 Moyin 创建项目并导入剧本，整个工作流过了再说图片，不能直接生成视频",
      limit: 1,
    });

    expect(sections[0]?.metadata.skillId).toBe("skill.moyin-script-import-sclass-first-gate");
  });

  test("recalls Moyin script generation and import gate before image or video work", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "external.generic-video-workflow",
        version: "1.0.0",
        title: "Generic Video Workflow",
        content: "Generate images and videos from story ideas.",
        tags: ["image", "video", "workflow", "media"],
        updatedAtMs: 100,
      },
      {
        id: "skill.moyin-script-import-sclass-first-gate",
        version: "1.2.0",
        title: "Moyin 剧本导入 S-Class 第一关",
        content:
          "When Moyin generates or imports scripts, verify the real Moyin project store, script.json, sclass.json, and S-Class workflow before any image, grid, video, ComfyUI export, or handoff package.",
        tags: [
          "moyin",
          "script-generate",
          "script-import",
          "script-workflow-gate",
          "s-class",
          "project-store",
          "no-premature-media",
        ],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      userText: "Moyin 里面先生成一个剧本或导入剧本，整个工作流都没有通过前不要碰图片和视频",
      limit: 1,
    });

    expect(sections[0]?.metadata.skillId).toBe("skill.moyin-script-import-sclass-first-gate");
  });

  test("recalls Moyin S-Class nine-grid reference gate after the script workflow passes", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "external.generic-image-generation",
        version: "1.0.0",
        title: "Generic Image Generation",
        content: "Generate image assets from prompts.",
        tags: ["image", "media", "generation"],
        updatedAtMs: 100,
      },
      {
        id: "skill.moyin-script-import-sclass-first-gate",
        version: "1.3.0",
        title: "Moyin 剧本导入 S-Class 第一关",
        content:
          "After script import or generation has passed Moyin S-Class, run the S-Class nine-grid gate: switch group generation to nine-grid, generate composition boardSlotHints, build a sealed request for sclass.group-grid-image, execute only after approval, backfill the Moyin artifact registry, and do not generate video.",
        tags: [
          "moyin",
          "script-workflow-gate",
          "s-class",
          "sclass-nine-grid",
          "composition-plan",
          "grid-image",
          "reference-image",
          "no-video",
        ],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      userText:
        "Moyin 剧本已经导入 S 级，继续分组生成九宫格分组更连贯，生成构图方案和九宫格参考图，不要视频",
      limit: 1,
    });

    expect(sections[0]?.metadata.skillId).toBe("skill.moyin-script-import-sclass-first-gate");
  });

  test("recalls Moyin S-Class nine-grid reference gate from Chinese shorthand", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "external.generic-image-generation",
        version: "1.0.0",
        title: "Generic Image Generation",
        content: "Generate image assets from prompts.",
        tags: ["image", "media", "generation"],
        updatedAtMs: 100,
      },
      {
        id: "skill.moyin-script-import-sclass-first-gate",
        version: "1.3.0",
        title: "Moyin 剧本导入 S-Class 第一关",
        content:
          "Run the S-Class nine-grid gate after script workflow verification: composition boardSlotHints, approved sclass.group-grid-image, artifact backfill, and no video.",
        tags: [
          "moyin",
          "sclass-nine-grid",
          "composition-plan",
          "grid-image",
          "reference-image",
          "no-video",
        ],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      userText: "继续九宫格分组，生成构图方案和九宫格参考图，但不要视频",
      limit: 1,
    });

    expect(sections[0]?.metadata.skillId).toBe("skill.moyin-script-import-sclass-first-gate");
  });

  test("recalls Moyin S-Class existing nine-grid review gate without regenerating media", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "external.generic-image-review",
        version: "1.0.0",
        title: "Generic Image Review",
        content: "Review generated image assets.",
        tags: ["image", "review", "media"],
        updatedAtMs: 100,
      },
      {
        id: "skill.moyin-script-import-sclass-first-gate",
        version: "1.4.0",
        title: "Moyin 剧本导入 S-Class 第一关",
        content:
          "When Moyin already has a nine-grid reference image, reuse the existing groupGridAsset, run sclass.group-grid-review through a real Moyin workflow-run, require boardReviewStatus passed or warning, and do not regenerate the image or generate video.",
        tags: [
          "moyin",
          "sclass-nine-grid",
          "grid-review",
          "board-review",
          "reuse-existing-grid",
          "no-video",
        ],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      userText: "Moyin 九宫格参考图已经有了，帮我复核九宫格图，不要重新生成图片，也不要视频",
      limit: 1,
    });

    expect(sections[0]?.metadata.skillId).toBe("skill.moyin-script-import-sclass-first-gate");
  });

  test("recalls Moyin S-Class image-only review gate from Chinese follow-up", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "external.generic-video-workflow",
        version: "1.0.0",
        title: "Generic Video Workflow",
        content: "Generate a video from image assets.",
        tags: ["video", "image", "workflow"],
        updatedAtMs: 100,
      },
      {
        id: "skill.moyin-script-import-sclass-first-gate",
        version: "1.4.0",
        title: "Moyin 剧本导入 S-Class 第一关",
        content:
          "Moyin S-Class existing nine-grid review gate: only run group-grid-review, source local-image:// from Moyin first, accept nine-grid padded cells as warning/pass, require videoArtifactCount=0.",
        tags: [
          "moyin",
          "sclass-nine-grid",
          "grid-review",
          "board-review",
          "reuse-existing-grid",
          "no-video",
        ],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({
      userText: "图片过了没？Moyin 只跑复核，不要重新生成图，更不要生成视频",
      limit: 1,
    });

    expect(sections[0]?.metadata.skillId).toBe("skill.moyin-script-import-sclass-first-gate");
  });

  test("honors minimum score thresholds before surfacing skills", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "loose-match",
        version: "1.0.0",
        title: "Loose Match",
        content: "A generic workflow mention.",
        tags: ["workflow"],
        updatedAtMs: 100,
      },
    ]);

    const index = new SkillPromptIndex(repository, { minScore: 10 });

    expect(index.buildSections({ userText: "workflow", limit: 1 })).toEqual([]);
  });

  test("does not surface skills marked disableModelInvocation to the model index", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "operator-only",
        version: "1.0.0",
        title: "Operator Only Browser Skill",
        content: "Use browser automation for privileged operator workflows.",
        tags: ["browser", "operator"],
        metadata: {
          disableModelInvocation: true,
        },
        updatedAtMs: 100,
      },
      {
        id: "model-visible-browser",
        version: "1.0.0",
        title: "Model Visible Browser Skill",
        content: "Use browser search for public research.",
        tags: ["browser", "research"],
        updatedAtMs: 101,
      },
    ]);

    const index = new SkillPromptIndex(repository);
    const sections = index.buildSections({ userText: "browser research", limit: 2 });

    expect(sections.map((section) => section.metadata?.skillId)).toEqual(["model-visible-browser"]);
  });

  test("honors Hermes requires_tools and requires_toolsets conditions", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "browser-research",
        version: "1.0.0",
        title: "Browser Research",
        content: "Use browser automation to inspect pages and extract evidence.",
        tags: ["browser", "research"],
        metadata: {
          hermes: {
            requires_tools: ["browser_snapshot"],
            requires_toolsets: ["browser"],
          },
        },
        updatedAtMs: 100,
      },
    ]);

    const index = new SkillPromptIndex(repository);

    expect(
      index.buildSections({
        availableTools: ["browser_snapshot"],
        availableToolsets: ["browser"],
        limit: 1,
        userText: "browser research",
      })[0]?.metadata?.skillId,
    ).toBe("browser-research");
    expect(
      index.buildSections({
        availableTools: ["web_search"],
        availableToolsets: ["web"],
        limit: 1,
        userText: "browser research",
      }),
    ).toEqual([]);
  });

  test("honors Hermes fallback_for_tools and fallback_for_toolsets conditions", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "duckduckgo-fallback",
        version: "1.0.0",
        title: "DuckDuckGo Fallback",
        content: "Use DuckDuckGo scraping when premium web search is not configured.",
        tags: ["web", "search", "duckduckgo"],
        metadata: {
          hermes: {
            fallback_for_tools: ["web_search"],
            fallback_for_toolsets: ["web"],
          },
        },
        updatedAtMs: 100,
      },
    ]);

    const index = new SkillPromptIndex(repository);

    expect(
      index.buildSections({
        availableTools: [],
        availableToolsets: [],
        limit: 1,
        userText: "web search duckduckgo",
      })[0]?.metadata?.skillId,
    ).toBe("duckduckgo-fallback");
    expect(
      index.buildSections({
        availableTools: ["web_search"],
        availableToolsets: ["web"],
        limit: 1,
        userText: "web search duckduckgo",
      }),
    ).toEqual([]);
  });

  test("keeps Hermes conditional skills visible when capability inventory is unknown", () => {
    const repository = new InMemorySkillRepository([
      {
        id: "terminal-only",
        version: "1.0.0",
        title: "Terminal Only",
        content: "Use terminal commands for local diagnostics.",
        tags: ["terminal"],
        metadata: {
          hermes: {
            requires_toolsets: ["terminal"],
          },
        },
        updatedAtMs: 100,
      },
    ]);

    const index = new SkillPromptIndex(repository);

    expect(index.buildSections({ limit: 1, userText: "terminal diagnostics" })).toHaveLength(1);
  });

  test("records use only for skills injected into prompt context", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "hotflow-skill-prompt-usage-"));
    try {
      const usageStore = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
        now: () => 123,
      });
      const repository = new InMemorySkillRepository([
        {
          id: "readme-summary",
          version: "1.0.0",
          title: "Summarize README files",
          content: "Read README.md and summarize it.",
          tags: ["readme"],
          updatedAtMs: 100,
        },
        {
          id: "todo-maintenance",
          version: "1.0.0",
          title: "Maintain todos",
          content: "Maintain a todo list.",
          tags: ["todo"],
          updatedAtMs: 101,
        },
      ]);

      const index = new SkillPromptIndex(repository, {
        usageStore,
        usageActor: "test-runtime",
      });

      index.buildSections({ userText: "readme", limit: 1 });

      expect(usageStore.readRecord("readme-summary")?.useCount).toBe(1);
      expect(usageStore.readRecord("todo-maintenance")).toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
