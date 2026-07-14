// renderLayout / explainLayout / summarizeLayout: the human-facing output.
// The explain format is part of the CLI contract (scripts and smoke tests
// grep it), so structure — not just content — is pinned here.
import test from "node:test";
import assert from "node:assert/strict";

import { pack, renderLayout, explainLayout, summarizeLayout, VERSION } from "../dist/index.js";
import { section, perChar } from "./helpers.mjs";

function fixture() {
  return pack(
    [
      section("system", "s".repeat(12), { pinned: true }),
      section("logs", "l".repeat(40), { priority: 5, strategy: "truncate-tail" }),
      section("scratch", "n".repeat(10)),
    ],
    { counter: perChar, separator: "|", ellipsis: "…", budget: 40, reserve: 5 },
  );
}

test("renderLayout joins kept sections with the separator", () => {
  const layout = pack([section("a", "aa"), section("b", "bb")], {
    counter: perChar,
    separator: "|",
    budget: 10,
  });
  assert.equal(renderLayout(layout, "|"), "aa|bb");
});

test("renderLayout on an empty layout is the empty string", () => {
  const layout = pack([], { counter: perChar, budget: 10 });
  assert.equal(renderLayout(layout), "");
});

test("the rendered string costs exactly tokens.used under the same counter", () => {
  const layout = fixture();
  assert.equal(perChar(renderLayout(layout, "|")), layout.tokens.used);
});

test("explainLayout header carries version, accounting and fingerprint", () => {
  const text = explainLayout(fixture());
  assert.ok(text.startsWith(`ctxpack ${VERSION} — packing decisions`));
  assert.match(text, /budget 40 · reserve 5 · capacity 35 · used \d+ · free \d+ · fits yes/);
  assert.match(text, /fingerprint [0-9a-f]{16}/);
});

test("explainLayout groups sections into KEPT / TRUNCATED / EVICTED blocks", () => {
  const text = explainLayout(fixture());
  assert.match(text, /KEPT \(1\)\n  = system/);
  assert.match(text, /TRUNCATED \(1\)\n  ~ logs/);
  assert.match(text, /EVICTED \(1\)\n  - scratch/);
});

test("explainLayout shows reasons and token movement for shrunk sections", () => {
  const text = explainLayout(fixture());
  assert.match(text, /~ logs\s+p=5\s+40 -> \d+ tokens\s+\[budget\]/);
  assert.match(text, /- scratch\s+p=0\s+10 tokens\s+\[budget\]/);
});

test("explainLayout prints 'none' for empty blocks", () => {
  const layout = pack([section("a", "aa")], { counter: perChar, budget: 10 });
  const text = explainLayout(layout);
  assert.match(text, /TRUNCATED \(0\)\n  none/);
  assert.match(text, /EVICTED \(0\)\n  none/);
});

test("explainLayout flags pinned overflow loudly", () => {
  const layout = pack([section("pin", "p".repeat(30), { pinned: true })], {
    counter: perChar,
    budget: 10,
  });
  const text = explainLayout(layout);
  assert.match(text, /fits NO/);
  assert.match(text, /OVERFLOW: pinned sections alone exceed capacity by 20 tokens/);
});

test("summarizeLayout is a stable one-liner", () => {
  assert.equal(
    summarizeLayout(fixture()),
    "1 kept, 1 truncated, 1 evicted · 35/35 tokens · fits yes",
  );
});
