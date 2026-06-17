import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import Auth from './Auth.jsx'
import { supabase } from './supabase.js'

function Root() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Loading
  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#080c14", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#22d3ee", fontSize: 32 }}>⚡</div>
      </div>
    )
  }

  return session ? <App session={session} /> : <Auth />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
