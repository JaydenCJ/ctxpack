/**
 * The packing engine.
 *
 * pack() runs three passes over the sections and never touches a pin:
 *
 *   1. Group quotas — each named group is shrunk to its quota by evicting
 *      or truncating its lowest-priority members.
 *   2. Global budget — while the total (sections + separators) exceeds
 *      capacity, the lowest-priority unpinned section is truncated just
 *      enough to close the gap, or evicted when it cannot be.
 *   3. Accounting — decisions, token stats and the fingerprint.
 *
 * Every step is deterministic: no clocks, no randomness, no Map iteration
 * order dependence, stable tie-breaks. Token math never trusts estimates —
 * any text that changes is re-priced with the counter before it is summed.
 */

import { resolveCounter } from "./counter.js";
import { fmtTokens } from "./explain.js";
import { fingerprintLayout } from "./fingerprint.js";
import { nextVictim, outputOrder, toEntries, validate, type Entry } from "./policy.js";
import { truncateToBudget } from "./truncate.js";
import type {
  Counter,
  Decision,
  Layout,
  PackedSection,
  PackOptions,
  Section,
} from "./types.js";

const DEFAULT_SEPARATOR = "\n\n";
const DEFAULT_ELLIPSIS = "…";

/** Sum of included section tokens plus the separators between them. */
function totalTokens(entries: Entry[], sepTokens: number): number {
  let sum = 0;
  let count = 0;
  for (const entry of entries) {
    if (!entry.included) continue;
    sum += entry.tokens;
    count += 1;
  }
  return count > 1 ? sum + sepTokens * (count - 1) : sum;
}

/** Evict an entry, recording the audit trail. */
function evict(entry: Entry, reason: Entry["reason"], detail: string): void {
  entry.included = false;
  entry.action = "evict";
  entry.reason = reason;
  entry.detail = detail;
}

/**
 * Try to shrink `entry` to `target` tokens (measured, from the original
 * text so repeated truncation never stacks ellipsis markers). Returns true
 * on success; on failure the caller evicts.
 */
function tryTruncate(
  entry: Entry,
  target: number,
  counter: Counter,
  ellipsis: string,
  reason: "budget" | "group-quota",
  cause: string,
): boolean {
  if (entry.strategy === "drop") return false;
  const floor = Math.max(entry.minTokens, 1);
  if (target < floor) return false;
  const cut = truncateToBudget(entry.originalText, target, counter, entry.strategy, ellipsis);
  if (cut === null || cut.tokens < floor) return false;
  const before = entry.tokens;
  entry.text = cut.text;
  entry.tokens = cut.tokens;
  entry.truncated = true;
  entry.action = "truncate";
  entry.reason = reason;
  entry.detail = `${entry.strategy} ${before} -> ${fmtTokens(cut.tokens)} ${cause}`;
  return true;
}

/** Resolve a group quota to a concrete token cap. */
function quotaTokens(
  quota: { maxTokens?: number; maxFraction?: number },
  capacity: number,
): number {
  const byTokens = quota.maxTokens ?? Number.POSITIVE_INFINITY;
  const byFraction =
    quota.maxFraction !== undefined
      ? Math.floor(quota.maxFraction * capacity)
      : Number.POSITIVE_INFINITY;
  return Math.min(byTokens, byFraction);
}

/** Pass 1: shrink each quota'd group to its cap. Groups in sorted-name order. */
function applyGroupQuotas(
  entries: Entry[],
  options: PackOptions,
  capacity: number,
  counter: Counter,
  ellipsis: string,
): void {
  const groups = options.groups ?? {};
  for (const name of Object.keys(groups).sort()) {
    const quota = groups[name];
    if (quota === undefined) continue;
    const cap = quotaTokens(quota, capacity);
    // Loop until the group's members fit the cap or only pins remain.
    for (;;) {
      const members = entries.filter((entry) => entry.included && entry.group === name);
      const used = members.reduce((sum, entry) => sum + entry.tokens, 0);
      if (used <= cap) break;
      const victim = nextVictim(members);
      if (victim === undefined) break; // only pins left: pins outrank quotas
      const over = used - cap;
      const target = victim.tokens - over;
      const cause = `(group "${name}" ${used} > quota ${cap})`;
      if (tryTruncate(victim, target, counter, ellipsis, "group-quota", cause)) continue;
      const why =
        victim.strategy === "drop"
          ? `group "${name}" over quota (${used} > ${cap}); lowest priority (p=${victim.priority})`
          : `group "${name}" over quota (${used} > ${cap}); truncation target ${Math.max(target, 0)} below minimum ${Math.max(victim.minTokens, 1)}`;
      evict(victim, victim.strategy === "drop" ? "group-quota" : "min-tokens", why);
    }
  }
}

/** Pass 2: fit the whole layout into capacity. Returns false on pinned overflow. */
function applyBudget(
  entries: Entry[],
  capacity: number,
  sepTokens: number,
  counter: Counter,
  ellipsis: string,
): boolean {
  for (;;) {
    const total = totalTokens(entries, sepTokens);
    if (total <= capacity) return true;
    const victim = nextVictim(entries);
    if (victim === undefined) {
      // Only pins remain and they still exceed capacity: report, don't throw.
      for (const entry of entries) {
        if (entry.included && entry.pinned) {
          entry.detail = `pinned; pinned total exceeds capacity by ${fmtTokens(total - capacity)}`;
        }
      }
      return false;
    }
    const over = total - capacity;
    const target = victim.tokens - over;
    const cause = `(over capacity by ${over})`;
    if (tryTruncate(victim, target, counter, ellipsis, "budget", cause)) continue;
    const why =
      victim.strategy === "drop"
        ? `over capacity by ${over}; lowest priority (p=${victim.priority}) among unpinned`
        : `over capacity by ${over}; truncation target ${Math.max(target, 0)} below minimum ${Math.max(victim.minTokens, 1)}`;
    evict(victim, victim.strategy === "drop" ? "budget" : "min-tokens", why);
  }
}

/**
 * Pack sections into a token budget. Pure and deterministic: same sections,
 * options and counter produce an identical Layout (verify by fingerprint).
 * Throws RangeError on invalid input; never throws on overflow — a layout
 * that does not fit comes back with `fits: false` and the pins intact.
 */
export function pack(sections: Section[], options: PackOptions): Layout {
  validate(sections, options);
  const counter = resolveCounter(options.counter);
  const separator = options.separator ?? DEFAULT_SEPARATOR;
  const ellipsis = options.ellipsis ?? DEFAULT_ELLIPSIS;
  const reserve = options.reserve ?? 0;
  const capacity = options.budget - reserve;
  const sepTokens = counter(separator);

  const entries = toEntries(sections);
  for (const entry of entries) {
    entry.tokens = counter(entry.text);
    entry.originalTokens = entry.tokens;
  }

  applyGroupQuotas(entries, options, capacity, counter, ellipsis);
  const fits = applyBudget(entries, capacity, sepTokens, counter, ellipsis);

  const keptEntries = outputOrder(entries, options.order ?? "input");
  const kept: PackedSection[] = keptEntries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    tokens: entry.tokens,
    truncated: entry.truncated,
    priority: entry.priority,
    pinned: entry.pinned,
    ...(entry.group !== undefined ? { group: entry.group } : {}),
  }));

  const used = totalTokens(entries, sepTokens);
  const separators = used - keptEntries.reduce((sum, entry) => sum + entry.tokens, 0);
  const tokens = {
    budget: options.budget,
    reserve,
    capacity,
    used,
    separators,
    free: capacity - used,
  };

  const decisions: Decision[] = entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    reason: entry.reason,
    detail:
      entry.detail !== ""
        ? entry.detail
        : entry.pinned
          ? "pinned; never evicted or truncated"
          : `fits as-is (${fmtTokens(entry.tokens)})`,
    originalTokens: entry.originalTokens,
    finalTokens: entry.included ? entry.tokens : 0,
    priority: entry.priority,
    pinned: entry.pinned,
    ...(entry.group !== undefined ? { group: entry.group } : {}),
  }));

  return {
    sections: kept,
    decisions,
    tokens,
    fits,
    fingerprint: fingerprintLayout(kept, tokens, fits),
  };
}
