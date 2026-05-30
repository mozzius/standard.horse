import { getBlobCidString, l } from "@atproto/lex"
import { markdown } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import remarkGfm from "remark-gfm"
import { useAuth } from "../auth/AuthProvider.tsx"
import { blobImageUrl, cdnImageUrl } from "../lib/bsky.ts"
import { markdownToPlaintext } from "../lib/markdown.ts"
import {
  defaultProvider,
  detectProvider,
  providerById,
  providers,
  type UploadedImage,
} from "../lib/providers/index.ts"
import {
  errorMessage,
  useDeleteDocument,
  useDocuments,
  useEditableDocument,
  usePublications,
  useSaveDocument,
  useUploadImage,
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

/** Read an image file's pixel dimensions (for the stored aspect ratio). */
async function readImageSize(
  file: File,
): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(file)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return size
  } catch {
    return { width: 0, height: 0 }
  }
}

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
  const { mutate: uploadImage, isPending: uploadingImage } = useUploadImage()

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [pathTemplate, setPathTemplate] = useState(DEFAULT_PATH_TEMPLATE)
  const [body, setBody] = useState("")
  const pathDialogRef = useRef<HTMLDialogElement>(null)
  // The live CodeMirror view, so we can insert uploaded images at the cursor.
  const viewRef = useRef<EditorView | null>(null)
  // In-post images uploaded this session, keyed by blob CID, so the provider
  // can reattach their blob refs on save.
  const uploadedImagesRef = useRef<Map<string, UploadedImage>>(new Map())

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

  // New posts default to whatever richtext format the other posts in the target
  // publication use, so a post lands in a format the blog's reader understands.
  const siblingProviderId = useMemo(() => {
    if (!isNew || !publication || !allDocs) return null
    const counts = new Map<string, number>()
    for (const d of allDocs) {
      if (!documentBelongsTo(publication, d.value.site)) continue
      const p = detectProvider(d.value.content)
      if (p) counts.set(p.id, (counts.get(p.id) ?? 0) + 1)
    }
    let best: string | null = null
    let most = 0
    for (const [id, c] of counts) if (c > most) ((best = id), (most = c))
    return best
  }, [isNew, publication, allDocs])

  // The format this post is read from / written in. New posts: the dropdown
  // selection, else the sibling default, else markpub. Existing posts: whatever
  // provider read them (null = an unrecognised format → read-only below).
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  )
  const activeProvider = useMemo(() => {
    if (isNew)
      return (
        providerById(
          selectedProviderId ?? siblingProviderId ?? defaultProvider.id,
        ) ?? defaultProvider
      )
    if (editableDoc?.providerId)
      return providerById(editableDoc.providerId) ?? defaultProvider
    // Existing post with content we couldn't read → unknown format.
    return existing?.content ? null : defaultProvider
  }, [isNew, selectedProviderId, siblingProviderId, editableDoc, existing])

  // Seed the editable form fields from the loaded document. The query result is
  // the source of truth for `existing`; this only mirrors it into the mutable
  // inputs. We seed once per record so a refetch (e.g. after save) doesn't
  // clobber edits — except that a list-cache placeholder upgraded to a richer
  // body is adopted, as long as the user hasn't typed yet.
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

    const baseTags = existing.tags ?? []
    const basePath = templatizePath(existing.path, rkey ?? "")

    return (
      coverChanged ||
      title.trim() !== (existing.title ?? "") ||
      description.trim() !== (existing.description ?? "") ||
      pathTemplate.trim() !== basePath ||
      body !== seededBodyRef.current ||
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

  /** Insert markdown at the cursor (or append if the editor isn't mounted). */
  function insertAtCursor(text: string) {
    const view = viewRef.current
    if (!view) {
      setBody((b) => (b ? `${b}\n\n${text}` : text))
      return
    }
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    view.focus()
  }

  /** Upload an image file and insert a markdown image referencing its blob. */
  async function handleImageFile(file: File) {
    setFormError(null)
    if (!file.type.startsWith("image/")) return
    if (file.size > 1_000_000) {
      setFormError("Images must be under 1MB.")
      return
    }
    const { width, height } = await readImageSize(file)
    const alt = file.name.replace(/\.[^.]+$/, "")
    uploadImage(file, {
      onSuccess: (ref) => {
        const cid = getBlobCidString(ref)
        uploadedImagesRef.current.set(cid, {
          ref,
          width,
          height,
          mimeType: file.type,
          alt,
        })
        const url = did ? cdnImageUrl(did, cid, "feed_fullsize") : ""
        insertAtCursor(`![${alt}](${url})`)
      },
      onError: (e) => setFormError(errorMessage(e, "Failed to upload image.")),
    })
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!publication || !activeProvider) return
    if (!title.trim()) {
      setFormError("A headline is required.")
      return
    }

    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    // Convert the edited markdown into the active format's content object,
    // reattaching existing/uploaded image blobs by CID.
    const content = activeProvider.fromMarkdown(body, {
      did,
      previousContent: existing?.content,
      uploadedImages: uploadedImagesRef.current,
    }) as unknown as DocumentRecord["content"]

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

  // An existing post whose content is a format no provider understands: editing
  // would overwrite the original content, so keep it read-only.
  if (!isNew && existing?.content && !activeProvider) {
    const format =
      (existing.content as { $type?: string }).$type ?? "an unknown format"
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
            standard.horse doesn’t support yet. Editing it here would overwrite
            the original content, so it’s read-only.
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
  const lost = editableDoc?.lost ?? []

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
        {isNew && (
          <select
            className="select"
            value={activeProvider?.id ?? defaultProvider.id}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            title="Richtext format to save this post in"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
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

      {lost.length > 0 && (
        <div className="admonition admonition--warn" role="note">
          <p className="admonition__title">Some content can’t be edited here</p>
          <p style={{ margin: 0 }}>
            This {activeProvider?.label ?? ""} post contains{" "}
            {lost.map((f, i) => (
              <span key={f}>
                {i > 0 && (i === lost.length - 1 ? " and " : ", ")}
                <strong>{f}</strong>
              </span>
            ))}{" "}
            that markdown can’t represent. You can still edit the text, but
            saving will drop {lost.length > 1 ? "those" : "that"}.
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
            <div className="editor-pane__head">
              <span>Markdown · GFM</span>
              <span className="toolbar__spacer" />
              <label
                className="editor-pane__action"
                title="Insert an image (or drag &amp; drop / paste into the editor)"
              >
                {uploadingImage ? "Uploading…" : "+ Image"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={uploadingImage}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handleImageFile(f)
                    e.target.value = ""
                  }}
                />
              </label>
            </div>
            <div
              className="cm-host"
              onDrop={(e) => {
                const f = e.dataTransfer.files?.[0]
                if (f && f.type.startsWith("image/")) {
                  e.preventDefault()
                  void handleImageFile(f)
                }
              }}
              onPaste={(e) => {
                const f = [...e.clipboardData.items]
                  .find((i) => i.type.startsWith("image/"))
                  ?.getAsFile()
                if (f) {
                  e.preventDefault()
                  void handleImageFile(f)
                }
              }}
            >
              <CodeMirror
                value={body}
                height="100%"
                extensions={cmExtensions}
                onChange={setBody}
                onCreateEditor={(view) => {
                  viewRef.current = view
                }}
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
