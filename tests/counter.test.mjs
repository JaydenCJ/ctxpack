// Built-in counters: the exact numbers are API (fingerprints depend on
// them), so these tests pin values, not just shapes. Both counters must be
// deterministic and monotonic — the truncation binary search relies on it.
import test from "node:test";
import assert from "node:assert/strict";

import { charsCounter, wordsCounter, resolveCounter, COUNTER_NAMES } from "../dist/index.js";

test("charsCounter: empty string costs zero", () => {
  assert.equal(charsCounter(""), 0);
});

test("charsCounter: ~4 ASCII characters per token, rounded up", () => {
  assert.equal(charsCounter("abcd"), 1);
  assert.equal(charsCounter("abcde"), 2);
  assert.equal(charsCounter("a"), 1); // even one character is a whole token
});

test("charsCounter: non-ASCII code points are one token each", () => {
  // Four kana would be ~1 token under the /4 rule but really tokenize
  // near one-per-character; under-counting overflows real windows.
  assert.equal(charsCounter("こんにちは"), 5);
});

test("charsCounter: mixed ASCII and wide text sums both parts", () => {
  // "ab " = 3 ASCII chars = ceil(3/4) = 1; two kana = 2.
  assert.equal(charsCounter("ab こん"), 3);
});

test("charsCounter: astral emoji count as one code point, not two units", () => {
  assert.equal(charsCounter("💡"), 1);
  assert.equal(charsCounter("💡💡💡"), 3);
});

test("wordsCounter: one token per whitespace-delimited word", () => {
  assert.equal(wordsCounter("the quick brown fox"), 4);
  assert.equal(wordsCounter(""), 0);
  assert.equal(wordsCounter("   \n\t  "), 0);
});

test("wordsCounter: overlong words are surcharged per 8 characters", () => {
  assert.equal(wordsCounter("short"), 1);
  assert.equal(wordsCounter("eightchr"), 2); // 8 chars: 1 + floor(8/8)
  assert.equal(wordsCounter("https://example.test/a/very/long/path"), 1 + 4);
});

test("counters are monotonic: substrings never cost more", () => {
  const samples = [
    "the quick brown fox jumps over the lazy dog",
    "log line 09:14 POST /v1/keys/rotate 403 role=developer",
    "日本語のテキストと English mixed 💡 content",
  ];
  for (const counter of [charsCounter, wordsCounter]) {
    for (const text of samples) {
      for (let i = 0; i <= text.length; i += 1) {
        assert.ok(counter(text.slice(0, i)) <= counter(text), `prefix ${i} of ${text}`);
        assert.ok(counter(text.slice(i)) <= counter(text), `suffix ${i} of ${text}`);
      }
    }
  }
});

test("resolveCounter: names, functions and the default", () => {
  assert.equal(resolveCounter("chars"), charsCounter);
  assert.equal(resolveCounter("words"), wordsCounter);
  assert.equal(resolveCounter(undefined), charsCounter);
  const custom = () => 42;
  assert.equal(resolveCounter(custom), custom);
});

test("resolveCounter: unknown name throws with the valid list", () => {
  assert.throws(() => resolveCounter("bpe"), /unknown counter "bpe".*chars, words/);
});

test("COUNTER_NAMES lists exactly the built-ins", () => {
  assert.deepEqual([...COUNTER_NAMES], ["chars", "words"]);
});
