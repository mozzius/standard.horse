import { getBlobCidString, type BlobRef } from "@atproto/lex"

/**
 * The Bluesky image CDN resizes/caches any atproto image blob (it resolves the
 * blob from the owner's PDS), so it's a convenient display CDN — no need to
 * resolve the user's PDS host ourselves. Used for display only; records still
 * store proper blob references.
 *
 * URL shape: https://cdn.bsky.app/img/<preset>/plain/<did>/<cid>
 */
export type CdnPreset =
  | "avatar"
  | "avatar_thumbnail"
  | "banner"
  | "feed_thumbnail"
  | "feed_fullsize"

export function cdnImageUrl(
  did: string,
  cid: string,
  preset: CdnPreset,
): string {
  return `https://cdn.bsky.app/img/${preset}/plain/${did}/${cid}`
}

/** CDN display URL for an image blob ref owned by `did`. */
export function blobImageUrl(
  did: string,
  ref: BlobRef,
  preset: CdnPreset,
): string {
  return cdnImageUrl(did, getBlobCidString(ref), preset)
}

export interface BlueskyProfile {
  handle?: string
  displayName?: string
  /** Avatar URL (already a cdn.bsky.app URL). */
  avatar?: string
}

/**
 * Fetch a Bluesky profile from the public AppView (no auth). Used to show the
 * signed-in user's avatar/handle in the masthead.
 */
export async function fetchBlueskyProfile(
  did: string,
): Promise<BlueskyProfile | null> {
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
    )
    if (!res.ok) return null
    const j = (await res.json()) as BlueskyProfile
    return { handle: j.handle, displayName: j.displayName, avatar: j.avatar }
  } catch {
    return null
  }
}
