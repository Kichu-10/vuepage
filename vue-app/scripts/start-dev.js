import { spawn } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npmCommand, ["run", "server"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn(npmCommand, ["run", "dev", "--", "--host", "127.0.0.1"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
];

let stopping = false;
function stopChildren(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("Could not start development service:", error.message);
    stopChildren(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      const reason = signal || (code === null ? "unknown" : code);
      console.error(`Development service exited (${reason}); stopping the other service.`);
      stopChildren(code || 1);
    }
  });
}

process.on("SIGINT", () => stopChildren());
process.on("SIGTERM", () => stopChildren());
