/**
 * A single shared password in front of the whole app.
 *
 * This exists because the dashboard holds your resume, phone number, current
 * and expected CTC, and a button that sends applications in your name. On a
 * laptop that lives behind localhost. On a server with an open port it does not,
 * so the app refuses to serve anything until APP_PASSWORD is set.
 *
 * Web Crypto only — this runs in middleware as well as in route handlers.
 */

export const COOKIE = "ja_session";

export function authRequired(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

/** True when the app is reachable off-box but has no password set. */
export function isUnprotected(): boolean {
  return !process.env.APP_PASSWORD;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The cookie carries a digest of the password salted with APP_SECRET, never the
 * password. Changing either value logs every session out.
 */
export async function sessionToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  const secret = process.env.APP_SECRET ?? "";
  return sha256Hex(`${password}:${secret}:ja-v1`);
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return false;
  // Compare digests rather than raw strings so the check is length-independent.
  const [a, b] = await Promise.all([sha256Hex(candidate), sha256Hex(expected)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await sessionToken();
  if (cookieValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
