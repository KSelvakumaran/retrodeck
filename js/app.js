// Retrodeck — app controller.
import { CONFIG } from './config.js';
import { login, logout, handleRedirect, isSignedIn, isConfigured, redirectUri, getToken, AuthError } from './auth.js';
import * as sp from './api.js';
import { ApiError } from './api.js';
import { DEMO_TRACKS, DEMO_PLAYLISTS } from './demo.js';

// ------------------------------------------------------------------ state
const S = {
  demo: new URLSearchParams(location.search).has('demo'),
  me: null,
  player: null,          // Spotify.Player (Web Playback SDK)
  deviceId: null,        // this browser's Connect device id
  isLocal: false,        // true while playback is in this browser
  activeDevice: null,    // { id, name } of the device currently playing
  playback: null,        // normalised: { track, paused, position, duration, shuffle, repeat, stamp, context }
  heart: { uri: null, saved: false },
  volume: 60,
  view: 'liked',
  list: { kind: null, items: [], next: null, loader: null, playlist: null, query: '' },
  pollTimer: null,
  seeking: false,
};

const $ = (sel) => document.querySelector(sel);
const el = {
  gate: $('#gate'), app: $('#app'), gateSetup: $('#gate-setup'), gateRedirect: $('#gate-redirect'),
  gateError: $('#gate-error'), btnLogin: $('#btn-login'),
  who: $('#who'), btnTheme: $('#btn-theme'), btnLogout: $('#btn-logout'),
  deck: $('.deck'), art: $('#c-art'), cTitle: $('#c-title'), cSide: $('#c-side'),
  tapeL: $('#tape-l'), tapeR: $('#tape-r'),
  lcdTitle: $('#lcd-title'), lcdArtist: $('#lcd-artist'), lcdState: $('#lcd-state'), lcdPos: $('#lcd-pos'), lcdDur: $('#lcd-dur'),
  seek: $('#seek'), volume: $('#volume'),
  btnPlay: $('#btn-play'), playLabel: $('#play-label'), btnPrev: $('#btn-prev'), btnNext: $('#btn-next'),
  btnShuffle: $('#btn-shuffle'), btnRepeat: $('#btn-repeat'), repeatOne: $('#repeat-one'),
  btnHeart: $('#btn-heart'), heartLabel: $('#heart-label'),
  btnSpeaker: $('#btn-speaker'), speakerName: $('#speaker-name'), speakerMenu: $('#speaker-menu'),
  deviceList: $('#device-list'), btnDevicesRefresh: $('#btn-devices-refresh'),
  openSpotify: $('#open-spotify'),
  tabs: [...document.querySelectorAll('.tab')], searchForm: $('#search-form'), searchInput: $('#search-input'),
  crateHead: $('#crate-head'), btnBack: $('#btn-back'), crateTitle: $('#crate-title'), crateNote: $('#crate-note'),
  btnPlayAll: $('#btn-play-all'),
  list: $('#list'), listStatus: $('#list-status'), btnMore: $('#btn-more'),
  toast: $('#toast'),
};

// ------------------------------------------------------------------ helpers
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
  return node;
}

const pad = (n) => String(n).padStart(2, '0');
function clock(ms = 0) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function pickImage(images, min = 300) {
  if (!images?.length) return '';
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= min) || sorted[sorted.length - 1]).url;
}

function idFromUri(uri) { return uri?.split(':')[2] || null; }

function mapTrack(t) {
  if (!t) return null;
  const id = t.id || idFromUri(t.uri);
  return {
    uri: t.uri,
    id,
    name: t.name || 'Untitled',
    artists: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name || '',
    art: pickImage(t.album?.images),
    thumb: pickImage(t.album?.images, 64),
    duration: t.duration_ms || 0,
    url: t.external_urls?.spotify || (id ? `https://open.spotify.com/track/${id}` : null),
    playable: t.is_playable !== false && !t.is_local,
  };
}

let toastTimer;
function toast(message, ms = 3800) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function explain(err) {
  if (err instanceof AuthError) return 'Your Spotify session ended. Sign in again.';
  if (err instanceof ApiError) {
    if (err.status === 404) return 'No active speaker. Pick one under the speaker button.';
    if (err.status === 403 && err.reason === 'PREMIUM_REQUIRED') return 'Playback control needs Spotify Premium.';
    if (err.status === 403) return 'Spotify blocked that action for this account or app.';
    return err.message;
  }
  return err?.message || 'Something went wrong.';
}

async function guard(fn) {
  try { return await fn(); }
  catch (err) {
    console.error(err);
    if (err instanceof AuthError) return showGate(explain(err));
    toast(explain(err));
  }
}

// ------------------------------------------------------------------ theme
const THEME_KEY = 'retrodeck.theme';
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  const now = currentTheme();
  el.btnTheme.textContent = now === 'dark' ? 'Light' : 'Dark';
  document.querySelector('meta[name="theme-color"]').content = now === 'dark' ? '#1E2226' : '#CDD3D9';
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { applyTheme(); }
el.btnTheme.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage off */ }
});

// ------------------------------------------------------------------ gate
function showGate(error) {
  stopPolling();
  el.app.hidden = true;
  el.gate.hidden = false;
  const configured = isConfigured();
  el.gateSetup.hidden = configured;
  el.gateRedirect.textContent = redirectUri();
  el.btnLogin.disabled = !configured;
  el.gateError.hidden = !error;
  el.gateError.textContent = error || '';
}

el.btnLogin.addEventListener('click', () => guard(login));
el.btnLogout.addEventListener('click', () => {
  if (S.demo) { location.href = location.pathname; return; }
  S.player?.disconnect();
  logout();
  showGate();
});

// ------------------------------------------------------------------ deck rendering
let lastTrackUri = null;

function setPlayback(pb) {
  S.playback = pb;
  renderDeck();
}

function positionNow() {
  const pb = S.playback;
  if (!pb) return 0;
  if (pb.paused) return pb.position;
  return Math.min(pb.duration, pb.position + (performance.now() - pb.stamp));
}

function renderDeck() {
  const pb = S.playback;
  const t = pb?.track;
  const playing = !!pb && !pb.paused;

  el.deck.classList.toggle('is-playing', playing);
  el.btnPlay.title = playing ? 'Pause' : 'Play';
  el.playLabel.textContent = playing ? 'Pause' : 'Play';
  el.lcdState.textContent = !t ? 'STOP' : playing ? '▶ PLAY' : '❚❚ PAUSE';
  el.seek.disabled = !t;
  el.btnHeart.disabled = !t;

  el.btnShuffle.setAttribute('aria-pressed', String(!!pb?.shuffle));
  const repeat = pb?.repeat || 'off';
  el.btnRepeat.setAttribute('aria-pressed', String(repeat !== 'off'));
  el.btnRepeat.title = `Repeat: ${repeat === 'track' ? 'this track' : repeat === 'context' ? 'all' : 'off'}`;
  el.repeatOne.hidden = repeat !== 'track';

  if (t?.uri !== lastTrackUri) {
    lastTrackUri = t?.uri || null;
    el.cTitle.textContent = fitText(t ? t.name : 'Insert a tape', 34);
    el.cSide.textContent = t ? 'A' : '';
    el.art.setAttribute('href', t?.art || '');
    el.lcdTitle.textContent = t ? t.name : 'No tape';
    el.lcdArtist.textContent = t ? [t.artists, t.album].filter(Boolean).join(' / ') : 'Pick something from your crate';
    el.lcdDur.textContent = clock(pb?.duration || 0);
    el.openSpotify.href = t?.url || 'https://open.spotify.com';
    document.title = t ? `${t.name} · Retrodeck` : 'Retrodeck';
    updateMarquee();
    markCurrentRow();
    refreshHeart();
    updateMediaSession();
  }
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = !t ? 'none' : playing ? 'playing' : 'paused';
  tick();
}

function fitText(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function updateMarquee() {
  const span = el.lcdTitle;
  span.classList.remove('is-marquee');
  requestAnimationFrame(() => {
    const box = span.parentElement;
    if (span.scrollWidth > box.clientWidth + 2) {
      span.style.setProperty('--marquee-time', `${Math.max(8, span.textContent.length / 2.2)}s`);
      span.classList.add('is-marquee');
    }
  });
}

const R_MIN = 14, R_MAX = 34;
function tick() {
  const pb = S.playback;
  const pos = positionNow();
  const dur = pb?.duration || 0;
  const p = dur ? pos / dur : 0;
  el.lcdPos.textContent = clock(pos);
  if (!S.seeking) {
    el.seek.value = Math.round(p * 1000);
    paintRange(el.seek);
  }
  const rl = R_MIN + (R_MAX - R_MIN) * (1 - p);
  const rr = R_MIN + (R_MAX - R_MIN) * p;
  setR(el.tapeL, rl);
  setR(el.tapeR, rr);
}
function setR(circle, r) {
  circle.setAttribute('r', r.toFixed(1));
  circle.style.r = `${r.toFixed(1)}px`;
}
function paintRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}
setInterval(tick, 250);

// ------------------------------------------------------------------ controls
async function control(action, arg) {
  if (S.demo) return demoControl(action, arg);
  const pb = S.playback;
  const local = S.isLocal && S.player;
  await guard(async () => {
    switch (action) {
      case 'toggle':
        if (local) { await S.player.activateElement?.(); await S.player.togglePlay(); }
        else if (pb && !pb.paused) await sp.pause();
        else if (!pb && S.deviceId) await sp.transfer(S.deviceId, true);
        else await sp.resume();
        break;
      case 'next': local ? await S.player.nextTrack() : await sp.next(); break;
      case 'prev':
        if (positionNow() > 3000) { local ? await S.player.seek(0) : await sp.seek(0); }
        else { local ? await S.player.previousTrack() : await sp.previous(); }
        break;
      case 'seek': local ? await S.player.seek(arg) : await sp.seek(arg); break;
      case 'volume': local ? await S.player.setVolume(arg / 100) : await sp.setVolume(arg); break;
      case 'shuffle': await sp.setShuffle(!pb?.shuffle); break;
      case 'repeat': {
        const order = ['off', 'context', 'track'];
        const nextMode = order[(order.indexOf(pb?.repeat || 'off') + 1) % 3];
        await sp.setRepeat(nextMode);
        if (pb) setPlayback({ ...pb, repeat: nextMode, position: positionNow(), stamp: performance.now() });
        break;
      }
    }
    if (!local || action === 'shuffle') setTimeout(poll, 450);
  });
}

el.btnPlay.addEventListener('click', () => control('toggle'));
el.btnNext.addEventListener('click', () => control('next'));
el.btnPrev.addEventListener('click', () => control('prev'));
el.btnShuffle.addEventListener('click', () => control('shuffle'));
el.btnRepeat.addEventListener('click', () => control('repeat'));

el.seek.addEventListener('input', () => {
  S.seeking = true;
  paintRange(el.seek);
  el.lcdPos.textContent = clock((el.seek.value / 1000) * (S.playback?.duration || 0));
});
el.seek.addEventListener('change', async () => {
  const ms = (el.seek.value / 1000) * (S.playback?.duration || 0);
  if (S.playback) setPlayback({ ...S.playback, position: ms, stamp: performance.now() });
  S.seeking = false;
  await control('seek', ms);
});

let volTimer;
el.volume.addEventListener('input', () => {
  S.volume = Number(el.volume.value);
  paintRange(el.volume);
  clearTimeout(volTimer);
  volTimer = setTimeout(() => control('volume', S.volume), 180);
});
paintRange(el.volume);

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); control('toggle'); }
  else if (e.key === 'n') control('next');
  else if (e.key === 'p') control('prev');
});

// ------------------------------------------------------------------ hearts
async function refreshHeart() {
  const t = S.playback?.track;
  S.heart = { uri: t?.uri || null, saved: false };
  paintHeart();
  if (!t || S.demo) { if (S.demo && t) { S.heart.saved = !!t.liked; paintHeart(); } return; }
  try {
    const saved = await sp.isSaved(t.uri);
    if (S.heart.uri === t.uri) { S.heart.saved = saved; paintHeart(); }
  } catch (err) { console.warn('Heart check failed', err); }
}
function paintHeart() {
  el.btnHeart.setAttribute('aria-pressed', String(S.heart.saved));
  el.heartLabel.textContent = S.heart.saved ? 'Liked' : 'Like';
}
el.btnHeart.addEventListener('click', () => guard(async () => {
  const uri = S.heart.uri;
  if (!uri) return;
  const want = !S.heart.saved;
  S.heart.saved = want; paintHeart();
  if (S.demo) { const t = S.playback.track; t.liked = want; return; }
  try { want ? await sp.save(uri) : await sp.unsave(uri); toast(want ? 'Added to Liked Songs' : 'Removed from Liked Songs', 2200); }
  catch (err) { S.heart.saved = !want; paintHeart(); throw err; }
}));

// ------------------------------------------------------------------ Web Playback SDK
function loadSdk() {
  return new Promise((resolve) => {
    if (window.Spotify) return resolve(true);
    window.onSpotifyWebPlaybackSDKReady = () => resolve(true);
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => resolve(false);
    document.head.append(s);
  });
}

function fromSdk(st) {
  const t = st.track_window?.current_track;
  return {
    track: mapTrack(t),
    paused: st.paused,
    position: st.position,
    duration: st.duration || t?.duration_ms || 0,
    shuffle: st.shuffle,
    repeat: ['off', 'context', 'track'][st.repeat_mode] || 'off',
    context: st.context?.uri || null,
    stamp: performance.now(),
  };
}

async function initPlayer() {
  const ok = await loadSdk();
  if (!ok || !window.Spotify) { toast('Could not load the Spotify player. You can still control another device.'); return; }

  const player = new window.Spotify.Player({
    name: CONFIG.deviceName,
    getOAuthToken: (cb) => { getToken().then(cb).catch(() => showGate('Your Spotify session ended. Sign in again.')); },
    volume: S.volume / 100,
  });
  S.player = player;

  player.addListener('ready', ({ device_id }) => {
    S.deviceId = device_id;
    if (!S.activeDevice) renderSpeaker();
  });
  player.addListener('not_ready', () => { S.isLocal = false; startPolling(); });
  player.addListener('player_state_changed', (st) => {
    if (!st) { // playback moved to another device
      if (S.isLocal) { S.isLocal = false; startPolling(); }
      return;
    }
    S.isLocal = true;
    S.activeDevice = { id: S.deviceId, name: CONFIG.deviceName };
    renderSpeaker();
    stopPolling();
    setPlayback(fromSdk(st));
  });
  player.addListener('initialization_error', ({ message }) => {
    console.warn(message);
    toast('This browser cannot play Spotify audio. Pick another speaker to use Retrodeck as a remote.', 6000);
  });
  player.addListener('authentication_error', () => showGate('Spotify could not confirm your session. Sign in again.'));
  player.addListener('account_error', () => toast('Playing in the browser needs Spotify Premium.', 6000));
  player.addListener('playback_error', ({ message }) => toast(`Playback error: ${message}`));
  player.addListener('autoplay_failed', () => toast('Your browser blocked autoplay. Press play.'));

  await player.connect();
}

// ------------------------------------------------------------------ polling (when another device plays)
async function poll() {
  if (S.demo) return;
  try {
    const p = await sp.getPlayback();
    if (!p || !p.item) {
      if (!S.isLocal) { S.activeDevice = p?.device ? { id: p.device.id, name: p.device.name } : null; setPlayback(null); renderSpeaker(); }
      return;
    }
    S.activeDevice = p.device ? { id: p.device.id, name: p.device.name } : null;
    S.isLocal = !!S.deviceId && p.device?.id === S.deviceId;
    renderSpeaker();
    if (S.isLocal && S.player) return; // SDK events drive the deck
    setPlayback({
      track: mapTrack(p.item),
      paused: !p.is_playing,
      position: p.progress_ms || 0,
      duration: p.item.duration_ms || 0,
      shuffle: !!p.shuffle_state,
      repeat: p.repeat_state || 'off',
      context: p.context?.uri || null,
      stamp: performance.now(),
    });
    if (p.device?.volume_percent != null && !S.isLocal) {
      S.volume = p.device.volume_percent; el.volume.value = S.volume; paintRange(el.volume);
    }
  } catch (err) {
    if (err instanceof AuthError) showGate(explain(err));
    else console.warn('Poll failed', err);
  }
}
function startPolling() {
  if (S.pollTimer || S.demo) return;
  poll();
  S.pollTimer = setInterval(() => { if (!document.hidden) poll(); }, 4000);
}
function stopPolling() {
  clearInterval(S.pollTimer);
  S.pollTimer = null;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.pollTimer) poll(); });

// ------------------------------------------------------------------ speakers (Spotify Connect)
function renderSpeaker() {
  const name = S.activeDevice?.name || (S.deviceId ? `${CONFIG.deviceName} (ready)` : 'No speaker');
  el.speakerName.textContent = name;
  el.btnSpeaker.title = `Playing on: ${name}`;
}

async function openSpeakerMenu() {
  el.speakerMenu.hidden = false;
  el.btnSpeaker.setAttribute('aria-expanded', 'true');
  el.deviceList.replaceChildren(h('li', {}, 'Looking for speakers…'));
  const devices = S.demo
    ? [{ id: 'demo', name: 'Retrodeck', type: 'Computer', is_active: true }, { id: 'phone', name: 'Phone', type: 'Smartphone' }]
    : (await guard(() => sp.getDevices()))?.devices || [];
  if (!devices.length) {
    el.deviceList.replaceChildren(h('li', {}, 'No speakers found. Open Spotify on a phone or computer, then refresh.'));
    return;
  }
  el.deviceList.replaceChildren(...devices.map((d) => h('li', {},
    h('button', {
      class: 'device', type: 'button', 'aria-current': String(!!d.is_active),
      onclick: () => chooseDevice(d),
    }, h('span', {}, d.id === S.deviceId ? `${d.name} (this browser)` : d.name), h('small', {}, d.type || '')),
  )));
}
function closeSpeakerMenu() {
  el.speakerMenu.hidden = true;
  el.btnSpeaker.setAttribute('aria-expanded', 'false');
}
async function chooseDevice(d) {
  closeSpeakerMenu();
  if (S.demo) { S.activeDevice = { id: d.id, name: d.name }; renderSpeaker(); return; }
  await guard(async () => {
    if (d.id === S.deviceId) await S.player?.activateElement?.();
    await sp.transfer(d.id, S.playback && !S.playback.paused);
    S.activeDevice = { id: d.id, name: d.name };
    renderSpeaker();
    if (d.id !== S.deviceId) startPolling();
    setTimeout(poll, 800);
  });
}
el.btnSpeaker.addEventListener('click', (e) => {
  e.stopPropagation();
  el.speakerMenu.hidden ? openSpeakerMenu() : closeSpeakerMenu();
});
el.btnDevicesRefresh.addEventListener('click', (e) => { e.stopPropagation(); openSpeakerMenu(); });
el.speakerMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', closeSpeakerMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSpeakerMenu(); });

// ------------------------------------------------------------------ playing from the crate
function targetDevice() {
  if (S.activeDevice && !S.isLocal) return S.activeDevice.id;
  return S.deviceId || S.activeDevice?.id || undefined;
}

async function playFrom(options) {
  if (S.demo) return demoPlay(options);
  await guard(async () => {
    const deviceId = targetDevice();
    if (!deviceId) { toast('No speaker yet. Wait a moment, or open Spotify on a device and pick it under the speaker button.', 6000); return; }
    if (deviceId === S.deviceId) await S.player?.activateElement?.();
    await sp.play({ deviceId, ...options });
    if (deviceId !== S.deviceId) setTimeout(poll, 600);
  });
}

// ------------------------------------------------------------------ crate (library)
function setView(view) {
  S.view = view;
  el.tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  el.searchForm.hidden = view !== 'search';
  el.crateHead.hidden = true;
  if (view === 'liked') loadList({ kind: 'liked', loader: loaderLiked });
  if (view === 'playlists') loadList({ kind: 'playlists', loader: loaderPlaylists });
  if (view === 'search') {
    if (S.list.kind === 'search' && S.list.query) renderList();
    else { resetList('search'); el.listStatus.textContent = 'Search Spotify for a track.'; }
    el.searchInput.focus();
  }
}
el.tabs.forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

function resetList(kind, extra = {}) {
  S.list = { kind, items: [], next: null, loader: null, playlist: null, query: '', ...extra };
  el.list.replaceChildren();
  el.btnMore.hidden = true;
  el.listStatus.textContent = '';
}

async function loadList({ kind, loader, ...extra }) {
  resetList(kind, { loader, ...extra });
  el.listStatus.textContent = 'Loading…';
  await loadMore();
}

async function loadMore() {
  const list = S.list;
  if (!list.loader) return;
  el.btnMore.disabled = true;
  const result = await guard(() => list.loader(list.items.length, list));
  el.btnMore.disabled = false;
  if (S.list !== list || !result) { if (S.list === list) el.listStatus.textContent = 'Could not load this list.'; return; }
  list.items.push(...result.items);
  list.next = result.hasMore;
  renderList();
}
el.btnMore.addEventListener('click', loadMore);

function renderList() {
  const { kind, items } = S.list;
  el.list.replaceChildren(...items.map((item, i) => (kind === 'playlists' ? playlistRow(item) : trackRow(item, i))));
  el.btnMore.hidden = !S.list.next;
  el.listStatus.textContent = items.length ? '' : emptyText(kind);
  markCurrentRow();
}

function emptyText(kind) {
  return {
    liked: 'No liked songs yet. Heart a track on the deck to add it here.',
    playlists: 'No playlists yet.',
    playlist: 'This playlist is empty.',
    search: 'Nothing matched. Try another spelling or an artist name.',
  }[kind] || '';
}

function trackRow(t, index) {
  const disabled = !t.playable;
  return h('li', {},
    h('button', {
      class: 'row', type: 'button', 'data-uri': t.uri, disabled,
      title: disabled ? 'Not playable' : `Play ${t.name}`,
      onclick: () => playTrackAt(index),
    },
    t.thumb ? h('img', { class: 'row-art', src: t.thumb, alt: '', loading: 'lazy', width: 44, height: 44 }) : h('span', { class: 'row-art' }),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-name' }, t.name),
      h('span', { class: 'row-sub' }, t.artists)),
    h('span', { class: 'row-meta' }, clock(t.duration))));
}

function playlistRow(p) {
  return h('li', {},
    h('button', { class: 'row', type: 'button', onclick: () => openPlaylist(p) },
      p.image ? h('img', { class: 'row-art', src: p.image, alt: '', loading: 'lazy', width: 44, height: 44 }) : h('span', { class: 'row-art' }),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-name' }, p.name),
        h('span', { class: 'row-sub' }, p.owned ? `${p.total ?? '?'} tracks` : `By ${p.ownerName}`)),
      h('span', { class: 'row-meta' }, p.total != null ? String(p.total) : '')));
}

function markCurrentRow() {
  const uri = S.playback?.track?.uri;
  el.list.querySelectorAll('.row[data-uri]').forEach((r) => {
    const on = !!uri && r.dataset.uri === uri;
    r.classList.toggle('is-current', on);
    if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
  });
}

function playTrackAt(index) {
  const { kind, items, playlist } = S.list;
  const t = items[index];
  if (!t) return;
  if (kind === 'playlist' && playlist) {
    playFrom({ contextUri: playlist.uri, offset: t.uri });
  } else {
    // Liked songs and search results: queue what is loaded, starting at this track.
    const uris = items.filter((x) => x.playable).map((x) => x.uri);
    playFrom({ uris, offset: Math.max(0, uris.indexOf(t.uri)) });
  }
}

// ---- loaders
async function loaderLiked(offset) {
  if (S.demo) return { items: offset ? [] : DEMO_TRACKS.map((t) => ({ ...t })), hasMore: false };
  const page = await sp.getLiked(offset);
  return { items: page.items.map((x) => mapTrack(x.track)).filter(Boolean), hasMore: !!page.next };
}

function mapPlaylist(p) {
  const owned = p.owner?.id === S.me?.id || !!p.collaborative;
  const total = p.items?.total ?? p.tracks?.total ?? null; // field renamed tracks -> items (Feb 2026)
  return {
    id: p.id, uri: p.uri, name: p.name || 'Untitled playlist',
    image: pickImage(p.images, 64), owned,
    ownerName: p.owner?.display_name || p.owner?.id || 'someone else',
    total,
  };
}

async function loaderPlaylists(offset) {
  if (S.demo) return { items: offset ? [] : DEMO_PLAYLISTS, hasMore: false };
  const page = await sp.getPlaylists(offset);
  return { items: page.items.filter(Boolean).map(mapPlaylist), hasMore: !!page.next };
}

async function loaderPlaylistItems(offset, list) {
  if (S.demo) return { items: offset ? [] : DEMO_TRACKS.slice(list.playlist.slice || 0).map((t) => ({ ...t })), hasMore: false };
  const page = await sp.getPlaylistItems(list.playlist.id, offset);
  const items = page.items
    .map((x) => x.item ?? x.track) // "item" since Feb 2026, "track" before
    .filter((t) => t && t.type !== 'episode')
    .map(mapTrack);
  return { items, hasMore: !!page.next };
}

async function loaderSearch(offset, list) {
  if (S.demo) {
    const q = list.query.toLowerCase();
    return { items: DEMO_TRACKS.filter((t) => `${t.name} ${t.artists}`.toLowerCase().includes(q)).map((t) => ({ ...t })), hasMore: false };
  }
  const res = await sp.searchTracks(list.query, offset);
  const page = res.tracks;
  return { items: page.items.filter(Boolean).map(mapTrack), hasMore: !!page.next && offset + page.items.length < 100 };
}

function openPlaylist(p) {
  el.crateHead.hidden = false;
  el.crateTitle.textContent = p.name;
  el.btnPlayAll.onclick = () => playFrom({ contextUri: p.uri });
  if (p.owned) {
    el.crateNote.hidden = true;
    loadList({ kind: 'playlist', loader: loaderPlaylistItems, playlist: p });
  } else {
    // Feb 2026 rule: track lists are only returned for playlists you own or collaborate on.
    el.crateNote.hidden = false;
    el.crateNote.textContent = 'Spotify only lists tracks for playlists you own or collaborate on. Press Play all to play it.';
    resetList('playlist', { playlist: p });
  }
}
el.btnBack.addEventListener('click', () => setView('playlists'));

el.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = el.searchInput.value.trim();
  if (!query) return;
  el.searchInput.blur();
  loadList({ kind: 'search', loader: loaderSearch, query });
});

// ------------------------------------------------------------------ media session (lock screen / headset keys)
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = S.playback?.track;
  navigator.mediaSession.metadata = t ? new MediaMetadata({
    title: t.name, artist: t.artists, album: t.album,
    artwork: t.art ? [{ src: t.art, sizes: '300x300', type: 'image/jpeg' }] : [],
  }) : null;
}
if ('mediaSession' in navigator) {
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported */ } };
  set('play', () => control('toggle'));
  set('pause', () => control('toggle'));
  set('nexttrack', () => control('next'));
  set('previoustrack', () => control('prev'));
}

// ------------------------------------------------------------------ demo mode (no sign-in)
let demoQueue = [];
function demoPlay({ uris, contextUri, offset }) {
  if (uris) demoQueue = uris.map((u) => DEMO_TRACKS.find((t) => t.uri === u)).filter(Boolean);
  else if (contextUri) {
    const pl = DEMO_PLAYLISTS.find((p) => p.uri === contextUri);
    demoQueue = DEMO_TRACKS.slice(pl?.slice || 0);
  }
  let start = 0;
  if (typeof offset === 'number') start = offset;
  else if (offset) start = Math.max(0, demoQueue.findIndex((t) => t.uri === offset));
  demoLoad(start, false);
}
function demoLoad(index, paused) {
  if (!demoQueue.length) demoQueue = DEMO_TRACKS.slice();
  const i = (index + demoQueue.length) % demoQueue.length;
  const t = demoQueue[i];
  S.demoIndex = i;
  setPlayback({
    track: t, paused, position: 0, duration: t.duration,
    shuffle: S.playback?.shuffle || false, repeat: S.playback?.repeat || 'off', stamp: performance.now(),
  });
}
function demoControl(action, arg) {
  const pb = S.playback;
  const now = positionNow();
  switch (action) {
    case 'toggle':
      if (!pb) return demoLoad(0, false);
      return setPlayback({ ...pb, paused: !pb.paused, position: now, stamp: performance.now() });
    case 'next': return demoLoad((S.demoIndex || 0) + 1, false);
    case 'prev': return now > 3000 ? setPlayback({ ...pb, position: 0, stamp: performance.now() }) : demoLoad((S.demoIndex || 0) - 1, false);
    case 'seek': return pb && setPlayback({ ...pb, position: arg, stamp: performance.now() });
    case 'shuffle': return pb && setPlayback({ ...pb, shuffle: !pb.shuffle, position: now, stamp: performance.now() });
    case 'repeat': {
      const order = ['off', 'context', 'track'];
      return pb && setPlayback({ ...pb, repeat: order[(order.indexOf(pb.repeat) + 1) % 3], position: now, stamp: performance.now() });
    }
    default: return undefined;
  }
}
setInterval(() => {
  if (!S.demo || !S.playback || S.playback.paused) return;
  if (positionNow() >= S.playback.duration) {
    if (S.playback.repeat === 'track') demoLoad(S.demoIndex, false);
    else demoLoad((S.demoIndex || 0) + 1, false);
  }
}, 500);

// ------------------------------------------------------------------ boot
async function startApp() {
  el.gate.hidden = true;
  el.app.hidden = false;
  renderSpeaker();
  renderDeck();

  if (S.demo) {
    el.who.textContent = 'Demo mode';
    el.btnLogout.textContent = 'Exit demo';
    S.activeDevice = { id: 'demo', name: 'Retrodeck' };
    renderSpeaker();
    setView('liked');
    demoQueue = DEMO_TRACKS.slice();
    demoLoad(0, true);
    if (new URLSearchParams(location.search).has('playing')) demoControl('toggle');
    return;
  }

  S.me = await sp.getMe();
  el.who.textContent = S.me.display_name || S.me.id;
  setView('liked');
  startPolling();      // pick up whatever is already playing on any device
  initPlayer();        // register this browser as a Connect speaker
}

async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
  }
  if (S.demo) return startApp();

  try {
    if (!isConfigured()) return showGate();
    await handleRedirect();
    if (!isSignedIn()) return showGate();
    await startApp();
  } catch (err) {
    console.error(err);
    showGate(err instanceof AuthError ? 'Sign in to continue.' : explain(err));
  }
}

boot();
