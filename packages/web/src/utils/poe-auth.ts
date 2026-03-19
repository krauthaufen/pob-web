/**
 * OAuth PKCE flow for Path of Exile API.
 * Client: pobweb (public client), scopes: account:profile + account:characters
 */

const CLIENT_ID = "pobweb";
const REDIRECT_URI = `${window.location.origin}/`;
const AUTH_URL = "https://www.pathofexile.com/oauth/authorize";
const TOKEN_URL = "/poe-oauth/token";

const TOKEN_KEY = "poe-token";
const REFRESH_KEY = "poe-refresh-token";
const EXPIRY_KEY = "poe-token-expiry";

const SAFE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
function randomString(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => SAFE_CHARS[b % SAFE_CHARS.length]).join("");
}

async function sha256Base64Url(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startLogin(): Promise<void> {
  const verifier = randomString(128);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(32);

  sessionStorage.setItem("poe-pkce-verifier", verifier);
  sessionStorage.setItem("poe-pkce-state", state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "account:profile account:characters",
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  window.location.href = `${AUTH_URL}?${params}`;
}

export async function handleCallback(): Promise<{ token: string; account?: string } | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) return null;

  const savedState = sessionStorage.getItem("poe-pkce-state");
  const verifier = sessionStorage.getItem("poe-pkce-verifier");

  if (!savedState || state !== savedState || !verifier) {
    return null;
  }

  // Clean URL
  history.replaceState(null, "", "/");
  sessionStorage.removeItem("poe-pkce-state");
  sessionStorage.removeItem("poe-pkce-verifier");

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  localStorage.setItem(TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(EXPIRY_KEY, String(expiresAt));

  return { token: data.access_token, account: data.username };
}

async function refreshToken(): Promise<string | null> {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return null;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refresh,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    logout();
    return null;
  }

  const data = await res.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  localStorage.setItem(TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(EXPIRY_KEY, String(expiresAt));

  return data.access_token;
}

export async function getToken(): Promise<string | null> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const expiry = Number(localStorage.getItem(EXPIRY_KEY) || 0);
  // Refresh if within 60s of expiry
  if (Date.now() > expiry - 60_000) {
    return refreshToken();
  }

  return token;
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}
