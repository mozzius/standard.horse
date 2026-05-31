import { getBlobCidString, l } from "@atproto/lex"
import { markdown } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { useEffect, useMemo, useReducer, useRef } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import remarkGfm from "remark-gfm"
import { useAuth } from "../auth/AuthProvider.tsx"
import { blobImageUrl, cdnImageUrl } from "../lib/bsky.ts"
import {
  clearDraft,
  deserializeImages,
  draftKey,
  loadDraft,
  saveDraft,
  serializeImages,
} from "../lib/drafts.ts"
import { markdownToPlaintext } from "../lib/markdown.ts"
import {
  cidFromSrc,
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
  PATH_RKEY_TOKEN,
  templatizePath,
  type DocumentRecord,
} from "../lib/repo.ts"
import {
  editorReducer,
  initEditorState,
  type EditorFields,
} from "./postEditorReducer.ts"

/** A coarse "x ago" label for the draft status; refreshed on each re-render. */
function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return "just now"
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

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

  // All mutable form state lives in one reducer; see postEditorReducer.ts. We
  // destructure for reads and dispatch named actions for writes. `setField` is a
  // shorthand for the common text-input case.
  const [state, dispatch] = useReducer(
    editorReducer,
    searchParams.get("pub"),
    initEditorState,
  )
  const {
    title,
    description,
    tags,
    pathTemplate,
    body,
    coverFile,
    coverRemoved,
    selectedPubRkey,
    selectedProviderId,
    formError,
    savedAt,
    restoredAt,
    stale,
    hydrated,
    baselineTick,
  } = state
  const setField = (field: keyof EditorFields, value: string) =>
    dispatch({ type: "set", field, value })

  const pathDialogRef = useRef<HTMLDialogElement>(null)
  // The live CodeMirror view, so we can insert uploaded images at the cursor.
  const viewRef = useRef<EditorView | null>(null)
  // In-post images uploaded this session, keyed by blob CID, so the provider
  // can reattach their blob refs on save.
  const uploadedImagesRef = useRef<Map<string, UploadedImage>>(new Map())
  // Local object-URL previews for those uploads, keyed by CID. The bsky CDN
  // can't serve a blob until it's referenced by a committed record, so until
  // the post is saved we render the local file instead of the (404ing) CDN URL.
  const previewUrlsRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const urls = previewUrlsRef.current
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  // Cover image: a newly-picked file to upload, or a flag to drop the existing
  // one (both in the reducer). Otherwise the document's existing coverImage is
  // kept.
  const coverObjectUrl = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : null),
    [coverFile],
  )
  useEffect(() => {
    return () => {
      if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl)
    }
  }, [coverObjectUrl])

  // `formError` is synchronous form validation only; save/delete failures are
  // derived from the mutations above. The draft-status fields (`savedAt` drives
  // the "saved locally" pill, `restoredAt` the recovery banner, `stale` the
  // server-changed warning) also live in the reducer.
  const saveError =
    formError ??
    (saveErr
      ? errorMessage(saveErr, "Failed to save")
      : deleteErr
        ? errorMessage(deleteErr, "Failed to delete")
        : null)

  // For a new post the target publication is user-selectable, defaulting to
  // ?pub=<rkey> (the reducer's initial `selectedPubRkey`). For an existing post
  // it's fixed to whichever publication its `site` points at.
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

  // localStorage key for this post's draft: the rkey for an existing post, or a
  // per-target-publication "new" slot for an unsaved one.
  const currentKey = useMemo(() => {
    if (!did) return null
    if (rkey) return draftKey(did, rkey)
    return draftKey(did, { newPub: publication?.rkey ?? null })
  }, [did, rkey, publication])

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

  // Likewise infer the URL path shape (e.g. "/<rkey>" vs "/post/<rkey>") from
  // sibling posts: templatize each sibling's path against its own rkey and take
  // the most common shape. Only paths that actually contain the rkey count
  // (slug-based paths can't be templated for a new post).
  const siblingPathTemplate = useMemo(() => {
    if (!isNew || !publication || !allDocs) return null
    const counts = new Map<string, number>()
    for (const d of allDocs) {
      if (!documentBelongsTo(publication, d.value.site)) continue
      if (!d.value.path) continue
      const tmpl = templatizePath(d.value.path, d.rkey)
      if (!tmpl.includes(PATH_RKEY_TOKEN)) continue
      counts.set(tmpl, (counts.get(tmpl) ?? 0) + 1)
    }
    let best: string | null = null
    let most = 0
    for (const [t, c] of counts) if (c > most) ((best = t), (most = c))
    return best
  }, [isNew, publication, allDocs])

  // The format this post is read from / written in. New posts: the dropdown
  // selection (`selectedProviderId` in the reducer), else the sibling default,
  // else markpub. Existing posts: whatever provider read them (null = an
  // unrecognised format → read-only below).
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
    const md = editableDoc.markdown.trim()
    if (seededUriRef.current !== editableDoc.entry.uri) {
      seededUriRef.current = editableDoc.entry.uri
      // The server body is always the dirty-comparison baseline, even when a
      // local draft supersedes it in the inputs — so isDirty (and the "saved
      // locally" status) reflect the draft differing from what's on the PDS.
      seededBodyRef.current = md
      const draft = did ? loadDraft(draftKey(did, rkey)) : null
      if (draft) {
        uploadedImagesRef.current = deserializeImages(draft.images)
        dispatch({
          type: "restoreDraft",
          draft,
          stale: draft.baseCid !== editableDoc.entry.cid,
        })
      } else {
        dispatch({
          type: "seed",
          fields: {
            title: v.title ?? "",
            description: v.description ?? "",
            tags: (v.tags ?? []).join(", "),
            pathTemplate: templatizePath(v.path, rkey),
            body: md,
          },
        })
      }
      dispatch({ type: "hydrated" })
    } else if (
      md !== seededBodyRef.current &&
      body.trim() === seededBodyRef.current
    ) {
      seededBodyRef.current = md
      dispatch({ type: "adoptBody", body: md })
    }
  }, [editableDoc, rkey, body, did])

  // For a new post, adopt the publication's inferred path shape once it loads
  // (unless the user has already opened the dialog and set one themselves).
  const pathSeededRef = useRef(false)
  useEffect(() => {
    if (!isNew || pathSeededRef.current || !siblingPathTemplate) return
    pathSeededRef.current = true
    setField("pathTemplate", siblingPathTemplate)
  }, [isNew, siblingPathTemplate])

  // For a new post, restore a local draft once the target publication resolves
  // (the draft is keyed by it). Runs once; new posts have no server baseline, so
  // any restored content simply reads as dirty/unsaved.
  const newSeededRef = useRef(false)
  useEffect(() => {
    if (!isNew || newSeededRef.current || !did || !publication) return
    newSeededRef.current = true
    const draft = loadDraft(draftKey(did, { newPub: publication.rkey }))
    if (draft) {
      uploadedImagesRef.current = deserializeImages(draft.images)
      dispatch({ type: "restoreDraft", draft, stale: false })
    }
    dispatch({ type: "hydrated" })
  }, [isNew, did, publication])

  const cmExtensions = useMemo(
    () => [markdown({ codeLanguages: languages }), EditorView.lineWrapping],
    [],
  )

  // Preview renderer: an image src is a bare blob CID, which isn't loadable.
  // Resolve it to a displayable URL — the local object-URL for this session's
  // uploads (the CDN can't serve a blob until it's committed to the record),
  // otherwise the bsky CDN. External (non-CID) srcs pass through untouched.
  const mdComponents = useMemo<Components>(
    () => ({
      img({ node: _node, src, alt, ...rest }) {
        const cid = typeof src === "string" ? cidFromSrc(src) : null
        const display = cid
          ? (previewUrlsRef.current.get(cid) ??
            (did ? cdnImageUrl(did, cid, "feed_fullsize") : src))
          : src
        return <img {...rest} src={display} alt={alt ?? ""} />
      },
    }),
    [did],
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
    // CodeMirror can carry a trailing newline the converted body doesn't, so
    // compare (and save) the trimmed body — trailing whitespace is meaningless.
    const bodyText = body.trim()

    if (!existing) {
      const basePath = siblingPathTemplate ?? DEFAULT_PATH_TEMPLATE
      return (
        coverChanged ||
        title.trim() !== "" ||
        bodyText !== "" ||
        description.trim() !== "" ||
        tagList.length > 0 ||
        pathTemplate.trim() !== basePath
      )
    }

    const baseTags = existing.tags ?? []
    const basePath = templatizePath(existing.path, rkey ?? "")

    return (
      coverChanged ||
      title.trim() !== (existing.title ?? "") ||
      description.trim() !== (existing.description ?? "") ||
      pathTemplate.trim() !== basePath ||
      bodyText !== seededBodyRef.current ||
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
    siblingPathTemplate,
    // seededBodyRef is a ref the memo can't watch; recompute when it's moved.
    baselineTick,
  ])

  // Mirror the editor's working state into localStorage so nothing typed is lost
  // before it reaches the PDS. Debounced; when the form matches the server record
  // (or is empty) the draft is dropped instead. The image map is keyed by blob
  // CID and serialized via lexToJson so restored uploads still save correctly.
  // `flushRef` holds the pending write so we can flush it on tab close.
  const baseCid = editableDoc?.entry.cid ?? null
  const flushRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    // Stay paused until the record's loaded and seeded/restored — otherwise the
    // empty initial form reads as "clean" and would clear a saved draft before
    // it gets restored on refresh.
    if (!hydrated || !currentKey) return
    if (!isDirty) {
      flushRef.current = null
      clearDraft(currentKey)
      dispatch({ type: "markClean" })
      return
    }
    const at = Date.now()
    const payload = {
      title,
      description,
      tags,
      pathTemplate,
      body,
      providerId: activeProvider?.id ?? null,
      images: serializeImages(uploadedImagesRef.current),
      baseCid,
      savedAt: at,
    }
    const write = () => {
      // Bail if a newer write superseded this one, or a save/discard cleared the
      // draft underneath us (clearDraftState nulls flushRef) — otherwise a
      // debounced write could resurrect a draft we just cleared on save.
      if (flushRef.current !== write) return
      saveDraft(currentKey, payload)
      dispatch({ type: "markSaved", at })
    }
    flushRef.current = write
    const t = setTimeout(write, 600)
    return () => clearTimeout(t)
  }, [
    hydrated,
    currentKey,
    isDirty,
    title,
    description,
    tags,
    pathTemplate,
    body,
    activeProvider,
    baseCid,
  ])

  // Close the debounce window: write any pending draft synchronously when the
  // page is being hidden/unloaded.
  useEffect(() => {
    const onHide = () => flushRef.current?.()
    window.addEventListener("pagehide", onHide)
    return () => window.removeEventListener("pagehide", onHide)
  }, [])

  /** Insert markdown at the cursor (or append if the editor isn't mounted). */
  function insertAtCursor(text: string) {
    const view = viewRef.current
    if (!view) {
      dispatch({ type: "appendBody", text })
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
    dispatch({ type: "setFormError", message: null })
    if (!file.type.startsWith("image/")) return
    if (file.size > 1_000_000) {
      dispatch({ type: "setFormError", message: "Images must be under 1MB." })
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
        previewUrlsRef.current.set(cid, URL.createObjectURL(file))
        // The src is the bare blob CID; the preview resolves it to a URL.
        insertAtCursor(`![${alt}](${cid})`)
      },
      onError: (e) =>
        dispatch({
          type: "setFormError",
          message: errorMessage(e, "Failed to upload image."),
        }),
    })
  }

  /** Forget the restored local draft and revert the form to the server record. */
  function discardDraft() {
    if (currentKey) clearDraft(currentKey)
    flushRef.current = null
    uploadedImagesRef.current = new Map()
    const fields: EditorFields =
      existing && rkey
        ? {
            title: existing.title ?? "",
            description: existing.description ?? "",
            tags: (existing.tags ?? []).join(", "),
            pathTemplate: templatizePath(existing.path, rkey),
            body: seededBodyRef.current,
          }
        : {
            title: "",
            description: "",
            tags: "",
            pathTemplate: siblingPathTemplate ?? DEFAULT_PATH_TEMPLATE,
            body: "",
          }
    dispatch({ type: "revert", fields })
  }

  /** Confirm, then discard — used by the toolbar button and the restore banner. */
  function onDiscard() {
    const message = existing
      ? "Discard your unsaved changes and revert to the published version?"
      : "Discard this draft? Everything you’ve written here will be lost."
    if (!window.confirm(message)) return
    discardDraft()
  }

  /** Reset draft state after the post is written to (or removed from) the PDS. */
  function clearDraftState() {
    if (currentKey) clearDraft(currentKey)
    flushRef.current = null
    dispatch({ type: "draftCleared" })
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    dispatch({ type: "setFormError", message: null })
    if (!publication || !activeProvider) return
    if (!title.trim()) {
      dispatch({ type: "setFormError", message: "A headline is required." })
      return
    }

    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    // Trim trailing/leading whitespace from the editor body before converting.
    const cleanBody = body.trim()

    // Convert the edited markdown into the active format's content object,
    // reattaching existing/uploaded image blobs by CID.
    const content = activeProvider.fromMarkdown(cleanBody, {
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
      textContent: markdownToPlaintext(cleanBody) || undefined,
      publishedAt: existing?.publishedAt ?? l.currentDatetimeString(),
      updatedAt: existing ? l.currentDatetimeString() : undefined,
    }

    // The mutation resolves the cover image (upload/remove/keep) itself.
    saveDocument(
      { isNew, rkey: docRkey, value, coverFile, coverRemoved },
      {
        onSuccess: () => {
          clearDraftState()
          if (isNew) navigate(`/post/${docRkey}`, { replace: true })
          else {
            // Rebaseline the body to what we just saved so isDirty clears
            // immediately — the document refetch (which would otherwise update
            // this) is async, and round-tripping the body back from the stored
            // format isn't guaranteed to be identical anyway.
            seededBodyRef.current = cleanBody
            dispatch({ type: "rebaseline" })
            dispatch({ type: "clearCover" })
          }
        },
      },
    )
  }

  function onDelete() {
    if (!rkey) return
    if (!window.confirm("Delete this post? This cannot be undone.")) return
    deleteDocument(rkey, {
      onSuccess: () => {
        clearDraftState()
        navigate("/", { replace: true })
      },
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
  // markpub can't reference image blobs, so in-post upload is disabled there.
  const canUploadImages = !!activeProvider?.supportsImages

  // Save-status pill: make it unambiguous whether the visible text is only in
  // this browser ("Draft saved locally") or actually written to the PDS.
  const statusKind = saving ? "saving" : isDirty ? "local" : "saved"
  const statusText = saving
    ? "Saving…"
    : isDirty
      ? savedAt
        ? `Draft saved locally · ${relativeTime(savedAt)}`
        : "Editing…"
      : existing
        ? "Saved to your PDS"
        : null

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
            onChange={(e) =>
              dispatch({ type: "selectPublication", rkey: e.target.value })
            }
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
            onChange={(e) =>
              dispatch({ type: "selectProvider", id: e.target.value })
            }
            title="Richtext format to save this post in"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {statusText && (
          <span className={`save-status save-status--${statusKind}`}>
            {statusText}
          </span>
        )}
        {isDirty && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onDiscard}
            disabled={saving}
            title={
              existing
                ? "Discard unsaved changes and revert to the published version"
                : "Discard this draft"
            }
          >
            Discard
          </button>
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

      {restoredAt !== null && (
        <div className="admonition admonition--warn" role="note">
          <p className="admonition__title">Restored unsaved changes</p>
          <p style={{ margin: 0 }}>
            We recovered a local draft from {relativeTime(restoredAt)}.{" "}
            {stale &&
              "The published version has changed since — saving will overwrite it. "}
            It’s only stored in this browser until you{" "}
            {isNew ? "publish" : "save"}.{" "}
            <button type="button" className="link-button" onClick={onDiscard}>
              Discard draft
            </button>
          </p>
        </div>
      )}

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
          onChange={(e) => setField("title", e.target.value)}
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
              onChange={(e) => setField("description", e.target.value)}
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
              onChange={(e) => setField("tags", e.target.value)}
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
                    dispatch({
                      type: "setFormError",
                      message: "Cover image must be under 1MB.",
                    })
                    e.target.value = ""
                    return
                  }
                  dispatch({ type: "setFormError", message: null })
                  dispatch({ type: "pickCover", file: f })
                }}
              />
              {coverPreviewUrl && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => dispatch({ type: "removeCover" })}
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
              {canUploadImages && (
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
              )}
            </div>
            <div
              className="cm-host"
              onDrop={(e) => {
                if (!canUploadImages) return
                const f = e.dataTransfer.files?.[0]
                if (f && f.type.startsWith("image/")) {
                  e.preventDefault()
                  void handleImageFile(f)
                }
              }}
              onPaste={(e) => {
                if (!canUploadImages) return
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
                onChange={(value) => setField("body", value)}
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
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
              onChange={(e) => {
                // A manual edit wins over the inferred sibling default.
                pathSeededRef.current = true
                setField("pathTemplate", e.target.value)
              }}
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
