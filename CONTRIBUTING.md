# Contributing to ctxpack

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, fully offline, and boringly
deterministic: same spec in, same layout out, forever.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/ctxpack.git
cd ctxpack
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (pack/explain/check/fingerprint,
exit codes, the `--allow` gate, stdin specs, budget overrides, fingerprint
determinism, and the pinned-overflow path) against the committed example
specs and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (the packer takes sections and returns a layout — only `cli.ts`
   touches the filesystem or the process).
5. Changes to eviction order, truncation cuts, counters or the canonical
   fingerprint serialization change what users' models see and break
   layout reproducibility: call them out explicitly in the PR and update
   [docs/pack-spec.md](docs/pack-spec.md) when the contract changes.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined. The truncation search and the FNV hash are in-repo on purpose.
- Determinism is API: no clocks, no randomness, no `Math.random`, no
  locale-dependent comparisons, stable tie-breaks everywhere. If two runs
  can differ, it is a bug.
- Never trust an estimate the counter can measure: any text the engine
  changes must be re-priced before it is summed against the budget.
- Pins are sacred: no pass — budget, quota, or anything added later — may
  evict or truncate a pinned section. Overflow is reported, not "fixed".
- No network calls, ever — ctxpack transforms local data only.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `ctxpack --version` output, the exact command line, and a
*minimal* pack spec (JSON) that reproduces the problem — a wrong victim, a
cut that overshoots the budget, or two runs that disagree. Specs are
self-contained, so a failing spec pasted into the issue is a full repro.

## Security

Do not open public issues for security problems (e.g. a spec that makes
the packer hang or a fingerprint collision that matters for your use);
use GitHub private vulnerability reporting on this repository instead.
