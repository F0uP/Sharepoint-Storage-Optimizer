import { app, Menu, nativeImage, Notification, Tray, type BrowserWindow } from "electron";
import path from "node:path";

/**
 * "Im Hintergrund weiterlaufen": tray icon, periodic quota check (executed by the web app, which holds
 * the Microsoft sign-in) and system notifications. Also handles "start at login".
 */
export interface BackgroundOptions {
  enabled: boolean;
  intervalHours: number;
  autostart: boolean;
}

export class Background {
  private tray: Tray | null = null;
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private hintShown = false;
  /** downloaded update waiting for the restart – offered in the tray menu */
  private update: { version?: string; install: () => void } | null = null;
  enabled = false;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly showWindow: () => void,
    private readonly quit: () => void,
    private readonly sendCheck: () => void,
  ) {}

  apply(options: BackgroundOptions) {
    this.enabled = options.enabled;
    if (options.enabled && !this.tray) this.createTray();
    if (!options.enabled && this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
    this.timer = this.firstRun = null;
    if (options.enabled) {
      this.firstRun = setTimeout(() => this.sendCheck(), 90_000);
      this.timer = setInterval(() => this.sendCheck(), options.intervalHours * 3_600_000);
    }

    if (app.isPackaged && process.platform !== "linux") {
      app.setLoginItemSettings({ openAtLogin: options.autostart, args: ["--hidden"] });
    }
  }

  /** Close button hides the window while background mode is on. */
  handleClose(event: Electron.Event) {
    if (!this.enabled) return;
    event.preventDefault();
    this.getWindow()?.hide();
    if (!this.hintShown) {
      this.hintShown = true;
      this.notify("Läuft im Hintergrund weiter", "Das Kontingent wird regelmäßig geprüft. Beenden über das Symbol im Infobereich.");
    }
  }

  notify(title: string, body: string) {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    notification.on("click", () => this.showWindow());
    notification.show();
  }

  private createTray() {
    const dir = path.join(app.getAppPath(), "tray");
    const icon =
      process.platform === "darwin"
        ? nativeImage.createFromPath(path.join(dir, "trayTemplate.png"))
        : nativeImage.createFromPath(path.join(dir, "tray.png"));
    if (process.platform === "darwin") icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    this.tray.setToolTip(app.getName());
    this.buildMenu();
    this.tray.on("click", () => this.showWindow());
  }

  private buildMenu() {
    const update = this.update;
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Öffnen", click: () => this.showWindow() },
        { label: "Kontingent jetzt prüfen", click: () => this.sendCheck() },
        ...(update
          ? [
              { type: "separator" as const },
              { label: `Update${update.version ? ` auf ${update.version}` : ""} installieren und neu starten`, click: update.install },
            ]
          : []),
        { type: "separator" },
        { label: "Beenden", click: () => this.quit() },
      ]),
    );
  }

  /** Offers a downloaded update in the tray menu (null removes the entry). */
  setUpdate(update: { version?: string; install: () => void } | null) {
    this.update = update;
    this.buildMenu();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
    this.tray?.destroy();
  }
}
