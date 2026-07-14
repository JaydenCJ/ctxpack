// pack(): the policy engine itself. The per-character counter makes every
// token count exact, so these tests assert real arithmetic — budgets,
// separators, quotas — not just "something was evicted".
import test from "node:test";
import assert from "node:assert/strict";

import { pack } from "../dist/index.js";
import { section, perChar } from "./helpers.mjs";

/** pack() with a per-character counter and a 1-token separator by default. */
function packc(sections, options = {}) {
  return pack(sections, { counter: perChar, separator: "|", ellipsis: "…", ...options });
}

function decision(layout, id) {
  const found = layout.decisions.find((d) => d.id === id);
  assert.notEqual(found, undefined, `no decision for ${id}`);
  return found;
}

test("everything fits: all sections kept in input order, decisions say why", () => {
  const layout = packc([section("a", "aaaa"), section("b", "bbbb")], { budget: 20 });
  assert.deepEqual(layout.sections.map((s) => s.id), ["a", "b"]);
  assert.equal(layout.fits, true);
  assert.equal(decision(layout, "a").reason, "fits");
  assert.equal(decision(layout, "a").action, "keep");
});

test("token accounting: sections + separators, reserve subtracted from capacity", () => {
  // 4 + 4 tokens + 1 separator = 9 used; capacity = 15 - 3 = 12.
  const layout = packc([section("a", "aaaa"), section("b", "bbbb")], { budget: 15, reserve: 3 });
  assert.deepEqual(layout.tokens, {
    budget: 15,
    reserve: 3,
    capacity: 12,
    used: 9,
    separators: 1,
    free: 3,
  });
});

test("lowest priority is evicted first", () => {
  const layout = packc(
    [
      section("low", "llll", { priority: 1 }),
      section("high", "hhhh", { priority: 5 }),
    ],
    { budget: 6 },
  );
  assert.deepEqual(layout.sections.map((s) => s.id), ["high"]);
  const d = decision(layout, "low");
  assert.equal(d.action, "evict");
  assert.equal(d.reason, "budget");
  assert.match(d.detail, /lowest priority \(p=1\)/);
});

test("equal priorities: the earlier section is evicted first (recency policy)", () => {
  const layout = packc(
    [section("old", "oooo"), section("mid", "mmmm"), section("new", "nnnn")],
    { budget: 9 }, // fits two sections (4+4+1), not three (4+4+4+2)
  );
  assert.deepEqual(layout.sections.map((s) => s.id), ["mid", "new"]);
  assert.equal(decision(layout, "old").action, "evict");
});

test("negative priorities are legal and evicted before priority 0", () => {
  const layout = packc(
    [section("junk", "jjjj", { priority: -2 }), section("note", "nnnn")],
    { budget: 4 },
  );
  assert.deepEqual(layout.sections.map((s) => s.id), ["note"]);
});

test("pinned sections survive even at priority disadvantage", () => {
  const layout = packc(
    [
      section("pin", "pppp", { pinned: true, priority: -10 }),
      section("big", "b".repeat(20), { priority: 100 }),
    ],
    { budget: 10 },
  );
  assert.deepEqual(layout.sections.map((s) => s.id), ["pin"]);
  assert.equal(decision(layout, "pin").reason, "pinned");
  assert.equal(decision(layout, "big").action, "evict");
});

test("evicting a section also frees its separator", () => {
  // Three 4-token sections + 2 separators = 14. Budget 9 must evict one:
  // that frees 4 + 1 = 5, leaving 9 exactly — a second eviction would be a bug.
  const layout = packc(
    [section("a", "aaaa"), section("b", "bbbb"), section("c", "cccc")],
    { budget: 9 },
  );
  assert.equal(layout.sections.length, 2);
  assert.equal(layout.tokens.used, 9);
});

test("truncatable sections are cut just enough instead of evicted", () => {
  const layout = packc(
    [
      section("keep", "kkkk", { priority: 5 }),
      section("log", "x".repeat(30), { strategy: "truncate-tail" }),
    ],
    { budget: 20 },
  );
  const d = decision(layout, "log");
  assert.equal(d.action, "truncate");
  assert.equal(d.reason, "budget");
  assert.ok(d.finalTokens < d.originalTokens);
  assert.ok(layout.tokens.used <= 20);
  assert.deepEqual(layout.sections.map((s) => s.id), ["keep", "log"]);
  assert.equal(layout.sections.find((s) => s.id === "log").truncated, true);
});

test("truncation target below minTokens evicts instead, reason min-tokens", () => {
  const layout = packc(
    [
      section("keep", "k".repeat(18), { priority: 5 }),
      section("trace", "t".repeat(30), { strategy: "truncate-tail", minTokens: 10 }),
    ],
    { budget: 20 }, // target for trace would be 20 - 18 - 1 = 1 < 10
  );
  const d = decision(layout, "trace");
  assert.equal(d.action, "evict");
  assert.equal(d.reason, "min-tokens");
  assert.match(d.detail, /below minimum 10/);
});

test("after a failed truncation the packer moves on to the next victim", () => {
  const layout = packc(
    [
      section("stub", "ss", { priority: 0, strategy: "truncate-tail", minTokens: 2 }),
      section("big", "b".repeat(12), { priority: 1 }),
      section("top", "tttt", { priority: 9 }),
    ],
    { budget: 7 },
  );
  // stub (p=0) cannot shrink below 2 usefully, gets evicted; then big.
  assert.deepEqual(layout.sections.map((s) => s.id), ["top"]);
});

test("group quota by maxTokens shrinks only that group", () => {
  const layout = packc(
    [
      section("h1", "1".repeat(10), { group: "history" }),
      section("h2", "2".repeat(10), { group: "history", priority: 1 }),
      section("solo", "s".repeat(10)),
    ],
    { budget: 100, groups: { history: { maxTokens: 12 } } },
  );
  // h1 (lower priority via tie-break? no: h1 p=0 < h2 p=1) evicted for quota.
  assert.equal(decision(layout, "h1").reason, "group-quota");
  assert.equal(decision(layout, "h2").action, "keep");
  assert.equal(decision(layout, "solo").action, "keep");
});

test("group quota by maxFraction is computed against capacity, floored", () => {
  const layout = packc(
    [section("h1", "1".repeat(9), { group: "g" }), section("other", "oo")],
    { budget: 22, reserve: 2, groups: { g: { maxFraction: 0.4 } } }, // floor(0.4*20)=8
  );
  const d = decision(layout, "h1");
  assert.equal(d.action, "evict");
  assert.match(d.detail, /9 > 8/);
});

test("group quota prefers truncation when the member allows it", () => {
  const layout = packc(
    [
      section("h1", "1".repeat(20), { group: "g", strategy: "truncate-tail" }),
      section("h2", "2".repeat(5), { group: "g", priority: 1 }),
    ],
    { budget: 100, groups: { g: { maxTokens: 15 } } },
  );
  const d = decision(layout, "h1");
  assert.equal(d.action, "truncate");
  assert.equal(d.reason, "group-quota");
  assert.ok(d.finalTokens <= 10); // 15 - 5 already used by h2
  assert.equal(decision(layout, "h2").action, "keep");
});

test("pinned members are exempt from group quotas (pins outrank quotas)", () => {
  const layout = packc(
    [
      section("pinned-h", "p".repeat(30), { group: "g", pinned: true }),
      section("h1", "1".repeat(10), { group: "g" }),
    ],
    { budget: 100, groups: { g: { maxTokens: 12 } } },
  );
  // The pin alone exceeds the quota; the unpinned member is sacrificed,
  // then the group is left over-quota rather than touching the pin.
  assert.equal(decision(layout, "pinned-h").action, "keep");
  assert.equal(decision(layout, "h1").action, "evict");
  assert.equal(layout.fits, true); // global budget is still fine
});

test("both maxTokens and maxFraction given: the tighter cap wins", () => {
  const layout = packc([section("h", "h".repeat(10), { group: "g" })], {
    budget: 40,
    groups: { g: { maxTokens: 30, maxFraction: 0.1 } }, // floor(0.1*40)=4 < 30
  });
  assert.equal(decision(layout, "h").action, "evict");
  assert.match(decision(layout, "h").detail, /10 > 4/);
});

test("pinned overflow: fits=false, pins kept, everything else evicted, no throw", () => {
  const layout = packc(
    [
      section("pin1", "p".repeat(10), { pinned: true }),
      section("pin2", "q".repeat(10), { pinned: true }),
      section("victim", "vvvv"),
    ],
    { budget: 12 },
  );
  assert.equal(layout.fits, false);
  assert.deepEqual(layout.sections.map((s) => s.id), ["pin1", "pin2"]);
  assert.ok(layout.tokens.free < 0);
  assert.match(decision(layout, "pin1").detail, /exceeds capacity by 9/); // 21 - 12
});

test("a single oversized pin overflows the same way", () => {
  const layout = packc([section("pin", "p".repeat(50), { pinned: true })], { budget: 10 });
  assert.equal(layout.fits, false);
  assert.equal(layout.sections.length, 1);
});

test("empty-text sections cost zero and are kept", () => {
  const layout = packc([section("marker", ""), section("body", "bbbb")], { budget: 6 });
  assert.deepEqual(layout.sections.map((s) => s.id), ["marker", "body"]);
  assert.equal(decision(layout, "marker").finalTokens, 0);
});

test('order: "priority" reorders output without changing eviction', () => {
  const layout = packc(
    [section("low", "llll", { priority: 1 }), section("high", "hhhh", { priority: 9 })],
    { budget: 20, order: "priority" },
  );
  assert.deepEqual(layout.sections.map((s) => s.id), ["high", "low"]);
  // Decisions stay in input order regardless of output order.
  assert.deepEqual(layout.decisions.map((d) => d.id), ["low", "high"]);
});

test("separator cost uses the configured separator and counter", () => {
  const layout = packc([section("a", "aa"), section("b", "bb")], {
    budget: 20,
    separator: "-----", // 5 tokens under perChar
  });
  assert.equal(layout.tokens.separators, 5);
  assert.equal(layout.tokens.used, 9);
});

test("re-truncation cuts from the original text (no stacked ellipsis)", () => {
  // The group quota truncates first; the global budget then truncates the
  // same section further. The result must contain exactly one marker.
  const layout = packc(
    [
      section("log", "x ".repeat(30).trim(), { group: "g", strategy: "truncate-tail" }),
      section("pin", "p".repeat(10), { pinned: true }),
    ],
    { budget: 26, groups: { g: { maxTokens: 20 } } },
  );
  const log = layout.sections.find((s) => s.id === "log");
  assert.notEqual(log, undefined);
  const markers = [...log.text].filter((ch) => ch === "…").length;
  assert.equal(markers, 1);
  assert.ok(layout.tokens.used <= 26);
});

test("validation: duplicate ids are rejected with the path", () => {
  assert.throws(
    () => packc([section("a", "x"), section("a", "y")], { budget: 10 }),
    /sections\[1\]\.id: duplicate id "a"/,
  );
});

test("validation: bad budget, reserve, strategy, minTokens, order", () => {
  assert.throws(() => packc([], { budget: 0 }), /options\.budget/);
  assert.throws(() => packc([], { budget: 2.5 }), /options\.budget/);
  assert.throws(() => packc([], { budget: 10, reserve: 10 }), /leaves no capacity/);
  assert.throws(() => packc([], { budget: 10, reserve: -1 }), /options\.reserve/);
  assert.throws(
    () => packc([section("a", "x", { strategy: "shrink" })], { budget: 10 }),
    /unknown strategy "shrink"/,
  );
  assert.throws(
    () => packc([section("a", "x", { minTokens: -1 })], { budget: 10 }),
    /minTokens/,
  );
  assert.throws(() => packc([], { budget: 10, order: "random" }), /options\.order/);
});

test("validation: group quota shape errors carry the group name", () => {
  assert.throws(() => packc([], { budget: 10, groups: { g: {} } }), /groups\.g.*maxTokens or maxFraction/);
  assert.throws(() => packc([], { budget: 10, groups: { g: { maxFraction: 1.5 } } }), /groups\.g\.maxFraction/);
  assert.throws(() => packc([], { budget: 10, groups: { g: { maxTokens: -5 } } }), /groups\.g\.maxTokens/);
});

test("every input section gets exactly one decision, in input order", () => {
  const ids = ["s1", "s2", "s3", "s4", "s5"];
  const layout = packc(
    ids.map((id, i) => section(id, id.repeat(3), { priority: i % 2 })),
    { budget: 12 },
  );
  assert.deepEqual(layout.decisions.map((d) => d.id), ids);
  for (const d of layout.decisions) {
    assert.ok(["keep", "truncate", "evict"].includes(d.action));
    assert.ok(d.detail.length > 0, `empty detail for ${d.id}`);
  }
});

test("determinism: repeated packs produce deeply equal layouts", () => {
  const sections = [
    section("sys", "You are terse.", { pinned: true }),
    section("h1", "older turn ".repeat(4), { group: "history" }),
    section("h2", "newer turn ".repeat(4), { group: "history" }),
    section("tool", "result ".repeat(20), { strategy: "truncate-middle", priority: 3 }),
  ];
  const options = { budget: 90, reserve: 8, groups: { history: { maxFraction: 0.4 } } };
  const a = packc(sections, options);
  const b = packc(sections, options);
  assert.deepEqual(a, b);
});

test("pack() does not mutate its inputs", () => {
  const sections = [section("a", "aaaa aaaa aaaa", { strategy: "truncate-tail" })];
  const frozen = JSON.stringify(sections);
  const options = { budget: 6, groups: { g: { maxTokens: 5 } } };
  const frozenOptions = JSON.stringify(options);
  packc(sections, options);
  assert.equal(JSON.stringify(sections), frozen);
  assert.equal(JSON.stringify(options), frozenOptions);
});

test("a realistic mixed layout: pins kept, logs truncated, chatter evicted", () => {
  const layout = packc(
    [
      section("system", "s".repeat(20), { pinned: true }),
      section("h1", "1".repeat(15), { group: "history", priority: 1 }),
      section("h2", "2".repeat(15), { group: "history", priority: 2, strategy: "truncate-tail" }),
      section("logs", "l".repeat(60), { priority: 5, strategy: "truncate-head", minTokens: 10 }),
      section("scratch", "n".repeat(10), { priority: 0 }),
      section("question", "q".repeat(12), { pinned: true }),
    ],
    { budget: 90, reserve: 10, groups: { history: { maxTokens: 20 } } },
  );
  assert.equal(layout.fits, true);
  assert.ok(layout.tokens.used <= 80);
  assert.equal(decision(layout, "system").action, "keep");
  assert.equal(decision(layout, "question").action, "keep");
  assert.equal(decision(layout, "logs").action, "truncate");
  assert.equal(decision(layout, "h1").action, "evict"); // quota: 15+15 > 20, h1 lower priority
  assert.equal(decision(layout, "scratch").action, "evict");
});
