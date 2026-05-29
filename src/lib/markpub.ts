/**
 * Hand-typed bindings for the `at.markpub.markdown` content member.
 *
 * markpub (https://markpub.at) is a lightweight wrapper that stuffs Markdown
 * into another record's open `content` union. Its lexicon isn't published to the
 * network yet, and standard.site's `content` field is an *open* union
 * (`closed: false`) — so we don't need generated validators for it. We just
 * construct/read the object shape ourselves and slot it into the document's
 * `content` field.
 *
 * Spec reference (markpub.at): the markdown can live inline as `text.markdown`,
 * or be offloaded to a PDS blob via `text.textBlob`. For now we *write* inline
 * GFM, but we *read* both.
 */

import type { l } from "@atproto/lex"

export const MARKPUB_MARKDOWN = "at.markpub.markdown"
export const MARKPUB_TEXT = "at.markpub.text"

export type MarkpubFlavor = "gfm" | "commonmark"

export interface MarkpubText {
  $type: typeof MARKPUB_TEXT
  /** Inline Markdown source. Mutually exclusive with `textBlob` in practice. */
  markdown?: string
  /** Markdown stored as a blob on the PDS (used for large documents). */
  textBlob?: l.BlobRef
  /** Optional formatting facets (byte-range hints) — we don't author these. */
  facets?: unknown[]
  lenses?: unknown[]
}

export interface MarkpubMarkdown {
  $type: typeof MARKPUB_MARKDOWN
  flavor?: MarkpubFlavor
  /** Documents the renderer used to produce HTML (informational). */
  renderingRules?: string
  /** Expected markdown extensions, e.g. ["LaTeX", "YAML"]. */
  extensions?: string[]
  /** Parsed YAML front-matter key/value blocks. */
  frontMatter?: unknown[]
  text: MarkpubText
}

/** Build a markpub content object from inline GFM markdown. */
export function buildMarkpubContent(markdown: string): MarkpubMarkdown {
  return {
    $type: MARKPUB_MARKDOWN,
    flavor: "gfm",
    renderingRules: "markdown-it",
    text: {
      $type: MARKPUB_TEXT,
      markdown,
    },
  }
}

/** Narrowing type-guard for an unknown open-union content member. */
export function isMarkpubMarkdown(
  content: unknown,
): content is MarkpubMarkdown {
  return (
    typeof content === "object" &&
    content !== null &&
    (content as { $type?: unknown }).$type === MARKPUB_MARKDOWN
  )
}

/**
 * Read the inline markdown out of a document's `content` union member.
 *
 * Returns `null` when the content is missing, not markpub, or stored only as a
 * blob (which the editor can't load synchronously — see {@link markpubTextBlob}).
 */
export function readMarkpubMarkdown(content: unknown): string | null {
  if (!isMarkpubMarkdown(content)) return null
  return content.text?.markdown ?? null
}

/** Returns the blob ref when markpub markdown was offloaded to a PDS blob. */
export function markpubTextBlob(content: unknown): l.BlobRef | null {
  if (!isMarkpubMarkdown(content)) return null
  return content.text?.textBlob ?? null
}
