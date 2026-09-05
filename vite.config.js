import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    target: ['chrome60', 'safari12', 'firefox60'],
    rollupOptions: {
      output: {
        // Split vendor libraries from app code so they cache separately
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'supabase': ['@supabase/supabase-js'],
        }
      }
    },
    // Compress more aggressively
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,  // remove console.logs
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.error'],
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'FleetMate',
        short_name: 'FleetMate',
        description: 'Fleet management for transport operators',
        theme_color: '#0c1220',
        background_color: '#060910',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        runtimeCaching: []
      }
    })
  ]
})
