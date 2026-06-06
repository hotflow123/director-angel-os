import { describe, expect, it } from "vitest";

import { listConversationRuntimeSourceProviderMatrix } from "../src/source-capabilities.js";

describe("conversation runtime source provider matrix", () => {
  it("projects web, browser, X, and OpenCLI providers into one ordered matrix", () => {
    const matrix = listConversationRuntimeSourceProviderMatrix({
      tools: [
        {
          name: "web_extract",
          description: "Extract public web pages.",
          readOnly: true,
          metadata: { capability: "web.extract", externalProviderStatus: "ready" },
        },
        {
          name: "browser_navigate",
          description: "Open a shared browser page.",
          readOnly: true,
          metadata: { capability: "browser.navigate", externalProviderStatus: "ready" },
        },
        {
          name: "web_search",
          description: "Search public web pages.",
          readOnly: true,
          metadata: { capability: "web.search", externalProviderStatus: "ready" },
        },
        {
          name: "x_search",
          description: "Search X/Twitter.",
          readOnly: true,
          metadata: { capability: "x.search", externalProviderStatus: "needs-auth" },
        },
      ],
    });

    expect(matrix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCapabilityId: "source.explicit-url.extract",
          role: "primary",
          provider: "public-web-extract",
          toolName: "web_extract",
          toolCapability: "web.extract",
          status: "ready",
          health: "ready",
        }),
        expect.objectContaining({
          sourceCapabilityId: "source.explicit-url.extract",
          role: "fallback",
          provider: "desktop-browser",
          toolName: "browser_navigate",
          fallbackForSourceCapabilityId: "source.explicit-url.extract",
          status: "ready",
        }),
        expect.objectContaining({
          sourceCapabilityId: "social.x-twitter.search",
          role: "primary",
          provider: "x-twitter",
          toolName: "x_search",
          status: "unavailable",
          health: "needs-auth",
        }),
        expect.objectContaining({
          sourceCapabilityId: "social.x-twitter.search",
          role: "fallback",
          provider: "auto",
          toolName: "web_search",
          fallbackForSourceCapabilityId: "social.x-twitter.search",
          status: "ready",
        }),
        expect.objectContaining({
          sourceCapabilityId: "source.explicit-url.opencli-twitter-thread",
          provider: "opencli",
          toolName: "director.opencli.invoke",
          status: "absent",
        }),
      ]),
    );
  });
});
