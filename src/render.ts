/**
 * Turn a layout into the string a model would receive.
 *
 * Rendering is intentionally dumb: join the kept sections with the same
 * separator the packer charged for, nothing added, nothing reordered. The
 * only guarantee worth having is that the rendered string's cost is what
 * `layout.tokens.used` says it is — the packer priced sections and
 * separators with the same counter this join uses.
 */

import type { Layout } from "./types.js";

const DEFAULT_SEPARATOR = "\n\n";

/** Join the kept sections with `separator` (must match the one given to pack()). */
export function renderLayout(layout: Layout, separator: string = DEFAULT_SEPARATOR): string {
  return layout.sections.map((section) => section.text).join(separator);
}
