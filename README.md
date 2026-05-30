# standard.horse

A generic, broadsheet-flavoured editor for [standard.site](https://standard.site)
records, built on [atproto](https://atproto.com). Sign in with your atproto
account, edit your publication's masthead and theme, and write posts in Markdown
— all read from and written directly to your own PDS. There is no backend and no
index; everything is live from your repo.

## Content formats

standard.site's document `content` is an **open union**, so each platform stores
posts in its own richtext format. standard.horse edits in **GFM Markdown** and
converts to/from each format via a _provider_ (`src/lib/providers/`):

| Provider     | `$type`                | Images                       |
| ------------ | ---------------------- | ---------------------------- |
| **markpub**  | `at.markpub.markdown`  | not supported (no blob slot) |
| **Leaflet**  | `pub.leaflet.content`  | ✓ (PDS blob)                 |
| **pckt**     | `blog.pckt.content`    | ✓ (PDS blob or URL)          |
| **Offprint** | `app.offprint.content` | ✓ (PDS blob)                 |

- **Reading** converts the stored blocks/facets to Markdown. Anything Markdown
  can't represent (polls, buttons, embeds, tables, callouts, highlight/underline,
  mentions, text alignment…) is dropped, and the editor shows a warning listing
  exactly what won't survive a save.
- **Writing** converts the Markdown back into the chosen format. New posts pick a
  format from a dropdown that defaults to whatever the publication's existing
  posts use; the URL-path shape is likewise inferred from sibling posts.
- **Images** are rendered as `![alt](<bsky-cdn-url>)`; on save the CID is matched
  back to a real blob ref (from this session's uploads or the post's previous
  content) so existing images survive without re-uploading. markpub has no blob
  slot, so in-post image upload is disabled there.

A post whose `content` is a format no provider understands stays **read-only** —
editing would overwrite the original.

## Stack

- **Vite + React + TypeScript** (SPA, no server)
- **[`@atproto/lex`](https://www.npmjs.com/package/@atproto/lex)** — lexicon
  codegen _and_ the runtime `Client` for XRPC / records / blobs
- **[`@atproto/oauth-client-browser`](https://www.npmjs.com/package/@atproto/oauth-client-browser)**
  — OAuth with granular scopes
- **CodeMirror** + **react-markdown / remark-gfm** — split-pane Markdown editor
- Typography: **Newsreader** (headlines) + **IBM Plex Sans** (body)

## Getting started

```bash
pnpm install      # also runs `lex build` (postinstall) to generate src/lexicons
pnpm dev          # serves on http://127.0.0.1:3000
```

Open **http://127.0.0.1:3000** (not `localhost` — see OAuth note below) and sign
in with a handle whose account already has a `site.standard.publication` record.

> **You need an existing publication.** This first draft only _edits_ existing
> publications. Create one with a standard.site-compatible tool (e.g.
> [Leaflet](https://leaflet.pub)) first, then manage it here.

### Scripts

| Script             | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `pnpm dev`         | Dev server (Vite)                                         |
| `pnpm build`       | Typecheck + production build (regenerates lexicons first) |
| `pnpm typecheck`   | `tsc --noEmit`                                            |
| `pnpm test`        | Run the provider conversion tests (Vitest)                |
| `pnpm lex:install` | Re-fetch the standard.site lexicon JSON from the network  |
| `pnpm lex:build`   | Regenerate `src/lexicons/` TypeScript from the JSON       |

## OAuth

Requested scopes (writes only — reads are public XRPC):

```
atproto blob:image/* include:site.standard.authFull
```

`include:site.standard.authFull` pulls in standard.site's published permission
set (repo access to its publication/document/subscription/recommend
collections) instead of hand-listing `repo:` scopes. `blob:image/*` (icon &
cover/in-post image uploads) and the base `atproto` scope aren't part of that
set, so they stay explicit.

- **Development** uses an atproto _loopback_ client. The OAuth server serves
  hard-coded metadata for `http://localhost`, but honours the `redirect_uri` and
  `scope` query params we encode into the client_id — so you still get the exact
  granular scopes above on the consent screen. The dev server binds `127.0.0.1`
  because loopback clients must use an IP origin, not `localhost`.
- **Production** must host a client metadata document at the app origin. Edit
  [`public/oauth-client-metadata.json`](./public/oauth-client-metadata.json) so
  every URL points at your real domain, deploy it, and the app loads it via
  `BrowserOAuthClient.load({ clientId: '<origin>/oauth-client-metadata.json' })`.
  The filename is deliberate: atproto's consent screen hides the raw client_id
  URL when it ends in exactly `/oauth-client-metadata.json`.

Handle resolution uses `bsky.social` by default (it will see handles + IPs).
Self-hosters can point `HANDLE_RESOLVER` in `src/auth/client.ts` at their PDS.

## Lexicons

The standard.site lexicon JSON lives in [`lexicons/`](./lexicons) with a
[`lexicons.json`](./lexicons.json) manifest — **these are committed**. The
generated TypeScript in `src/lexicons/` is **git-ignored** and rebuilt by
`pnpm lex:build` (and automatically on install/build).

Some lexicons need manual handling, all vendored as JSON under `lexicons/`:

- **markpub** (`at.markpub.*`) isn't published to the network, so its lexicons
  are vendored verbatim.
- **pckt** and **Offprint** publish their lexicons, but their `richtext.facet`
  documents are **invalid** under `@atproto/lex` (marker features like `#bold`
  declared with no `properties`), so `lex install` rejects them. The fix: the
  broken facet JSON is vendored with a `properties: {}` patch; once it's in the
  local indexer, `lex install` reuses it and pulls in the (valid) block lexicons
  normally. The patched facets are intentionally **not** manifest roots — that
  would re-trigger the failing network resolution — so `lex:ci` stays green.

## Known limitations

- Edits existing publications only — no create-a-publication flow.
- Block-format conversion is **lossy by design**: anything Markdown can't express
  is dropped on save (the editor warns first). Tables aren't written in any format
  yet.
- Bodies are written **inline**. Blob-backed bodies (markpub `text.textBlob`,
  Leaflet `blobPages`, pckt `blob`) are _read_ but not _written_, so very large
  posts aren't re-offloaded to a blob on save.
- markpub in-post images would be garbage-collected (no blob reference in the
  record), so image upload is disabled for markpub. The eventual fix is a
  `horse.standard.markdown` lexicon that carries real blob refs.
- No contributors or facets/lenses authoring UI yet.
- Single bundle is large (CodeMirror's `language-data`); could be code-split.
