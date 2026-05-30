import type { Paragraph } from "mdast"
import { describe, expect, it } from "vitest"
import {
  facetsToPhrasing,
  phrasingToFacets,
  type Facet,
  type FacetSchema,
} from "./facets.ts"
import { parseMarkdown } from "./mdast.ts"

const S: FacetSchema = {
  facet: "x.facet",
  byteSlice: "x.facet#byteSlice",
  bold: "x.facet#bold",
  italic: "x.facet#italic",
  code: "x.facet#code",
  strike: "x.facet#strikethrough",
  link: "x.facet#link",
  lossy: { "x.facet#highlight": "highlight", "x.facet#underline": "underline" },
}

/** Parse an inline markdown snippet to its paragraph's phrasing children. */
function phrasingOf(md: string) {
  const para = parseMarkdown(md).children[0] as Paragraph
  return para.children
}

describe("phrasingToFacets", () => {
  it("emits no facets for plain text", () => {
    const { plaintext, facets } = phrasingToFacets(phrasingOf("hello"), S)
    expect(plaintext).toBe("hello")
    expect(facets).toEqual([])
  })

  it("captures bold over the right byte range", () => {
    const { plaintext, facets } = phrasingToFacets(phrasingOf("a **bc** d"), S)
    expect(plaintext).toBe("a bc d")
    expect(facets).toHaveLength(1)
    expect(facets[0].index).toEqual({ byteStart: 2, byteEnd: 4 })
    expect(facets[0].features[0].$type).toBe(S.bold)
  })

  it("counts byte offsets, not code units, across an emoji", () => {
    // "😀 " is 4 + 1 = 5 bytes; the bold "bold" then spans bytes 5–9.
    const { facets } = phrasingToFacets(phrasingOf("😀 **bold**"), S)
    expect(facets[0].index).toEqual({ byteStart: 5, byteEnd: 9 })
  })

  it("captures a link uri", () => {
    const { facets } = phrasingToFacets(phrasingOf("[t](https://e.com)"), S)
    expect(facets[0].features[0]).toEqual({
      $type: S.link,
      uri: "https://e.com",
    })
  })

  it("produces overlapping facets for nested marks", () => {
    const { plaintext, facets } = phrasingToFacets(phrasingOf("**_x_**"), S)
    expect(plaintext).toBe("x")
    const types = facets.map((f) => f.features[0].$type).sort()
    expect(types).toEqual([S.bold, S.italic].sort())
  })

  it("never tags $type on the facet or byteSlice, only the feature", () => {
    const { facets } = phrasingToFacets(phrasingOf("**b**"), S)
    expect(facets[0]).not.toHaveProperty("$type")
    expect(facets[0].index).not.toHaveProperty("$type")
  })
})

describe("facetsToPhrasing", () => {
  it("wraps a bold range in a strong node", () => {
    const facets: Facet[] = [
      { index: { byteStart: 0, byteEnd: 4 }, features: [{ $type: S.bold }] },
    ]
    const nodes = facetsToPhrasing("bold", facets, S, new Set())
    expect(nodes[0]).toMatchObject({ type: "strong" })
  })

  it("keeps text but records a lost feature for highlight", () => {
    const lost = new Set<string>()
    const facets: Facet[] = [
      {
        index: { byteStart: 0, byteEnd: 2 },
        features: [{ $type: "x.facet#highlight" }],
      },
    ]
    const nodes = facetsToPhrasing("hi there", facets, S, lost)
    expect([...lost]).toContain("highlight")
    // Text is preserved (as a plain run).
    const text = nodes.map((n) => ("value" in n ? n.value : "")).join("")
    expect(text).toBe("hi there")
  })

  it("round-trips plaintext+facets back through phrasing", () => {
    const { plaintext, facets } = phrasingToFacets(
      phrasingOf("a **b** and *c* and `d`"),
      S,
    )
    const back = phrasingToFacets(
      facetsToPhrasing(plaintext, facets, S, new Set()),
      S,
    )
    expect(back.plaintext).toBe(plaintext)
    expect(back.facets.map((f) => f.features[0].$type).sort()).toEqual(
      facets.map((f) => f.features[0].$type).sort(),
    )
  })
})
