/**
 * OAuth scopes. Reads (getRecord/listRecords) are public and need no scope. For
 * writes we include standard.site's published permission set
 * (`site.standard.authFull`) rather than hand-listing `repo:` scopes — it grants
 * repo access to the publication/document/subscription/recommend collections.
 * It doesn't cover blob uploads or the base session scope, so `atproto` and
 * `blob:image/*` (publication icons & cover/in-post images) stay explicit.
 *
 * Lives in its own dependency-free module so both the browser client
 * (`client.ts`) and the serverless metadata endpoint (`api/`) can share one
 * source of truth without dragging in `@atproto/oauth-client-browser`.
 */
export const SCOPE = [
  "atproto",
  "blob:image/*",
  "include:site.standard.authFull",
].join(" ")
