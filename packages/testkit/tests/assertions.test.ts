import { describe, expect, test } from "vitest";

import { assertEqual } from "../src/index.js";

describe("assertions helpers", () => {
  test("throws with a readable message when values differ", () => {
    expect(() => {
      assertEqual(1, 2);
    }).toThrow(/Expected 2, received 1/);
  });
});
