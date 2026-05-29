import { useEffect, useState } from "react"
import { Link } from "react-router"
import { useAuth } from "../auth/AuthProvider.tsx"
import {
  blobUrl,
  documentUrl,
  listDocuments,
  type DocumentRecord,
  type PublicationRecord,
  type RecordEntry,
} from "../lib/repo.ts"
import { isMarkpubMarkdown } from "../lib/markpub.ts"
import { documentBelongsTo, usePublications } from "../lib/usePublications.ts"

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

function PostRow({
  doc,
  pubUrl,
}: {
  doc: RecordEntry<DocumentRecord>
  pubUrl: string | undefined
}) {
  const url = documentUrl(pubUrl, doc.value.path)
  // Only markpub posts are editable; flag others so the click isn't a dead end.
  const readOnly = !!doc.value.content && !isMarkpubMarkdown(doc.value.content)
  return (
    <Link to={`/post/${doc.rkey}`} className="post-row">
      <div>
        <h2 className="post-row__title">
          {doc.value.title || "Untitled"}
          {readOnly && <span className="tag">read-only</span>}
        </h2>
        {doc.value.description && (
          <p className="muted" style={{ margin: 0, maxWidth: "60ch" }}>
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
}

function PublicationSection({
  pub,
  docs,
}: {
  pub: RecordEntry<PublicationRecord>
  docs: RecordEntry<DocumentRecord>[]
}) {
  const { did, pdsUrl } = useAuth()
  const v = pub.value
  const iconUrl = v.icon && did && pdsUrl ? blobUrl(pdsUrl, did, v.icon) : null

  return (
    <section style={{ marginBottom: 48 }}>
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
              Publication
            </span>
            <h1 style={{ margin: 0, fontSize: "2rem" }}>{v.name}</h1>
            <a href={v.url} target="_blank" rel="noreferrer" className="muted">
              {v.url}
            </a>
          </div>
        </div>
        <span className="toolbar__spacer" />
        <Link className="btn btn--ghost" to={`/settings/${pub.rkey}`}>
          Masthead &amp; Theme
        </Link>
        <Link className="btn btn--accent" to={`/post/new?pub=${pub.rkey}`}>
          Write a post
        </Link>
      </div>

      <hr />

      {docs.length === 0 ? (
        <div className="notice">
          <h3>No posts yet.</h3>
          <p className="muted">
            This publication’s front page is blank.{" "}
            <Link to={`/post/new?pub=${pub.rkey}`}>Write the first post.</Link>
          </p>
        </div>
      ) : (
        <div>
          {docs.map((doc) => (
            <PostRow key={doc.uri} doc={doc} pubUrl={v.url} />
          ))}
        </div>
      )}
    </section>
  )
}

export function Dashboard() {
  const { client } = useAuth()
  const { publications, loading: pubLoading, error: pubError } = usePublications()
  const [docs, setDocs] = useState<RecordEntry<DocumentRecord>[] | null>(null)
  const [docsError, setDocsError] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return
    let cancelled = false
    listDocuments(client)
      .then((list) => {
        if (cancelled) return
        list.sort((a, b) =>
          (b.value.publishedAt ?? "").localeCompare(a.value.publishedAt ?? ""),
        )
        setDocs(list)
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
  }, [client])

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

  if (publications.length === 0) {
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

  const unattached =
    docs?.filter((d) => !publications.some((p) => documentBelongsTo(p, d.value.site))) ??
    []

  return (
    <div className="container">
      {docsError && <div className="error-banner">{docsError}</div>}

      {!docs ? (
        <p className="spinner">Gathering the morning’s posts…</p>
      ) : (
        <>
          {publications.map((pub) => (
            <PublicationSection
              key={pub.uri}
              pub={pub}
              docs={docs.filter((d) => documentBelongsTo(pub, d.value.site))}
            />
          ))}

          {unattached.length > 0 && (
            <section style={{ marginBottom: 48 }}>
              <span className="kicker">Unattached documents</span>
              <h2 style={{ marginTop: 0 }}>Not linked to a publication</h2>
              <hr />
              <div>
                {unattached.map((doc) => (
                  <PostRow key={doc.uri} doc={doc} pubUrl={undefined} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
