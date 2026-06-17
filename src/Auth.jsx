import { supabase } from './supabase'

const C = {
  bg: "#080c14", surface: "#0f1623", border: "#1a2236",
  text: "#e2e8f0", muted: "#64748b", cyan: "#22d3ee", faint: "#1e293b",
}

export default function Auth() {
  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
  }

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24, fontFamily: "'Inter','Segoe UI',sans-serif",
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚡</div>
        <div style={{ color: C.cyan, fontWeight: 800, fontSize: 32, letterSpacing: "-0.04em" }}>FleetLog</div>
        <div style={{ color: C.muted, fontSize: 14, marginTop: 6 }}>InDrive Car Owner Tracker</div>
      </div>

      {/* Card */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: 32, width: "100%", maxWidth: 360, textAlign: "center",
      }}>
        <div style={{ color: C.text, fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Welcome back</div>
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 28 }}>
          Sign in to access your fleet data from any device
        </div>

        <button onClick={signInWithGoogle} style={{
          width: "100%", padding: "12px 20px",
          background: "#fff", color: "#1f2937",
          border: "none", borderRadius: 10,
          fontWeight: 700, fontSize: 15, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}>
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.4 35.6 26.8 36 24 36c-5.2 0-9.6-2.9-11.3-7.2l-6.5 5C9.5 40 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.4-2.5 4.5-4.6 5.9l6.2 5.2C40.8 36.2 44 30.5 44 24c0-1.3-.1-2.7-.4-4z"/>
          </svg>
          Continue with Google
        </button>

        <div style={{ color: C.muted, fontSize: 11, marginTop: 20, lineHeight: 1.6 }}>
          Your data is private and only visible to you.{" "}
          Works offline after first login.
        </div>
      </div>
    </div>
  )
}
