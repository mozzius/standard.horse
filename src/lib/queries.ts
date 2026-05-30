/**
 * react-query hooks over the repo layer. Reads are cached per-DID; writes are
 * mutations that invalidate the affected caches so views refresh themselves.
 * Every hook reads the authenticated lex Client from <AuthProvider> and stays
 * disabled until it's available.
 */

import { getBlobCidString, type BlobRef } from "@atproto/lex"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "../auth/AuthProvider.tsx"
import { readMarkpubMarkdown } from "./markpub.ts"
import { detectProvider } from "./providers/index.ts"
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  listPublications,
  putDocument,
  putPublication,
  uploadImageBlob,
  type DocumentRecord,
  type PublicationRecord,
  type RecordEntry,
} from "./repo.ts"

/** Pull a displayable message off a thrown value, falling back to a default. */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

export const queryKeys = {
  publications: (did: string | null) => ["publications", did] as const,
  documents: (did: string | null) => ["documents", did] as const,
  document: (did: string | null, rkey: string) =>
    ["document", did, rkey] as const,
}

// ---- Reads ----

/** All of the signed-in user's publications. */
export function usePublications() {
  const { client, did } = useAuth()
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.publications(did),
    queryFn: () => listPublications(client!),
    enabled: !!client,
  })
  return {
    publications: data ?? [],
    loading: isPending,
    error: error ? errorMessage(error, "Failed to load publications") : null,
    reload: refetch,
  }
}

/** All of the signed-in user's documents (across every publication). */
export function useDocuments() {
  const { client, did } = useAuth()
  return useQuery({
    queryKey: queryKeys.documents(did),
    queryFn: () => listDocuments(client!),
    enabled: !!client,
  })
}

export interface EditableDocument {
  entry: RecordEntry<DocumentRecord>
  /** The post body as markdown, converted from whatever format it was stored in. */
  markdown: string
  /** id of the provider that read this post; null if the format is unrecognised. */
  providerId: string | null
  /** Human labels for blocks/features dropped converting to markdown. */
  lost: string[]
}

/**
 * Load a single document and convert its body to markdown for the editor. The
 * content's `$type` selects a provider (markpub/leaflet/pckt/offprint); the
 * provider does the conversion (fetching a body blob if needed) inside the
 * queryFn so react-query owns the whole async load.
 */
export function useEditableDocument(rkey: string | undefined) {
  const { client, did } = useAuth()
  const qc = useQueryClient()
  return useQuery<EditableDocument>({
    queryKey: queryKeys.document(did, rkey ?? ""),
    enabled: !!client && !!rkey,
    // Seed instantly from the documents-list cache (e.g. arriving from the
    // dashboard) so the editor paints before the per-record fetch resolves.
    // markpub bodies are inline so convert synchronously; block formats wait
    // for the full load (their conversion may need a blob fetch).
    placeholderData: () => {
      if (!rkey) return undefined
      const list = qc.getQueryData<RecordEntry<DocumentRecord>[]>(
        queryKeys.documents(did),
      )
      const entry = list?.find((d) => d.rkey === rkey)
      if (!entry) return undefined
      const provider = detectProvider(entry.value.content)
      const markdown =
        provider?.id === "markpub"
          ? (readMarkpubMarkdown(entry.value.content) ?? "")
          : ""
      return { entry, markdown, providerId: provider?.id ?? null, lost: [] }
    },
    queryFn: async () => {
      const c = client!
      const entry = await getDocument(c, rkey!)
      const provider = detectProvider(entry.value.content)
      if (!provider) {
        // Unrecognised (or absent) content — show the plaintext mirror.
        return {
          entry,
          markdown: entry.value.textContent ?? "",
          providerId: null,
          lost: [],
        }
      }
      const { markdown, lost } = await provider.toMarkdown(
        entry.value.content,
        {
          did,
          fetchBlob: async (ref: BlobRef) => {
            const cid = getBlobCidString(ref)
            const res = await c.getBlob(
              did as Parameters<typeof c.getBlob>[0],
              cid as Parameters<typeof c.getBlob>[1],
            )
            return res.body as Uint8Array
          },
        },
      )
      return { entry, markdown, providerId: provider.id, lost }
    },
  })
}

/** Upload an image file as a blob, returning its ref (for in-post images). */
export function useUploadImage() {
  const { client } = useAuth()
  return useMutation({
    mutationFn: (file: File) => uploadImageBlob(client!, file),
  })
}

// ---- Writes ----
// Each mutation owns its full async unit (including any blob upload) so callers
// never await — they pass raw inputs and react to the result in callbacks.

export function usePutPublication() {
  const { client, did } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      rkey: string
      value: Omit<PublicationRecord, "$type">
      /** A freshly-picked icon to upload and attach before writing. */
      iconFile?: File | null
    }) => {
      let icon = vars.value.icon
      if (vars.iconFile) icon = await uploadImageBlob(client!, vars.iconFile)
      await putPublication(client!, vars.rkey, { ...vars.value, icon })
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.publications(did) }),
  })
}

/**
 * Create or update a document. Resolves the cover image (upload a new file, drop
 * the old one, or keep it) inside the mutation so the whole save is one unit.
 */
export function useSaveDocument() {
  const { client, did } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      isNew: boolean
      rkey: string
      value: Omit<DocumentRecord, "$type">
      coverFile?: File | null
      coverRemoved?: boolean
    }) => {
      let coverImage = vars.value.coverImage
      if (vars.coverRemoved) coverImage = undefined
      if (vars.coverFile)
        coverImage = await uploadImageBlob(client!, vars.coverFile)
      const value = { ...vars.value, coverImage }
      if (vars.isNew) await createDocument(client!, value, vars.rkey)
      else await putDocument(client!, vars.rkey, value)
      return { rkey: vars.rkey }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.documents(did) })
      qc.invalidateQueries({ queryKey: queryKeys.document(did, vars.rkey) })
    },
  })
}

export function useDeleteDocument() {
  const { client, did } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rkey: string) => deleteDocument(client!, rkey),
    onSuccess: (_data, rkey) => {
      qc.invalidateQueries({ queryKey: queryKeys.documents(did) })
      qc.removeQueries({ queryKey: queryKeys.document(did, rkey) })
    },
  })
}
