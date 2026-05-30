/**
 * markpub provider (`at.markpub.markdown`). markpub stores GFM markdown
 * directly, so conversion is near-identity: read the inline `text.markdown` (or
 * a text blob), and write it straight back. Nothing is ever lost.
 *
 * Note: markpub references no image blobs, so an uploaded image lives only as a
 * CDN URL in the markdown text — see the GC caveat in [[image-support-needs-blob-refs]].
 */

import {
  buildMarkpubContent,
  isMarkpubMarkdown,
  MARKPUB_MARKDOWN,
  markpubTextBlob,
  readMarkpubMarkdown,
} from "../markpub.ts"
import type { ContentProvider, ReadCtx } from "./types.ts"

export const markpubProvider: ContentProvider = {
  id: "markpub",
  label: "Markdown (markpub)",
  contentType: MARKPUB_MARKDOWN,
  supportsImages: false,
  matches: isMarkpubMarkdown,

  async toMarkdown(content: unknown, ctx: ReadCtx) {
    let markdown = readMarkpubMarkdown(content)
    if (markdown == null) {
      const blob = markpubTextBlob(content)
      if (blob) {
        try {
          markdown = new TextDecoder().decode(await ctx.fetchBlob(blob))
        } catch {
          markdown = ""
        }
      } else {
        markdown = ""
      }
    }
    return { markdown, lost: [] }
  },

  fromMarkdown(markdown: string) {
    return buildMarkpubContent(markdown)
  },
}
