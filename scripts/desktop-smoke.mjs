// Starts the packaged desktop app with --smoke-test: it boots the bundled server, renders the
// first screen, checks the preload bridge and exits 0. Usage: node scripts/desktop-smoke.mjs <executable>
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const executable = process.argv[2];
if (!executable || !existsSync(executable)) {
  console.error(`Programmdatei nicht gefunden: ${executable}`);
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(executable, ["--smoke-test"], { env, stdio: "inherit" });
const timer = setTimeout(() => {
  console.error("Smoke test: Zeitüberschreitung nach 240 s");
  child.kill();
  process.exit(1);
}, 240_000);

child.on("exit", (code) => {
  clearTimeout(timer);
  console.log(code === 0 ? "Smoke test bestanden" : `Smoke test fehlgeschlagen (Code ${code})`);
  process.exit(code ?? 1);
});
