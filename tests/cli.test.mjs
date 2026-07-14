// CLI integration: the built dist/cli.js run as a child process against
// the committed example specs and inline stdin specs — commands, flags,
// exit codes (0 ok / 1 overflow or failed gate / 2 usage) and JSON output.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { VERSION } from "../dist/index.js";
import { ROOT, runCli } from "./helpers.mjs";

const CHAT = "examples/agent-chat.json";
const BRIEF = "examples/doc-brief.json";

/** A spec whose pinned sections cannot fit: the overflow case. */
const OVERFLOW_SPEC = JSON.stringify({
  budget: 10,
  sections: [{ id: "pin", text: "p".repeat(200), pinned: true }, { id: "x", text: "hello" }],
});

test("--version matches package.json and the library constant", () => {
  const r = runCli(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), VERSION);
  assert.equal(
    r.stdout.trim(),
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version,
  );
});

test("usage errors all exit 2: no args, unknown command/flag, missing file, bad spec", () => {
  assert.equal(runCli([]).status, 2);
  assert.equal(runCli(["frobnicate", CHAT]).status, 2);
  assert.equal(runCli(["pack", CHAT, "--frobnicate"]).status, 2);
  const missing = runCli(["pack", "does-not-exist.json"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no such file/);
  const badSpec = runCli(["pack", "-"], '{"budget": 10, "sections": [{"id": 5}]}');
  assert.equal(badSpec.status, 2);
  assert.match(badSpec.stderr, /sections\[0\]\.id/);
  // --help itself is a success and documents the contract.
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  for (const word of ["pack", "explain", "check", "fingerprint", "--allow", "Exit codes"]) {
    assert.ok(help.stdout.includes(word), `help missing ${word}`);
  }
});

test("pack renders pins and survivors, drops the evicted, exits 0", () => {
  const r = runCli(["pack", CHAT, "--stats"]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("You answer only from the provided context"));
  assert.ok(r.stdout.includes("why did my first two rotation attempts fail?"));
  assert.ok(r.stdout.includes("role=owner")); // tool logs kept
  assert.ok(!r.stdout.includes("note to self")); // scratch evicted
  assert.match(r.stderr, /3 kept, 1 truncated, 2 evicted · \d+\/\d+ tokens · fits yes/);
});

test("pack --json emits the full layout and is byte-identical across runs", () => {
  const a = runCli(["pack", CHAT, "--json"]);
  const b = runCli(["pack", CHAT, "--json"]);
  assert.equal(a.status, 0);
  assert.equal(a.stdout, b.stdout);
  const layout = JSON.parse(a.stdout);
  assert.equal(layout.fits, true);
  assert.match(layout.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(layout.decisions.length, 6);
  const scratch = layout.decisions.find((d) => d.id === "scratch");
  assert.equal(scratch.action, "evict");
  assert.ok(scratch.detail.length > 0);
});

test("explain prints the decision report with all three blocks", () => {
  const r = runCli(["explain", CHAT]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ctxpack \d+\.\d+\.\d+ — packing decisions/);
  assert.match(r.stdout, /KEPT \(3\)/);
  assert.match(r.stdout, /TRUNCATED \(1\)/);
  assert.match(r.stdout, /EVICTED \(2\)/);
  assert.match(r.stdout, /\[group-quota\]/);
  const json = runCli(["explain", CHAT, "--json"]);
  const report = JSON.parse(json.stdout);
  assert.equal(report.sections, undefined); // explain --json is the audit, not the content
  assert.equal(report.decisions.length, 6);
});

test("check is a CI gate: fails closed, --allow opens it deliberately", () => {
  const strict = runCli(["check", CHAT]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /FAIL \d+ evicted/);
  const partial = runCli(["check", CHAT, "--allow", "truncate"]);
  assert.equal(partial.status, 1); // evictions still forbidden
  const open = runCli(["check", CHAT, "--allow", "truncate,evict"]);
  assert.equal(open.status, 0);
  assert.match(open.stdout, /PASS/);
  const json = JSON.parse(runCli(["check", CHAT, "--allow", "truncate,evict", "--json"]).stdout);
  assert.equal(json.pass, true);
  assert.deepEqual(json.allow, ["truncate", "evict"]);
  assert.equal(runCli(["check", CHAT, "--allow", "explode"]).status, 2);
});

test("stdin specs and flag overrides work; overrides change the fingerprint", () => {
  const spec = readFileSync(join(ROOT, CHAT), "utf8");
  const viaStdin = runCli(["fingerprint", "-"], spec);
  const viaFile = runCli(["fingerprint", CHAT]);
  assert.equal(viaStdin.status, 0);
  assert.equal(viaStdin.stdout, viaFile.stdout);
  const overridden = runCli(["fingerprint", CHAT, "--budget", "400"]);
  assert.equal(overridden.status, 0);
  assert.notEqual(overridden.stdout, viaFile.stdout);
  assert.equal(runCli(["fingerprint", CHAT, "--budget", "nope"]).status, 2);
});

test("pinned overflow: pack and explain exit 1 but still produce output", () => {
  const packed = runCli(["pack", "-"], OVERFLOW_SPEC);
  assert.equal(packed.status, 1);
  assert.ok(packed.stdout.includes("ppp")); // the pin is still rendered
  assert.ok(!packed.stdout.includes("hello"));
  const explained = runCli(["explain", "-"], OVERFLOW_SPEC);
  assert.equal(explained.status, 1);
  assert.match(explained.stdout, /fits NO/);
  assert.match(explained.stdout, /OVERFLOW: pinned sections alone exceed capacity/);
  // The priority-ordered example still checks clean end to end.
  const brief = runCli(["check", BRIEF, "--allow", "truncate,evict"]);
  assert.equal(brief.status, 0);
});
