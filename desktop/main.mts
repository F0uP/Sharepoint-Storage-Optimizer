import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  shell,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from "electron";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Background } from "./background.mjs";
import { downloadAll, downloadTo, resolveInside, uniquePath, type DownloadJob } from "./backup.mjs";
import { compressImage, compressVideo, findFfmpeg, loadSharp, uploadToSession, type Quality } from "./media.mjs";
import { readSettings, writeSettings } from "./settings-store.mjs";
import { Updates } from "./updater.mjs";

/**
 * Desktop shell: runs the bundled Next.js server (standalone output) in a utility process on
 * localhost and shows it in a window. The web app stays identical to the browser/Docker version;
 * desktop-only features (backup, compression, background checks, updates) live here.
 */

const APP_ID = "app.storage-optimizer.desktop";

/**
 * Fixed port = stable origin, so the redirect URI registered in Entra ID stays valid and the
 * sign-in and scan cache in browser storage survive restarts. Falls back to a free port.
 */
const PREFERRED_PORT = 41731;
const SMOKE_TEST = process.argv.includes("--smoke-test");
const DEV_URL = app.isPackaged ? undefined : process.env.DESKTOP_DEV_URL;
/** Started at login → stay in the tray (evaluated after "ready"). */
const startHidden = () =>
  process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);

const LOGIN_HOSTS = new Set([
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "login.microsoftonline.us",
  "login.partner.microsoftonline.cn",
]);

if (!app.isPackaged && process.env.DESKTOP_USER_DATA) app.setPath("userData", process.env.DESKTOP_USER_DATA);

let mainWindow: BrowserWindow | null = null;
let server: UtilityProcess | null = null;
let appOrigin = "";
let quitting = false;

/** Folders the user picked in a dialog – the renderer may only write into these. */
const approvedFolders = new Set<string>();
/** Compressed files waiting for upload (tempId → temp directory). */
const pendingMedia = new Map<string, { dir: string; output: string }>();

function isAppUrl(url: string): boolean {
  try {
    return appOrigin !== "" && new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function isLoginUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && LOGIN_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/** Links (SharePoint files, Entra portal, provider docs) open in the default browser. */
function openExternal(url: string) {
  try {
    if (["https:", "http:", "mailto:"].includes(new URL(url).protocol)) void shell.openExternal(url);
  } catch {
    // ignore malformed URLs
  }
}

function send(event: string, payload: unknown) {
  mainWindow?.webContents.send("desktop:event", { event, payload });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const background = new Background(
  () => mainWindow,
  showWindow,
  () => app.quit(),
  () => send("watch-check", null),
);
const updates = new Updates((status) => send("update", status));

/* ------------------------------------------------------------------ server */

function probePort(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.listen(port, "127.0.0.1", () => {
      const address = probe.address();
      const actual = typeof address === "object" && address ? address.port : null;
      probe.close(() => resolve(actual));
    });
  });
}

async function choosePort(): Promise<number> {
  return (await probePort(PREFERRED_PORT)) ?? (await probePort(0)) ?? PREFERRED_PORT;
}

function serverDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(app.getAppPath(), "..", "server");
}

async function waitForServer(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await delay(150);
  }
  throw new Error("Der lokale Server hat nicht rechtzeitig geantwortet.");
}

async function startServer(port: number): Promise<string> {
  const dir = serverDir();
  const child = utilityProcess.fork(path.join(dir, "server.js"), [], {
    cwd: dir,
    serviceName: "SharePoint Storage Optimizer Server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
  });
  server = child;

  const output: string[] = [];
  const collect = (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.length > 40) output.shift();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const exited = new Promise<never>((_, reject) =>
    child.once("exit", (code) => reject(new Error(`Der lokale Server wurde beendet (Code ${code}).\n\n${output.join("").slice(-1500)}`))),
  );
  exited.catch(() => {});
  // generous: the very first start after installing can be slow while antivirus scans the new files
  await Promise.race([waitForServer(`http://127.0.0.1:${port}/api/config`, 120_000), exited]);

  child.on("exit", (code) => {
    fail(new Error(`Der lokale Server wurde unerwartet beendet (Code ${code}).`), "SharePoint Storage Optimizer wurde beendet");
  });
  return `http://localhost:${port}`;
}

/* ------------------------------------------------------------------ window */

function hardenSession() {
  // Only clipboard writes (copy redirect URI); no camera, notifications, geolocation, …
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === "clipboard-sanitized-write"),
  );
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "Datei speichern",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
  });
}

function buildMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      {
        label: "Darstellung",
        submenu: [
          { role: "reload", label: "Neu laden" },
          { type: "separator" },
          { role: "resetZoom", label: "Originalgröße" },
          { role: "zoomIn", label: "Vergrößern" },
          { role: "zoomOut", label: "Verkleinern" },
          { type: "separator" },
          { role: "togglefullscreen", label: "Vollbild" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: app.getName(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => {
    if (!startHidden() || SMOKE_TEST) win.show();
  });

  // MSAL sign-in popups stay inside the app, every other link goes to the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || isLoginUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 700,
          autoHideMenuBar: true,
          minimizable: false,
          backgroundColor: "#ffffff",
          title: "Microsoft-Anmeldung",
        },
      };
    }
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (popup) => {
    popup.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  if (!app.isPackaged) {
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "F12") win.webContents.toggleDevTools();
    });
  }
  win.on("close", (event) => {
    if (!quitting) background.handleClose(event);
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  return win;
}

/* --------------------------------------------------------------------- IPC */

/** Only the app page in the main window may call the bridge – never login popups or other content. */
function assertTrusted(event: IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || !isAppUrl(event.senderFrame?.url ?? "")) {
    throw new Error("Zugriff verweigert.");
  }
}

function handle<Args extends unknown[], Result>(channel: string, fn: (...args: Args) => Result | Promise<Result>) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrusted(event);
    return fn(...(args as Args));
  });
}

function assertApproved(folder: string) {
  if (!approvedFolders.has(path.resolve(folder))) throw new Error("Ordner wurde nicht ausgewählt.");
}

async function applySettings(settings?: Record<string, string>) {
  const s = settings ?? (await readSettings());
  background.apply({
    enabled: s.desktopBackground === "on",
    intervalHours: Math.max(1, Number(s.desktopIntervalHours) || 12),
    autostart: s.desktopAutostart === "on",
  });
}

const progress = (task: string) => (done: number, total: number) => send("progress", { task, done, total });

function registerIpc() {
  handle("settings:load", () => readSettings());
  handle("settings:save", async (value: unknown) => {
    await writeSettings(value);
    await applySettings();
  });
  handle("app:info", () => ({ version: app.getVersion(), platform: process.platform }));
  handle("app:notify", (title: string, body: string) => background.notify(String(title).slice(0, 120), String(body).slice(0, 300)));

  handle("backup:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Zielordner wählen",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = path.resolve(result.filePaths[0]);
    approvedFolders.add(folder);
    return folder;
  });
  handle("backup:download", async (folder: string, jobs: DownloadJob[]) => {
    assertApproved(folder);
    return downloadAll(folder, jobs.slice(0, 500), progress("download"));
  });

  handle("media:status", async () => {
    const settings = await readSettings();
    return { ffmpeg: await findFfmpeg(settings.ffmpegPath), images: loadSharp(serverDir()) !== null };
  });
  handle(
    "media:compress",
    async (job: { url: string; name: string; kind: "video" | "image"; quality: Quality; backupFolder?: string; relativePath?: string }) => {
      const ext = path.extname(job.name).toLowerCase();
      const dir = await mkdtemp(path.join(os.tmpdir(), "spo-media-"));
      try {
        const input = path.join(dir, `original${ext}`);
        const output = path.join(dir, `compressed${ext}`);
        await downloadTo(job.url, input);
        if (job.backupFolder) {
          assertApproved(job.backupFolder);
          const target = await uniquePath(resolveInside(job.backupFolder, job.relativePath ?? job.name));
          await mkdir(path.dirname(target), { recursive: true });
          await copyFile(input, target);
        }
        if (job.kind === "video") {
          const ffmpeg = await findFfmpeg((await readSettings()).ffmpegPath);
          if (!ffmpeg.available || !ffmpeg.path) throw new Error("ffmpeg wurde nicht gefunden.");
          await compressVideo(ffmpeg.path, input, output, job.quality, (f) => send("progress", { task: "compress", done: f, total: 1 }));
        } else {
          const sharp = loadSharp(serverDir());
          if (!sharp) throw new Error("Bildkomprimierung ist auf diesem System nicht verfügbar.");
          await compressImage(sharp, input, output, job.quality);
        }
        const tempId = path.basename(dir);
        pendingMedia.set(tempId, { dir, output });
        return { tempId, originalBytes: (await stat(input)).size, compressedBytes: (await stat(output)).size };
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    },
  );
  handle("media:upload", async (tempId: string, uploadUrl: string) => {
    const job = pendingMedia.get(tempId);
    if (!job) throw new Error("Datei nicht mehr vorhanden.");
    try {
      await uploadToSession(job.output, uploadUrl, progress("upload"));
    } finally {
      pendingMedia.delete(tempId);
      await rm(job.dir, { recursive: true, force: true });
    }
  });
  handle("media:discard", async (tempId: string) => {
    const job = pendingMedia.get(tempId);
    pendingMedia.delete(tempId);
    if (job) await rm(job.dir, { recursive: true, force: true });
  });

  handle("update:check", () => updates.check());
  handle("update:install", () => updates.install());
}

/* ---------------------------------------------------------------- lifecycle */

/** `--smoke-test`: start, render the first screen, check the bridge, exit 0 – used by CI on the packaged app. */
async function runSmokeTest(win: BrowserWindow) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = (await win.webContents.executeJavaScript(
      `({ bridge: typeof window.desktop?.loadSettings === "function", heading: document.querySelector("h1")?.textContent ?? "" })`,
    )) as { bridge: boolean; heading: string };
    if (state.bridge && state.heading) {
      console.log(`Smoke test passed – "${state.heading}"`);
      shutdown(0);
      return;
    }
    await delay(250);
  }
  throw new Error("Smoke test: Die Oberfläche wurde nicht angezeigt.");
}

async function cleanupTemp() {
  await Promise.all([...pendingMedia.values()].map((job) => rm(job.dir, { recursive: true, force: true })));
  pendingMedia.clear();
}

/** `app.exit` skips `before-quit` – stop the server first so its exit isn't reported as a crash. */
function shutdown(code: number) {
  quitting = true;
  server?.kill();
  background.dispose();
  app.exit(code);
}

function fail(error: unknown, title = "SharePoint Storage Optimizer konnte nicht starten") {
  if (quitting) return;
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (!SMOKE_TEST) dialog.showErrorBox(title, message);
  shutdown(1);
}

async function start() {
  app.setAppUserModelId(APP_ID);
  buildMenu();
  hardenSession();
  registerIpc();

  mainWindow = createWindow();
  // data: URL instead of file:// – the file protocol has no extra privileges (fuse), so it can't read app.asar
  const loading = await readFile(path.join(app.getAppPath(), "loading.html"), "utf8");
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loading)}`);

  const origin = DEV_URL ?? (await startServer(await choosePort()));
  appOrigin = new URL(origin).origin;
  await mainWindow.loadURL(origin);

  if (SMOKE_TEST) {
    await runSmokeTest(mainWindow);
    return;
  }
  await applySettings();
  updates.init();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", () => {
    quitting = true;
    server?.kill();
    background.dispose();
    void cleanupTemp();
  });
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(start).catch(fail);
}
