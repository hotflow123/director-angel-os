import { assertDesktopAction } from "./desktop-contract.js";

export function installDirectorAngelPreloadBridge({ contextBridge, bridge }) {
  if (!contextBridge?.exposeInMainWorld) {
    throw new Error("Director Angel preload bridge requires contextBridge.exposeInMainWorld.");
  }
  if (!bridge?.invoke) {
    throw new Error("Director Angel preload bridge requires an invoke-capable bridge.");
  }

  contextBridge.exposeInMainWorld("directorAngel", {
    invoke(action) {
      assertDesktopAction(action);
      return bridge.invoke(action);
    },
    liveAudio: {
      start(input = {}) {
        return bridge.invoke({
          ...input,
          type: "liveAudio.start",
        });
      },
      stop(input = {}) {
        return bridge.invoke({
          ...input,
          type: "liveAudio.stop",
        });
      },
      cancel(input = {}) {
        return bridge.invoke({
          ...input,
          type: "liveAudio.cancel",
        });
      },
      status(input = {}) {
        return bridge.invoke({
          ...input,
          type: "liveAudio.status",
        });
      },
    },
    uiState: {
      read() {
        return bridge.uiState?.read?.() ?? null;
      },
      write(snapshot) {
        return bridge.uiState?.write?.(snapshot) ?? { ok: false };
      },
    },
  });
}
