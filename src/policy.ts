/**
 * Packing policy: validation, normalization and victim selection.
 *
 * All the "who goes first" logic lives here so it can be unit-tested (and
 * argued about) without running the packer. The single ordering rule:
 * lower priority is evicted first, and among equal priorities the section
 * that appears *earlier* in the input is evicted first. With chat history
 * appended in chronological order that is exactly "oldest first".
 */

import type { PackOptions, Section, TruncateStrategy } from "./types.js";

const STRATEGIES: readonly TruncateStrategy[] = [
  "drop",
  "truncate-tail",
  "truncate-head",
  "truncate-middle",
];

/** A section normalized to concrete values plus its input position. */
export interface Entry {
  id: string;
  index: number;
  originalText: string;
  priority: number;
  pinned: boolean;
  group: string | undefined;
  strategy: TruncateStrategy;
  minTokens: number;
  /** Mutable packing state. */
  included: boolean;
  text: string;
  tokens: number;
  originalTokens: number;
  truncated: boolean;
  action: "keep" | "truncate" | "evict";
  reason: "pinned" | "fits" | "budget" | "group-quota" | "min-tokens";
  detail: string;
}

/** Throw a RangeError with a spec-path-style message. */
function bad(path: string, message: string): never {
  throw new RangeError(`${path}: ${message}`);
}

/** Validate options and sections; returns nothing, throws on the first problem. */
export function validate(sections: Section[], options: PackOptions): void {
  if (!Number.isInteger(options.budget) || options.budget <= 0) {
    bad("options.budget", `must be a positive integer, got ${String(options.budget)}`);
  }
  const reserve = options.reserve ?? 0;
  if (!Number.isInteger(reserve) || reserve < 0) {
    bad("options.reserve", `must be a non-negative integer, got ${String(options.reserve)}`);
  }
  if (reserve >= options.budget) {
    bad("options.reserve", `${reserve} leaves no capacity out of budget ${options.budget}`);
  }
  if (options.order !== undefined && options.order !== "input" && options.order !== "priority") {
    bad("options.order", `must be "input" or "priority", got ${JSON.stringify(options.order)}`);
  }
  for (const [name, quota] of Object.entries(options.groups ?? {})) {
    if (quota.maxTokens === undefined && quota.maxFraction === undefined) {
      bad(`options.groups.${name}`, "needs maxTokens or maxFraction");
    }
    if (quota.maxTokens !== undefined && (!Number.isInteger(quota.maxTokens) || quota.maxTokens < 0)) {
      bad(`options.groups.${name}.maxTokens`, `must be a non-negative integer, got ${String(quota.maxTokens)}`);
    }
    if (
      quota.maxFraction !== undefined &&
      (typeof quota.maxFraction !== "number" ||
        !Number.isFinite(quota.maxFraction) ||
        quota.maxFraction < 0 ||
        quota.maxFraction > 1)
    ) {
      bad(`options.groups.${name}.maxFraction`, `must be a number in [0, 1], got ${String(quota.maxFraction)}`);
    }
  }
  const seen = new Set<string>();
  sections.forEach((section, i) => {
    const path = `sections[${i}]`;
    if (typeof section.id !== "string" || section.id.length === 0) {
      bad(`${path}.id`, "must be a non-empty string");
    }
    if (seen.has(section.id)) bad(`${path}.id`, `duplicate id ${JSON.stringify(section.id)}`);
    seen.add(section.id);
    if (typeof section.text !== "string") bad(`${path}.text`, "must be a string");
    if (section.priority !== undefined && !Number.isFinite(section.priority)) {
      bad(`${path}.priority`, `must be a finite number, got ${String(section.priority)}`);
    }
    if (section.strategy !== undefined && !STRATEGIES.includes(section.strategy)) {
      bad(`${path}.strategy`, `unknown strategy ${JSON.stringify(section.strategy)} (valid: ${STRATEGIES.join(", ")})`);
    }
    if (section.minTokens !== undefined && (!Number.isInteger(section.minTokens) || section.minTokens < 0)) {
      bad(`${path}.minTokens`, `must be a non-negative integer, got ${String(section.minTokens)}`);
    }
  });
}

/** Normalize sections into mutable packing entries (tokens filled in by the packer). */
export function toEntries(sections: Section[]): Entry[] {
  return sections.map((section, index) => ({
    id: section.id,
    index,
    originalText: section.text,
    priority: section.priority ?? 0,
    pinned: section.pinned ?? false,
    group: section.group,
    strategy: section.strategy ?? "drop",
    minTokens: section.minTokens ?? 0,
    included: true,
    text: section.text,
    tokens: 0,
    originalTokens: 0,
    truncated: false,
    action: "keep",
    reason: section.pinned ? "pinned" : "fits",
    detail: "",
  }));
}

/**
 * Compare two entries by eviction order: the entry that should be evicted
 * *first* sorts first. Lower priority first; ties by input order (earlier
 * input evicted first). Pinned entries must be filtered out by the caller.
 */
export function evictionOrder(a: Entry, b: Entry): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.index - b.index;
}

/** Pick the next victim among included, unpinned entries; undefined when none. */
export function nextVictim(entries: Entry[]): Entry | undefined {
  let victim: Entry | undefined;
  for (const entry of entries) {
    if (!entry.included || entry.pinned) continue;
    if (victim === undefined || evictionOrder(entry, victim) < 0) victim = entry;
  }
  return victim;
}

/** Output order for kept sections. */
export function outputOrder(entries: Entry[], order: "input" | "priority"): Entry[] {
  const kept = entries.filter((entry) => entry.included);
  if (order === "priority") {
    kept.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.index - b.index));
  }
  return kept;
}
