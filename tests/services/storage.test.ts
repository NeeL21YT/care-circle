import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setFileStoreForTests, fileStore, isStorageConfigured } from "@/lib/storage";

beforeEach(() => {
  __setFileStoreForTests(null);
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.SUPABASE_STORAGE_BUCKET = "bkt";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_STORAGE_BUCKET;
});

const ok = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status });

describe("Supabase file store", () => {
  it("reports whether storage is configured and fails clearly when it is not", () => {
    expect(isStorageConfigured()).toBe(true);
    delete process.env.SUPABASE_URL;
    expect(isStorageConfigured()).toBe(false);
    expect(() => fileStore()).toThrowError(/not set up yet/);
  });

  it("creates the private bucket once, then uploads with the service key and an encoded path", async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal("fetch", f);
    const store = fileStore();
    await store.save("patients/p 1/documents/d1/a b.pdf", new Uint8Array([1, 2]), "application/pdf");
    await store.save("patients/p1/x.pdf", new Uint8Array([1]), "application/pdf");
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    const bucketCalls = calls.filter(([u]) => u.endsWith("/storage/v1/bucket"));
    expect(bucketCalls).toHaveLength(1);
    expect(JSON.parse(bucketCalls[0][1].body as string)).toEqual({ id: "bkt", name: "bkt", public: false });
    const upload = calls.find(([u]) => u.includes("/object/bkt/patients/p%201/documents/d1/a%20b.pdf"))!;
    expect((upload[1].headers as Record<string, string>).Authorization).toBe("Bearer service-key");
    expect((upload[1].headers as Record<string, string>)["content-type"]).toBe("application/pdf");
  });

  it("treats an existing bucket as fine and surfaces upload failures without leaking details", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.endsWith("/bucket") ? ok({ error: "Duplicate" }, 409) : ok({ secret: "boom" }, 500))));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(fileStore().save("a/b.pdf", new Uint8Array([1]), "application/pdf")).rejects.toMatchObject({ status: 503 });
    spy.mockRestore();
  });

  it("builds an absolute signed URL from Supabase's relative one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ signedURL: "/object/sign/bkt/patients/p1/a.pdf?token=abc" })));
    expect(await fileStore().signedUrl("patients/p1/a.pdf", 300)).toBe("https://proj.supabase.co/storage/v1/object/sign/bkt/patients/p1/a.pdf?token=abc");
  });

  it("signing a missing file is a 404, and deleting a missing file is not an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ error: "Not found" }, 400)));
    await expect(fileStore().signedUrl("x", 60)).rejects.toMatchObject({ status: 404 });
    await expect(fileStore().remove("x")).resolves.toBeUndefined();
  });
});
