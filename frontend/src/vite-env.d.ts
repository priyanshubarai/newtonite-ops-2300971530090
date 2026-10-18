/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the backend API. Defaults to the same-origin `/api` proxy. */
  readonly VITE_API_URL?: string;
}
