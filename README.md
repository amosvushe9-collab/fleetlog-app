# FleetLog — InDrive Fleet Tracker PWA

## Setup (do this once, ~20 minutes)

### 1. Supabase — Database
1. Go to supabase.com → New project → name it `fleetlog`
2. Go to SQL Editor → New Query
3. Paste the contents of `supabase_schema.sql` → Run
4. Go to Project Settings → API → copy:
   - Project URL
   - anon/public key

### 2. Google Auth in Supabase
1. Supabase → Authentication → Providers → Google → Enable
2. Go to console.cloud.google.com → New project → APIs & Services → Credentials
3. Create OAuth 2.0 Client ID (Web application)
4. Add Authorized redirect URI: `https://your-project-id.supabase.co/auth/v1/callback`
5. Copy Client ID and Secret back into Supabase Google provider settings

### 3. Environment variables
Create a `.env` file (copy `.env.example`):
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Deploy to Netlify
1. Push this folder to a GitHub repo
2. netlify.com → Add new site → Import from GitHub
3. Add environment variables in Netlify → Site settings → Environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy — takes ~2 minutes

### 5. Add Netlify URL to Google OAuth
In Google Cloud Console → your OAuth client → add your Netlify URL to:
- Authorized JavaScript origins
- Authorized redirect URIs: `https://your-netlify-url/auth/v1/callback`

### 6. Install on phone
**Android:** Chrome → 3-dot menu → Add to Home Screen
**iPhone:** Safari → Share → Add to Home Screen

### 7. Stop Supabase from auto-pausing (important!)
Supabase free tier pauses your project after 7 days of no activity. This repo includes
`.github/workflows/keep-alive.yml` which pings your database every 4 days automatically —
completely free, runs on GitHub's infrastructure, no server needed.

To activate it:
1. In your GitHub repo → Settings → Secrets and variables → Actions
2. Add two repository secrets:
   - `SUPABASE_URL` → your Supabase project URL
   - `SUPABASE_ANON_KEY` → your anon/public key
3. That's it — GitHub will run the ping automatically every 4 days.
4. To test it immediately: go to Actions tab → "Keep Supabase Alive" → Run workflow

If your project ever does pause anyway (e.g. you paused the workflow), just go to
your Supabase dashboard and click Restore — takes about 30 seconds, completely free.

---
Works offline after first login. Data syncs to Supabase when online.
