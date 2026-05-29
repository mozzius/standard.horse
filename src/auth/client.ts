import {
  atprotoLoopbackClientMetadata,
  BrowserOAuthClient,
} from "@atproto/oauth-client-browser"

/**
 * Granular OAuth scopes. Reads (getRecord/listRecords) are public and need no
 * scope; we only request write access to the two collections this app edits,
 * plus image-blob uploads for publication icons & cover images.
 *
 * Omitting `?action` on a `repo:` scope grants create + update + delete.
 */
export const SCOPE = [
  "atproto",
  "blob:image/*",
  "repo:site.standard.publication",
  "repo:site.standard.document",
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
 *   `public/client-metadata.json` and the README.
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
    clientId: `${origin}/client-metadata.json`,
    handleResolver: HANDLE_RESOLVER,
  })
}
