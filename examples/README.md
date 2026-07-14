# ctxpack examples

Two committed pack specs, small enough to read whole and real enough to
show every decision kind. Run them from the repository root after
`npm install && npm run build`.

## agent-chat.json — a support agent hitting its window

A pinned system prompt and a pinned user question, tool logs that prefer
`truncate-head` (newest lines matter), a chat-history group capped at 30%
of capacity, and a low-priority scratch note. The budget is deliberately
one notch too small for everything.

```bash
node dist/cli.js explain examples/agent-chat.json   # the decision report
node dist/cli.js pack examples/agent-chat.json      # what the model would see
node dist/cli.js check examples/agent-chat.json     # exits 1: evictions happened
node dist/cli.js check examples/agent-chat.json --allow truncate,evict  # exits 0
```

Expect: both pins kept, the history group shrunk to its quota, the scratch
note evicted at the global budget, and one history turn truncated tail-first.

## doc-brief.json — an incident brief under a word budget

Uses the `words` counter, `order: "priority"` (most important first),
`truncate-middle` for a timeline whose edges carry the signal, and a
custom ` […] ` ellipsis. Shows that a section can be evicted with reason
`min-tokens` when the leftover space is too small to be useful.

```bash
node dist/cli.js pack examples/doc-brief.json
node dist/cli.js fingerprint examples/doc-brief.json
```

## Things worth trying

```bash
# Tighten the budget and watch the decisions change, one victim at a time.
node dist/cli.js explain examples/agent-chat.json --budget 120

# Feed a spec on stdin — same fingerprint as reading the file.
node dist/cli.js fingerprint - < examples/agent-chat.json

# Machine-readable everything.
node dist/cli.js pack examples/agent-chat.json --json | head -30
```
