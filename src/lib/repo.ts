/**
 * Thin, app-specific wrappers over the `@atproto/lex` Client for the two
 * collections standard.horse edits: site.standard.publication and
 * site.standard.document. The Client defaults `repo` to the authenticated
 * user's DID, so reads/writes target the signed-in user's own PDS.
 */

import { getBlobCidString, type BlobRef, type Client } from "@atproto/lex"
import type { Main as DocumentRecord } from "../lexicons/site/standard/document.defs.js"
import document from "../lexicons/site/standard/document.js"
import type { Main as PublicationRecord } from "../lexicons/site/standard/publication.defs.js"
import publication from "../lexicons/site/standard/publication.js"
import type { Main as BasicTheme } from "../lexicons/site/standard/theme/basic.defs.js"
import { rgb } from "../lexicons/site/standard/theme/color.js"

export type { PublicationRecord, DocumentRecord, BasicTheme }

export interface RecordEntry<T> {
  uri: string
  cid: string
  rkey: string
  value: T
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Extract the record key (last path segment) from an at:// URI. */
export function atUriRkey(uri: string): string {
  return uri.split("/").pop() ?? ""
}

// ---- Publications ----

export async function listPublications(
  client: Client,
): Promise<RecordEntry<PublicationRecord>[]> {
  const res = await client.list(publication, { limit: 100 })
  // Iterate with for...of rather than `res.records.map(...)`: `res.records` is
  // an intersection-of-arrays whose `.map` resolves to the untyped base call
  // signature (value: LexMap), while the iterator keeps the record value type.
  const out: RecordEntry<PublicationRecord>[] = []
  for (const r of res.records) {
    out.push({
      uri: r.uri,
      cid: r.cid,
      rkey: atUriRkey(r.uri),
      value: r.value,
    })
  }
  return out
}

export async function putPublication(
  client: Client,
  rkey: string,
  value: Omit<PublicationRecord, "$type">,
): Promise<void> {
  await client.put(publication, value, { rkey })
}

// ---- Documents ----

export async function listDocuments(
  client: Client,
): Promise<RecordEntry<DocumentRecord>[]> {
  const res = await client.list(document, { limit: 100 })
  const out: RecordEntry<DocumentRecord>[] = []
  for (const r of res.records) {
    out.push({
      uri: r.uri,
      cid: r.cid,
      rkey: atUriRkey(r.uri),
      value: r.value,
    })
  }
  return out
}

export async function getDocument(
  client: Client,
  rkey: string,
): Promise<RecordEntry<DocumentRecord>> {
  const res = await client.get(document, { rkey })
  return {
    uri: res.uri,
    cid: res.cid ?? "",
    rkey,
    value: res.value,
  }
}

export async function createDocument(
  client: Client,
  value: Omit<DocumentRecord, "$type">,
  rkey: string,
): Promise<{ uri: string; rkey: string }> {
  const res = await client.create(document, value, { rkey })
  return { uri: res.uri, rkey: atUriRkey(res.uri) }
}

export async function putDocument(
  client: Client,
  rkey: string,
  value: Omit<DocumentRecord, "$type">,
): Promise<void> {
  await client.put(document, value, { rkey })
}

export async function deleteDocument(
  client: Client,
  rkey: string,
): Promise<void> {
  await client.delete(document, { rkey })
}

// ---- Blobs ----

/** Upload an image file and return a blob ref to embed in a record. */
export async function uploadImageBlob(
  client: Client,
  file: File,
): Promise<BlobRef> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const res = await client.uploadBlob(bytes, {
    encoding: file.type as `${string}/${string}`,
  })
  return res.body.blob
}

/** Resolve a blob ref on the given repo to a fetchable PDS URL. */
export function blobUrl(_client: Client, did: string, ref: BlobRef): string {
  const cid = getBlobCidString(ref)
  // com.atproto.sync.getBlob is a public read endpoint; the AppView/relay also
  // serves a CDN-backed copy, which is fine for displaying icons.
  return `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
}

// ---- Theme helpers ----

export const DEFAULT_THEME: Record<keyof ThemeColors, Rgb> = {
  background: { r: 246, g: 242, b: 233 },
  foreground: { r: 26, g: 23, b: 20 },
  accent: { r: 138, g: 28, b: 28 },
  accentForeground: { r: 255, g: 255, b: 255 },
}

export interface ThemeColors {
  background: Rgb
  foreground: Rgb
  accent: Rgb
  accentForeground: Rgb
}

function buildColor(c: Rgb) {
  return rgb.$build({ r: c.r, g: c.g, b: c.b })
}

/** Build a site.standard.theme.basic object from four RGB colors. */
export function buildBasicTheme(colors: ThemeColors): BasicTheme {
  return {
    $type: "site.standard.theme.basic",
    background: buildColor(colors.background),
    foreground: buildColor(colors.foreground),
    accent: buildColor(colors.accent),
    accentForeground: buildColor(colors.accentForeground),
  }
}

function readColor(value: unknown, fallback: Rgb): Rgb {
  if (value && typeof value === "object") {
    const v = value as Partial<Rgb>
    if (
      typeof v.r === "number" &&
      typeof v.g === "number" &&
      typeof v.b === "number"
    ) {
      return { r: v.r, g: v.g, b: v.b }
    }
  }
  return fallback
}

/** Read a publication's basicTheme into plain RGB colors (with fallbacks). */
export function readBasicTheme(theme: BasicTheme | undefined): ThemeColors {
  return {
    background: readColor(theme?.background, DEFAULT_THEME.background),
    foreground: readColor(theme?.foreground, DEFAULT_THEME.foreground),
    accent: readColor(theme?.accent, DEFAULT_THEME.accent),
    accentForeground: readColor(
      theme?.accentForeground,
      DEFAULT_THEME.accentForeground,
    ),
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => n.toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRgb(hex: string): Rgb {
  const m = hex.replace("#", "")
  return {
    r: parseInt(m.slice(0, 2), 16) || 0,
    g: parseInt(m.slice(2, 4), 16) || 0,
    b: parseInt(m.slice(4, 6), 16) || 0,
  }
}

// ---- Misc ----

// base32-sortable alphabet used by atproto TIDs.
const S32 = "234567abcdefghijklmnopqrstuvwxyz"
let lastTidMicros = 0
const tidClockId = Math.floor(Math.random() * 1024)

/**
 * Generate an atproto TID (timestamp identifier): 13 base32-sortable chars
 * encoding microsecond time + a random clock id. Used as both the document's
 * record key and its URL path, so posts get a stable, sortable slug without the
 * user inventing one. (`@atproto/lex` exposes `isTidString` but no generator,
 * and pnpm doesn't surface the transitive `@atproto/common-web`.)
 */
export function nextTid(): string {
  let micros = Date.now() * 1000
  if (micros <= lastTidMicros) micros = lastTidMicros + 1
  lastTidMicros = micros
  let n = (BigInt(micros) << 10n) | BigInt(tidClockId)
  let out = ""
  for (let i = 0; i < 13; i++) {
    out = S32[Number(n & 31n)] + out
    n >>= 5n
  }
  return out
}

/**
 * The path field is edited as a *template* that may contain the literal token
 * `<rkey>`, which is substituted with the document's record key (a TID). This
 * lets the path track the record key while matching whatever route shape the
 * user's frontend uses (e.g. `/post/<rkey>`).
 */
export const PATH_RKEY_TOKEN = "<rkey>"
export const DEFAULT_PATH_TEMPLATE = `/post/${PATH_RKEY_TOKEN}`

/** Substitute `<rkey>` in a path template with the actual record key. */
export function interpolatePath(template: string, rkey: string): string {
  const t = template.trim() || DEFAULT_PATH_TEMPLATE
  return t.replaceAll(PATH_RKEY_TOKEN, rkey)
}

/**
 * Turn a stored path back into an editable template by replacing occurrences of
 * the record key with the `<rkey>` token (so editing shows `/post/<rkey>` rather
 * than the resolved TID). Falls back to the stored path if the rkey isn't found.
 */
export function templatizePath(path: string | undefined, rkey: string): string {
  if (!path) return DEFAULT_PATH_TEMPLATE
  return rkey ? path.replaceAll(rkey, PATH_RKEY_TOKEN) : path
}

/** Build a canonical URL to a document from its publication url + path. */
export function documentUrl(
  pubUrl: string | undefined,
  path: string | undefined,
): string | null {
  if (!pubUrl || !path) return null
  return pubUrl.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`)
}
