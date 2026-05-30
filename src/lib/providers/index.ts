/**
 * Content-format providers. Each provider reads and writes one standard.site
 * `content` member ($type), converting it to/from the markdown the editor
 * speaks. standard.horse can therefore edit posts authored by leaflet, pckt and
 * offprint as well as its own markpub posts.
 */

import { leafletProvider } from "./leaflet.ts"
import { markpubProvider } from "./markpub.ts"
import { offprintProvider } from "./offprint.ts"
import { pcktProvider } from "./pckt.ts"
import type { ContentProvider } from "./types.ts"

export type {
  ContentProvider,
  ConvertResult,
  ReadCtx,
  UploadedImage,
  WriteCtx,
} from "./types.ts"

/** All providers, markpub first (the default for new posts). */
export const providers: ContentProvider[] = [
  markpubProvider,
  leafletProvider,
  pcktProvider,
  offprintProvider,
]

export const defaultProvider = markpubProvider

/** The provider that handles a stored content object, if any. */
export function detectProvider(content: unknown): ContentProvider | null {
  return providers.find((p) => p.matches(content)) ?? null
}

export function providerById(id: string): ContentProvider | undefined {
  return providers.find((p) => p.id === id)
}

/** The provider whose `$type` matches the given content member type. */
export function providerByContentType(
  type: string | undefined,
): ContentProvider | undefined {
  return type ? providers.find((p) => p.contentType === type) : undefined
}
