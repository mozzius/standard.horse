/**
 * Round-trip every standard.site document published by the three platforms'
 * official accounts (leaflet.pub, pckt.blog, offprint.app), captured live. This
 * exercises the providers against real-world block soup far beyond the
 * hand-written samples.
 *
 * The invariant here is convergence to a *fixed point*: once content has been
 * through one markdown round-trip, a second round-trip is identical
 * (`m2 === m3`). The very first read of hand-authored content can normalise
 * once — markdown genuinely can't express some things (adjacent bold runs like
 * `**a****b**`, or emphasis spanning a bare email, which remark escapes then
 * re-autolinks) — but it must not keep drifting. Strict first-read stability
 * (open + no-op save changes nothing) is covered for clean posts in
 * realposts.test.ts.
 */

import { describe, expect, it } from "vitest"
import leaflet from "./__fixtures__/official-leaflet.json" with { type: "json" }
import offprint from "./__fixtures__/official-offprint.json" with { type: "json" }
import pckt from "./__fixtures__/official-pckt.json" with { type: "json" }
import { detectProvider } from "./index.ts"
import type { ReadCtx, WriteCtx } from "./types.ts"

const fixtures = [leaflet, pckt, offprint]

type Post = { rkey: string; title: string | null; content: unknown }
const cases: { handle: string; did: string; post: Post }[] = fixtures.flatMap(
  (fx) => fx.posts.map((post) => ({ handle: fx.handle, did: fx.did, post })),
)

function readCtx(did: string): ReadCtx {
  return {
    did,
    fetchBlob: async () => {
      throw new Error("unexpected blob fetch (fixtures have inline bodies)")
    },
  }
}

describe("official accounts", () => {
  it("detects the expected provider per platform", () => {
    expect(detectProvider(leaflet.posts[0].content)?.id).toBe("leaflet")
    expect(
      detectProvider(
        pckt.posts.find((p) => detectProvider(p.content)?.id === "pckt")!
          .content,
      )?.id,
    ).toBe("pckt")
    expect(detectProvider(offprint.posts[0].content)?.id).toBe("offprint")
  })

  it.each(cases)(
    "$handle/$post.rkey round-trips stably",
    async ({ did, post }) => {
      const provider = detectProvider(post.content)
      expect(provider, "no provider").not.toBeNull()
      if (!provider) return

      const first = await provider.toMarkdown(post.content, readCtx(did))
      const c2 = provider.fromMarkdown(first.markdown, {
        did,
        previousContent: post.content,
      } satisfies WriteCtx)
      const second = await provider.toMarkdown(c2, readCtx(did))
      const c3 = provider.fromMarkdown(second.markdown, {
        did,
        previousContent: c2,
      } satisfies WriteCtx)
      const third = await provider.toMarkdown(c3, readCtx(did))

      // Converges: the second round-trip is a fixed point.
      expect(third.markdown).toBe(second.markdown)
      // Dropped blocks/features don't come back, so losses only shrink.
      expect(first.lost).toEqual(expect.arrayContaining(second.lost))
      expect(second.lost).toEqual(third.lost)
    },
  )
})
