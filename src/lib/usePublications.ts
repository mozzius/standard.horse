import { useCallback, useEffect, useState } from "react"
import { useAuth } from "../auth/AuthProvider.tsx"
import {
  listPublications,
  type PublicationRecord,
  type RecordEntry,
} from "./repo.ts"

interface PublicationsState {
  loading: boolean
  error: string | null
  /** All of the signed-in user's publications. */
  publications: RecordEntry<PublicationRecord>[]
  reload: () => void
}

/** Loads all of the signed-in user's site.standard.publication records. */
export function usePublications(): PublicationsState {
  const { client } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publications, setPublications] = useState<
    RecordEntry<PublicationRecord>[]
  >([])
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!client) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listPublications(client)
      .then((pubs) => {
        if (cancelled) return
        setPublications(pubs)
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : "Failed to load publications",
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, nonce])

  return { loading, error, publications, reload }
}

/**
 * Does a document belong to this publication? `document.site` points at the
 * owning publication — either its at:// record URI or its https:// url.
 */
export function documentBelongsTo(
  pub: RecordEntry<PublicationRecord>,
  site: string | undefined,
): boolean {
  if (!site) return false
  const s = site.replace(/\/$/, "")
  return s === pub.uri || s === pub.value.url?.replace(/\/$/, "")
}
