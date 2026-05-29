import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import { listPublications, type PublicationRecord, type RecordEntry } from './repo.ts'

interface PublicationState {
  loading: boolean
  error: string | null
  /** The user's first publication, or null if they have none. */
  publication: RecordEntry<PublicationRecord> | null
  reload: () => void
}

/**
 * Loads the signed-in user's publication. We only edit existing publications
 * (first draft), so if a user has more than one we use the first; if they have
 * none, screens render an empty state pointing them to standard.site.
 */
export function usePublication(): PublicationState {
  const { client } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [publication, setPublication] =
    useState<RecordEntry<PublicationRecord> | null>(null)
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
        setPublication(pubs[0] ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load publication')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, nonce])

  return { loading, error, publication, reload }
}
