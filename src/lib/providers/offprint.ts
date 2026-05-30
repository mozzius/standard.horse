/**
 * Offprint provider (`app.offprint.content`). Offprint stores an `items` array
 * of blocks. Blocks map closely to markdown; inline formatting uses offprint's
 * richtext facets.
 *
 * Lossy on read: callouts (kept as blockquotes), buttons, web bookmarks/embeds,
 * bluesky posts, image grids/carousels/diffs, text alignment, and the
 * highlight/underline/mention inline features. Math round-trips via ```math.
 */

import type { List, ListItem as MdListItem, RootContent } from "mdast"
import {
  facetsToPhrasing,
  phrasingToFacets,
  type Facet,
  type FacetSchema,
} from "./facets.ts"
import {
  imageBlobSrc,
  mdastToMarkdown,
  parseMarkdown,
  resolveMarkdownImage,
} from "./mdast.ts"
import type { ContentProvider, ReadCtx, WriteCtx } from "./types.ts"

const NS = "app.offprint.richtext.facet"
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
    [`${NS}#mention`]: "mentions",
    [`${NS}#webMention`]: "mentions",
  },
}

const B = (n: string) => `app.offprint.block.${n}`
const CONTENT = "app.offprint.content"

const LOSS_LABELS: Record<string, string> = {
  [B("callout")]: "callouts",
  [B("button")]: "buttons",
  [B("webBookmark")]: "bookmarks",
  [B("webEmbed")]: "embeds",
  [B("blueskyPost")]: "Bluesky posts",
  [B("imageGrid")]: "image grids",
  [B("imageCarousel")]: "image carousels",
  [B("imageDiff")]: "image comparisons",
}

type Obj = Record<string, unknown>
const facetsOf = (o: Obj) => o.facets as Facet[] | undefined

// ---- read: offprint content → markdown ----

function blockToMdast(block: Obj, lost: Set<string>): RootContent[] {
  if (block.textAlign && block.textAlign !== "left") lost.add("text alignment")
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
          children: inner.map((t) =>
            t.$type === B("heading")
              ? {
                  type: "heading" as const,
                  depth: Math.min(
                    Math.max((t.level as number) ?? 1, 1),
                    6,
                  ) as 1,
                  children: text(t),
                }
              : { type: "paragraph" as const, children: text(t) },
          ),
        },
      ]
    }
    case B("callout"):
      // No markdown callout — keep the text as a blockquote, note the loss.
      lost.add(LOSS_LABELS[B("callout")])
      return [
        {
          type: "blockquote",
          children: [{ type: "paragraph", children: text(block) }],
        },
      ]
    case B("codeBlock"):
      return [
        {
          type: "code",
          lang: (block.language as string) || null,
          value: (block.code as string) ?? "",
        },
      ]
    case B("mathBlock"):
      return [
        { type: "code", lang: "math", value: (block.tex as string) ?? "" },
      ]
    case B("horizontalRule"):
      return [{ type: "thematicBreak" }]
    case B("image"): {
      if (!block.blob) {
        lost.add("images")
        return []
      }
      const url = imageBlobSrc(block.blob as never)
      return url
        ? [
            {
              type: "paragraph",
              children: [
                { type: "image", url, alt: (block.alt as string) ?? "" },
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
  const items = (list.children as Obj[]) ?? []
  return {
    type: "list",
    ordered,
    start: ordered ? ((list.start as number) ?? undefined) : undefined,
    children: items.map((it) => itemToMdast(it, ordered, lost)),
  }
}

function itemToMdast(
  item: Obj,
  ordered: boolean,
  lost: Set<string>,
  checked?: boolean,
): MdListItem {
  const content = item.content as Obj | undefined
  const children: RootContent[] = [
    {
      type: "paragraph",
      children: facetsToPhrasing(
        (content?.plaintext as string) ?? "",
        facetsOf(content ?? {}),
        SCHEMA,
        lost,
      ),
    },
  ]
  const nested = (item.children as Obj[]) ?? []
  if (nested.length) {
    children.push({
      type: "list",
      ordered,
      children: nested.map((n) => itemToMdast(n, ordered, lost)),
    })
  }
  const li: MdListItem = { type: "listItem", children: children as never }
  if (checked != null) li.checked = checked
  return li
}

function taskListToMdast(list: Obj, lost: Set<string>): List {
  const items = (list.children as Obj[]) ?? []
  return {
    type: "list",
    ordered: false,
    children: items.map((it) => itemToMdast(it, false, lost, !!it.checked)),
  }
}

// ---- write: markdown → offprint content ----

function mdastToBlock(node: RootContent, ctx: WriteCtx): Obj | null {
  switch (node.type) {
    case "heading": {
      const { plaintext, facets } = phrasingToFacets(node.children, SCHEMA)
      // offprint headings are levels 1–3.
      return tidy({
        $type: B("heading"),
        level: Math.min(node.depth, 3),
        plaintext,
        facets,
      })
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
        } else if (child.type === "heading") {
          const { plaintext, facets } = phrasingToFacets(child.children, SCHEMA)
          content.push(
            tidy({
              $type: B("heading"),
              level: Math.min(child.depth, 3),
              plaintext,
              facets,
            }),
          )
        }
      }
      return { $type: B("blockquote"), content }
    }
    case "code":
      if (node.lang === "math")
        return { $type: B("mathBlock"), tex: node.value }
      return tidy({
        $type: B("codeBlock"),
        code: node.value,
        language: node.lang || undefined,
      })
    case "thematicBreak":
      return { $type: B("horizontalRule") }
    case "image":
      return imageBlock(node, ctx)
    case "list":
      return listBlock(node, ctx)
    default:
      return null
  }
}

function imageBlock(node: RootContent, ctx: WriteCtx): Obj | null {
  if (node.type !== "image") return null
  const img = resolveMarkdownImage(node, ctx)
  // Offprint images are blob-only; external URLs can't be stored.
  if (!img || img.kind !== "blob") return null
  const out: Obj = { $type: B("image"), blob: img.ref }
  if (img.alt) out.alt = img.alt
  if (img.width && img.height)
    out.aspectRatio = { width: img.width, height: img.height }
  return out
}

function listBlock(node: List, ctx: WriteCtx): Obj {
  if (node.children.length && node.children.every((li) => li.checked != null)) {
    return {
      $type: B("taskList"),
      children: node.children.map((li) => ({
        $type: B("taskList#taskItem"),
        checked: !!li.checked,
        content: textOf(li),
      })),
    }
  }
  return tidy({
    $type: B(node.ordered ? "orderedList" : "bulletList"),
    start: node.ordered ? (node.start ?? undefined) : undefined,
    children: node.children.map((li) => itemBlock(li, node.ordered, ctx)),
  })
}

function textOf(item: MdListItem): Obj {
  const phrasing = item.children
    .filter((c) => c.type === "paragraph")
    .flatMap((p) => (p.type === "paragraph" ? p.children : []))
  const { plaintext, facets } = phrasingToFacets(phrasing, SCHEMA)
  return tidy({ $type: B("text"), plaintext, facets })
}

function itemBlock(
  item: MdListItem,
  ordered: boolean | null | undefined,
  ctx: WriteCtx,
): Obj {
  const kind = ordered ? "orderedList" : "bulletList"
  const out: Obj = { $type: B(`${kind}#listItem`), content: textOf(item) }
  const nested = item.children.find((c) => c.type === "list") as
    | List
    | undefined
  if (nested)
    out.children = nested.children.map((li) => itemBlock(li, ordered, ctx))
  return out
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

export const offprintProvider: ContentProvider = {
  id: "offprint",
  label: "Offprint",
  contentType: CONTENT,
  supportsImages: true,
  matches: (c) => (c as Obj | null)?.$type === CONTENT,

  async toMarkdown(content: unknown, ctx: ReadCtx) {
    const c = content as Obj
    const lost = new Set<string>()
    const items = (c.items as Obj[]) ?? []
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
