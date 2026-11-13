// Stages the desktop app in dist-desktop/ (run after `next build`):
//   dist-desktop/server – Next.js standalone server incl. static assets (→ resources/server)
//   dist-desktop/app    – bundled main process + preload, loading screen, tray icons, package.json (→ app.asar)
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PRODUCT_NAME = "SharePoint Storage Optimizer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-desktop");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("Kein Next.js-Build gefunden – zuerst `npm run build` ausführen.");
  process.exit(1);
}

// 1. Server
const serverDir = path.join(out, "server");
rmSync(serverDir, { recursive: true, force: true });
cpSync(standalone, serverDir, { recursive: true, verbatimSymlinks: true });
cpSync(path.join(root, ".next", "static"), path.join(serverDir, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(serverDir, "public"), { recursive: true });
// Next copies .env* files into the standalone output – never ship local secrets
for (const name of readdirSync(serverDir)) {
  if (name.startsWith(".env")) rmSync(path.join(serverDir, name), { force: true });
}

// 2. Electron app – bundled, so dependencies like electron-updater need no node_modules in the asar
const appDir = path.join(out, "app");
rmSync(appDir, { recursive: true, force: true });
const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  outdir: appDir,
  outExtension: { ".js": ".cjs" },
  legalComments: "none",
  logLevel: "warning",
};
await build({ ...shared, entryPoints: { main: path.join(root, "desktop", "main.mts") } });
await build({ ...shared, entryPoints: { preload: path.join(root, "desktop", "preload.cts") } });
cpSync(path.join(root, "desktop", "loading.html"), path.join(appDir, "loading.html"));
cpSync(path.join(root, "desktop", "resources", "tray"), path.join(appDir, "tray"), { recursive: true });

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      productName: PRODUCT_NAME,
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      private: true,
      main: "main.cjs",
    },
    null,
    2,
  ),
);

console.log(`Desktop-App vorbereitet in ${path.relative(root, out)}/ (Version ${pkg.version})`);
