/**
 * pckt provider (`blog.pckt.content`). pckt stores an `items` array of blocks
 * (or a JSON blob when >20KB). Blocks map closely to markdown; inline formatting
 * uses pckt's richtext facets.
 *
 * Lossy on read: tables, mentions blocks, galleries, iframes, websites, bluesky
 * embeds, and the highlight/underline/mention inline features.
 */

import type { List, ListItem as MdListItem, RootContent } from "mdast"
import {
  facetsToPhrasing,
  phrasingToFacets,
  type Facet,
  type FacetSchema,
} from "./facets.ts"
import {
  blobCid,
  imageBlobSrc,
  mdastToMarkdown,
  parseMarkdown,
  resolveMarkdownImage,
} from "./mdast.ts"
import type { ContentProvider, ReadCtx, WriteCtx } from "./types.ts"

const NS = "blog.pckt.richtext.facet"
const SCHEMA: FacetSchema = {
  facet: NS,
  byteSlice: `${NS}#byteSlice`,
  bold: `${NS}#bold`,
  italic: `${NS}#italic`,
  code: `${NS}#code`,
  strike: `${NS}#strikethrough`,
  link: `${NS}#link`,
  lossy: {
    [`${NS}#highlight`]: "highlight",
    [`${NS}#underline`]: "underline",
    [`${NS}#atMention`]: "mentions",
    [`${NS}#didMention`]: "mentions",
    [`${NS}#id`]: "anchors",
  },
}

const B = (n: string) => `blog.pckt.block.${n}`
const CONTENT = "blog.pckt.content"

const LOSS_LABELS: Record<string, string> = {
  [B("table")]: "tables",
  [B("mention")]: "mention blocks",
  [B("gallery")]: "galleries",
  [B("iframe")]: "embeds",
  [B("website")]: "website cards",
  [B("blueskyEmbed")]: "Bluesky posts",
}

type Obj = Record<string, unknown>
const facetsOf = (o: Obj) => o.facets as Facet[] | undefined

// ---- read: pckt content → markdown ----

function blockToMdast(block: Obj, lost: Set<string>): RootContent[] {
  const text = (o: Obj) =>
    facetsToPhrasing((o.plaintext as string) ?? "", facetsOf(o), SCHEMA, lost)

  switch (block.$type) {
    case B("text"): {
      const children = text(block)
      return children.length ? [{ type: "paragraph", children }] : []
    }
    case B("heading"): {
      const level = Math.min(Math.max((block.level as number) ?? 1, 1), 6) as 1
      return [{ type: "heading", depth: level, children: text(block) }]
    }
    case B("blockquote"): {
      const inner = (block.content as Obj[]) ?? []
      return [
        {
          type: "blockquote",
          children: inner.map((t) => ({
            type: "paragraph" as const,
            children: text(t),
          })),
        },
      ]
    }
    case B("codeBlock"):
      return [
        {
          type: "code",
          lang: (block.language as string) || null,
          value: (block.plaintext as string) ?? "",
        },
      ]
    case B("horizontalRule"):
      return [{ type: "thematicBreak" }]
    case B("hardBreak"):
      return [] // paragraph breaks already separate blocks
    case B("image"): {
      const attrs = (block.attrs as Obj) ?? {}
      const url = attrs.blob
        ? imageBlobSrc(attrs.blob as never)
        : (attrs.src as string) || ""
      return url
        ? [
            {
              type: "paragraph",
              children: [
                { type: "image", url, alt: (attrs.alt as string) ?? "" },
              ],
            },
          ]
        : []
    }
    case B("bulletList"):
      return [listToMdast(block, false, lost)]
    case B("orderedList"):
      return [listToMdast(block, true, lost)]
    case B("taskList"):
      return [taskListToMdast(block, lost)]
    default:
      if (block.$type && LOSS_LABELS[block.$type as string])
        lost.add(LOSS_LABELS[block.$type as string])
      else lost.add("an unsupported block")
      return []
  }
}

function listToMdast(list: Obj, ordered: boolean, lost: Set<string>): List {
  const items = (list.content as Obj[]) ?? []
  return {
    type: "list",
    ordered,
    start: ordered ? ((list.start as number) ?? undefined) : undefined,
    children: items.map((it) => listItemToMdast(it, lost)),
  }
}

function listItemToMdast(item: Obj, lost: Set<string>): MdListItem {
  const children: RootContent[] = []
  for (const block of (item.content as Obj[]) ?? []) {
    if (block.$type === B("text"))
      children.push({
        type: "paragraph",
        children: facetsToPhrasing(
          (block.plaintext as string) ?? "",
          facetsOf(block),
          SCHEMA,
          lost,
        ),
      })
    else if (block.$type === B("bulletList"))
      children.push(listToMdast(block, false, lost))
    else if (block.$type === B("orderedList"))
      children.push(listToMdast(block, true, lost))
  }
  return { type: "listItem", children: children as never }
}

function taskListToMdast(list: Obj, lost: Set<string>): List {
  const items = (list.content as Obj[]) ?? []
  return {
    type: "list",
    ordered: false,
    children: items.map((it) => {
      const phrasing = ((it.content as Obj[]) ?? []).flatMap((t) =>
        facetsToPhrasing(
          (t.plaintext as string) ?? "",
          facetsOf(t),
          SCHEMA,
          lost,
        ),
      )
      return {
        type: "listItem",
        checked: !!it.checked,
        children: [{ type: "paragraph", children: phrasing }],
      }
    }),
  }
}

// ---- write: markdown → pckt content ----

function mdastToBlock(node: RootContent, ctx: WriteCtx): Obj | null {
  switch (node.type) {
    case "heading": {
      const { plaintext, facets } = phrasingToFacets(node.children, SCHEMA)
      return tidy({ $type: B("heading"), level: node.depth, plaintext, facets })
    }
    case "paragraph": {
      if (node.children.length === 1 && node.children[0].type === "image")
        return imageBlock(node.children[0], ctx)
      const { plaintext, facets } = phrasingToFacets(node.children, SCHEMA)
      return tidy({ $type: B("text"), plaintext, facets })
    }
    case "blockquote": {
      const content: Obj[] = []
      for (const child of node.children) {
        if (child.type === "paragraph") {
          const { plaintext, facets } = phrasingToFacets(child.children, SCHEMA)
          content.push(tidy({ $type: B("text"), plaintext, facets }))
        }
      }
      return { $type: B("blockquote"), content }
    }
    case "code":
      return tidy({
        $type: B("codeBlock"),
        language: node.lang || undefined,
        plaintext: node.value,
      })
    case "thematicBreak":
      return { $type: B("horizontalRule") }
    case "image":
      return imageBlock(node, ctx)
    case "list":
      return listBlock(node, ctx)
    default:
      return null // tables, html, etc. — dropped
  }
}

function imageBlock(node: RootContent, ctx: WriteCtx): Obj | null {
  if (node.type !== "image") return null
  const img = resolveMarkdownImage(node, ctx)
  if (!img) return null
  const attrs: Obj = {}
  if (img.kind === "blob") {
    const cid = blobCid(img.ref)
    attrs.src = cid ? `blob:${cid}` : ""
    attrs.blob = img.ref
    if (img.alt) attrs.alt = img.alt
    if (img.width && img.height)
      attrs.aspectRatio = { width: img.width, height: img.height }
  } else {
    // pckt allows a plain URL src (unlike leaflet).
    attrs.src = img.url
    if (img.alt) attrs.alt = img.alt
  }
  return { $type: B("image"), attrs }
}

function listBlock(node: List, ctx: WriteCtx): Obj {
  // GFM task lists (every item has a checkbox) become a pckt taskList.
  if (node.children.length && node.children.every((li) => li.checked != null)) {
    return {
      $type: B("taskList"),
      content: node.children.map((li) => ({
        $type: B("taskItem"),
        checked: !!li.checked,
        content: [textOfItem(li)],
      })),
    }
  }
  return tidy({
    $type: B(node.ordered ? "orderedList" : "bulletList"),
    start: node.ordered ? (node.start ?? undefined) : undefined,
    content: node.children.map((li) => listItemBlock(li, ctx)),
  })
}

function textOfItem(item: MdListItem): Obj {
  const phrasing = item.children
    .filter((c) => c.type === "paragraph")
    .flatMap((p) => (p.type === "paragraph" ? p.children : []))
  const { plaintext, facets } = phrasingToFacets(phrasing, SCHEMA)
  return tidy({ $type: B("text"), plaintext, facets })
}

function listItemBlock(item: MdListItem, ctx: WriteCtx): Obj {
  const content: Obj[] = []
  for (const child of item.children) {
    if (child.type === "paragraph") {
      const { plaintext, facets } = phrasingToFacets(child.children, SCHEMA)
      content.push(tidy({ $type: B("text"), plaintext, facets }))
    } else if (child.type === "list") {
      content.push(listBlock(child, ctx))
    }
  }
  if (content.length === 0) content.push({ $type: B("text"), plaintext: "" })
  return { $type: B("listItem"), content }
}

function tidy(o: Obj): Obj {
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) delete o[k]
    if (
      k === "facets" &&
      Array.isArray(o[k]) &&
      (o[k] as unknown[]).length === 0
    )
      delete o[k]
  }
  return o
}

export const pcktProvider: ContentProvider = {
  id: "pckt",
  label: "pckt",
  contentType: CONTENT,
  supportsImages: true,
  matches: (c) => (c as Obj | null)?.$type === CONTENT,

  async toMarkdown(content: unknown, ctx: ReadCtx) {
    const c = content as Obj
    const lost = new Set<string>()
    let items = (c.items as Obj[]) ?? []
    if (c.blob) {
      try {
        const bytes = await ctx.fetchBlob(c.blob as never)
        const parsed = JSON.parse(new TextDecoder().decode(bytes))
        items = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
      } catch {
        /* fall back to inline items */
      }
    }
    const out: RootContent[] = []
    for (const block of items) out.push(...blockToMdast(block, lost))
    return { markdown: mdastToMarkdown(out), lost: [...lost] }
  },

  fromMarkdown(markdown: string, ctx: WriteCtx) {
    const tree = parseMarkdown(markdown)
    const items: Obj[] = []
    for (const node of tree.children) {
      const block = mdastToBlock(node, ctx)
      if (block) items.push(block)
    }
    return { $type: CONTENT, items }
  },
}
