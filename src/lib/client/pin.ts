/**
 * Optional convenience PIN for a shared/trusted device. It is NOT authentication:
 * the Firebase session and server-side authorization still decide access.
 * The PIN never leaves the device; only a salted PBKDF2 hash is kept locally.
 */
const KEY = "cc.pin";
const SESSION = "cc.pin.unlocked";
const ITER = 150_000;

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITER }, key, 256);
}

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);

export function hasPin(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}
export function isUnlocked(): boolean {
  try { return sessionStorage.getItem(SESSION) === "1"; } catch { return true; }
}
export async function setPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(KEY, JSON.stringify({ salt: b64(salt), hash: b64(await derive(pin, salt)) }));
  sessionStorage.setItem(SESSION, "1");
}
export function clearPin() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(SESSION);
}
export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const { salt, hash } = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const ok = b64(await derive(pin, unb64(salt))) === hash;
    if (ok) sessionStorage.setItem(SESSION, "1");
    return ok;
  } catch { return false; }
}
