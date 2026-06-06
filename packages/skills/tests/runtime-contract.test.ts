import { describe, expect, test } from "vitest";

import { resolveSkillRuntimeContract } from "../src/index.js";

describe("resolveSkillRuntimeContract", () => {
  test("returns setup-on-load and fallback evidence when required tools are missing", () => {
    const result = resolveSkillRuntimeContract({
      skill: {
        id: "skill.twitter-research",
        version: "1.0.0",
        title: "Twitter Research",
        content: "Use live X/Twitter search before summarizing trends.",
        toolNames: ["x_search"],
        updatedAtMs: 100,
        metadata: {
          hermes: {
            requires_tools: ["x_search"],
            fallback_skill_ids: ["skill.public-web-research"],
            setup_on_load: {
              summary: "X/Twitter provider must be configured before live search.",
              next_actions: [
                "Configure an X/Twitter search provider or use the public web fallback.",
              ],
            },
          },
        },
      },
      availableTools: ["web_search"],
      availableToolsets: ["web"],
      operator: {
        surface: "desktop-local",
        scopes: ["skills.use"],
      },
      nowMs: 1000,
    });

    expect(result).toMatchObject({
      schemaId: "skills.runtime-contract.v1",
      skillId: "skill.twitter-research",
      loadable: false,
      status: "needs_setup",
      reasonCode: "missing_required_capability",
      guard: expect.objectContaining({
        allowed: true,
        status: "allowed",
      }),
      conditionalLoading: expect.objectContaining({
        matched: false,
        missingTools: ["x_search"],
      }),
      setupOnLoad: expect.objectContaining({
        required: true,
        summary: "X/Twitter provider must be configured before live search.",
        nextActions: ["Configure an X/Twitter search provider or use the public web fallback."],
      }),
      fallback: expect.objectContaining({
        recommended: true,
        skillIds: ["skill.public-web-research"],
      }),
    });
    expect(result.evidenceRefs).toEqual(
      expect.arrayContaining([
        "skill-runtime://skill.twitter-research/missing-tool/x_search",
        "skill-runtime://skill.twitter-research/fallback/skill.public-web-research",
      ]),
    );
  });

  test("blocks model loading when Skill guard excludes the current surface or scope", () => {
    const result = resolveSkillRuntimeContract({
      skill: {
        id: "skill.operator-local",
        version: "1.0.0",
        title: "Operator Local",
        content: "Local-only Skill that can touch privileged operator workflows.",
        updatedAtMs: 100,
        metadata: {
          guard: {
            allowed_surfaces: ["desktop-local"],
            required_scopes: ["skills.operator.local"],
          },
        },
      },
      operator: {
        surface: "weixin",
        scopes: ["skills.use"],
      },
      nowMs: 1100,
    });

    expect(result).toMatchObject({
      loadable: false,
      status: "blocked",
      reasonCode: "guard_blocked",
      guard: {
        allowed: false,
        status: "blocked",
        reasonCode: "surface_not_allowed",
        missingScopes: ["skills.operator.local"],
      },
    });
    expect(result.evidenceRefs).toEqual(
      expect.arrayContaining([
        "skill-runtime://skill.operator-local/guard/surface-not-allowed",
        "skill-runtime://skill.operator-local/guard/missing-scope/skills.operator.local",
      ]),
    );
  });

  test("allows conditional loading once required capabilities and guard scopes are present", () => {
    const result = resolveSkillRuntimeContract({
      skill: {
        id: "skill.browser-research",
        version: "1.0.0",
        title: "Browser Research",
        content: "Use browser snapshot before extracting evidence.",
        updatedAtMs: 100,
        metadata: {
          hermes: {
            requires_tools: ["browser_snapshot"],
            requires_toolsets: ["browser"],
          },
          guard: {
            allowed_surfaces: ["desktop-local", "host-api"],
            required_scopes: ["skills.use"],
          },
        },
      },
      availableTools: ["browser_snapshot"],
      availableToolsets: ["browser"],
      operator: {
        surface: "host-api",
        scopes: ["skills.use"],
      },
      nowMs: 1200,
    });

    expect(result).toMatchObject({
      loadable: true,
      status: "allowed",
      reasonCode: "runtime_contract_admitted",
      conditionalLoading: expect.objectContaining({
        matched: true,
        missingTools: [],
        missingToolsets: [],
      }),
      guard: expect.objectContaining({
        allowed: true,
        status: "allowed",
      }),
    });
  });
});
