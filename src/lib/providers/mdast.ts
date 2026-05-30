/**
 * Shared markdown/mdast plumbing for the content providers: parse markdown to
 * an mdast tree, serialise blocks back to markdown, and the image-blob handling
 * that lets existing images survive a markdown round-trip without re-uploading.
 *
 * Images are rendered to markdown as `![alt](cdn-url)` where the URL is a
 * Bluesky CDN link encoding the blob CID. On the way back, that CID is matched
 * against blobs harvested from the post's previous content (or images uploaded
 * this editing session), so the original blob ref is reattached verbatim.
 */

import { getBlobCidString, type BlobRef } from "@atproto/lex"
import type { Image, Root, RootContent } from "mdast"
import { remark } from "remark"
import remarkGfm from "remark-gfm"
import { cdnImageUrl } from "../bsky.ts"
import type { WriteCtx } from "./types.ts"

const processor = remark().use(remarkGfm)

export function parseMarkdown(md: string): Root {
  return processor.parse(md) as Root
}

/** Serialise mdast block content to a markdown string. */
export function mdastToMarkdown(children: RootContent[]): string {
  return processor.stringify({ type: "root", children }).trim()
}

// ---- image blob resolution ----

export interface HarvestedImage {
  ref: BlobRef
  /** The object the blob hung off of, so callers can read sibling fields
   * (aspectRatio, alt, …) when rebuilding a format-specific image block. */
  owner: Record<string, unknown>
}

function isBlobLike(v: unknown): v is BlobRef {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  if (o.$type === "blob") return true
  // Legacy/CBOR-shaped refs: { ref: CID|{ $link }, mimeType, size }.
  return "mimeType" in o && "ref" in o
}

/**
 * The blob's CID as a string. `getBlobCidString` handles the runtime BlobRef
 * (a CID instance), but records deserialised from plain JSON carry the CBOR
 * shape `{ ref: { $link } }` / `{ $link }`, so fall back to that.
 */
export function blobCid(ref: BlobRef): string | null {
  try {
    const s = getBlobCidString(ref)
    if (s && s !== "[object Object]") return s
  } catch {
    /* fall through to the JSON shape */
  }
  const r = (ref as { ref?: unknown }).ref ?? ref
  if (typeof r === "string") return r
  if (
    r &&
    typeof r === "object" &&
    typeof (r as { $link?: unknown }).$link === "string"
  )
    return (r as { $link: string }).$link
  return null
}

/**
 * Walk an arbitrary content object collecting every image blob it references,
 * keyed by CID, along with the object that owns it.
 */
export function harvestImages(content: unknown): Map<string, HarvestedImage> {
  const out = new Map<string, HarvestedImage>()
  const visit = (node: unknown, owner: Record<string, unknown> | null) => {
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, owner))
      return
    }
    if (typeof node !== "object" || node === null) return
    const obj = node as Record<string, unknown>
    for (const [, val] of Object.entries(obj)) {
      if (isBlobLike(val)) {
        const mime = (val as { mimeType?: string }).mimeType
        // Only treat image blobs as reusable images.
        if (!mime || mime.startsWith("image/")) {
          const cid = blobCid(val)
          if (cid && !out.has(cid)) out.set(cid, { ref: val, owner: obj })
        }
      } else if (typeof val === "object" && val !== null) {
        visit(val, obj)
      }
    }
  }
  visit(content, null)
  return out
}

/** Build the markdown image URL we emit for a stored image blob. */
export function imageMarkdownUrl(did: string | null, ref: BlobRef): string {
  const cid = blobCid(ref)
  if (!cid || !did) return ""
  return cdnImageUrl(did, cid, "feed_fullsize")
}

/** Pull the blob CID out of a Bluesky CDN URL we previously emitted. */
export function cidFromUrl(url: string): string | null {
  // …/img/<preset>/plain/<did>/<cid>[@jpeg]
  const m = url.match(/\/plain\/[^/]+\/([^/?@]+)/)
  return m ? m[1] : null
}

export type ResolvedImage =
  /** An image blob we can reattach (uploaded this session or kept from before). */
  | {
      kind: "blob"
      ref: BlobRef
      width?: number
      height?: number
      alt?: string
    }
  /** An external image URL with no backing blob. */
  | { kind: "url"; url: string; alt?: string }

/**
 * Resolve a markdown `![alt](url)` node to a blob ref (matching its CID against
 * session uploads, then the post's previous content) or an external URL.
 * Returns `null` only when the url is empty.
 */
export function resolveMarkdownImage(
  node: Image,
  ctx: WriteCtx,
): ResolvedImage | null {
  const url = node.url
  if (!url) return null
  const alt = node.alt || undefined
  const cid = cidFromUrl(url)
  if (cid) {
    const up = ctx.uploadedImages?.get(cid)
    if (up)
      return {
        kind: "blob",
        ref: up.ref,
        width: up.width,
        height: up.height,
        alt: alt ?? up.alt,
      }
    const prev = harvestImages(ctx.previousContent).get(cid)
    if (prev) {
      const ar = prev.owner.aspectRatio as
        | { width?: number; height?: number }
        | undefined
      return {
        kind: "blob",
        ref: prev.ref,
        width: ar?.width,
        height: ar?.height,
        alt: alt ?? (prev.owner.alt as string | undefined),
      }
    }
  }
  return { kind: "url", url, alt }
}
