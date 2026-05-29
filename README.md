# standard.horse

A generic, broadsheet-flavoured editor for [standard.site](https://standard.site)
records, built on [atproto](https://atproto.com). Sign in with your atproto
account, edit your publication's masthead and theme, and write posts in Markdown
— all read from and written directly to your own PDS. There is no backend and no
index; everything is live from your repo.

Post content is stored using [markpub](https://markpub.at)
(`at.markpub.markdown`), a thin GitHub-Flavored-Markdown wrapper, slotted into
the document's open `content` union.

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
pnpm dev          # serves on http://127.0.0.1:8080
```

Open **http://127.0.0.1:8080** (not `localhost` — see OAuth note below) and sign
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
| `pnpm lex:install` | Re-fetch the standard.site lexicon JSON from the network  |
| `pnpm lex:build`   | Regenerate `src/lexicons/` TypeScript from the JSON       |

## OAuth

Requested scopes (writes only — reads are public XRPC):

```
atproto blob:image/* repo:site.standard.publication repo:site.standard.document
```

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

markpub's lexicon isn't published to the network yet, and standard.site's
`content` is an _open_ union, so the markpub member is hand-typed in
[`src/lib/markpub.ts`](./src/lib/markpub.ts) rather than generated.

## Known limitations (first draft)

- Edits existing publications only — no create-a-publication flow.
- Writes Markdown **inline** (`text.markdown`). It _reads_ blob-backed markdown
  (`text.textBlob`) but doesn't write it, so very large posts (>1MB) aren't
  handled on save.
- No cover-image, contributors, or facets/lenses UI yet.
- Single bundle is large (CodeMirror's `language-data`); could be code-split.
