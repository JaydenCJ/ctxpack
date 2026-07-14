# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- The core packing engine: `pack(sections, options)` fits prioritized,
  optionally pinned sections into a token budget and returns a `Layout`
  with the kept sections, one explainable `Decision` per input section,
  full token accounting (budget, reserve, capacity, separators, free) and
  a reproducibility fingerprint.
- Priority eviction with a single deterministic rule: lower priority is
  evicted first; among equal priorities the earlier input section goes
  first, so chronologically appended history gets recency behavior free.
- Pinned sections that survive every pass — budget, group quotas,
  everything. If pins alone exceed capacity the layout is returned with
  `fits: false` instead of throwing.
- Four shrink strategies per section: `drop` (all-or-nothing),
  `truncate-tail`, `truncate-head` and `truncate-middle`, all cutting
  *just enough* to close the overflow, verified by re-measuring with the
  counter (never estimated), surrogate-pair safe, word-boundary snapping,
  with a `minTokens` floor below which the section is evicted instead.
- Group quotas: cap a named group of sections (`maxTokens`, `maxFraction`
  of capacity, or both — tighter wins) before the global budget pass.
- Reserved headroom (`reserve`) and separator-cost accounting: the tokens
  spent joining sections are charged like any other tokens.
- Pluggable token counters: bring your model's tokenizer as a
  `(text) => number`, or use the built-in deterministic estimators
  (`chars`, code-point aware and CJK-honest, and `words`).
- Layout fingerprints: FNV-1a 64-bit over a canonical serialization of
  what the model would see — same spec, same fingerprint, any machine.
- A strict JSON pack-spec format (`parseSpec`) that rejects unknown keys
  with their path, plus [docs/pack-spec.md](docs/pack-spec.md) documenting
  every key, the eviction rules and the determinism contract.
- The `ctxpack` CLI: `pack` (render or `--json`), `explain` (the decision
  report), `check` (a CI gate that fails closed, opened deliberately with
  `--allow truncate,evict`) and `fingerprint`; stdin specs via `-`;
  `--budget`/`--reserve`/`--counter` overrides; script-friendly exit codes
  (0 ok / 1 overflow or failed gate / 2 usage error).
- Committed example specs (a support-agent window and an incident brief)
  and a runnable [examples/README.md](examples/README.md).
- Test suite: 90 node:test tests (unit + CLI integration) and an
  end-to-end `scripts/smoke.sh` against the bundled examples.

[0.1.0]: https://github.com/JaydenCJ/ctxpack/releases/tag/v0.1.0
