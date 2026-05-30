import type { BlobRef } from "@atproto/lex"
import { describe, expect, it } from "vitest"
import { leafletProvider } from "./leaflet.ts"
import { offprintProvider } from "./offprint.ts"
import { pcktProvider } from "./pckt.ts"
import type {
  ContentProvider,
  ReadCtx,
  UploadedImage,
  WriteCtx,
} from "./types.ts"

const DID = "did:plc:test"
const readCtx: ReadCtx = {
  did: DID,
  fetchBlob: async () => new Uint8Array(),
}
const writeCtx: WriteCtx = { did: DID, uploadedImages: new Map() }

/** A blob ref whose CID stringifies to `cid` (matches getBlobCidString). */
function fakeBlob(cid: string): BlobRef {
  return {
    $type: "blob",
    ref: { toString: () => cid },
    mimeType: "image/png",
    size: 1,
  } as unknown as BlobRef
}
function cdnUrl(cid: string): string {
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${DID}/${cid}`
}

const blockProviders: ContentProvider[] = [
  leafletProvider,
  pcktProvider,
  offprintProvider,
]

const SAMPLE = `# Heading one

Some **bold**, *italic*, \`code\`, ~~struck~~ and a [link](https://example.com).

## Heading two

> a quote with **emphasis**

- one
- two
  - nested a

1. first
2. second

- [ ] todo
- [x] done

\`\`\`js
const x = 1
\`\`\`

---

A trailing paragraph.`

describe.each(blockProviders)("$id round-trips clean markdown", (provider) => {
  it("preserves the common block + inline constructs", async () => {
    const content = provider.fromMarkdown(SAMPLE, writeCtx)
    const { markdown, lost } = await provider.toMarkdown(content, readCtx)

    expect(markdown).toMatch(/^# Heading one/m)
    expect(markdown).toMatch(/^## Heading two/m)
    expect(markdown).toContain("**bold**")
    expect(markdown).toMatch(/\*italic\*/)
    expect(markdown).toContain("`code`")
    expect(markdown).toContain("~~struck~~")
    expect(markdown).toContain("[link](https://example.com)")
    expect(markdown).toMatch(/^> /m)
    expect(markdown).toContain("nested a")
    expect(markdown).toMatch(/\[[ x]\]/) // task checkbox
    expect(markdown).toContain("const x = 1")
    expect(markdown).toMatch(/^(---|\*\*\*)$/m)
    expect(lost).toEqual([])
  })
})

describe("lost-feature reporting", () => {
  it("flags a leaflet poll", async () => {
    const content = {
      $type: "pub.leaflet.content",
      pages: [
        {
          $type: "pub.leaflet.pages.linearDocument",
          blocks: [{ block: { $type: "pub.leaflet.blocks.poll" } }],
        },
      ],
    }
    const { lost } = await leafletProvider.toMarkdown(content, readCtx)
    expect(lost).toContain("polls")
  })

  it("flags an offprint button", async () => {
    const content = {
      $type: "app.offprint.content",
      items: [{ $type: "app.offprint.block.button", href: "x", text: "y" }],
    }
    const { lost } = await offprintProvider.toMarkdown(content, readCtx)
    expect(lost).toContain("buttons")
  })

  it("flags a pckt table", async () => {
    const content = {
      $type: "blog.pckt.content",
      items: [{ $type: "blog.pckt.block.table" }],
    }
    const { lost } = await pcktProvider.toMarkdown(content, readCtx)
    expect(lost).toContain("tables")
  })

  it("flags highlight inline features", async () => {
    const content = {
      $type: "blog.pckt.content",
      items: [
        {
          $type: "blog.pckt.block.text",
          plaintext: "hi",
          facets: [
            {
              index: { byteStart: 0, byteEnd: 2 },
              features: [{ $type: "blog.pckt.richtext.facet#highlight" }],
            },
          ],
        },
      ],
    }
    const { lost } = await pcktProvider.toMarkdown(content, readCtx)
    expect(lost).toContain("highlight")
  })
})

describe("image preserve-by-CID (session upload)", () => {
  const cid = "bafyuploadedcid"
  const ref = fakeBlob(cid)
  const uploaded = new Map<string, UploadedImage>([
    [cid, { ref, width: 800, height: 600, mimeType: "image/png", alt: "pic" }],
  ])
  const ctx: WriteCtx = { did: DID, uploadedImages: uploaded }
  const md = `![pic](${cdnUrl(cid)})`

  it("leaflet reattaches the blob with aspect ratio", () => {
    const content = leafletProvider.fromMarkdown(md, ctx) as any
    const block = content.pages[0].blocks[0].block
    expect(block.$type).toBe("pub.leaflet.blocks.image")
    expect(block.image).toBe(ref)
    expect(block.aspectRatio).toEqual({ width: 800, height: 600 })
  })

  it("pckt stores blob + blob:CID src", () => {
    const content = pcktProvider.fromMarkdown(md, ctx) as any
    const attrs = content.items[0].attrs
    expect(attrs.blob).toBe(ref)
    expect(attrs.src).toBe(`blob:${cid}`)
  })

  it("offprint stores the blob", () => {
    const content = offprintProvider.fromMarkdown(md, ctx) as any
    expect(content.items[0].blob).toBe(ref)
  })

  it("round-trips back to a CDN url containing the CID", async () => {
    const content = leafletProvider.fromMarkdown(md, ctx)
    const { markdown } = await leafletProvider.toMarkdown(content, readCtx)
    expect(markdown).toContain(cid)
  })
})

describe("image preserve-by-CID (previous content)", () => {
  it("leaflet reattaches an unedited image from previousContent", async () => {
    const cid = "bafyprevcid"
    const ref = fakeBlob(cid)
    const previous = {
      $type: "pub.leaflet.content",
      pages: [
        {
          $type: "pub.leaflet.pages.linearDocument",
          blocks: [
            {
              block: {
                $type: "pub.leaflet.blocks.image",
                image: ref,
                alt: "kept",
                aspectRatio: { width: 100, height: 50 },
              },
            },
          ],
        },
      ],
    }
    const { markdown } = await leafletProvider.toMarkdown(previous, readCtx)
    expect(markdown).toContain(cid)
    const content = leafletProvider.fromMarkdown(markdown, {
      did: DID,
      previousContent: previous,
    }) as any
    const block = content.pages[0].blocks[0].block
    expect(block.image).toBe(ref)
    expect(block.aspectRatio).toEqual({ width: 100, height: 50 })
  })
})

describe("external image URLs", () => {
  const md = "![x](https://example.com/a.png)"
  it("pckt keeps the URL as src", () => {
    const content = pcktProvider.fromMarkdown(md, writeCtx) as any
    expect(content.items[0].attrs.src).toBe("https://example.com/a.png")
  })
  it("leaflet drops it (blob-only)", () => {
    const content = leafletProvider.fromMarkdown(md, writeCtx) as any
    expect(content.pages[0].blocks).toHaveLength(0)
  })
  it("offprint drops it (blob-only)", () => {
    const content = offprintProvider.fromMarkdown(md, writeCtx) as any
    expect(content.items).toHaveLength(0)
  })
})
