#!/usr/bin/env node
import { spawn } from "node:child_process";
import { homedir, hostname } from "node:os";
import { run } from "./run.js";

/** Opens a URL with the system's browser; false when there is none (a server, CI). */
function openBrowser(url: string): Promise<boolean> {
  // Windows: rundll32, not cmd.exe, which would read & and | in the address as commands (security review 2026-11-21).
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => (child.unref(), resolve(true)));
    } catch {
      resolve(false);
    }
  });
}

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  home: homedir(),
  env: process.env,
  fetch,
  hostname: hostname(),
  openBrowser,
  color: !!process.stdout.isTTY && !process.env.NO_COLOR,
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
});
process.exitCode = code;
