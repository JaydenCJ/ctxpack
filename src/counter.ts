/**
 * Built-in token counters.
 *
 * ctxpack is a packing engine, not a tokenizer: for exact budgets you pass
 * your model's real tokenizer as a `Counter`. The estimators here exist so
 * the engine is useful out of the box, and they promise two things a real
 * deployment needs from *any* counter: determinism (same string, same
 * number, on every platform) and monotonicity (a substring never costs
 * more than the string it came from).
 */

import type { Counter, CounterName } from "./types.js";

/**
 * The classic "one token per ~4 characters" heuristic, counted in Unicode
 * code points so astral symbols are one character, not two. Code points
 * outside Basic Latin are charged a full token each — CJK and most other
 * non-Latin scripts really do tokenize near one-per-character in common
 * BPE vocabularies, and *under*-counting is the failure mode that blows a
 * real context window.
 */
export function charsCounter(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) as number) < 0x80) ascii += 1;
    else wide += 1;
  }
  return Math.ceil(ascii / 4) + wide;
}

/**
 * One token per whitespace-delimited word, plus one per 8 characters of
 * any overlong word (URLs, base64 blobs and identifiers split into many
 * tokens in every real vocabulary). A floor-style estimate: cheap, stable,
 * and honest about very long "words".
 */
export function wordsCounter(text: string): number {
  let tokens = 0;
  for (const word of text.split(/\s+/)) {
    if (word.length === 0) continue;
    tokens += 1 + Math.floor(word.length / 8);
  }
  return tokens;
}

const BUILTINS: Record<CounterName, Counter> = {
  chars: charsCounter,
  words: wordsCounter,
};

/** Resolve a counter option (function, built-in name, or undefined → "chars"). */
export function resolveCounter(counter?: Counter | CounterName): Counter {
  if (counter === undefined) return charsCounter;
  if (typeof counter === "function") return counter;
  const found = BUILTINS[counter];
  if (found === undefined) {
    throw new RangeError(
      `unknown counter "${String(counter)}" (built-ins: ${Object.keys(BUILTINS).join(", ")})`,
    );
  }
  return found;
}

/** Names of the built-in counters, for CLI help and validation. */
export const COUNTER_NAMES: readonly CounterName[] = ["chars", "words"];
