import { describe, expect, it } from "vitest";

import {
  createMediaAuthorizationControls,
  formatEvidenceDisclosureLines,
  resolveMediaAuthorizationActionPayload,
} from "./evidence.js";

function createFakeElement(tagName = "div") {
  const element = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    dataset: {},
    textContent: "",
    className: "",
    type: "",
    ownerDocument: null,
    setAttribute(name, value) {
      this.dataset[name] = String(value);
    },
    addEventListener() {},
    append(...children) {
      this.children.push(...children);
      this.textContent = this.children.map((child) => child.textContent).join("");
    },
  };
  element.ownerDocument = {
    createElement(nextTagName) {
      const child = createFakeElement(nextTagName);
      child.ownerDocument = element.ownerDocument;
      return child;
    },
  };
  return element;
}

function installFakeDocument() {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      return createFakeElement(tagName);
    },
  };
  return () => {
    globalThis.document = previous;
  };
}

describe("evidence media authorization budget visibility", () => {
  it("projects the tool ledger evidence id from disclosure content refs", () => {
    const lines = formatEvidenceDisclosureLines({
      sources: [
        {
          url: "https://example.test/shot-guide",
          fullBodyChars: 2048,
          mediaCount: 0,
          readStatus: "read",
          contentRef: {
            kind: "tool-ledger",
            evidenceId: "tool-evidence-shot-guide",
            relativePath: "tool-results/tool-evidence-shot-guide.json",
          },
        },
      ],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("证据：tool-evidence-shot-guide");
  });

  it("renders token and asset budgets directly on media authorization buttons", () => {
    const restoreDocument = installFakeDocument();
    try {
      const controls = createMediaAuthorizationControls({
        sources: [
          {
            mediaCount: 3,
            mediaAdmission: {
              requiredNextAction: "request_user_authorization",
              budget: {
                fileCountLimit: 2,
                tokenLimit: 21000,
              },
            },
            mediaAuthorization: {
              recommendedMode: "low_cost",
              estimatedTokenBudget: {
                lowCost: 12000,
                deepMultimodal: 21000,
              },
            },
          },
        ],
      });

      const buttons = controls.children.filter((child) => child.tagName === "BUTTON");

      expect(buttons.map((button) => button.dataset.mediaAuthorizationMode)).toEqual([
        "media_inventory",
        "low_cost",
        "deep_multimodal",
      ]);
      expect(buttons[0].textContent).toContain("0 tokens");
      expect(buttons[1].textContent).toContain("12,000 tokens");
      expect(buttons[1].textContent).toContain("最多 2 个媒体");
      expect(buttons[2].textContent).toContain("21,000 tokens");
      expect(buttons[1].dataset.tokenBudget).toBe("12000");
      expect(buttons[1].dataset.maxAssets).toBe("2");
    } finally {
      restoreDocument();
    }
  });

  it("keeps authorization payload budgets aligned with the visible mode budgets", () => {
    const source = {
      mediaCount: 3,
      mediaAdmission: {
        budget: {
          fileCountLimit: 2,
          tokenLimit: 21000,
        },
      },
      mediaAuthorization: {
        estimatedTokenBudget: {
          lowCost: 12000,
          deepMultimodal: 21000,
        },
      },
    };

    expect(resolveMediaAuthorizationActionPayload(source, "media_inventory")).toMatchObject({
      tokenBudget: 0,
      maxAssets: 2,
      userAuthorized: false,
    });
    expect(resolveMediaAuthorizationActionPayload(source, "low_cost")).toMatchObject({
      tokenBudget: 12000,
      maxAssets: 2,
      userAuthorized: true,
    });
    expect(resolveMediaAuthorizationActionPayload(source, "deep_multimodal")).toMatchObject({
      tokenBudget: 21000,
      maxAssets: 2,
      userAuthorized: true,
    });
  });
});
