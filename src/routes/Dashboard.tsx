import { useEffect, useState } from "react"
import { Link } from "react-router"
import { useAuth } from "../auth/AuthProvider.tsx"
import {
  blobUrl,
  documentUrl,
  listDocuments,
  type DocumentRecord,
  type RecordEntry,
} from "../lib/repo.ts"
import { usePublication } from "../lib/usePublication.ts"

function formatDate(iso: string | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function Dashboard() {
  const { client, did } = useAuth()
  const { publication, loading: pubLoading, error: pubError } = usePublication()
  const [docs, setDocs] = useState<RecordEntry<DocumentRecord>[] | null>(null)
  const [docsError, setDocsError] = useState<string | null>(null)

  useEffect(() => {
    if (!client || !publication) return
    let cancelled = false
    // A repo can hold documents for several publications (e.g. a Leaflet blog
    // alongside this one). `document.site` points at the owning publication —
    // either its at:// record URI or its https:// url — so keep only matches.
    const pubUri = publication.uri
    const pubUrl = publication.value.url?.replace(/\/$/, "")
    const belongsHere = (site: string | undefined) => {
      if (!site) return false
      const s = site.replace(/\/$/, "")
      return s === pubUri || s === pubUrl
    }
    listDocuments(client)
      .then((list) => {
        if (cancelled) return
        const mine = list.filter((d) => belongsHere(d.value.site))
        mine.sort((a, b) =>
          (b.value.publishedAt ?? "").localeCompare(a.value.publishedAt ?? ""),
        )
        setDocs(mine)
      })
      .catch((err) => {
        if (!cancelled)
          setDocsError(
            err instanceof Error ? err.message : "Failed to load posts",
          )
      })
    return () => {
      cancelled = true
    }
  }, [client, publication])

  if (pubLoading) {
    return (
      <div className="container">
        <p className="spinner">Reading from your PDS…</p>
      </div>
    )
  }

  if (pubError) {
    return (
      <div className="container">
        <div className="error-banner">{pubError}</div>
      </div>
    )
  }

  if (!publication) {
    return (
      <div className="container">
        <div className="notice">
          <p className="kicker">No publication found</p>
          <h2>You don’t have a standard.site publication yet.</h2>
          <p className="muted">
            standard.horse edits existing publications (for now!). If you want a
            fully managed experience, create one with a standard.site-compatible
            tool such as{" "}
            <a href="https://leaflet.pub" target="_blank" rel="noreferrer">
              Leaflet
            </a>
            ,{" "}
            <a href="https://pckt.blog" target="_blank" rel="noreferrer">
              pckt
            </a>
            , or{" "}
            <a href="https://offprint.app" target="_blank" rel="noreferrer">
              Offprint
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  const pub = publication.value
  const iconUrl = pub.icon && did ? blobUrl(client!, did, pub.icon) : null

  return (
    <div className="container">
      <div className="toolbar">
        <div className="row" style={{ alignItems: "center", gap: 14 }}>
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              width={52}
              height={52}
              style={{
                borderRadius: 4,
                objectFit: "cover",
                border: "1px solid var(--rule)",
              }}
            />
          )}
          <div className="stack">
            <span className="kicker" style={{ margin: 0 }}>
              Your publication
            </span>
            <h1 style={{ margin: 0, fontSize: "2rem" }}>{pub.name}</h1>
            <a
              href={pub.url}
              target="_blank"
              rel="noreferrer"
              className="muted"
            >
              {pub.url}
            </a>
          </div>
        </div>
        <span className="toolbar__spacer" />
        <Link className="btn btn--ghost" to="/settings">
          Masthead &amp; Theme
        </Link>
        <Link className="btn btn--accent" to="/post/new">
          Write a post
        </Link>
      </div>

      <hr />

      {docsError && <div className="error-banner">{docsError}</div>}

      {!docs ? (
        <p className="spinner">Gathering the morning’s posts…</p>
      ) : docs.length === 0 ? (
        <div className="notice">
          <h3>No posts yet.</h3>
          <p className="muted">
            Your front page is blank.{" "}
            <Link to="/post/new">Write your first post.</Link>
          </p>
        </div>
      ) : (
        <div>
          {docs.map((doc) => {
            const url = documentUrl(pub.url, doc.value.path)
            return (
              <Link key={doc.uri} to={`/post/${doc.rkey}`} className="post-row">
                <div>
                  <h2 className="post-row__title">
                    {doc.value.title || "Untitled"}
                  </h2>
                  {doc.value.description && (
                    <p
                      className="muted"
                      style={{ margin: 0, maxWidth: "60ch" }}
                    >
                      {doc.value.description}
                    </p>
                  )}
                  {url && (
                    <span className="muted" style={{ fontSize: "0.74rem" }}>
                      {url}
                    </span>
                  )}
                </div>
                <span className="post-row__meta">
                  {formatDate(doc.value.publishedAt)}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
