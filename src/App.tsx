import { NavLink, Link, Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './auth/AuthProvider.tsx'
import { Login } from './routes/Login.tsx'
import { Dashboard } from './routes/Dashboard.tsx'
import { PublicationSettings } from './routes/PublicationSettings.tsx'
import { PostEditor } from './routes/PostEditor.tsx'

const DATELINE = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

function Masthead() {
  const { status, signOut } = useAuth()
  const signedIn = status === 'signed-in'
  return (
    <header className="masthead">
      <div className="masthead__bar">
        <div className="container masthead__inner">
          <Link to="/" className="masthead__title">
            standard<span className="dot">.</span>horse
          </Link>
          <span className="masthead__dateline">{DATELINE} · Late Edition</span>
        </div>
      </div>
      {signedIn && (
        <div className="container">
          <nav className="masthead__nav">
            <NavLink to="/" end>
              Posts
            </NavLink>
            <NavLink to="/settings">Masthead &amp; Theme</NavLink>
            <NavLink to="/post/new">Write</NavLink>
            <span className="masthead__spacer" />
            <a
              href="#sign-out"
              onClick={(e) => {
                e.preventDefault()
                void signOut()
              }}
            >
              Sign out
            </a>
          </nav>
        </div>
      )}
    </header>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') {
    return (
      <div className="container content">
        <p className="spinner">Setting the type…</p>
      </div>
    )
  }
  if (status === 'signed-out') {
    return <Navigate to="/" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

export function App() {
  const { status } = useAuth()
  return (
    <div className="page">
      <Masthead />
      <main className="content">
        <Routes>
          <Route
            path="/"
            element={
              status === 'signed-in' ? (
                <Dashboard />
              ) : status === 'loading' ? (
                <div className="container">
                  <p className="spinner">Setting the type…</p>
                </div>
              ) : (
                <Login />
              )
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <PublicationSettings />
              </RequireAuth>
            }
          />
          <Route
            path="/post/new"
            element={
              <RequireAuth>
                <PostEditor />
              </RequireAuth>
            }
          />
          <Route
            path="/post/:rkey"
            element={
              <RequireAuth>
                <PostEditor />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
