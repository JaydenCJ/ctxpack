/**
 * Public types for ctxpack.
 *
 * The vocabulary is small on purpose: a *section* is the unit of context,
 * a *counter* prices text in tokens, `pack()` turns sections + a budget
 * into a *layout*, and every section gets exactly one *decision* that
 * explains what happened to it and why.
 */

/** How a section may be shrunk when it does not fit. */
export type TruncateStrategy =
  | "drop"
  | "truncate-tail"
  | "truncate-head"
  | "truncate-middle";

/** One unit of context: a system prompt, a chat turn, a tool result, a document chunk. */
export interface Section {
  /** Unique identifier; referenced by decisions and fingerprints. */
  id: string;
  /** The section body. May be empty (costs zero tokens). */
  text: string;
  /**
   * Higher priority survives longer. Default 0. Ties are broken by input
   * order: among equal priorities the *earlier* section is evicted first,
   * which makes "append newest last" behave like a recency policy.
   */
  priority?: number;
  /** Pinned sections are never evicted or truncated, by anything. */
  pinned?: boolean;
  /** Optional group name; groups can carry token quotas (see PackOptions.groups). */
  group?: string;
  /**
   * What to do when this section must shrink. `"drop"` (the default) is
   * all-or-nothing; the `truncate-*` strategies cut just enough to fit and
   * splice in the ellipsis marker.
   */
  strategy?: TruncateStrategy;
  /**
   * If truncation would leave fewer than this many tokens, evict the whole
   * section instead — a 3-token stump of a stack trace helps nobody.
   */
  minTokens?: number;
}

/**
 * Prices a string in tokens. Must be deterministic and monotonic
 * (a substring never costs more than the string it came from).
 * Bring your model's real tokenizer for exact budgets; the built-in
 * estimators are for when "close and reproducible" is enough.
 */
export type Counter = (text: string) => number;

/** Names of the built-in counters. */
export type CounterName = "chars" | "words";

/** A token quota for one group of sections. */
export interface GroupQuota {
  /** Absolute cap in tokens. */
  maxTokens?: number;
  /** Cap as a fraction of capacity (budget minus reserve), floored. */
  maxFraction?: number;
}

/** Options accepted by pack(). Only `budget` is required. */
export interface PackOptions {
  /** Total token budget for the packed context. Must be a positive integer. */
  budget: number;
  /** Tokens held back (e.g. for the model's response). Default 0. */
  reserve?: number;
  /** A Counter function or a built-in name. Default "chars". */
  counter?: Counter | CounterName;
  /** String joined between sections; its token cost is charged. Default "\n\n". */
  separator?: string;
  /** Marker spliced in where text was cut. Default "…". */
  ellipsis?: string;
  /** Per-group token quotas, enforced before the global budget. */
  groups?: Record<string, GroupQuota>;
  /** Output order of kept sections: as given, or by descending priority. Default "input". */
  order?: "input" | "priority";
}

/** What happened to a section. */
export type DecisionAction = "keep" | "truncate" | "evict";

/**
 * Why it happened.
 *
 * - `pinned`        kept: the section is pinned.
 * - `fits`          kept: there was room.
 * - `budget`        shrunk or removed by the global budget pass.
 * - `group-quota`   shrunk or removed to satisfy its group's quota.
 * - `min-tokens`    evicted because truncation could not leave a useful remainder.
 */
export type DecisionReason =
  | "pinned"
  | "fits"
  | "budget"
  | "group-quota"
  | "min-tokens";

/** The audit record for one input section. */
export interface Decision {
  id: string;
  action: DecisionAction;
  reason: DecisionReason;
  /** Human-readable explanation with the actual numbers. */
  detail: string;
  /** Token cost of the section as given. */
  originalTokens: number;
  /** Token cost after packing; 0 when evicted. */
  finalTokens: number;
  priority: number;
  pinned: boolean;
  group?: string;
}

/** A section as it appears in the packed layout. */
export interface PackedSection {
  id: string;
  text: string;
  tokens: number;
  truncated: boolean;
  priority: number;
  pinned: boolean;
  group?: string;
}

/** Token accounting for a layout. */
export interface TokenStats {
  budget: number;
  reserve: number;
  /** budget - reserve: what the packed text may use. */
  capacity: number;
  /** Section tokens + separator tokens actually used. */
  used: number;
  /** Separator tokens included in `used`. */
  separators: number;
  /** capacity - used. Negative only when `fits` is false. */
  free: number;
}

/** The result of pack(): reproducible, explainable, ready to render. */
export interface Layout {
  /** Kept sections in output order. */
  sections: PackedSection[];
  /** One decision per input section, in input order. */
  decisions: Decision[];
  tokens: TokenStats;
  /**
   * False only when pinned sections alone exceed capacity. The layout is
   * still returned (all pins kept, everything else evicted) so the caller
   * can report the overflow instead of crashing.
   */
  fits: boolean;
  /** FNV-1a 64-bit hex over the canonical layout; same spec, same fingerprint. */
  fingerprint: string;
}
