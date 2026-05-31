/**
 * Local draft persistence for the post editor. Everything the user types is
 * mirrored into localStorage so it survives a reload/crash/tab-close until it's
 * actually written to the PDS. Drafts are the safety net; the PDS record stays
 * the source of truth — a draft is cleared once it's been saved.
 *
 * Keys are DID-scoped so a different signed-in account never reads another's
 * drafts. Image blob refs round-trip through `lexToJson`/`jsonToLex` because a
 * `BlobRef` holds a live `CID` that plain `JSON.stringify` mangles (after which
 * `getBlobCidString` returns "[object Object]").
 */

import { jsonToLex, lexToJson, type LexValue } from "@atproto/lex"
import type { UploadedImage } from "./providers/index.ts"

const VERSION = 1
const PREFIX = "sh:draft"

export interface PostDraft {
  /** Schema version; entries with a different version are ignored on load. */
  v: number
  title: string
  description: string
  tags: string
  pathTemplate: string
  body: string
  /** id of the richtext provider this draft is being written in. */
  providerId: string | null
  /** cid -> uploaded in-post image, blob refs serialized via lexToJson. */
  images: Record<string, unknown>
  /** cid of the server record this draft was based on (null for a new post). */
  baseCid: string | null
  /** epoch ms of the last persist, for the "saved … ago" label. */
  savedAt: number
}

/** Storage key for a post draft. Pass `{ newPub }` for an unsaved new post. */
export function draftKey(
  did: string,
  target: string | { newPub: string | null },
): string {
  if (typeof target === "string") return `${PREFIX}:${did}:${target}`
  return `${PREFIX}:${did}:new${target.newPub ? `:${target.newPub}` : ""}`
}

/** Serialize the in-session uploaded-image map for storage. */
export function serializeImages(
  images: Map<string, UploadedImage>,
): Record<string, unknown> {
  const obj: Record<string, UploadedImage> = {}
  for (const [cid, img] of images) obj[cid] = img
  // lexToJson recurses into each image's BlobRef, encoding the CID losslessly.
  return lexToJson(obj as unknown as LexValue) as Record<string, unknown>
}

/** Revive a stored image map back into live UploadedImage values. */
export function deserializeImages(
  images: Record<string, unknown> | undefined,
): Map<string, UploadedImage> {
  const map = new Map<string, UploadedImage>()
  if (!images) return map
  try {
    const revived = jsonToLex(images as never) as unknown as Record<
      string,
      UploadedImage
    >
    for (const cid of Object.keys(revived)) map.set(cid, revived[cid])
  } catch {
    // Corrupt image payload — drop it; the markdown text is still recovered.
  }
  return map
}

/** Load a draft, or null if absent/unreadable/stale-schema. */
export function loadDraft(key: string): PostDraft | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PostDraft
    if (parsed?.v !== VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/** Persist a draft. Failures (quota, private mode) are swallowed. */
export function saveDraft(key: string, draft: Omit<PostDraft, "v">): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: VERSION, ...draft }))
  } catch {
    // Storage unavailable/full — nothing we can do; don't break the editor.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
