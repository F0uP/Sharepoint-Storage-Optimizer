// Starts the self-contained production server (same as the Docker image).
// Next's standalone output does not include static assets – copy them next to server.js first.
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
if (!existsSync(join(standalone, "server.js"))) {
  console.error('Kein Standalone-Build gefunden – bitte zuerst "npm run build" ausführen.');
  process.exit(1);
}

cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });

// .env.local etc. live in the project root, not in the standalone folder (E2E tests opt out)
if (!process.env.SKIP_ENV_FILES) nextEnv.loadEnvConfig(root);

// `npm start -- -p 4000` → PORT=4000
const portFlag = process.argv.indexOf("-p");
if (portFlag > -1) process.env.PORT = process.argv[portFlag + 1];

process.chdir(standalone);
await import(pathToFileURL(join(standalone, "server.js")).href);
