import { SCOPE } from "../src/auth/scope.ts"

export const config = { runtime: "edge" }

/** The canonical production domain — prod never reflects the request Host. */
const PROD_HOST = "standard.horse"

/**
 * Serve the atproto OAuth client metadata document, with `client_id` /
 * `redirect_uris` bound to the origin it's served from.
 *
 * atproto requires the document's `client_id` to equal the URL it was fetched
 * from, and every `redirect_uri` to share that origin — so a single static file
 * can only describe one domain. Vercel preview deployments each get their own
 * `*.vercel.app` origin, so we reflect the request Host for previews and lock
 * production to the canonical domain.
 *
 * - **production:** only `standard.horse` is valid; any other Host (e.g. the
 *   bare `*.vercel.app` production URL) 404s rather than emit a doc whose
 *   `client_id` won't match the fetch URL.
 * - **preview:** reflect the deployment's own `*.vercel.app` origin.
 * - Reflecting the Host is safe (the redirect target is always this same
 *   origin), but never let a shared cache key on path alone — hence no caching.
 */
export default function handler(req: Request): Response {
  const env = process.env.VERCEL_ENV // "production" | "preview" | "development"
  const reqHost = req.headers.get("host") ?? ""

  let host: string | null = null
  if (env === "production") {
    host = reqHost === PROD_HOST ? PROD_HOST : null
  } else if (reqHost.endsWith(".vercel.app")) {
    host = reqHost
  }

  if (!host) return new Response("Not found", { status: 404 })

  const origin = `https://${host}`
  const metadata = {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: "standard.horse",
    client_uri: origin,
    redirect_uris: [`${origin}/`],
    scope: SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  }
  return new Response(JSON.stringify(metadata), {
    headers: {
      "content-type": "application/json",
      // Never let a shared cache key this on path alone (Host is reflected).
      "cache-control": "no-store",
    },
  })
}
