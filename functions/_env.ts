import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

// wrangler.toml binds VIEWS_KV. D1 and secrets are optional deployment bindings;
// their absence intentionally selects the existing KV/memory paths.
export interface Env {
  VIEWS_KV?: KVNamespace;
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  TOTP_SECRET?: string;
  TURNSTILE_SECRET?: string;
}
