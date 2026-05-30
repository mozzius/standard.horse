import { jsonToLex, lexToJson } from "@atproto/lex"
import { QueryClient } from "@tanstack/react-query"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"
import "@fontsource/newsreader/400.css"
import "@fontsource/newsreader/500.css"
import "@fontsource/newsreader/600.css"
import "@fontsource/newsreader/700.css"
import "@fontsource/newsreader/400-italic.css"
import "@fontsource/ibm-plex-sans/400.css"
import "@fontsource/ibm-plex-sans/500.css"
import "@fontsource/ibm-plex-sans/600.css"
import "./styles/global.css"
import { init } from "@plausible-analytics/tracker"
import { App } from "./App.tsx"
import { AuthProvider } from "./auth/AuthProvider.tsx"

init({
  domain: "standard.horse",
  endpoint: "https://plausible.mozzius.dev/api/event",
})

// Records change rarely and an open editor must not be reset out from under the
// user, so don't refetch on window focus; rely on explicit mutation invalidation.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
  },
})

// Persist the dashboard's data to localStorage so it paints instantly on a
// return visit (then refetches in the background). The cache holds atproto
// records whose blob refs are CID instances — plain JSON.stringify mangles
// those into "[object Object]", so we round-trip through lexToJson/jsonToLex,
// which serialise CIDs to `{ $link }` and revive them on the way back.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "standard.horse:rq-cache",
  serialize: (client) => JSON.stringify(lexToJson(client as never)),
  deserialize: (cached) => jsonToLex(JSON.parse(cached)) as never,
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // 24h; older snapshots are discarded
        // Bump when the cache's shape changes to invalidate old snapshots.
        buster: "v1",
        dehydrateOptions: {
          // Only persist the dashboard's list queries — not the per-document
          // editor query (large, and its markdown conversion is cheap to redo)
          // and not transient/failed queries.
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            (query.queryKey[0] === "publications" ||
              query.queryKey[0] === "documents"),
        },
      }}
    >
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
)
