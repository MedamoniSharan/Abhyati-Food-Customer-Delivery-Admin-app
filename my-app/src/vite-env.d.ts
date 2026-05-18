/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Cloud API key with Maps Embed API enabled (optional). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
