import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/** The only API the web app gets in the desktop build (typed in src/lib/desktop.ts). */

const EVENTS = new Set(["progress", "update", "watch-check"]);

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  loadSettings: (): Promise<unknown> => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: unknown): Promise<void> => ipcRenderer.invoke("settings:save", settings),
  appInfo: () => ipcRenderer.invoke("app:info"),
  notify: (title: string, body: string) => ipcRenderer.invoke("app:notify", title, body),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("backup:choose"),
  downloadFiles: (folder: string, jobs: unknown) => ipcRenderer.invoke("backup:download", folder, jobs),
  mediaStatus: () => ipcRenderer.invoke("media:status"),
  compressFile: (job: unknown) => ipcRenderer.invoke("media:compress", job),
  uploadFile: (tempId: string, uploadUrl: string) => ipcRenderer.invoke("media:upload", tempId, uploadUrl),
  discardFile: (tempId: string) => ipcRenderer.invoke("media:discard", tempId),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  on: (event: string, listener: (payload: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error(`Unbekanntes Ereignis: ${event}`);
    const handler = (_e: IpcRendererEvent, message: { event: string; payload: unknown }) => {
      if (message.event === event) listener(message.payload);
    };
    ipcRenderer.on("desktop:event", handler);
    return () => ipcRenderer.removeListener("desktop:event", handler);
  },
});
