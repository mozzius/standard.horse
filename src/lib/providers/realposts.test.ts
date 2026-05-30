/**
 * Round-trip tests against real standard.site posts (a mix of markpub and
 * leaflet) captured from a live PDS. The key invariant: reading a post to
 * markdown and writing it back must be *stable* — converting the resulting
 * content to markdown again yields the identical string. That catches
 * conversion asymmetries without needing a perfect byte-for-byte record match
 * (which a lossy format can't promise).
 */

import { describe, expect, it } from "vitest"
import fixture from "./__fixtures__/real-posts.json" with { type: "json" }
import { detectProvider } from "./index.ts"
import type { ReadCtx, WriteCtx } from "./types.ts"

const readCtx: ReadCtx = {
  did: fixture.did,
  // None of the fixtures use a body blob; fail loudly if that changes.
  fetchBlob: async () => {
    throw new Error("unexpected blob fetch")
  },
}

describe("real posts", () => {
  it("has fixtures of both supported formats", () => {
    const types = new Set(
      fixture.posts.map((p) => (p.content as { $type?: string } | null)?.$type),
    )
    expect(types).toContain("at.markpub.markdown")
    expect(types).toContain("pub.leaflet.content")
  })

  it.each(fixture.posts)("$rkey ($title) round-trips stably", async (post) => {
    const provider = detectProvider(post.content)
    expect(provider, "no provider for this post").not.toBeNull()
    if (!provider) return

    const first = await provider.toMarkdown(post.content, readCtx)
    expect(first.markdown.length).toBeGreaterThan(0)

    const writeCtx: WriteCtx = {
      did: fixture.did,
      previousContent: post.content,
    }
    const rebuilt = provider.fromMarkdown(first.markdown, writeCtx)
    const second = await provider.toMarkdown(rebuilt, readCtx)

    // Markdown → content → markdown is idempotent.
    expect(second.markdown).toBe(first.markdown)
    // And re-reading the rebuilt content loses nothing more than the first read.
    expect(second.lost).toEqual(first.lost)
  })
})
