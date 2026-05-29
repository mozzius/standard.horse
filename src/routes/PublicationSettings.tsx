import type { l } from "@atproto/lex"
import { useEffect, useMemo, useState } from "react"
import { HexColorPicker } from "react-colorful"
import { Link, useParams } from "react-router"
import { useAuth } from "../auth/AuthProvider.tsx"
import {
  blobUrl,
  buildBasicTheme,
  hexToRgb,
  putPublication,
  readBasicTheme,
  rgbToHex,
  uploadImageBlob,
  type ThemeColors,
} from "../lib/repo.ts"
import { usePublications } from "../lib/usePublications.ts"

const COLOR_FIELDS: { key: keyof ThemeColors; label: string; hint: string }[] =
  [
    { key: "background", label: "Background", hint: "Page background" },
    { key: "foreground", label: "Foreground", hint: "Body text" },
    { key: "accent", label: "Accent", hint: "Links & buttons" },
    { key: "accentForeground", label: "Accent text", hint: "Text on buttons" },
  ]

export function PublicationSettings() {
  const { client, did, pdsUrl } = useAuth()
  const { rkey } = useParams<{ rkey: string }>()
  const { publications, loading, error, reload } = usePublications()
  // Edit the publication named in the route, falling back to the first.
  const publication = useMemo(
    () => publications.find((p) => p.rkey === rkey) ?? publications[0] ?? null,
    [publications, rkey],
  )

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [url, setUrl] = useState("")
  const [theme, setTheme] = useState<ThemeColors | null>(null)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!publication) return
    const v = publication.value
    setName(v.name ?? "")
    setDescription(v.description ?? "")
    setUrl(v.url ?? "")
    setTheme(readBasicTheme(v.basicTheme))
  }, [publication])

  if (loading) {
    return (
      <div className="container">
        <p className="spinner">Loading the masthead…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="container">
        <div className="error-banner">{error}</div>
      </div>
    )
  }
  if (!publication || !theme) {
    return (
      <div className="container">
        <div className="notice">
          <h3>No publication to edit.</h3>
          <p className="muted">
            <Link to="/">Back to your posts.</Link>
          </p>
        </div>
      </div>
    )
  }

  const existingIconUrl =
    publication.value.icon && did && pdsUrl
      ? blobUrl(pdsUrl, did, publication.value.icon)
      : null
  const previewIconUrl = iconFile
    ? URL.createObjectURL(iconFile)
    : existingIconUrl

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!client || !publication || !theme) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      let icon = publication.value.icon
      if (iconFile) icon = await uploadImageBlob(client, iconFile)

      // putRecord replaces the whole record — preserve untouched fields.
      await putPublication(client, publication.rkey, {
        ...publication.value,
        name: name.trim(),
        description: description.trim() || undefined,
        url: url.trim() as l.UriString,
        icon,
        basicTheme: buildBasicTheme(theme),
      })
      setIconFile(null)
      setSaved(true)
      reload()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <p className="kicker">Masthead &amp; Theme</p>
      <h1>Edit your publication</h1>

      {saveError && <div className="error-banner">{saveError}</div>}

      <form onSubmit={onSave}>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Base URL</span>
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourblog.com"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field__label">Icon</span>
          <div className="row" style={{ alignItems: "center" }}>
            {previewIconUrl && (
              <img
                src={previewIconUrl}
                alt=""
                width={64}
                height={64}
                style={{
                  borderRadius: 6,
                  objectFit: "cover",
                  border: "1px solid var(--rule)",
                }}
              />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <span className="muted" style={{ fontSize: "0.74rem" }}>
            Square image, at least 256×256, under 1MB.
          </span>
        </div>

        <hr />

        <p className="field__label">Theme</p>
        <div className="swatch-grid">
          {COLOR_FIELDS.map(({ key, label, hint }) => {
            const hex = rgbToHex(theme[key])
            return (
              <div className="swatch" key={key}>
                <div
                  className="swatch__preview"
                  style={{ background: hex }}
                  aria-hidden
                />
                <div className="stack" style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: "0.9rem" }}>{label}</strong>
                  <span className="muted" style={{ fontSize: "0.74rem" }}>
                    {hint} · {hex}
                  </span>
                </div>
                <HexColorPicker
                  color={hex}
                  onChange={(next) =>
                    setTheme({ ...theme, [key]: hexToRgb(next) })
                  }
                />
              </div>
            )
          })}
        </div>

        <hr />

        <div className="toolbar">
          <button className="btn btn--accent" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <Link className="btn btn--ghost" to="/">
            Back
          </Link>
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </form>
    </div>
  )
}
