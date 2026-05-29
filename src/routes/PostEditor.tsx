import { l } from "@atproto/lex"
import { markdown } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import remarkGfm from "remark-gfm"
import { useAuth } from "../auth/AuthProvider.tsx"
import { blobImageUrl } from "../lib/bsky.ts"
import { markdownToPlaintext } from "../lib/markdown.ts"
import {
  buildMarkpubContent,
  isMarkpubMarkdown,
  readMarkpubMarkdown,
} from "../lib/markpub.ts"
import {
  errorMessage,
  useDeleteDocument,
  useDocuments,
  useEditableDocument,
  usePublications,
  useSaveDocument,
} from "../lib/queries.ts"
import {
  DEFAULT_PATH_TEMPLATE,
  documentBelongsTo,
  documentUrl,
  interpolatePath,
  nextTid,
  templatizePath,
  type DocumentRecord,
} from "../lib/repo.ts"

export function PostEditor() {
  const { rkey } = useParams<{ rkey: string }>()
  const isNew = !rkey
  const navigate = useNavigate()
  const { did } = useAuth()
  const { publications, loading: pubLoading } = usePublications()
  const [searchParams] = useSearchParams()

  const {
    data: editableDoc,
    isPending: docPending,
    error: docError,
  } = useEditableDocument(isNew ? undefined : rkey)
  const existing = editableDoc?.entry.value ?? null
  const loading = !isNew && docPending
  const loadError = docError
    ? errorMessage(docError, "Failed to load post")
    : null

  const { data: allDocs } = useDocuments()
  const {
    mutate: saveDocument,
    isPending: saving,
    error: saveErr,
  } = useSaveDocument()
  const {
    mutate: deleteDocument,
    isPending: deleting,
    error: deleteErr,
  } = useDeleteDocument()

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [pathTemplate, setPathTemplate] = useState(DEFAULT_PATH_TEMPLATE)
  const [body, setBody] = useState("")
  const pathDialogRef = useRef<HTMLDialogElement>(null)

  // Cover image: a newly-picked file to upload, or a flag to drop the existing
  // one. Otherwise the document's existing coverImage blob is kept.
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverRemoved, setCoverRemoved] = useState(false)
  const coverObjectUrl = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : null),
    [coverFile],
  )
  useEffect(() => {
    return () => {
      if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl)
    }
  }, [coverObjectUrl])

  // Synchronous form validation only; save/delete failures are derived from the
  // mutations above.
  const [formError, setFormError] = useState<string | null>(null)
  const saveError =
    formError ??
    (saveErr
      ? errorMessage(saveErr, "Failed to save")
      : deleteErr
        ? errorMessage(deleteErr, "Failed to delete")
        : null)

  // For a new post the target publication is user-selectable, defaulting to
  // ?pub=<rkey>. For an existing post it's fixed to whichever publication its
  // `site` points at.
  const [selectedPubRkey, setSelectedPubRkey] = useState<string | null>(
    searchParams.get("pub"),
  )
  const publication = useMemo(() => {
    if (!publications.length) return null
    if (existing?.site) {
      return (
        publications.find((p) => documentBelongsTo(p, existing.site)) ?? null
      )
    }
    return (
      publications.find((p) => p.rkey === selectedPubRkey) ?? publications[0]
    )
  }, [publications, existing, selectedPubRkey])

  // Seed the editable form fields from the loaded document. The query result is
  // the source of truth for `existing`; this only mirrors it into the mutable
  // inputs. We seed once per record so a refetch (e.g. after save) doesn't
  // clobber edits — except that if a list-cache placeholder gets upgraded to a
  // richer body (a text blob) we adopt it, as long as the user hasn't typed yet.
  const seededUriRef = useRef<string | null>(null)
  const seededBodyRef = useRef("")
  useEffect(() => {
    if (!editableDoc || !rkey) return
    const v = editableDoc.entry.value
    if (seededUriRef.current !== editableDoc.entry.uri) {
      seededUriRef.current = editableDoc.entry.uri
      seededBodyRef.current = editableDoc.markdown
      setTitle(v.title ?? "")
      setDescription(v.description ?? "")
      setTags((v.tags ?? []).join(", "))
      setPathTemplate(templatizePath(v.path, rkey))
      setBody(editableDoc.markdown)
    } else if (
      editableDoc.markdown !== seededBodyRef.current &&
      body === seededBodyRef.current
    ) {
      seededBodyRef.current = editableDoc.markdown
      setBody(editableDoc.markdown)
    }
  }, [editableDoc, rkey, body])

  // Names the richtext formats used by existing posts in the target publication
  // when none of them are markpub — i.e. the provider stores posts in a format
  // we don't write, so the post we're about to publish may not render there.
  const unsupportedSiblingFormats = useMemo(() => {
    if (!isNew || !publication || !allDocs) return null
    const withContent = allDocs.filter(
      (d) => documentBelongsTo(publication, d.value.site) && !!d.value.content,
    )
    if (withContent.length === 0) return null
    if (withContent.some((d) => isMarkpubMarkdown(d.value.content))) return null
    return [
      ...new Set(
        withContent.map(
          (d) =>
            (d.value.content as { $type?: string }).$type ??
            "an unknown format",
        ),
      ),
    ]
  }, [isNew, publication, allDocs])

  const cmExtensions = useMemo(
    () => [markdown({ codeLanguages: languages }), EditorView.lineWrapping],
    [],
  )

  // Derive dirtiness by diffing form state against the loaded record — no
  // separate isDirty state to keep in sync. For a new post, "dirty" means the
  // user has entered anything worth saving.
  const isDirty = useMemo(() => {
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    const coverChanged = coverFile !== null || coverRemoved

    if (!existing) {
      return (
        coverChanged ||
        title.trim() !== "" ||
        body !== "" ||
        description.trim() !== "" ||
        tagList.length > 0 ||
        pathTemplate.trim() !== DEFAULT_PATH_TEMPLATE
      )
    }

    const baseBody =
      readMarkpubMarkdown(existing.content) ?? existing.textContent ?? ""
    const baseTags = existing.tags ?? []
    const basePath = templatizePath(existing.path, rkey ?? "")

    return (
      coverChanged ||
      title.trim() !== (existing.title ?? "") ||
      description.trim() !== (existing.description ?? "") ||
      pathTemplate.trim() !== basePath ||
      body !== baseBody ||
      JSON.stringify(tagList) !== JSON.stringify(baseTags)
    )
  }, [
    existing,
    title,
    description,
    tags,
    pathTemplate,
    body,
    rkey,
    coverFile,
    coverRemoved,
  ])

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!publication) return
    if (!title.trim()) {
      setFormError("A headline is required.")
      return
    }

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
      ...existing, // preserve contributors, bskyPostRef, etc.
      site: publication.uri as l.UriString,
      title: title.trim(),
      description: description.trim() || undefined,
      tags: tagList.length ? tagList : undefined,
      path: interpolatePath(pathTemplate, docRkey),
      content,
      coverImage: existing?.coverImage,
      textContent: markdownToPlaintext(body) || undefined,
      publishedAt: existing?.publishedAt ?? l.currentDatetimeString(),
      updatedAt: existing ? l.currentDatetimeString() : undefined,
    }

    // The mutation resolves the cover image (upload/remove/keep) itself.
    saveDocument(
      { isNew, rkey: docRkey, value, coverFile, coverRemoved },
      {
        onSuccess: () => {
          if (isNew) navigate(`/post/${docRkey}`, { replace: true })
          else {
            setCoverFile(null)
            setCoverRemoved(false)
          }
        },
      },
    )
  }

  function onDelete() {
    if (!rkey) return
    if (!window.confirm("Delete this post? This cannot be undone.")) return
    deleteDocument(rkey, {
      onSuccess: () => navigate("/", { replace: true }),
    })
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

  // This editor only understands markpub (GFM markdown). If an existing post's
  // content is some other richtext format, refuse to edit it — saving would
  // overwrite the original content with markpub and lose it.
  const content = existing?.content
  if (content && !isMarkpubMarkdown(content)) {
    const format = (content as { $type?: string }).$type ?? "an unknown format"
    const otherUrl = documentUrl(publication.value.url, existing?.path)
    return (
      <div className="container">
        <div className="toolbar">
          <Link to="/" className="muted" style={{ textDecoration: "none" }}>
            ← All posts
          </Link>
          <span className="toolbar__spacer" />
          {otherUrl && (
            <a
              className="btn btn--ghost"
              href={otherUrl}
              target="_blank"
              rel="noreferrer"
            >
              View live
            </a>
          )}
        </div>
        <div className="notice">
          <p className="kicker">Can’t edit this post</p>
          <h2 style={{ marginTop: 0 }}>{existing?.title || "Untitled"}</h2>
          <p className="muted">
            This post’s content is stored as <code>{format}</code>, which
            standard.horse can’t edit yet — it only handles markpub (
            <code>at.markpub.markdown</code>) markdown. Editing it here would
            overwrite the original content, so it’s read-only.
          </p>
        </div>
      </div>
    )
  }

  const liveUrl = documentUrl(publication.value.url, existing?.path)
  // For new posts the record key isn't minted until publish, so show a "…".
  const resolvedPath = interpolatePath(pathTemplate, rkey ?? "…")
  const coverPreviewUrl =
    coverObjectUrl ??
    (!coverRemoved && existing?.coverImage && did
      ? blobImageUrl(did, existing.coverImage, "feed_fullsize")
      : null)

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
        {isNew && publications.length > 1 && (
          <select
            className="select"
            value={publication?.rkey ?? ""}
            onChange={(e) => setSelectedPubRkey(e.target.value)}
            title="Which publication to publish to"
          >
            {publications.map((p) => (
              <option key={p.rkey} value={p.rkey}>
                {p.value.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          form="post-form"
          className="btn btn--accent"
          disabled={saving || !isDirty}
        >
          {saving ? "Saving…" : isNew ? "Publish" : "Save"}
        </button>
      </div>

      {saveError && <div className="error-banner">{saveError}</div>}

      {unsupportedSiblingFormats && (
        <div className="admonition admonition--warn" role="note">
          <p className="admonition__title">Format mismatch</p>
          <p style={{ margin: 0 }}>
            The other posts in <strong>{publication.value.name}</strong> are
            stored as{" "}
            {unsupportedSiblingFormats.map((f, i) => (
              <span key={f}>
                {i > 0 && ", "}
                <code>{f}</code>
              </span>
            ))}
            , not markpub. standard.horse writes posts as markdown (
            <code>at.markpub.markdown</code>), so your blog provider may not
            support this richtext format.
          </p>
        </div>
      )}

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

        <div className="field">
          <span className="field__label">Cover image</span>
          <div className="row" style={{ alignItems: "center" }}>
            {coverPreviewUrl && (
              <img
                src={coverPreviewUrl}
                alt=""
                style={{
                  width: 160,
                  height: 90,
                  objectFit: "cover",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--rule)",
                }}
              />
            )}
            <div className="stack" style={{ gap: 8 }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  if (f && f.size > 1_000_000) {
                    setFormError("Cover image must be under 1MB.")
                    e.target.value = ""
                    return
                  }
                  setFormError(null)
                  setCoverRemoved(false)
                  setCoverFile(f)
                }}
              />
              {coverPreviewUrl && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setCoverFile(null)
                    setCoverRemoved(true)
                  }}
                >
                  Remove cover
                </button>
              )}
            </div>
          </div>
          <span className="muted" style={{ fontSize: "0.74rem" }}>
            Thumbnail / cover image. Under 1MB.
          </span>
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
          <p
            className="muted"
            style={{ fontSize: "0.84rem", marginBottom: 16 }}
          >
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
