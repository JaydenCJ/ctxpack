/**
 * ctxpack — deterministic context-window packing.
 *
 * Public API surface. Everything here is pure and side-effect free; only
 * the CLI (`ctxpack` binary) touches the filesystem or the process.
 *
 *   import { pack, renderLayout } from "ctxpack";
 *
 *   const layout = pack(sections, { budget: 8000, reserve: 1024 });
 *   const prompt = renderLayout(layout);
 *   layout.decisions   // one explainable decision per section
 *   layout.fingerprint // same spec, same fingerprint, any machine
 */

export { pack } from "./packer.js";
export { renderLayout } from "./render.js";
export { explainLayout, summarizeLayout } from "./explain.js";
export { truncateToBudget, type Truncation } from "./truncate.js";
export { charsCounter, wordsCounter, resolveCounter, COUNTER_NAMES } from "./counter.js";
export { fingerprintLayout, canonicalLayout, fnv1a64 } from "./fingerprint.js";
export { parseSpec, type PackSpec } from "./spec.js";
export { evictionOrder } from "./policy.js";
export { VERSION } from "./version.js";
export type {
  Counter,
  CounterName,
  Decision,
  DecisionAction,
  DecisionReason,
  GroupQuota,
  Layout,
  PackedSection,
  PackOptions,
  Section,
  TokenStats,
  TruncateStrategy,
} from "./types.js";
