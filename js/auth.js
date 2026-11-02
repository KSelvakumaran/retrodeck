// Spotify sign-in with Authorization Code + PKCE (no client secret in the browser).
import { CONFIG } from './config.js';

const TOKEN_KEY = 'retrodeck.token';
const VERIFIER_KEY = 'retrodeck.verifier';
const STATE_KEY = 'retrodeck.state';

export class AuthError extends Error {
  constructor(message = 'Signed out') { super(message); this.name = 'AuthError'; }
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(byteCount = 64) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

export function redirectUri() {
  return CONFIG.redirectUri || location.origin + location.pathname.replace(/index\.html$/, '');
}

export function isConfigured() {
  return !!CONFIG.clientId && !CONFIG.clientId.startsWith('PASTE_');
}

function load() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch { return null; }
}

function save(json, previous) {
  const token = {
    access_token: json.access_token,
    // Spotify may or may not rotate the refresh token; keep the old one if none is returned.
    refresh_token: json.refresh_token || previous?.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  return token;
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  return json;
}

export async function login() {
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CONFIG.clientId,
    scope: CONFIG.scopes.join(' '),
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    redirect_uri: redirectUri(),
    state,
  });
  location.assign('https://accounts.spotify.com/authorize?' + params);
}

// Call once on page load. Finishes sign-in if Spotify just redirected back with ?code=…
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const error = q.get('error');
  if (!code && !error) return false;
  history.replaceState(null, '', redirectUri());

  if (error) {
    throw new Error(error === 'access_denied' ? 'Spotify sign-in was cancelled.' : `Spotify sign-in failed: ${error}`);
  }
  if (q.get('state') !== localStorage.getItem(STATE_KEY)) {
    throw new Error('Sign-in check did not match. Sign in again.');
  }
  const json = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: CONFIG.clientId,
    code_verifier: localStorage.getItem(VERIFIER_KEY),
  });
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
  save(json);
  return true;
}

export function isSignedIn() {
  return !!load()?.refresh_token;
}

let refreshing = null;

export async function getToken() {
  const token = load();
  if (!token?.refresh_token) throw new AuthError();
  if (Date.now() < token.expires_at - 60_000) return token.access_token;

  // One refresh at a time, even if many requests ask for a token together.
  if (!refreshing) {
    refreshing = tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: CONFIG.clientId,
    })
      .then((json) => save(json, token).access_token)
      .catch((err) => { logout(); throw new AuthError(err.message); })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}
