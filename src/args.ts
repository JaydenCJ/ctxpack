/**
 * CLI argument parsing — tiny, strict and dependency-free.
 *
 * Unknown flags and malformed values are hard errors (exit 2 in the CLI),
 * because a mistyped `--bugdet` that silently packs with the spec's budget
 * is exactly the kind of quiet wrongness ctxpack exists to prevent.
 */

import { COUNTER_NAMES } from "./counter.js";

/** Parsed command line. */
export interface CliArgs {
  command: string;
  positional: string[];
  json: boolean;
  stats: boolean;
  budget?: number;
  reserve?: number;
  counter?: string;
  allow: string[];
  help: boolean;
  version: boolean;
}

/** Thrown for user errors; the CLI maps it to exit code 2. */
export class UsageError extends Error {}

function intValue(flag: string, value: string | undefined): number {
  if (value === undefined) throw new UsageError(`${flag} needs a value`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new UsageError(`${flag} needs a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return n;
}

const ALLOW_VALUES = ["truncate", "evict"];
const VALUE_FLAGS = ["--budget", "--reserve", "--counter", "--allow"];

/** Parse argv (without the node/script prefix). */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "",
    positional: [],
    json: false,
    stats: false,
    allow: [],
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--version" || arg === "-V") args.version = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--stats") args.stats = true;
    else if (arg === "--budget") args.budget = intValue(arg, argv[(i += 1)]);
    else if (arg === "--reserve") args.reserve = intValue(arg, argv[(i += 1)]);
    else if (arg === "--counter") {
      const value = argv[(i += 1)];
      if (value === undefined || !COUNTER_NAMES.includes(value as (typeof COUNTER_NAMES)[number])) {
        throw new UsageError(`--counter needs one of: ${COUNTER_NAMES.join(", ")}`);
      }
      args.counter = value;
    } else if (arg === "--allow") {
      const value = argv[(i += 1)];
      if (value === undefined) throw new UsageError("--allow needs a value");
      for (const item of value.split(",").map((s) => s.trim()).filter((s) => s !== "")) {
        if (!ALLOW_VALUES.includes(item)) {
          throw new UsageError(`--allow accepts ${ALLOW_VALUES.join(", ")}; got ${JSON.stringify(item)}`);
        }
        if (!args.allow.includes(item)) args.allow.push(item);
      }
    } else if (arg.startsWith("-") && arg !== "-") {
      const eq = arg.indexOf("=");
      if (eq !== -1 && VALUE_FLAGS.includes(arg.slice(0, eq))) {
        // "--budget=100" is a common habit; point at the supported spelling.
        throw new UsageError(
          `${arg.slice(0, eq)} takes its value as a separate argument: ${arg.slice(0, eq)} ${arg.slice(eq + 1)}`,
        );
      }
      throw new UsageError(`unknown flag ${JSON.stringify(arg)}`);
    } else if (args.command === "") {
      args.command = arg;
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}
