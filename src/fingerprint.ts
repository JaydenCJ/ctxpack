/**
 * Layout fingerprints.
 *
 * A fingerprint is FNV-1a (64-bit) over a canonical serialization of what
 * the model would actually see: the algorithm version, the budget shape,
 * and the kept sections' ids and final texts in output order. Same spec +
 * same counter ⇒ same fingerprint, on any machine — which makes layouts
 * diffable in logs and cacheable by key, and makes "the context changed"
 * a one-string comparison. FNV-1a is used because it is tiny, endian-free
 * and dependency-free; it is a change detector, not a security boundary.
 */

import type { PackedSection, TokenStats } from "./types.js";

/** Bump when the canonical serialization (not the packing policy) changes. */
const FINGERPRINT_VERSION = 1;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-8 bytes of `text`, as 16 lowercase hex chars. */
export function fnv1a64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Canonical serialization of a layout for hashing. JSON with a fixed key
 * order (arrays of tuples, not objects), so no property-ordering trap.
 */
export function canonicalLayout(
  sections: readonly PackedSection[],
  tokens: TokenStats,
  fits: boolean,
): string {
  const body = sections.map((section) => [section.id, section.text]);
  return JSON.stringify([
    FINGERPRINT_VERSION,
    tokens.budget,
    tokens.reserve,
    fits,
    body,
  ]);
}

/** Fingerprint a packed layout (sections must be in output order). */
export function fingerprintLayout(
  sections: readonly PackedSection[],
  tokens: TokenStats,
  fits: boolean,
): string {
  return fnv1a64(canonicalLayout(sections, tokens, fits));
}
