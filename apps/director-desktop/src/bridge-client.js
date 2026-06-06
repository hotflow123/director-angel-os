import { assertDesktopAction } from "./desktop-contract.js";

export function createDirectorAngelBridgeClient(options = {}) {
  if (options.mode !== "native") {
    throw new Error("Director desktop requires native bridge mode.");
  }

  const nativeBridge = globalThis.window?.directorAngel;
  if (!nativeBridge?.invoke) {
    throw new Error("Director desktop native bridge is unavailable.");
  }

  return {
    invoke(action) {
      assertDesktopAction(action);
      return nativeBridge.invoke(action);
    },
    uiState: {
      read() {
        return nativeBridge.uiState?.read?.() ?? Promise.resolve(null);
      },
      write(snapshot) {
        return nativeBridge.uiState?.write?.(snapshot) ?? Promise.resolve({ ok: false });
      },
    },
    onEvent(listener) {
      if (typeof nativeBridge.onEvent !== "function") {
        return () => {};
      }
      return nativeBridge.onEvent(listener);
    },
  };
}
