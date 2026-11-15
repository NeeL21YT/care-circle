import "server-only";
import { HttpError } from "@/lib/api/errors";

/**
 * File storage abstraction. Documents and profile photos only ever touch this
 * interface, so the provider (Supabase today) can be swapped without touching
 * services or UI. Buckets are PRIVATE: files are reachable only through
 * short-lived signed URLs issued after server-side authorization.
 */
export interface FileStore {
  save(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Reads the object bytes (server-side only, e.g. for AI processing). */
  read(path: string): Promise<Uint8Array>;
  /** Signed URL valid for `ttlSeconds`. */
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
}

let override: FileStore | null = null;
/** Test seam. */
export function __setFileStoreForTests(s: FileStore | null) {
  override = s;
}

export function isStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Supabase Storage via its REST API (no SDK). The service-role key is server
 * only and bypasses Supabase RLS, which is fine because the bucket is private
 * and every call here happens after our own authorization checks.
 */
class SupabaseStore implements FileStore {
  private ensured = false;
  constructor(
    private url: string,
    private key: string,
    private bucket: string,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }
  private api(path: string) {
    return `${this.url.replace(/\/$/, "")}/storage/v1${path}`;
  }

  /** Creates the private bucket on first use if it does not exist yet. */
  private async ensureBucket() {
    if (this.ensured) return;
    const res = await fetch(this.api("/bucket"), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false }),
    });
    // 200 created, 409 already exists: both fine.
    if (!res.ok && res.status !== 409 && !(await res.clone().text()).includes("already exists")) {
      throw new HttpError(503, "storage_unavailable", "File storage is not available right now. Please try again later.");
    }
    this.ensured = true;
  }

  async save(path: string, bytes: Uint8Array, contentType: string) {
    await this.ensureBucket();
    const res = await fetch(this.api(`/object/${this.bucket}/${enc(path)}`), {
      method: "POST",
      headers: this.headers({ "content-type": contentType, "x-upsert": "true", "cache-control": "private, no-store" }),
      body: Buffer.from(bytes),
    });
    if (!res.ok) {
      console.error("[storage] upload failed", res.status);
      throw new HttpError(503, "storage_unavailable", "The file could not be saved. Please try again.");
    }
  }

  async remove(path: string) {
    const res = await fetch(this.api(`/object/${this.bucket}/${enc(path)}`), { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 404 && res.status !== 400) {
      console.error("[storage] delete failed", res.status);
      throw new HttpError(503, "storage_unavailable", "The file could not be removed. Please try again.");
    }
  }

  async read(path: string) {
    const res = await fetch(this.api(`/object/${this.bucket}/${enc(path)}`), { headers: this.headers() });
    if (!res.ok) throw new HttpError(404, "not_found", "That file was not found.");
    return new Uint8Array(await res.arrayBuffer());
  }

  async signedUrl(path: string, ttlSeconds: number) {
    const res = await fetch(this.api(`/object/sign/${this.bucket}/${enc(path)}`), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    const json = (await res.json().catch(() => ({}))) as { signedURL?: string };
    if (!res.ok || !json.signedURL) throw new HttpError(404, "not_found", "That file was not found.");
    // `signedURL` is relative to /storage/v1 and already contains the token.
    return this.api(json.signedURL.replace(/^\/storage\/v1/, ""));
  }
}

export function fileStore(): FileStore {
  if (override) return override;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(503, "storage_not_configured", "File storage is not set up yet, so documents and photos cannot be used.");
  }
  return new SupabaseStore(url, key, process.env.SUPABASE_STORAGE_BUCKET || "care-circle-documents");
}
