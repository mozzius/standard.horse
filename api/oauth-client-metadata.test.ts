import { afterEach, describe, expect, it } from "vitest"
import { SCOPE } from "../src/auth/scope.ts"
import handler from "./oauth-client-metadata.ts"

// The function reads the Host header (set by the transport, not by `new
// Request(url)`), so pass it explicitly. VERCEL_ENV is read from process.env.
const original = process.env.VERCEL_ENV
afterEach(() => {
  if (original === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = original
})

function call(host: string, env: string | undefined): Response {
  if (env === undefined) delete process.env.VERCEL_ENV
  else process.env.VERCEL_ENV = env
  return handler(
    new Request("https://example/oauth-client-metadata.json", {
      headers: { host },
    }),
  )
}

describe("oauth client metadata endpoint", () => {
  it("locks production to the canonical domain", async () => {
    const res = call("standard.horse", "production")
    expect(res.status).toBe(200)
    const doc = (await res.json()) as Record<string, unknown>
    expect(doc.client_id).toBe(
      "https://standard.horse/oauth-client-metadata.json",
    )
    expect(doc.client_uri).toBe("https://standard.horse")
    expect(doc.redirect_uris).toEqual(["https://standard.horse/"])
  })

  it("404s production requests on any other host", () => {
    // incl. the bare *.vercel.app production URL — a doc there would have a
    // client_id that mismatches the fetch URL.
    expect(call("standard-horse-abc123.vercel.app", "production").status).toBe(
      404,
    )
    expect(call("evil.com", "production").status).toBe(404)
  })

  it("reflects a preview deployment's own vercel.app origin", async () => {
    const host = "standard-horse-git-feature-mozzius.vercel.app"
    const res = call(host, "preview")
    expect(res.status).toBe(200)
    const doc = (await res.json()) as Record<string, unknown>
    expect(doc.client_id).toBe(`https://${host}/oauth-client-metadata.json`)
    expect(doc.redirect_uris).toEqual([`https://${host}/`])
  })

  it("404s non-vercel hosts outside production", () => {
    expect(call("evil.com", "preview").status).toBe(404)
    expect(call("localhost:3000", "development").status).toBe(404)
  })

  it("keeps the served scope in sync with the canonical SCOPE", async () => {
    const doc = (await call("standard.horse", "production").json()) as Record<
      string,
      unknown
    >
    expect(doc.scope).toBe(SCOPE)
  })
})
