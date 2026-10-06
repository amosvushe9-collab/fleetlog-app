import { useState } from 'react'
import { supabase } from './supabase'

const C = {
  bg: "#060910", surface: "#111827", border: "#1e2d45",
  text: "#f0f4f8", muted: "#5a7a9a", cyan: "#00c8e8", faint: "#162032",
  red: "#ef4444", green: "#22c55e",
}

export default function Auth() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState("login") // login | signup | magic
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [showEmail, setShowEmail] = useState(false)

  async function signInWithGoogle() {
    setError("")
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  async function handleEmail(e) {
    e.preventDefault()
    setError(""); setInfo("")
    if (!email.trim()) return setError("Enter your email address")

    setLoading(true)
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin }
        })
        if (error) throw error
        setInfo("Magic link sent! Check your email and tap the link.")
      } else if (mode === "signup") {
        if (!password) return setError("Enter a password")
        const { error } = await supabase.auth.signUp({ email, password,
          options: { emailRedirectTo: window.location.origin }
        })
        if (error) throw error
        setInfo("Account created! Check your email to confirm, then sign in.")
        setMode("login")
      } else {
        if (!password) return setError("Enter your password")
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err.message || "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 15% 40%, #0c1a2e 0%, " + C.bg + " 50%), radial-gradient(ellipse at 85% 60%, #0a1525 0%, " + C.bg + " 50%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "'Inter','SF Pro Display','Segoe UI',sans-serif",
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 36, textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>⚡</div>
        <div style={{ color: C.cyan, fontWeight: 900, fontSize: 34, letterSpacing: "-0.05em" }}>FleetMate</div>
        <div style={{ color: C.muted, fontSize: 14, marginTop: 8 }}>Fleet management for transport operators</div>
      </div>

      <div style={{
        background: C.surface, border: "1px solid " + C.border,
        borderRadius: 16, padding: 32, width: "100%", maxWidth: 360, textAlign: "center",
      }}>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
          {mode === "signup" ? "Create account" : "Welcome back"}
        </div>
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>
          {mode === "signup" ? "Sign up to start managing your fleet" : "Sign in to access your fleet data"}
        </div>

        {/* Google button */}
        <button onClick={signInWithGoogle} disabled={loading} style={{
          width: "100%", padding: "13px 20px",
          background: loading ? "#e5e7eb" : "#fff", color: "#1f2937",
          border: "none", borderRadius: 10,
          fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)", transition: "opacity 0.15s",
          opacity: loading ? 0.7 : 1,
        }}>
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.6 26.8 36 24 36c-5.2 0-9.6-2.9-11.3-7.2l-6.5 5C9.5 40 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.5-4.6 5.9l6.2 5.2C40.8 36.2 44 30.5 44 24c0-1.3-.1-2.7-.4-4z"/>
          </svg>
          {loading ? "Signing in…" : "Continue with Google"}
        </button>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0" }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span style={{ color: C.muted, fontSize: 12 }}>or</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>

        {/* Email toggle */}
        {!showEmail ? (
          <button onClick={() => setShowEmail(true)} style={{
            width: "100%", padding: "12px 20px",
            background: "transparent", color: C.muted,
            border: "1px solid " + C.border, borderRadius: 10,
            fontWeight: 600, fontSize: 14, cursor: "pointer",
          }}>
            Sign in with Email
          </button>
        ) : (
          <form onSubmit={handleEmail} style={{ textAlign: "left" }}>
            {/* Mode tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 16, background: C.faint, borderRadius: 8, padding: 4 }}>
              {[["login","Sign in"],["signup","Sign up"],["magic","Magic link"]].map(([m, label]) => (
                <button key={m} type="button" onClick={() => { setMode(m); setError(""); setInfo("") }} style={{
                  flex: 1, padding: "6px 4px", borderRadius: 6, border: "none",
                  background: mode === m ? C.surface : "transparent",
                  color: mode === m ? C.text : C.muted,
                  fontWeight: mode === m ? 700 : 500, fontSize: 12, cursor: "pointer",
                  boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.3)" : "none",
                }}>{label}</button>
              ))}
            </div>

            <input
              type="email" placeholder="Email address" value={email}
              onChange={e => setEmail(e.target.value)} required
              style={inputStyle}
            />

            {mode !== "magic" && (
              <input
                type="password" placeholder="Password" value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ ...inputStyle, marginTop: 10 }}
              />
            )}

            {error && (
              <div style={{ color: C.red, fontSize: 12, marginTop: 10, padding: "8px 12px", background: "#1f0e0e", borderRadius: 8 }}>
                {error}
              </div>
            )}
            {info && (
              <div style={{ color: C.green, fontSize: 12, marginTop: 10, padding: "8px 12px", background: "#0a1f0e", borderRadius: 8 }}>
                {info}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", marginTop: 14, padding: "13px 20px",
              background: C.cyan, color: "#000",
              border: "none", borderRadius: 10,
              fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Please wait…" : mode === "magic" ? "Send magic link" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
        )}

        <div style={{ color: C.muted, fontSize: 11, marginTop: 20, lineHeight: 1.6 }}>
          Your data is private and only visible to you.
        </div>
      </div>

      <div style={{ color: C.muted, fontSize: 10, marginTop: 24, opacity: 0.5 }}>
        fleetmate.netlify.app
      </div>
    </div>
  )
}

const inputStyle = {
  width: "100%", padding: "12px 14px",
  background: "#0d1829", color: "#f0f4f8",
  border: "1px solid #1e2d45", borderRadius: 10,
  fontSize: 14, outline: "none",
}
