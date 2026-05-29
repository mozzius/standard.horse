import { getBlobCidString, l } from "@atproto/lex"
import { markdown } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Link, useNavigate, useParams } from "react-router"
import remarkGfm from "remark-gfm"
import { useAuth } from "../auth/AuthProvider.tsx"
import {
  buildMarkpubContent,
  markpubTextBlob,
  readMarkpubMarkdown,
} from "../lib/markpub.ts"
import {
  createDocument,
  DEFAULT_PATH_TEMPLATE,
  deleteDocument,
  documentUrl,
  getDocument,
  interpolatePath,
  nextTid,
  putDocument,
  templatizePath,
  type DocumentRecord,
} from "../lib/repo.ts"
import { usePublication } from "../lib/usePublication.ts"

/** Rough plaintext for the document's `textContent` (indexers, search). */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

export function PostEditor() {
  const { rkey } = useParams<{ rkey: string }>()
  const isNew = !rkey
  const navigate = useNavigate()
  const { client, did } = useAuth()
  const { publication, loading: pubLoading } = usePublication()

  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [existing, setExisting] = useState<DocumentRecord | null>(null)

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [pathTemplate, setPathTemplate] = useState(DEFAULT_PATH_TEMPLATE)
  const [body, setBody] = useState("")
  const pathDialogRef = useRef<HTMLDialogElement>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Load existing document when editing.
  useEffect(() => {
    if (isNew || !client || !rkey) return
    let cancelled = false
    setLoading(true)
    getDocument(client, rkey)
      .then(async (entry) => {
        if (cancelled) return
        const v = entry.value
        setExisting(v)
        setTitle(v.title ?? "")
        setDescription(v.description ?? "")
        setTags((v.tags ?? []).join(", "))
        setPathTemplate(templatizePath(v.path, rkey))

        let md = readMarkpubMarkdown(v.content)
        if (md == null) {
          // Fall back to a markdown blob, or the plaintext mirror.
          const blob = markpubTextBlob(v.content)
          if (blob && did) {
            try {
              const cid = getBlobCidString(blob)
              const res = await client.getBlob(
                did as Parameters<typeof client.getBlob>[0],
                cid as Parameters<typeof client.getBlob>[1],
              )
              md = new TextDecoder().decode(res.body as Uint8Array)
            } catch {
              md = v.textContent ?? ""
            }
          } else {
            md = v.textContent ?? ""
          }
        }
        if (!cancelled) setBody(md)
      })
      .catch((err) => {
        if (!cancelled)
          setLoadError(
            err instanceof Error ? err.message : "Failed to load post",
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client, rkey, isNew, did])

  const cmExtensions = useMemo(
    () => [markdown({ codeLanguages: languages }), EditorView.lineWrapping],
    [],
  )

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!client || !publication) return
    if (!title.trim()) {
      setSaveError("A headline is required.")
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)

      const content = buildMarkpubContent(
        body,
      ) as unknown as DocumentRecord["content"]

      // The record key is a freshly-minted TID for new posts. The path is the
      // user's template with `<rkey>` substituted for that key.
      const docRkey = rkey ?? nextTid()

      const value: Omit<DocumentRecord, "$type"> = {
        ...existing, // preserve coverImage, contributors, bskyPostRef, etc.
        site: publication.uri as l.UriString,
        title: title.trim(),
        description: description.trim() || undefined,
        tags: tagList.length ? tagList : undefined,
        path: interpolatePath(pathTemplate, docRkey),
        content,
        textContent: stripMarkdown(body) || undefined,
        publishedAt: existing?.publishedAt ?? l.currentDatetimeString(),
        updatedAt: existing ? l.currentDatetimeString() : undefined,
      }

      if (isNew) {
        await createDocument(client, value, docRkey)
        navigate(`/post/${docRkey}`, { replace: true })
      } else {
        await putDocument(client, docRkey, value)
        setExisting({ $type: "site.standard.document", ...value })
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!client || !rkey) return
    if (!window.confirm("Delete this post? This cannot be undone.")) return
    setDeleting(true)
    try {
      await deleteDocument(client, rkey)
      navigate("/", { replace: true })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete")
      setDeleting(false)
    }
  }

  if (pubLoading || loading) {
    return (
      <div className="container">
        <p className="spinner">Loading the manuscript…</p>
      </div>
    )
  }

  if (!publication) {
    return (
      <div className="container">
        <div className="notice">
          <h3>You need a publication first.</h3>
          <p className="muted">
            <Link to="/">Back to your posts.</Link>
          </p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="container">
        <div className="error-banner">{loadError}</div>
      </div>
    )
  }

  const liveUrl = documentUrl(publication.value.url, existing?.path)
  // For new posts the record key isn't minted until publish, so show a "…".
  const resolvedPath = interpolatePath(pathTemplate, rkey ?? "…")

  return (
    <div className="container">
      <div className="toolbar">
        <Link to="/" className="muted" style={{ textDecoration: "none" }}>
          ← All posts
        </Link>
        <span className="toolbar__spacer" />
        {!isNew && liveUrl && (
          <a
            className="btn btn--ghost"
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
          >
            View live
          </a>
        )}
        {!isNew && (
          <button
            type="button"
            className="btn btn--danger"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
        <button
          type="submit"
          form="post-form"
          className="btn btn--accent"
          disabled={saving}
        >
          {saving ? "Saving…" : isNew ? "Publish" : "Save"}
        </button>
      </div>

      {saveError && <div className="error-banner">{saveError}</div>}

      <form id="post-form" onSubmit={onSave}>
        <input
          className="input"
          style={{
            fontFamily: "var(--serif)",
            fontSize: "2rem",
            border: "none",
            background: "transparent",
            padding: "4px 0",
            marginBottom: 8,
          }}
          placeholder="Headline"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="row" style={{ marginBottom: 16 }}>
          <label
            className="field"
            style={{ flex: 2, minWidth: 240, marginBottom: 0 }}
          >
            <span className="field__label">Description / standfirst</span>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label
            className="field"
            style={{ flex: 1, minWidth: 160, marginBottom: 0 }}
          >
            <span className="field__label">Tags (comma-separated)</span>
            <input
              className="input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="path-chip"
          onClick={() => pathDialogRef.current?.showModal()}
          style={{ marginBottom: 16 }}
        >
          <span className="field__label" style={{ margin: 0 }}>
            Path
          </span>
          <code>{resolvedPath}</code>
          <span className="muted" style={{ fontSize: "0.74rem" }}>
            edit
          </span>
        </button>

        <div className="editor-split">
          <div className="editor-pane">
            <div className="editor-pane__head">Markdown · GFM</div>
            <div className="cm-host">
              <CodeMirror
                value={body}
                height="100%"
                extensions={cmExtensions}
                onChange={setBody}
                basicSetup={{ lineNumbers: false, foldGutter: false }}
              />
            </div>
          </div>
          <div className="editor-pane">
            <div className="editor-pane__head">Preview</div>
            <article className="prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {body || "*Nothing written yet.*"}
              </ReactMarkdown>
            </article>
          </div>
        </div>
      </form>

      <dialog ref={pathDialogRef} className="dialog">
        <form method="dialog">
          <h3 style={{ marginBottom: 4 }}>URL path</h3>
          <p className="muted" style={{ fontSize: "0.84rem", marginBottom: 16 }}>
            The path appended to your publication URL. Use the token{" "}
            <code>&lt;rkey&gt;</code> and it’s replaced with the post’s record
            key when saved.
          </p>
          <label className="field">
            <span className="field__label">Path template</span>
            <input
              className="input"
              value={pathTemplate}
              onChange={(e) => setPathTemplate(e.target.value)}
              placeholder={DEFAULT_PATH_TEMPLATE}
              spellCheck={false}
              autoCapitalize="none"
              autoFocus
            />
          </label>
          <p className="muted" style={{ fontSize: "0.78rem" }}>
            Resolves to <code>{resolvedPath}</code>
          </p>
          <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
            <span className="toolbar__spacer" />
            <button className="btn btn--accent" type="submit">
              Done
            </button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
