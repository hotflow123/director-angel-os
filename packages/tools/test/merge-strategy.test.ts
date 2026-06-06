import { describe, expect, it } from "vitest";

import { mergeToolResults } from "../src/index.js";

describe("mergeToolResults", () => {
  const results = [
    { toolCallId: "1", toolName: "a", ok: false, error: "nope" },
    { toolCallId: "2", toolName: "b", ok: true, output: 42 },
  ] as const;

  it("keeps ordered results", () => {
    expect(mergeToolResults("ordered", results)).toHaveLength(2);
  });

  it("returns the first successful result", () => {
    expect(mergeToolResults("first-wins", results)).toEqual([results[1]]);
  });

  it("drops partial results for all-or-nothing", () => {
    expect(mergeToolResults("all-or-nothing", results)).toEqual([]);
  });
});
