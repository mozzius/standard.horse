import type { BlobRef } from "@atproto/lex"

/** An image uploaded during this editing session, awaiting placement on save. */
export interface UploadedImage {
  ref: BlobRef
  width: number
  height: number
  mimeType: string
  alt?: string
}

/** Context for reading stored content into markdown. */
export interface ReadCtx {
  did: string | null
  /** Fetch a blob's bytes (for bodies offloaded to a PDS blob). */
  fetchBlob: (ref: BlobRef) => Promise<Uint8Array>
}

/** Context for writing edited markdown back into a content object. */
export interface WriteCtx {
  did: string | null
  /** The content object being replaced, so existing image blobs round-trip. */
  previousContent?: unknown
  /** Images uploaded this session, keyed by blob CID. */
  uploadedImages?: Map<string, UploadedImage>
}

export interface ConvertResult {
  markdown: string
  /** Human labels for blocks/features dropped converting to markdown. */
  lost: string[]
}

export interface ContentProvider {
  /** Stable id used in the format dropdown and provider lookups. */
  id: string
  /** Display name, e.g. "Leaflet". */
  label: string
  /** The content object's `$type` this provider reads and writes. */
  contentType: string
  /** Whether in-post image upload works. False for markpub: it stores only a
   * markdown string with no blob slot, so an uploaded blob would be GC'd. */
  supportsImages: boolean
  /** True if this provider handles the given stored content object. */
  matches(content: unknown): boolean
  /** Read stored content into editable markdown (may fetch a body blob). */
  toMarkdown(content: unknown, ctx: ReadCtx): Promise<ConvertResult>
  /** Build a fresh content object from edited markdown. */
  fromMarkdown(markdown: string, ctx: WriteCtx): unknown
}
