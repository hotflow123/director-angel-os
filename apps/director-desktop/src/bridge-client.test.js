import { afterEach, describe, expect, it, vi } from "vitest";

import { createDirectorAngelBridgeClient } from "./bridge-client.js";
import { DESKTOP_ACTIONS } from "./desktop-contract.js";

describe("director desktop bridge client", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("fails closed unless native bridge mode is available", () => {
    globalThis.window = undefined;

    expect(() => createDirectorAngelBridgeClient()).toThrow(/native bridge mode/i);
    expect(() => createDirectorAngelBridgeClient({ mode: "mock" })).toThrow(/native bridge mode/i);
    expect(() => createDirectorAngelBridgeClient({ mode: "native" })).toThrow(/native bridge/i);
  });

  it("delegates typed actions and UI state persistence to the native bridge", async () => {
    const invoke = vi.fn(async (action) => ({
      actionType: action.type,
      events: [],
    }));
    const uiState = {
      read: vi.fn(async () => ({ schemaVersion: "director.desktop.ui-state.v1" })),
      write: vi.fn(async (snapshot) => ({ ok: true, snapshot })),
    };
    const off = vi.fn();
    const onEvent = vi.fn(() => off);
    globalThis.window = { directorAngel: { invoke, onEvent, uiState } };

    const bridge = createDirectorAngelBridgeClient({ mode: "native" });
    await expect(bridge.invoke({ type: DESKTOP_ACTIONS.COMMAND_CATALOG })).resolves.toEqual({
      actionType: DESKTOP_ACTIONS.COMMAND_CATALOG,
      events: [],
    });
    await expect(bridge.uiState.read()).resolves.toEqual({
      schemaVersion: "director.desktop.ui-state.v1",
    });
    await expect(bridge.uiState.write({ draft: "x" })).resolves.toEqual({
      ok: true,
      snapshot: { draft: "x" },
    });
    const listener = vi.fn();
    expect(bridge.onEvent(listener)).toBe(off);

    expect(invoke).toHaveBeenCalledWith({ type: DESKTOP_ACTIONS.COMMAND_CATALOG });
    expect(uiState.read).toHaveBeenCalled();
    expect(uiState.write).toHaveBeenCalledWith({ draft: "x" });
    expect(onEvent).toHaveBeenCalledWith(listener);
  });
});
