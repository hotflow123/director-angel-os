import { describe, expect, it } from "vitest";

import { readDesktopCatalogViaHostApi } from "./desktop-host-api-client.js";

function restoreEnvValue(name, previous) {
  if (previous === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = previous;
}

describe("desktop Host API client", () => {
  it("attaches the configured Host API bearer token to requests", async () => {
    const previous = process.env.DIRECTOR_HOST_API_BEARER_TOKEN;
    process.env.DIRECTOR_HOST_API_BEARER_TOKEN = "desktop-token";
    const calls = [];
    const fetchFn = async (url, init = {}) => {
      calls.push({ url, headers: init.headers });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ resources: [] });
        },
      };
    };

    try {
      await readDesktopCatalogViaHostApi({
        hostApiUrl: "http://127.0.0.1:3201",
        fetchFn,
      });
    } finally {
      restoreEnvValue("DIRECTOR_HOST_API_BEARER_TOKEN", previous);
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer desktop-token",
    });
  });
});
