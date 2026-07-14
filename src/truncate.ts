/**
 * Token-budgeted truncation.
 *
 * The contract: given a text, a target token budget and a strategy, return
 * a cut version whose *measured* cost is <= the target — never an estimate
 * of a cost. Because counters need not be additive (most round), every
 * candidate cut is priced by counting the fully assembled result, and the
 * largest cut that fits is found by binary search. That only works because
 * counters are required to be monotonic, which every sane tokenizer is.
 *
 * Cuts never split a surrogate pair, and when a whitespace boundary exists
 * close to the cut point the cut backs up to it, so truncated text ends on
 * a whole word instead of "deplo".
 */

import type { Counter, TruncateStrategy } from "./types.js";

/** A successful truncation: the new text and its measured token cost. */
export interface Truncation {
  text: string;
  tokens: number;
}

/** How far back to look for a nicer whitespace cut point (in code units). */
const WORD_SNAP_WINDOW = 16;

/** Move a cut index left until it does not split a surrogate pair. */
function surrogateSafe(text: string, index: number): number {
  let i = index;
  while (i > 0) {
    const code = text.charCodeAt(i - 1);
    // A high surrogate just before the cut means the pair would be split.
    if (code >= 0xd800 && code <= 0xdbff) i -= 1;
    else break;
  }
  return i;
}

/** Move a cut index right past a low surrogate so the pair stays together. */
function surrogateSafeRight(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    // A low surrogate at the cut means its high surrogate is to the left.
    if (code >= 0xdc00 && code <= 0xdfff) i += 1;
    else break;
  }
  return i;
}

/**
 * Binary search the largest `n` in [0, max] with fits(n) true.
 * Assumes fits is monotone (true up to some point, then false).
 * Returns -1 when even fits(0) is false.
 */
function largestFitting(max: number, fits: (n: number) => boolean): number {
  if (!fits(0)) return -1;
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Snap a head-cut left to trailing whitespace, if any is close by. */
function snapLeft(text: string, cut: number): number {
  if (cut <= 0 || cut >= text.length) return cut;
  for (let i = cut; i > cut - WORD_SNAP_WINDOW && i > 0; i -= 1) {
    if (/\s/.test(text[i - 1] as string)) {
      // Trim the run of whitespace itself as well.
      let j = i;
      while (j > 0 && /\s/.test(text[j - 1] as string)) j -= 1;
      return j > 0 ? j : cut;
    }
  }
  return cut;
}

/** Snap a tail-cut right to leading whitespace, if any is close by. */
function snapRight(text: string, cut: number): number {
  if (cut <= 0 || cut >= text.length) return cut;
  for (let i = cut; i < cut + WORD_SNAP_WINDOW && i < text.length; i += 1) {
    if (/\s/.test(text[i] as string)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j] as string)) j += 1;
      return j < text.length ? j : cut;
    }
  }
  return cut;
}

/**
 * Truncate `text` so that its measured cost is <= `maxTokens`.
 *
 * Returns null when no useful cut exists: the target is <= 0, the strategy
 * is "drop", or even one character plus the ellipsis marker exceeds the
 * target. Callers treat null as "evict instead".
 */
export function truncateToBudget(
  text: string,
  maxTokens: number,
  counter: Counter,
  strategy: TruncateStrategy,
  ellipsis: string,
): Truncation | null {
  if (strategy === "drop" || maxTokens <= 0) return null;

  // Already fits — nothing to cut. (Callers normally never ask, but the
  // invariant "result costs <= maxTokens" should hold regardless.)
  const whole = counter(text);
  if (whole <= maxTokens) return { text, tokens: whole };

  if (strategy === "truncate-tail") {
    const assemble = (n: number) => {
      const cut = snapLeft(text, surrogateSafe(text, n));
      return text.slice(0, cut) + ellipsis;
    };
    const best = largestFitting(text.length, (n) => counter(assemble(n)) <= maxTokens);
    if (best <= 0) return null;
    const cut = snapLeft(text, surrogateSafe(text, best));
    if (cut <= 0) return null;
    const out = text.slice(0, cut) + ellipsis;
    return { text: out, tokens: counter(out) };
  }

  if (strategy === "truncate-head") {
    const assemble = (n: number) => {
      const cut = snapRight(text, surrogateSafeRight(text, text.length - n));
      return ellipsis + text.slice(cut);
    };
    const best = largestFitting(text.length, (n) => counter(assemble(n)) <= maxTokens);
    if (best <= 0) return null;
    const cut = snapRight(text, surrogateSafeRight(text, text.length - best));
    if (cut >= text.length) return null;
    const out = ellipsis + text.slice(cut);
    return { text: out, tokens: counter(out) };
  }

  // truncate-middle: keep symmetric head and tail halves around the marker.
  // Both cut points snap to word boundaries like the other strategies —
  // snapping only ever keeps *less* text, so the budget still holds.
  const half = Math.floor(text.length / 2);
  const assemble = (n: number) => {
    const headCut = snapLeft(text, surrogateSafe(text, n));
    const tailCut = snapRight(text, surrogateSafeRight(text, text.length - n));
    return text.slice(0, headCut) + ellipsis + text.slice(tailCut);
  };
  const best = largestFitting(half, (n) => counter(assemble(n)) <= maxTokens);
  if (best <= 0) return null;
  const out = assemble(best);
  return { text: out, tokens: counter(out) };
}
