const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("directorAngel", {
  invoke(action) {
    return ipcRenderer.invoke("director-angel:invoke", action);
  },
  liveAudio: {
    start(input = {}) {
      return ipcRenderer.invoke("director-angel:invoke", {
        ...input,
        type: "liveAudio.start",
      });
    },
    stop(input = {}) {
      return ipcRenderer.invoke("director-angel:invoke", {
        ...input,
        type: "liveAudio.stop",
      });
    },
    cancel(input = {}) {
      return ipcRenderer.invoke("director-angel:invoke", {
        ...input,
        type: "liveAudio.cancel",
      });
    },
    status(input = {}) {
      return ipcRenderer.invoke("director-angel:invoke", {
        ...input,
        type: "liveAudio.status",
      });
    },
  },
  uiState: {
    read() {
      return ipcRenderer.invoke("director-angel:uiState:read");
    },
    write(snapshot) {
      return ipcRenderer.invoke("director-angel:uiState:write", snapshot);
    },
  },
  onEvent(listener) {
    const handler = (_event, payload) => {
      listener(payload);
    };
    ipcRenderer.on("director-angel:event", handler);
    return () => {
      ipcRenderer.removeListener("director-angel:event", handler);
    };
  },
});
