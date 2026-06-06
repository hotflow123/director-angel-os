import { afterEach, describe, expect, it, vi } from "vitest";

const startCliMock = vi.hoisted(() => vi.fn());

vi.mock("./shell.js", () => ({
  startCli: startCliMock,
}));

describe("director-angel bin entrypoint", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    startCliMock.mockReset();
    vi.resetModules();
  });

  it("wraps args as hotflow director commands", async () => {
    process.argv = ["node", "director-angel", "task", "events", "--task-id", "task-1"];

    await import("./director-angel-main.js");

    expect(startCliMock).toHaveBeenCalledWith([
      "director",
      "task",
      "events",
      "--task-id",
      "task-1",
    ]);
  });
});
