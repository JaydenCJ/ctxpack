# The pack-spec format

A pack spec is one JSON object holding everything a `pack()` call needs:
the budget, the policy knobs, and the sections. The CLI reads it from a
file or stdin (`-`); the library takes the same data via `parseSpec()` or
as plain arguments. Parsing is strict — unknown keys are rejected with
their path, so a typo like `"prioritiy"` fails loudly instead of silently
packing wrong.

```json
{
  "budget": 220,
  "reserve": 24,
  "counter": "chars",
  "separator": "\n\n",
  "ellipsis": "…",
  "order": "input",
  "groups": {
    "history": { "maxFraction": 0.5 }
  },
  "sections": [
    { "id": "system", "pinned": true, "text": "You are terse." },
    { "id": "h-1", "group": "history", "priority": 1, "text": "…" },
    { "id": "logs", "priority": 5, "strategy": "truncate-head", "minTokens": 20, "text": "…" }
  ]
}
```

## Top-level keys

| Key | Type | Default | Effect |
|---|---|---|---|
| `budget` | integer > 0 | *required* | Total token budget for the packed context. |
| `reserve` | integer ≥ 0 | `0` | Tokens held back (e.g. for the model's reply). Capacity = budget − reserve. |
| `counter` | `"chars"` \| `"words"` | `"chars"` | Built-in estimator. The library API also accepts any `(text) => number`. |
| `separator` | string | `"\n\n"` | Joined between sections when rendering; its token cost is charged per join. |
| `ellipsis` | string | `"…"` | Marker spliced in where text was cut; its cost is charged too. |
| `order` | `"input"` \| `"priority"` | `"input"` | Output order of kept sections. Eviction is unaffected. |
| `groups` | object | — | Per-group quotas, applied before the global budget (see below). |
| `sections` | array | *required* | The sections, in input order. |

## Section keys

| Key | Type | Default | Effect |
|---|---|---|---|
| `id` | string | *required* | Unique; referenced by decisions and fingerprints. |
| `text` | string | *required* | The body. Empty is legal and costs zero. |
| `priority` | finite number | `0` | Higher survives longer. Negative is legal. |
| `pinned` | boolean | `false` | Never evicted or truncated, by anything — including group quotas. |
| `group` | string | — | Membership for group quotas. A section has at most one group. |
| `strategy` | see below | `"drop"` | How the section shrinks when it must. |
| `minTokens` | integer ≥ 0 | `0` | If truncation cannot keep at least this many tokens, evict instead. |

### Strategies

| Strategy | Keeps | Typical use |
|---|---|---|
| `drop` | all or nothing | chat turns, notes — things that are useless in half |
| `truncate-tail` | the beginning | documents, instructions with the point up front |
| `truncate-head` | the end | logs, transcripts — the latest lines matter |
| `truncate-middle` | both ends | stack traces, diffs — the edges carry the signal |

## Group quotas

```json
"groups": { "history": { "maxTokens": 800, "maxFraction": 0.5 } }
```

A quota caps the combined token cost of a group's members. `maxTokens` is
absolute; `maxFraction` is a fraction of capacity, floored; when both are
given the tighter cap wins. Quotas run before the global budget pass and
use the same victim rule (lowest priority first, earlier input first on
ties). Pinned members are exempt: pins outrank quotas, and the group is
left over-quota rather than a pin being touched.

## Ordering and eviction rules

- The single eviction rule everywhere: **lower priority is evicted first;
  among equal priorities, the section appearing earlier in the input is
  evicted first.** Append chat history chronologically and this becomes a
  recency policy for free.
- Truncation cuts *just enough* to close the current overflow, never more,
  and always re-cuts from the original text so repeated truncation cannot
  stack ellipsis markers.
- Every change is re-priced with the counter — the engine never trusts a
  token estimate it can measure.
- If pinned sections alone exceed capacity, nothing throws: the layout
  comes back with `fits: false`, all pins kept, everything else evicted,
  and the CLI exits `1`.

## Determinism contract

Same spec + same counter ⇒ byte-identical layout, decisions and
fingerprint, on any machine. There are no clocks, no randomness, no
locale- or platform-dependent comparisons anywhere in the engine. The
fingerprint is FNV-1a 64-bit over the canonical layout (algorithm
version, budget, reserve, fits, kept ids + texts in output order) — a
change detector for logs and caches, not a security boundary.
