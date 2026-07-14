/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

declare module "node:fs" {
  /** Overloads limited to how the CLI reads specs (path or stdin fd 0). */
  export function readFileSync(path: string | number, encoding: "utf8"): string;
}

declare var process: {
  argv: string[];
  exitCode: number | undefined;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
};

/** The slice of TextEncoder the fingerprint module relies on (ES2022 lib lacks DOM). */
declare class TextEncoder {
  encode(input: string): Uint8Array;
}
