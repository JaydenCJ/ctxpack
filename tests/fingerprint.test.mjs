// Fingerprints are the reproducibility contract: stable across runs and
// machines, sensitive to anything the model would actually see, blind to
// anything it would not. The FNV-1a vectors are pinned so a refactor that
// changes hashes cannot slip through as "all tests still pass".
import test from "node:test";
import assert from "node:assert/strict";

import { fnv1a64, canonicalLayout, pack } from "../dist/index.js";
import { section, perChar } from "./helpers.mjs";

function packc(sections, options = {}) {
  return pack(sections, { counter: perChar, separator: "|", ...options });
}

test("fnv1a64 matches the published FNV-1a test vectors", () => {
  // Reference values for the 64-bit FNV-1a parameters.
  assert.equal(fnv1a64(""), "cbf29ce484222325");
  assert.equal(fnv1a64("a"), "af63dc4c8601ec8c");
  assert.equal(fnv1a64("foobar"), "85944171f73967e8");
});

test("fnv1a64 hashes UTF-8 bytes, so non-ASCII text is well-defined", () => {
  assert.equal(fnv1a64("日本語"), fnv1a64("日本語"));
  assert.notEqual(fnv1a64("日本語"), fnv1a64("日本诰")); // one code point differs
});

test("identical specs produce identical fingerprints", () => {
  const sections = [section("a", "aaaa"), section("b", "bbbb", { priority: 2 })];
  const a = packc(sections, { budget: 20 });
  const b = packc(sections, { budget: 20 });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{16}$/);
});

test("changing any kept text changes the fingerprint", () => {
  const a = packc([section("a", "hello")], { budget: 20 });
  const b = packc([section("a", "hello!")], { budget: 20 });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("changing the budget changes the fingerprint even when content is identical", () => {
  const sections = [section("a", "aaaa")];
  const a = packc(sections, { budget: 20 });
  const b = packc(sections, { budget: 21 });
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("an eviction that removes a section changes the fingerprint", () => {
  const sections = [section("a", "aaaa", { priority: 5 }), section("b", "bbbb")];
  const roomy = packc(sections, { budget: 20 });
  const tight = packc(sections, { budget: 4 });
  assert.notEqual(roomy.fingerprint, tight.fingerprint);
});

test("evicted content does not leak into the fingerprint", () => {
  // Two different low-priority sections that are both evicted: the model
  // sees the same thing, so the fingerprint must match.
  const a = packc([section("keep", "kkkk", { priority: 5 }), section("gone", "xxxxxxxx")], { budget: 4 });
  const b = packc([section("keep", "kkkk", { priority: 5 }), section("gone", "yyyyyyyy")], { budget: 4 });
  assert.equal(a.fingerprint, b.fingerprint);
});

test("canonicalLayout has a fixed shape (version, budget, reserve, fits, sections)", () => {
  const layout = packc([section("a", "hi")], { budget: 10, reserve: 2 });
  const canonical = JSON.parse(canonicalLayout(layout.sections, layout.tokens, layout.fits));
  assert.deepEqual(canonical, [1, 10, 2, true, [["a", "hi"]]]);
});
