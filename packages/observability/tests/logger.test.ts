import { describe, expect, test } from "vitest";

import { type LogRecord, createLogger } from "../src/index.js";

describe("createLogger", () => {
  test("writes log records with merged child fields", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sink: (record) => {
        records.push(record);
      },
      fields: { service: "agent" },
      now: () => 42,
    });

    const child = logger.child({ runId: "run_1" });
    child.info("hello", { step: "boot" });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: 42,
      level: "info",
      message: "hello",
      fields: {
        service: "agent",
        runId: "run_1",
        step: "boot",
      },
    });
  });
});
