import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "spo-updater-test-"));

vi.mock("electron", () => ({
  app: { isPackaged: true, getAppPath: () => dir, getPath: () => dir },
}));

const autoUpdater = Object.assign(new EventEmitter(), {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  logger: null as unknown,
  checkForUpdates: vi.fn(async () => {}),
  quitAndInstall: vi.fn(),
});
vi.mock("electron-updater", () => ({ autoUpdater }));

const { consumeHiddenRestart, fileLogger, Updates } = await import("./updater.mjs");

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, "resourcesPath", { value: dir, configurable: true });
  writeFileSync(path.join(dir, "app-update.yml"), "provider: github\n");
  autoUpdater.removeAllListeners();
  autoUpdater.checkForUpdates.mockClear();
  autoUpdater.quitAndInstall.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(path.join(dir, "restart-hidden"), { force: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function started() {
  const published: string[] = [];
  const ready = vi.fn();
  const updates = new Updates((s) => published.push(s.state), ready);
  updates.init();
  return { updates, published, ready };
}

describe("Updates", () => {
  it("downloads automatically, reports progress and announces the finished download", () => {
    const { updates, published, ready } = started();
    expect(autoUpdater).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true });
    autoUpdater.emit("update-available", { version: "1.1.0" });
    autoUpdater.emit("download-progress", { percent: 42.4 });
    expect(updates.status).toMatchObject({ state: "downloading", version: "1.1.0", percent: 42 });
    autoUpdater.emit("update-downloaded", { version: "1.1.0" });
    expect(updates.ready).toBe(true);
    expect(ready).toHaveBeenCalledWith("1.1.0");
    expect(published).toEqual(["downloading", "downloading", "ready"]);
  });

  it("does not check again while a download runs or an update waits for the restart", async () => {
    const { updates } = started();
    autoUpdater.emit("update-available", { version: "1.1.0" });
    await updates.check();
    autoUpdater.emit("update-downloaded", { version: "1.1.0" });
    await updates.check();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(updates.status.state).toBe("ready");
  });

  it("keeps a downloaded update when a later check fails", () => {
    const { updates } = started();
    autoUpdater.emit("update-downloaded", { version: "1.1.0" });
    autoUpdater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(updates.status.state).toBe("ready");
  });

  it("installs silently and starts the new version – back in the tray when it came from there", () => {
    const { updates } = started();
    updates.install();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    autoUpdater.emit("update-downloaded", { version: "1.1.0" });
    updates.install({ hidden: true });
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(consumeHiddenRestart(dir)).toBe(true);
    // only once
    expect(consumeHiddenRestart(dir)).toBe(false);
  });

  it("stays off without an update feed", async () => {
    rmSync(path.join(dir, "app-update.yml"));
    const updates = new Updates(() => {});
    updates.init();
    expect((await updates.check()).state).toBe("disabled");
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});

describe("fileLogger", () => {
  it("appends lines and starts a new file at about 1 MB", () => {
    const file = path.join(dir, "logs", "updater.log");
    const log = fileLogger(file);
    log.info("Checking for update");
    log.error(new Error("kaputt"));
    expect(readFileSync(file, "utf8")).toMatch(/INFO Checking for update\n.*ERROR Error: kaputt/s);
    writeFileSync(file, "x".repeat(1_000_001));
    log.warn("weiter");
    expect(existsSync(`${file}.old`)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/WARN weiter/);
  });
});
