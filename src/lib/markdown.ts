import { remark } from "remark"
import remarkGfm from "remark-gfm"
import stripMarkdown from "strip-markdown"

/**
 * Convert GFM markdown to plain text, for a document's `textContent` field
 * (which "should not contain markdown or other formatting"). Strips syntax via
 * a remark pipeline — headings/emphasis/links keep their text; code blocks and
 * tables are dropped.
 */
export function markdownToPlaintext(md: string): string {
  return String(
    remark().use(remarkGfm).use(stripMarkdown).processSync(md),
  ).trim()
}
