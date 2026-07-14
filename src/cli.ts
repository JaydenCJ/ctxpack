#!/usr/bin/env node
/**
 * The ctxpack CLI. Thin by design: read a pack spec (file or stdin), apply
 * flag overrides, call the same pack() the library exports, print. All
 * logic worth testing lives in the pure modules; this file only maps
 * results to text and exit codes:
 *
 *   0  ok (pack/explain/fingerprint: layout fits; check: gate passed)
 *   1  pack/explain: pinned overflow; check: gate failed
 *   2  usage or input error
 */

import { readFileSync } from "node:fs";

import { parseArgs, UsageError, type CliArgs } from "./args.js";
import { explainLayout, fmtTokens, summarizeLayout } from "./explain.js";
import { pack } from "./packer.js";
import { renderLayout } from "./render.js";
import { parseSpec, type PackSpec } from "./spec.js";
import { VERSION } from "./version.js";
import type { CounterName } from "./types.js";

const HELP = `ctxpack ${VERSION} — deterministic context-window packing

Usage: ctxpack <command> <spec.json | -> [options]

Commands:
  pack         pack the spec and print the rendered context
  explain      print the packing decision report
  check        verify the spec packs cleanly (CI gate)
  fingerprint  print the layout fingerprint

Options:
  --json            machine-readable output (pack, explain, check)
  --stats           pack: print a one-line summary to stderr
  --budget <n>      override the spec's token budget
  --reserve <n>     override the spec's reserved tokens
  --counter <name>  override the counter: chars | words
  --allow <list>    check: tolerate "truncate" and/or "evict" (comma-separated)
  -V, --version     print the version
  -h, --help        print this help

Exit codes:
  0  ok — layout fits (pack/explain) or the check gate passed
  1  pinned overflow (pack/explain) or the check gate failed
  2  usage or input error

The spec format is documented in docs/pack-spec.md; "-" reads it from stdin.
`;

function readSpecSource(path: string | undefined): string {
  if (path === undefined) throw new UsageError("missing spec path (use - for stdin)");
  if (path === "-") return readFileSync(0, "utf8");
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      throw new UsageError(`no such file: ${path}`);
    }
    throw new UsageError(`cannot read ${path}: ${(error as Error).message}`);
  }
}

function loadSpec(args: CliArgs): PackSpec {
  const spec = parseSpec(readSpecSource(args.positional[0]));
  if (args.budget !== undefined) spec.options.budget = args.budget;
  if (args.reserve !== undefined) spec.options.reserve = args.reserve;
  if (args.counter !== undefined) spec.options.counter = args.counter as CounterName;
  return spec;
}

function cmdPack(args: CliArgs): number {
  const spec = loadSpec(args);
  const layout = pack(spec.sections, spec.options);
  if (args.json) {
    process.stdout.write(JSON.stringify(layout, null, 2) + "\n");
  } else {
    process.stdout.write(renderLayout(layout, spec.options.separator ?? "\n\n") + "\n");
  }
  if (args.stats) process.stderr.write(summarizeLayout(layout) + "\n");
  return layout.fits ? 0 : 1;
}

function cmdExplain(args: CliArgs): number {
  const spec = loadSpec(args);
  const layout = pack(spec.sections, spec.options);
  if (args.json) {
    const report = {
      decisions: layout.decisions,
      tokens: layout.tokens,
      fits: layout.fits,
      fingerprint: layout.fingerprint,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(explainLayout(layout) + "\n");
  }
  return layout.fits ? 0 : 1;
}

function cmdCheck(args: CliArgs): number {
  const spec = loadSpec(args);
  const layout = pack(spec.sections, spec.options);
  const truncated = layout.decisions.filter((d) => d.action === "truncate");
  const evicted = layout.decisions.filter((d) => d.action === "evict");
  const violations: string[] = [];
  if (!layout.fits) {
    violations.push(`pinned sections exceed capacity by ${fmtTokens(-layout.tokens.free)}`);
  }
  if (evicted.length > 0 && !args.allow.includes("evict")) {
    violations.push(`${evicted.length} evicted (${evicted.map((d) => d.id).join(", ")})`);
  }
  if (truncated.length > 0 && !args.allow.includes("truncate")) {
    violations.push(`${truncated.length} truncated (${truncated.map((d) => d.id).join(", ")})`);
  }
  const pass = violations.length === 0;
  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          pass,
          fits: layout.fits,
          kept: layout.decisions.filter((d) => d.action === "keep").length,
          truncated: truncated.length,
          evicted: evicted.length,
          allow: args.allow,
          violations,
          fingerprint: layout.fingerprint,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(`ctxpack check: ${summarizeLayout(layout)}\n`);
    for (const violation of violations) process.stdout.write(`  FAIL ${violation}\n`);
    process.stdout.write(pass ? "PASS\n" : "FAIL\n");
  }
  return pass ? 0 : 1;
}

function cmdFingerprint(args: CliArgs): number {
  const spec = loadSpec(args);
  const layout = pack(spec.sections, spec.options);
  process.stdout.write(layout.fingerprint + "\n");
  return 0;
}

export function main(argv: string[]): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`ctxpack: ${(error as Error).message}\n`);
    return 2;
  }
  if (args.version) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }
  if (args.help || args.command === "") {
    process.stdout.write(HELP);
    return args.help ? 0 : 2;
  }
  try {
    switch (args.command) {
      case "pack":
        return cmdPack(args);
      case "explain":
        return cmdExplain(args);
      case "check":
        return cmdCheck(args);
      case "fingerprint":
        return cmdFingerprint(args);
      default:
        process.stderr.write(`ctxpack: unknown command ${JSON.stringify(args.command)}\n`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof RangeError) {
      process.stderr.write(`ctxpack: ${(error as Error).message}\n`);
      return 2;
    }
    throw error;
  }
}

// Set the exit code instead of calling process.exit(): exit() can drop
// buffered stdout when the output is piped; exitCode lets Node flush first.
process.exitCode = main(process.argv.slice(2));
