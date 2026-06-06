import { describe, expect, test } from "vitest";

import { FakeModel } from "../src/index.js";

describe("FakeModel", () => {
  test("returns queued responses and records requests", async () => {
    const model = new FakeModel({
      responders: [{ output: "first" }, { output: "second" }],
      fallback: { output: "fallback" },
    });

    const request = {
      input: "hello",
      memory: [],
      session: { id: "s1", turn: 0, state: {} },
    } as const;

    await expect(model.complete(request)).resolves.toMatchObject({ output: "first" });
    await expect(model.complete(request)).resolves.toMatchObject({ output: "second" });
    await expect(model.complete(request)).resolves.toMatchObject({ output: "fallback" });
    expect(model.requests).toHaveLength(3);
  });
});
