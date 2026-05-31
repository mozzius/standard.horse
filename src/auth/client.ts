import {
  atprotoLoopbackClientMetadata,
  BrowserOAuthClient,
} from "@atproto/oauth-client-browser"
import { SCOPE } from "./scope.ts"

export { SCOPE }

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
 * - **Production / preview:** the metadata document is served dynamically at
 *   the app origin by `api/oauth-client-metadata.ts` (see the README). The
 *   filename matters — atproto's consent UI hides the raw client_id URL when it
 *   ends in exactly `/oauth-client-metadata.json`.
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
