// window.rippleApp — what the dashboard can ask of the app it runs in, and nothing more: the
// connection state, and the recovery actions that work with the router dead (they run the CLI in
// the main process). In a plain browser the object does not exist and the dashboard behaves as it
// always has. The page runs sandboxed with context isolation.

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("rippleApp", {
  platform: process.platform,
  state: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:state"),
  onState: (callback: (state: unknown) => void): void => {
    ipcRenderer.on("ripple-app:state", (_event, state: unknown) => callback(state));
  },
  refresh: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:act", "refresh"),
  repair: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:act", "repair"),
  directOn: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:act", "direct-on"),
  directOff: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:act", "direct-off"),
  restartClaude: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:act", "restart-claude"),
  enableLoginItem: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:act", "login-item"),
  openLogs: (): Promise<unknown> => ipcRenderer.invoke("ripple-app:act", "logs"),
  recentLog: (): Promise<string[]> => ipcRenderer.invoke("ripple-app:log"),
});
