import { Client } from "@atproto/lex"
import type {
  BrowserOAuthClient,
  OAuthSession,
} from "@atproto/oauth-client-browser"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { resolvePdsUrl } from "../lib/repo.ts"
import { createOAuthClient } from "./client.ts"

type AuthStatus = "loading" | "signed-in" | "signed-out"

interface AuthState {
  status: AuthStatus
  did: string | null
  /** Authenticated lex Client, ready for repo/blob calls. Null until signed in. */
  client: Client | null
  /** The user's PDS endpoint, for building public getBlob URLs. */
  pdsUrl: string | null
  error: string | null
  signIn: (handle: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * Bootstrap the OAuth client and process any redirect callback. Memoized at
 * module scope because `init()` must run exactly once per page load — React's
 * StrictMode would otherwise invoke the effect twice and consume the callback
 * params on the first run, breaking the second.
 */
let bootstrapPromise: Promise<{
  oauth: BrowserOAuthClient
  session: OAuthSession | null
}> | null = null

function bootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const oauth = await createOAuthClient()
      const result = await oauth.init()
      return { oauth, session: result?.session ?? null }
    })()
  }
  return bootstrapPromise
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const oauthRef = useRef<BrowserOAuthClient | null>(null)
  const sessionRef = useRef<OAuthSession | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [did, setDid] = useState<string | null>(null)
  const [client, setClient] = useState<Client | null>(null)
  const [pdsUrl, setPdsUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function adopt(session: OAuthSession | null) {
    sessionRef.current = session
    if (session) {
      setDid(session.did)
      setClient(new Client(session))
      setStatus("signed-in")
      // Resolve the PDS host (for getBlob URLs) in the background.
      void resolvePdsUrl(session.did).then((url) => {
        if (sessionRef.current === session) setPdsUrl(url)
      })
    } else {
      setDid(null)
      setClient(null)
      setPdsUrl(null)
      setStatus("signed-out")
    }
  }

  useEffect(() => {
    let cancelled = false
    bootstrap()
      .then(({ oauth, session }) => {
        if (cancelled) return
        oauthRef.current = oauth
        adopt(session)
      })
      .catch((err) => {
        if (cancelled) return
        console.error("OAuth init failed", err)
        setError(
          err instanceof Error ? err.message : "Failed to initialise auth",
        )
        setStatus("signed-out")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      status,
      did,
      client,
      pdsUrl,
      error,
      async signIn(handle: string) {
        const oauth = oauthRef.current
        if (!oauth) throw new Error("Auth not ready yet")
        setError(null)
        // Redirects away; the promise only rejects if the user cancels.
        await oauth.signIn(handle.trim())
      },
      async signOut() {
        const session = sessionRef.current
        adopt(null)
        try {
          await session?.signOut()
        } catch (err) {
          console.error("Sign out failed", err)
        }
      },
    }),
    [status, did, client, pdsUrl, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
  return ctx
}
