// Shared test helpers: section factories and a runner for the built CLI.
// Everything is deterministic — no clocks, no randomness, no network; CLI
// tests run the compiled dist/cli.js as a child process, exactly like a
// user would.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Build a section with sensible defaults; override any field. */
export function section(id, text, overrides = {}) {
  return { id, text, ...overrides };
}

/** A deterministic "1 token per character" counter — makes test math trivial. */
export const perChar = (text) => text.length;

/**
 * Run the built CLI with the given argv (and optional stdin), returning
 * { status, stdout, stderr }.
 */
export function runCli(argv, stdin) {
  const result = spawnSync(process.execPath, [join(ROOT, "dist", "cli.js"), ...argv], {
    cwd: ROOT,
    encoding: "utf8",
    input: stdin,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
