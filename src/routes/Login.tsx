import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'

export function Login() {
  const { signIn, error } = useAuth()
  const [handle, setHandle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!handle.trim()) return
    setSubmitting(true)
    setLocalError(null)
    try {
      await signIn(handle)
      // signIn redirects away; if we get here the user likely cancelled.
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign in failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <div className="center-narrow">
        <p className="kicker">Sign in with atproto</p>
        <h1>Your printing press for standard.site.</h1>
        <p className="muted">
          standard.horse is a plain-spoken editor for your{' '}
          <a href="https://standard.site" target="_blank" rel="noreferrer">
            standard.site
          </a>{' '}
          publication. Edit your masthead, set your theme, and write posts in
          Markdown — all stored on your own PDS.
        </p>

        {(localError || error) && (
          <div className="error-banner">{localError || error}</div>
        )}

        <form onSubmit={onSubmit}>
          <label className="field">
            <span className="field__label">Handle</span>
            <input
              className="input"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="alice.bsky.social"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={submitting}
            />
          </label>
          <button className="btn btn--accent" type="submit" disabled={submitting}>
            {submitting ? 'Redirecting…' : 'Sign in'}
          </button>
        </form>

        <p className="muted" style={{ fontSize: '0.78rem', marginTop: 24 }}>
          Handle resolution is performed via bsky.social, which will see your
          handle and IP address.
        </p>
      </div>
    </div>
  )
}
