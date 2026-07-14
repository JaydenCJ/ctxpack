// parseSpec: strict JSON spec parsing. The important behavior is that
// mistakes fail loudly with a path — a typo'd key that silently changes
// packing would be the worst possible failure mode for a budget tool.
import test from "node:test";
import assert from "node:assert/strict";

import { parseSpec, pack } from "../dist/index.js";

const MINIMAL = { budget: 10, sections: [{ id: "a", text: "hi" }] };

test("parses a minimal spec", () => {
  const spec = parseSpec(JSON.stringify(MINIMAL));
  assert.equal(spec.options.budget, 10);
  assert.deepEqual(spec.sections, [{ id: "a", text: "hi" }]);
});

test("parses every option and passes them through", () => {
  const spec = parseSpec(
    JSON.stringify({
      budget: 100,
      reserve: 10,
      counter: "words",
      separator: "\n",
      ellipsis: "[cut]",
      order: "priority",
      groups: { history: { maxTokens: 40, maxFraction: 0.5 } },
      sections: [
        { id: "s", text: "x", priority: 3, pinned: true, group: "history", strategy: "truncate-tail", minTokens: 5 },
      ],
    }),
  );
  assert.equal(spec.options.reserve, 10);
  assert.equal(spec.options.counter, "words");
  assert.equal(spec.options.separator, "\n");
  assert.equal(spec.options.ellipsis, "[cut]");
  assert.equal(spec.options.order, "priority");
  assert.deepEqual(spec.options.groups, { history: { maxTokens: 40, maxFraction: 0.5 } });
  assert.equal(spec.sections[0].minTokens, 5);
});

test("a parsed spec feeds straight into pack()", () => {
  const spec = parseSpec(JSON.stringify(MINIMAL));
  const layout = pack(spec.sections, spec.options);
  assert.equal(layout.fits, true);
  assert.equal(layout.sections.length, 1);
});

test("invalid JSON is reported as such", () => {
  assert.throws(() => parseSpec("{nope"), /spec is not valid JSON/);
});

test("non-object roots are rejected", () => {
  assert.throws(() => parseSpec("[]"), /root: must be a JSON object/);
  assert.throws(() => parseSpec('"hello"'), /root: must be a JSON object/);
});

test("unknown top-level keys are rejected with the key name", () => {
  assert.throws(
    () => parseSpec(JSON.stringify({ ...MINIMAL, bugdet: 5 })),
    /root\.bugdet: unknown key/,
  );
});

test("unknown section keys are rejected with the path", () => {
  const spec = { budget: 10, sections: [{ id: "a", text: "x", prioritiy: 9 }] };
  assert.throws(() => parseSpec(JSON.stringify(spec)), /sections\[0\]\.prioritiy: unknown key/);
});

test("missing budget or sections is an error", () => {
  assert.throws(() => parseSpec(JSON.stringify({ sections: [] })), /\.budget: required/);
  assert.throws(() => parseSpec(JSON.stringify({ budget: 10 })), /\.sections: required/);
});

test("counter must be a known built-in name", () => {
  assert.throws(
    () => parseSpec(JSON.stringify({ ...MINIMAL, counter: "bpe" })),
    /\.counter: must be one of: chars, words/,
  );
});

test("section id and text are required strings", () => {
  assert.throws(
    () => parseSpec(JSON.stringify({ budget: 10, sections: [{ text: "x" }] })),
    /sections\[0\]\.id: required/,
  );
  assert.throws(
    () => parseSpec(JSON.stringify({ budget: 10, sections: [{ id: "a", text: 5 }] })),
    /sections\[0\]\.text: required/,
  );
});

test("group quotas reject unknown keys", () => {
  const spec = { ...MINIMAL, groups: { g: { maxToken: 5 } } };
  assert.throws(() => parseSpec(JSON.stringify(spec)), /groups\.g\.maxToken: unknown key/);
});

test("value errors are left to pack(): parse succeeds, pack throws", () => {
  // parseSpec checks shape; pack() checks values. Duplicate ids pass the
  // parser and fail in pack with the same message the library API gives.
  const spec = parseSpec(
    JSON.stringify({ budget: 10, sections: [{ id: "a", text: "x" }, { id: "a", text: "y" }] }),
  );
  assert.throws(() => pack(spec.sections, spec.options), /duplicate id "a"/);
});
