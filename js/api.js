// Thin Spotify Web API client. Endpoints follow the February 2026 Development Mode rules:
// - playlist contents via /playlists/{id}/items (owned or collaborative playlists only)
// - hearts via /me/library?uris=… (PUT / DELETE / contains)
// - search limit max 10
import { getToken, AuthError } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

export class ApiError extends Error {
  constructor(status, message, reason) {
    super(message || `Spotify returned ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = 'GET', query, body, retry = true } = {}) {
  const token = await getToken();
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && retry) {
    const seconds = Number(res.headers.get('Retry-After')) || 1;
    await wait(Math.min(seconds, 10) * 1000);
    return api(path, { method, query, body, retry: false });
  }
  if (res.status === 401) throw new AuthError('Session expired');

  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }

  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.message, json?.error?.reason);
  }
  return json;
}

// ---- Reads -------------------------------------------------------------
export const getMe = () => api('/me');
export const getLiked = (offset = 0) => api('/me/tracks', { query: { limit: 50, offset } });
export const getPlaylists = (offset = 0) => api('/me/playlists', { query: { limit: 50, offset } });
export const getPlaylistItems = (id, offset = 0) =>
  api(`/playlists/${id}/items`, { query: { limit: 50, offset, additional_types: 'track' } });
export const searchTracks = (q, offset = 0) =>
  api('/search', { query: { q, type: 'track', limit: 10, offset } });
export const getPlayback = () => api('/me/player', { query: { additional_types: 'track' } });
export const getDevices = () => api('/me/player/devices');

// ---- Library (hearts) ----------------------------------------------------
export const isSaved = async (uri) => (await api('/me/library/contains', { query: { uris: uri } }))?.[0] === true;
export const save = (uri) => api('/me/library', { method: 'PUT', query: { uris: uri } });
export const unsave = (uri) => api('/me/library', { method: 'DELETE', query: { uris: uri } });

// ---- Player --------------------------------------------------------------
export function play({ deviceId, uris, contextUri, offset }) {
  const body = {};
  if (uris) body.uris = uris;
  if (contextUri) body.context_uri = contextUri;
  if (offset !== undefined) body.offset = typeof offset === 'number' ? { position: offset } : { uri: offset };
  return api('/me/player/play', { method: 'PUT', query: { device_id: deviceId }, body: Object.keys(body).length ? body : undefined });
}
export const resume = (deviceId) => api('/me/player/play', { method: 'PUT', query: { device_id: deviceId } });
export const pause = () => api('/me/player/pause', { method: 'PUT' });
export const next = () => api('/me/player/next', { method: 'POST' });
export const previous = () => api('/me/player/previous', { method: 'POST' });
export const seek = (ms) => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms) } });
export const setVolume = (pct) => api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(pct) } });
export const setShuffle = (state) => api('/me/player/shuffle', { method: 'PUT', query: { state } });
export const setRepeat = (state) => api('/me/player/repeat', { method: 'PUT', query: { state } });
export const transfer = (deviceId, playNow) =>
  api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: !!playNow } });
