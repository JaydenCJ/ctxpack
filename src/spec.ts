/**
 * The JSON pack-spec format used by the CLI (and useful for storing packing
 * policies next to prompts). A spec is the full input to one pack() call:
 *
 *   {
 *     "budget": 220, "reserve": 24, "counter": "chars",
 *     "separator": "\n\n", "ellipsis": "…", "order": "input",
 *     "groups": { "history": { "maxFraction": 0.5 } },
 *     "sections": [ { "id": "system", "pinned": true, "text": "…" }, … ]
 *   }
 *
 * Parsing is strict: unknown keys are rejected with their path, so a typo
 * like "prioritiy" fails loudly instead of silently packing wrong.
 */

import { COUNTER_NAMES } from "./counter.js";
import type { CounterName, PackOptions, Section } from "./types.js";

/** A parsed spec: sections plus the options for pack(). */
export interface PackSpec {
  sections: Section[];
  options: PackOptions;
}

function fail(path: string, message: string): never {
  throw new RangeError(`spec ${path}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`${path}.${key}`, `unknown key (allowed: ${allowed.join(", ")})`);
    }
  }
}

const SPEC_KEYS = [
  "budget",
  "reserve",
  "counter",
  "separator",
  "ellipsis",
  "groups",
  "order",
  "sections",
];
const SECTION_KEYS = ["id", "text", "priority", "pinned", "group", "strategy", "minTokens"];
const QUOTA_KEYS = ["maxTokens", "maxFraction"];

/**
 * Parse a JSON string into a PackSpec. Shape errors carry the offending
 * path; value errors (bad budget, duplicate ids, …) are left to pack()'s
 * validator so the rules live in exactly one place.
 */
export function parseSpec(json: string): PackSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new RangeError(`spec is not valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(raw)) fail("root", "must be a JSON object");
  checkKeys(raw, SPEC_KEYS, "root");

  if (typeof raw.budget !== "number") fail(".budget", "required, must be a number");
  if (!Array.isArray(raw.sections)) fail(".sections", "required, must be an array");
  if (raw.counter !== undefined) {
    if (typeof raw.counter !== "string" || !COUNTER_NAMES.includes(raw.counter as CounterName)) {
      fail(".counter", `must be one of: ${COUNTER_NAMES.join(", ")}`);
    }
  }
  for (const key of ["separator", "ellipsis"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "string") {
      fail(`.${key}`, "must be a string");
    }
  }
  if (raw.reserve !== undefined && typeof raw.reserve !== "number") {
    fail(".reserve", "must be a number");
  }
  if (raw.order !== undefined && raw.order !== "input" && raw.order !== "priority") {
    fail(".order", 'must be "input" or "priority"');
  }

  let groups: PackOptions["groups"];
  if (raw.groups !== undefined) {
    if (!isObject(raw.groups)) fail(".groups", "must be an object");
    groups = {};
    for (const [name, quota] of Object.entries(raw.groups)) {
      if (!isObject(quota)) fail(`.groups.${name}`, "must be an object");
      checkKeys(quota, QUOTA_KEYS, `.groups.${name}`);
      groups[name] = quota as { maxTokens?: number; maxFraction?: number };
    }
  }

  const sections: Section[] = raw.sections.map((entry, i) => {
    if (!isObject(entry)) fail(`.sections[${i}]`, "must be an object");
    checkKeys(entry, SECTION_KEYS, `.sections[${i}]`);
    if (typeof entry.id !== "string") fail(`.sections[${i}].id`, "required, must be a string");
    if (typeof entry.text !== "string") fail(`.sections[${i}].text`, "required, must be a string");
    if (entry.pinned !== undefined && typeof entry.pinned !== "boolean") {
      fail(`.sections[${i}].pinned`, "must be a boolean");
    }
    if (entry.group !== undefined && typeof entry.group !== "string") {
      fail(`.sections[${i}].group`, "must be a string");
    }
    return entry as unknown as Section;
  });

  const options: PackOptions = {
    budget: raw.budget,
    ...(raw.reserve !== undefined ? { reserve: raw.reserve } : {}),
    ...(raw.counter !== undefined ? { counter: raw.counter as CounterName } : {}),
    ...(raw.separator !== undefined ? { separator: raw.separator as string } : {}),
    ...(raw.ellipsis !== undefined ? { ellipsis: raw.ellipsis as string } : {}),
    ...(groups !== undefined ? { groups } : {}),
    ...(raw.order !== undefined ? { order: raw.order as "input" | "priority" } : {}),
  };
  return { sections, options };
}
