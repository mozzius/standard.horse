import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
