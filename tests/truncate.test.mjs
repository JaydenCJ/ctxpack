// truncateToBudget: the one hard promise is that the *measured* cost of
// the returned text is <= the target, for any monotonic counter — the
// packer's budget math builds on that. These tests use a per-character
// counter for exact arithmetic plus the real estimators for realism.
import test from "node:test";
import assert from "node:assert/strict";

import { truncateToBudget, charsCounter } from "../dist/index.js";
import { perChar } from "./helpers.mjs";

const ELL = "…";

test("returns the text unchanged when it already fits", () => {
  const r = truncateToBudget("hello", 10, perChar, "truncate-tail", ELL);
  assert.deepEqual(r, { text: "hello", tokens: 5 });
});

test("drop strategy never truncates", () => {
  assert.equal(truncateToBudget("hello world", 5, perChar, "drop", ELL), null);
});

test("non-positive targets are refused", () => {
  assert.equal(truncateToBudget("hello", 0, perChar, "truncate-tail", ELL), null);
  assert.equal(truncateToBudget("hello", -3, perChar, "truncate-tail", ELL), null);
});

test("truncate-tail keeps the head and appends the ellipsis", () => {
  const r = truncateToBudget("aaaa bbbb cccc", 8, perChar, "truncate-tail", ELL);
  assert.notEqual(r, null);
  assert.ok(r.text.endsWith(ELL));
  assert.ok(r.text.startsWith("aaaa"));
  assert.ok(r.tokens <= 8);
  assert.equal(r.tokens, perChar(r.text)); // reported cost is measured, not estimated
});

test("truncate-head keeps the tail and prepends the ellipsis", () => {
  const r = truncateToBudget("aaaa bbbb cccc", 8, perChar, "truncate-head", ELL);
  assert.notEqual(r, null);
  assert.ok(r.text.startsWith(ELL));
  assert.ok(r.text.endsWith("cccc"));
  assert.ok(r.tokens <= 8);
});

test("truncate-middle keeps both ends around the marker", () => {
  const text = "HEAD then a lot of middle filler content here THE-TAIL";
  const r = truncateToBudget(text, 20, perChar, "truncate-middle", ELL);
  assert.notEqual(r, null);
  assert.ok(r.text.startsWith("HEAD".slice(0, 2)));
  assert.ok(r.text.includes(ELL));
  assert.ok(r.text.endsWith("TAIL".slice(-2)));
  assert.ok(r.tokens <= 20);
});

test("tail cuts snap back to a word boundary when one is close", () => {
  // With a 12-token budget the raw cut lands mid-"deployment"; the snap
  // should back up so the kept text ends on a whole word.
  const r = truncateToBudget("rollback the deployment now", 12, perChar, "truncate-tail", ELL);
  assert.notEqual(r, null);
  assert.ok(!/\w…$/.test(r.text) || !r.text.includes(" "), `cut mid-word: ${JSON.stringify(r.text)}`);
  assert.match(r.text, /^rollback…$|^rollback the…$/);
});

test("head cuts snap forward to a word boundary when one is close", () => {
  const r = truncateToBudget("rollback the deployment now", 10, perChar, "truncate-head", ELL);
  assert.notEqual(r, null);
  assert.match(r.text, /^…(deployment now|now)$/);
});

test("returns null when even one character plus the marker exceeds the target", () => {
  // perChar("…") = 1, so a target of 1 leaves no room for content.
  assert.equal(truncateToBudget("hello world", 1, perChar, "truncate-tail", ELL), null);
  assert.equal(truncateToBudget("hello world", 1, perChar, "truncate-head", ELL), null);
  assert.equal(truncateToBudget("hello world", 1, perChar, "truncate-middle", ELL), null);
});

test("returns null when the ellipsis alone exceeds the target", () => {
  const marker = "[truncated]";
  assert.equal(truncateToBudget("hello world", 5, perChar, "truncate-tail", marker), null);
});

test("a custom multi-token ellipsis is charged like any other text", () => {
  const marker = " [cut] ";
  const r = truncateToBudget("aaaa bbbb cccc dddd", 15, perChar, "truncate-tail", marker);
  assert.notEqual(r, null);
  assert.ok(r.text.endsWith(marker));
  assert.ok(r.tokens <= 15);
});

test("never splits an astral emoji (surrogate pair) at the cut", () => {
  const text = "💡💡💡💡💡💡💡💡"; // 16 UTF-16 units, 8 code points
  for (const strategy of ["truncate-tail", "truncate-head", "truncate-middle"]) {
    const r = truncateToBudget(text, 5, charsCounter, strategy, ELL);
    assert.notEqual(r, null, strategy);
    // A lone surrogate would appear as �-adjacent garbage; check pairs.
    for (const ch of r.text) {
      const code = ch.codePointAt(0);
      assert.ok(code < 0xd800 || code > 0xdfff, `${strategy} left a lone surrogate`);
    }
    assert.ok(r.tokens <= 5, strategy);
  }
});

test("result cost is <= target across a sweep of targets and strategies", () => {
  const text =
    "The export queue backed up after the deploy; rollback restored baseline " +
    "error rates within four minutes and no jobs were lost. 詳細は監査ログを参照。";
  for (const strategy of ["truncate-tail", "truncate-head", "truncate-middle"]) {
    for (const counter of [perChar, charsCounter]) {
      for (let target = 2; target <= counter(text); target += 3) {
        const r = truncateToBudget(text, target, counter, strategy, ELL);
        if (r !== null) {
          assert.ok(r.tokens <= target, `${strategy} target=${target} got ${r.tokens}`);
          assert.equal(r.tokens, counter(r.text));
        }
      }
    }
  }
});

test("truncation is deterministic: same inputs, same cut", () => {
  const text = "one two three four five six seven eight nine ten";
  const a = truncateToBudget(text, 20, perChar, "truncate-middle", ELL);
  const b = truncateToBudget(text, 20, perChar, "truncate-middle", ELL);
  assert.deepEqual(a, b);
});
