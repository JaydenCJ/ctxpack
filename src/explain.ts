/**
 * Human-readable packing reports.
 *
 * explainLayout() renders the decision log as a stable, greppable text
 * table: a header with the token accounting and fingerprint, then KEPT /
 * TRUNCATED / EVICTED blocks with per-section reasons. The format is part
 * of the CLI's contract (smoke tests grep it), so changes here are
 * breaking changes.
 */

import { VERSION } from "./version.js";
import type { Decision, Layout } from "./types.js";

/** "1 token" / "n tokens" — every human-readable message uses this. */
export function fmtTokens(n: number): string {
  return `${n} token${n === 1 ? "" : "s"}`;
}

/** Pad-right helper that never truncates. */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Label for the priority/pinned column. */
function rank(decision: Decision): string {
  return decision.pinned ? "pinned" : `p=${decision.priority}`;
}

function block(title: string, rows: string[]): string[] {
  const out = [`${title} (${rows.length})`];
  if (rows.length === 0) out.push("  none");
  else out.push(...rows);
  return out;
}

/** Render the full decision report for a layout. */
export function explainLayout(layout: Layout): string {
  const { tokens } = layout;
  const lines: string[] = [];
  lines.push(`ctxpack ${VERSION} — packing decisions`);
  lines.push("");
  lines.push(
    `budget ${tokens.budget} · reserve ${tokens.reserve} · capacity ${tokens.capacity} · ` +
      `used ${tokens.used} · free ${tokens.free} · fits ${layout.fits ? "yes" : "NO"}`,
  );
  lines.push(`fingerprint ${layout.fingerprint}`);
  lines.push("");

  const kept = layout.decisions.filter((d) => d.action === "keep");
  const truncated = layout.decisions.filter((d) => d.action === "truncate");
  const evicted = layout.decisions.filter((d) => d.action === "evict");
  const idWidth = Math.max(2, ...layout.decisions.map((d) => d.id.length));

  lines.push(
    ...block(
      "KEPT",
      kept.map(
        (d) => `  = ${pad(d.id, idWidth)}  ${pad(rank(d), 8)}  ${fmtTokens(d.finalTokens)}`,
      ),
    ),
  );
  lines.push(
    ...block(
      "TRUNCATED",
      truncated.map(
        (d) =>
          `  ~ ${pad(d.id, idWidth)}  ${pad(rank(d), 8)}  ` +
          `${d.originalTokens} -> ${fmtTokens(d.finalTokens)}  [${d.reason}] ${d.detail}`,
      ),
    ),
  );
  lines.push(
    ...block(
      "EVICTED",
      evicted.map(
        (d) =>
          `  - ${pad(d.id, idWidth)}  ${pad(rank(d), 8)}  ` +
          `${fmtTokens(d.originalTokens)}  [${d.reason}] ${d.detail}`,
      ),
    ),
  );

  if (!layout.fits) {
    lines.push("");
    lines.push(
      `OVERFLOW: pinned sections alone exceed capacity by ${fmtTokens(-tokens.free)} — ` +
        "raise the budget, lower the reserve, or unpin something.",
    );
  }
  return lines.join("\n");
}

/** One-line summary used by `ctxpack check` and `pack --stats`. */
export function summarizeLayout(layout: Layout): string {
  const kept = layout.decisions.filter((d) => d.action === "keep").length;
  const truncated = layout.decisions.filter((d) => d.action === "truncate").length;
  const evicted = layout.decisions.filter((d) => d.action === "evict").length;
  return (
    `${kept} kept, ${truncated} truncated, ${evicted} evicted · ` +
    `${layout.tokens.used}/${layout.tokens.capacity} tokens · fits ${layout.fits ? "yes" : "NO"}`
  );
}
