import {
  atprotoLoopbackClientMetadata,
  BrowserOAuthClient,
} from "@atproto/oauth-client-browser"

/**
 * OAuth scopes. Reads (getRecord/listRecords) are public and need no scope. For
 * writes we include standard.site's published permission set
 * (`site.standard.authFull`) rather than hand-listing `repo:` scopes — it grants
 * repo access to the publication/document/subscription/recommend collections.
 * It doesn't cover blob uploads or the base session scope, so `atproto` and
 * `blob:image/*` (publication icons & cover/in-post images) stay explicit.
 */
export const SCOPE = [
  "atproto",
  "blob:image/*",
  "include:site.standard.authFull",
].join(" ")

/**
 * Handle resolution happens over the network. Using a Bluesky-hosted endpoint
 * leaks handles/IPs to a third party; self-hosters should point this at their
 * own PDS. Fine as a default for now.
 */
const HANDLE_RESOLVER = "https://bsky.social"

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  )
}

/**
 * Build the OAuth client for the current environment.
 *
 * - **Development (loopback):** atproto servers serve hard-coded metadata for
 *   loopback clients. We encode our redirect URI and granular `scope` into the
 *   `http://localhost?...` client_id so the consent screen reflects them.
 * - **Production:** the metadata document must be hosted at the app origin; see
 *   `public/oauth-client-metadata.json` and the README. The filename matters —
 *   atproto's consent UI hides the raw client_id URL when it ends in exactly
 *   `/oauth-client-metadata.json`.
 */
export async function createOAuthClient(): Promise<BrowserOAuthClient> {
  const { origin, hostname } = window.location

  if (isLoopbackHost(hostname)) {
    const redirectUri = `${origin}/`
    const clientId =
      `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(SCOPE)}`
    return new BrowserOAuthClient({
      handleResolver: HANDLE_RESOLVER,
      clientMetadata: atprotoLoopbackClientMetadata(clientId),
    })
  }

  return BrowserOAuthClient.load({
    clientId: `${origin}/oauth-client-metadata.json`,
    handleResolver: HANDLE_RESOLVER,
  })
}
