// Retrodeck — app controller.
import { CONFIG } from './config.js';
import { login, logout, handleRedirect, isSignedIn, isConfigured, redirectUri, getToken, hasAllScopes, AuthError } from './auth.js';
import * as sp from './api.js';
import { ApiError } from './api.js';
import * as demo from './demo.js';

// ------------------------------------------------------------------ state
const S = {
  demo: new URLSearchParams(location.search).has('demo'),
  me: null,
  player: null,          // Spotify.Player (Web Playback SDK)
  deviceId: null,        // this browser's Connect device id
  isLocal: false,        // true while playback is in this browser
  activeDevice: null,    // { id, name } of the device currently playing
  playback: null,        // { track, paused, position, duration, shuffle, repeat, stamp, context }
  heart: { uri: null, saved: false },
  volume: 60,
  view: 'home',          // selected tab
  stack: [],             // pages in the menu; last one is shown, earlier ones are "Back"
  searchPage: null,      // last search, kept when switching tabs
  focus: false,          // player-only view (something is loaded)
  drawerOpen: false,     // menu open while in player-only view
  homeStale: true,
  cache: { recent: null, recentAt: 0, similar: new Map(), albums: new Map() },
  pollTimer: null,
  seeking: false,
};

const $ = (sel) => document.querySelector(sel);
const el = {
  gate: $('#gate'), app: $('#app'), gateSetup: $('#gate-setup'), gateRedirect: $('#gate-redirect'),
  gateError: $('#gate-error'), btnLogin: $('#btn-login'),
  who: $('#who'), btnBrowse: $('#btn-browse'), btnBrowseDeck: $('#btn-browse-deck'), btnTheme: $('#btn-theme'), btnLogout: $('#btn-logout'),
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
  crate: $('#crate'), btnCloseCrate: $('#btn-close-crate'), scrim: $('#scrim'),
  tabs: [...document.querySelectorAll('.tab')], searchForm: $('#search-form'), searchInput: $('#search-input'),
  body: $('#crate-body'),
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
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
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

const idFromUri = (uri) => uri?.split(':')[2] || null;

function mapTrack(t) {
  if (!t) return null;
  const id = t.id || idFromUri(t.uri);
  const artistRefs = (t.artists || []).map((a) => ({ id: a.id || idFromUri(a.uri), name: a.name }));
  return {
    uri: t.uri,
    id,
    name: t.name || 'Untitled',
    artists: artistRefs.map((a) => a.name).join(', '),
    artistRefs,
    album: t.album?.name || '',
    albumId: t.album?.id || idFromUri(t.album?.uri),
    albumUri: t.album?.uri || null,
    art: pickImage(t.album?.images),
    thumb: pickImage(t.album?.images, 64),
    duration: t.duration_ms || 0,
    url: t.external_urls?.spotify || (id ? `https://open.spotify.com/track/${id}` : null),
    playable: t.is_playable !== false && !t.is_local,
  };
}

function mapAlbum(a) {
  return {
    id: a.id, uri: a.uri, name: a.name || 'Untitled album',
    artists: (a.artists || []).map((x) => x.name).join(', '),
    year: (a.release_date || '').slice(0, 4),
    type: a.album_type || 'album',
    image: pickImage(a.images, 64), art: pickImage(a.images),
    total: a.total_tracks ?? null,
  };
}

function mapArtist(a) {
  return { id: a.id, uri: a.uri, name: a.name || 'Unknown artist', image: pickImage(a.images, 64), genres: a.genres || [] };
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

// Album pages return tracks without their album; put it back so rows and the deck get the cover art.
const withAlbum = (t, album) => ({ ...t, album: { id: album.id, uri: album.uri, name: album.name, images: album.images } });

// Two versions of one song (single + album cut) count as the same song.
const songKey = (t) => `${t.name.toLowerCase().replace(/\s*[([].*$/, '')}|${(t.artistRefs[0]?.name || '').toLowerCase()}`;

const quoteSafe = (s) => s.replace(/"/g, '');

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
    el.lcdArtist.textContent = t ? [t.artists, t.album].filter(Boolean).join(' / ') : 'Pick a song to start';
    el.lcdDur.textContent = clock(pb?.duration || 0);
    el.openSpotify.href = t?.url || 'https://open.spotify.com';
    document.title = t ? `${t.name} · Retrodeck` : 'Retrodeck';
    updateMarquee();
    markCurrentRows();
    refreshHeart();
    updateMediaSession();
    onTrackChange();
  }
  updateMode();
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
  setR(el.tapeL, R_MIN + (R_MAX - R_MIN) * (1 - p));
  setR(el.tapeR, R_MIN + (R_MAX - R_MIN) * p);
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

// ------------------------------------------------------------------ player-only view + slide-out menu
function updateMode() {
  const focus = !!S.playback?.track;
  if (focus === S.focus) return;
  S.focus = focus;
  document.body.classList.toggle('is-focus', focus);
  el.btnBrowse.hidden = !focus;
  if (focus) {
    el.crate.setAttribute('role', 'dialog');
    el.crate.setAttribute('aria-modal', 'true');
    el.crate.setAttribute('aria-label', 'Browse');
  } else {
    el.crate.removeAttribute('role');
    el.crate.removeAttribute('aria-modal');
    el.crate.setAttribute('aria-label', 'Library');
    closeDrawer({ restoreFocus: false });
    if (isHomeRoot() && S.homeStale) loadHome();
  }
}

function openDrawer(view) {
  if (!S.focus) { if (view) setView(view); return; }
  S.drawerOpener = document.activeElement;
  S.drawerOpen = true;
  document.body.classList.add('drawer-open');
  el.scrim.hidden = false;
  el.btnBrowse.setAttribute('aria-expanded', 'true');
  el.btnBrowseDeck.setAttribute('aria-expanded', 'true');
  if (view && view !== S.view) setView(view);
  else if (isHomeRoot() && S.homeStale) loadHome();
  setTimeout(() => {
    if (S.view === 'search' && S.stack.length === 1) el.searchInput.focus();
    else el.tabs.find((t) => t.dataset.view === S.view)?.focus();
  }, 60);
}

function closeDrawer({ restoreFocus = true } = {}) {
  if (!S.drawerOpen) return;
  S.drawerOpen = false;
  document.body.classList.remove('drawer-open');
  el.scrim.hidden = true;
  el.btnBrowse.setAttribute('aria-expanded', 'false');
  el.btnBrowseDeck.setAttribute('aria-expanded', 'false');
  if (restoreFocus) (S.drawerOpener?.isConnected ? S.drawerOpener : el.btnPlay).focus();
}

const crateVisible = () => !S.focus || S.drawerOpen;

el.btnBrowse.addEventListener('click', () => (S.drawerOpen ? closeDrawer() : openDrawer()));
el.btnBrowseDeck.addEventListener('click', () => openDrawer());
el.btnCloseCrate.addEventListener('click', () => closeDrawer());
el.scrim.addEventListener('click', () => closeDrawer());

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
  if (e.key === 'Escape') {
    if (!el.speakerMenu.hidden) closeSpeakerMenu();
    else closeDrawer();
    return;
  }
  if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); control('toggle'); }
  else if (e.key === 'n') control('next');
  else if (e.key === 'p') control('prev');
  else if (e.key === '/') { e.preventDefault(); openDrawer('search'); el.searchInput.focus(); }
});

// ------------------------------------------------------------------ hearts
async function refreshHeart() {
  const t = S.playback?.track;
  S.heart = { uri: t?.uri || null, saved: false };
  paintHeart();
  if (!t) return;
  if (S.demo) { S.heart.saved = !!t.liked; paintHeart(); return; }
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
  if (S.demo) { S.playback.track.liked = want; return; }
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
    if (!st) {
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

// ------------------------------------------------------------------ playing
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

function playSection(section, index) {
  const t = section.items[index];
  if (!t?.playable) return;
  if (section.context) {
    playFrom({ contextUri: section.context, offset: t.uri });
  } else {
    // Queue the whole section from this track on, so the next song comes from the same list.
    const uris = section.items.filter((x) => x.playable).map((x) => x.uri);
    playFrom({ uris, offset: Math.max(0, uris.indexOf(t.uri)) });
  }
  if (S.focus) closeDrawer({ restoreFocus: false });
}

function playAll(page) {
  if (page.playAll) playFrom(page.playAll);
  if (S.focus) closeDrawer({ restoreFocus: false });
}

// ------------------------------------------------------------------ the menu: pages and sections
// A page is { title?, sub?, note?, playAll?, sections: [...] }.
// A section is { heading?, note?, kind: 'tracks'|'albums'|'artists'|'playlists', items, context?, limit?,
//                loading?, error?, empty?, action?, more?: async (section) => { items, hasMore }, hasMore? }.

const top = () => S.stack[S.stack.length - 1];
const isTop = (page) => top() === page;
const isHomeRoot = () => S.view === 'home' && S.stack.length === 1;

function setView(view) {
  S.view = view;
  el.tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  if (view === 'home') loadHome();
  if (view === 'liked') showRoot(pagedTracks({ empty: 'No liked songs yet. Tap Like on the deck to add one.' }, loaderLiked));
  if (view === 'playlists') showRoot(pagedList('playlists', { empty: 'No playlists yet.' }, loaderPlaylists));
  if (view === 'search') {
    showRoot(S.searchPage || { sections: [], hint: 'Search for a song, artist or album.' });
  }
}
el.tabs.forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

function showRoot(page) {
  S.stack = [page];
  el.body.scrollTop = 0;
  render();
  startSections(page);
}

function push(page) {
  const current = top();
  if (current) current.scroll = el.body.scrollTop;
  S.stack.push(page);
  el.body.scrollTop = 0;
  render();
}

function back() {
  if (S.stack.length < 2) return;
  S.stack.pop();
  render();
  el.body.scrollTop = top().scroll || 0;
}

// Sections with a loader and no items yet fetch their first page.
function startSections(page) {
  for (const sec of page.sections) {
    if (sec.more && !sec.items.length && !sec.started) loadMore(page, sec);
  }
}

async function loadMore(page, sec) {
  sec.started = true;
  sec.loading = true;
  sec.error = null;
  if (isTop(page)) render();
  try {
    const res = await sec.more(sec);
    sec.items.push(...res.items);
    sec.hasMore = !!res.hasMore;
  } catch (err) {
    console.error(err);
    if (err instanceof AuthError) return showGate(explain(err));
    sec.error = explain(err);
  }
  sec.loading = false;
  if (isTop(page)) render();
}

function pagedTracks(sec, loader, extra = {}) {
  return { ...extra, sections: [{ kind: 'tracks', items: [], ...sec, more: loader }] };
}
function pagedList(kind, sec, loader) {
  return { sections: [{ kind, items: [], ...sec, more: loader }] };
}

function render() {
  const page = top();
  const searchRoot = S.view === 'search' && S.stack.length === 1;
  el.searchForm.hidden = !searchRoot;
  if (!page) { el.body.replaceChildren(); return; }

  const nodes = [];
  if (S.stack.length > 1) {
    nodes.push(h('button', { class: 'link-btn crate-back', type: 'button', onclick: back }, 'Back'));
  }
  if (page.title) {
    nodes.push(h('div', { class: 'page-head' },
      page.art ? h('img', { class: 'page-art', src: page.art, alt: '', width: 72, height: 72 }) : null,
      h('div', { class: 'page-text' },
        h('h2', { class: 'page-title' }, page.title),
        page.sub ? h('p', { class: 'page-sub' }, page.sub) : null),
      page.playAll ? h('button', { class: 'chip chip--hot', type: 'button', onclick: () => playAll(page) }, 'Play all') : null));
  }
  if (page.note) nodes.push(h('p', { class: 'crate-note' }, page.note));
  if (page.hint && !page.sections.length) nodes.push(h('p', { class: 'list-status' }, page.hint));

  for (const sec of page.sections) nodes.push(renderSection(page, sec));
  el.body.replaceChildren(...nodes);
  markCurrentRows();
}

function renderSection(page, sec) {
  const wrap = h('section', { class: 'sec' });
  if (sec.heading) wrap.append(h('h3', { class: 'sec-head' }, sec.heading));
  if (sec.note) wrap.append(h('p', { class: 'sec-note' }, sec.note));

  const limit = sec.limit ?? Infinity;
  const shown = sec.items.slice(0, limit);
  if (shown.length) {
    wrap.append(h('ol', { class: 'list' }, shown.map((item, i) => h('li', {}, rowFor(sec, item, i)))));
  }
  if (sec.items.length > limit) {
    wrap.append(h('button', {
      class: 'chip chip--more', type: 'button',
      onclick: () => { sec.limit = Infinity; render(); },
    }, `Show all ${sec.items.length}`));
  } else if (sec.hasMore && !sec.loading) {
    wrap.append(h('button', { class: 'chip chip--more', type: 'button', onclick: () => loadMore(page, sec) }, 'Load more'));
  }

  let status = '';
  if (sec.loading) status = 'Loading…';
  else if (sec.error) status = sec.error;
  else if (!sec.items.length && sec.empty) status = sec.empty;
  if (status) wrap.append(h('p', { class: 'list-status' }, status));
  if (sec.action && !sec.loading) {
    wrap.append(h('button', { class: 'chip chip--more', type: 'button', onclick: sec.action.onclick }, sec.action.label));
  }
  return wrap;
}

function art(src, round) {
  const cls = round ? 'row-art row-art--round' : 'row-art';
  return src ? h('img', { class: cls, src, alt: '', loading: 'lazy', width: 44, height: 44 }) : h('span', { class: cls });
}

function rowFor(sec, item, index) {
  if (sec.kind === 'tracks') {
    const disabled = !item.playable;
    return h('button', {
      class: 'row', type: 'button', 'data-uri': item.uri, disabled,
      title: disabled ? 'Not playable' : `Play ${item.name}`,
      onclick: () => playSection(sec, index),
    },
    art(item.thumb),
    h('span', { class: 'row-text' }, h('span', { class: 'row-name' }, item.name), h('span', { class: 'row-sub' }, item.artists)),
    h('span', { class: 'row-meta' }, clock(item.duration)));
  }
  if (sec.kind === 'albums') {
    const kind = item.type === 'single' ? 'Single' : item.type === 'compilation' ? 'Compilation' : 'Album';
    return h('button', { class: 'row', type: 'button', onclick: () => openAlbum(item) },
      art(item.image),
      h('span', { class: 'row-text' }, h('span', { class: 'row-name' }, item.name), h('span', { class: 'row-sub' }, `${kind} by ${item.artists}`)),
      h('span', { class: 'row-meta' }, item.year || ''));
  }
  if (sec.kind === 'artists') {
    return h('button', { class: 'row', type: 'button', onclick: () => openArtist(item) },
      art(item.image, true),
      h('span', { class: 'row-text' }, h('span', { class: 'row-name' }, item.name), h('span', { class: 'row-sub' }, item.genres?.length ? `Artist, ${item.genres.slice(0, 2).join(', ')}` : 'Artist')),
      h('span', { class: 'row-meta' }, ''));
  }
  // playlists
  return h('button', { class: 'row', type: 'button', onclick: () => openPlaylist(item) },
    art(item.image),
    h('span', { class: 'row-text' }, h('span', { class: 'row-name' }, item.name), h('span', { class: 'row-sub' }, item.owned ? `${item.total ?? '?'} songs` : `By ${item.ownerName}`)),
    h('span', { class: 'row-meta' }, item.total != null ? String(item.total) : ''));
}

function markCurrentRows() {
  const uri = S.playback?.track?.uri;
  el.body.querySelectorAll('.row[data-uri]').forEach((r) => {
    const on = !!uri && r.dataset.uri === uri;
    r.classList.toggle('is-current', on);
    if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
  });
}

// ------------------------------------------------------------------ Home: recently played + more like this
function onTrackChange() {
  S.homeStale = true;
  if (crateVisible() && isHomeRoot()) {
    clearTimeout(onTrackChange.t);
    onTrackChange.t = setTimeout(loadHome, 700);
  }
}

async function loadHome() {
  S.homeStale = false;
  const nowPlaying = S.playback?.track || null;
  const recent = { heading: 'Recently played', kind: 'tracks', items: [], limit: 8, loading: true, empty: 'Nothing here yet. Songs you play show up here.' };
  const similar = { heading: 'More like this', kind: 'tracks', items: [], limit: 10, loading: true, empty: 'Play a song to get suggestions.' };
  const page = { sections: nowPlaying ? [similar, recent] : [recent, similar] };
  if (S.view !== 'home') return;
  S.stack = [page];
  render();

  const recentP = fetchRecent(recent).then((items) => { recent.loading = false; if (isTop(page)) render(); return items; });
  const seed = nowPlaying || (await recentP)[0];
  if (!seed) { similar.loading = false; if (isTop(page)) render(); return; }

  similar.heading = `More like “${seed.name}”`;
  similar.note = 'From the same artists, genre and album.';
  try { similar.items = await getSimilar(seed); }
  catch (err) { console.error(err); similar.error = 'Could not load suggestions right now.'; }
  similar.loading = false;
  if (isTop(page)) render();
}

async function fetchRecent(sec) {
  if (S.demo) return (sec.items = demo.demoRecent());
  if (!hasAllScopes()) {
    sec.empty = 'Spotify needs one more permission to show what you played recently.';
    sec.action = { label: 'Allow and sign in again', onclick: () => guard(login) };
    return [];
  }
  if (S.cache.recent && Date.now() - S.cache.recentAt < 20_000) return (sec.items = S.cache.recent.slice());
  try {
    const res = await sp.getRecent();
    const seen = new Set();
    const items = [];
    for (const x of res.items || []) {
      const t = mapTrack(x.track);
      if (!t || seen.has(t.uri)) continue;
      seen.add(t.uri);
      items.push(t);
    }
    S.cache.recent = items;
    S.cache.recentAt = Date.now();
    return (sec.items = items.slice());
  } catch (err) {
    console.error(err);
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      sec.empty = 'Spotify needs one more permission to show what you played recently.';
      sec.action = { label: 'Allow and sign in again', onclick: () => guard(login) };
    } else if (err instanceof AuthError) {
      showGate(explain(err));
    } else {
      sec.error = 'Could not load recently played.';
    }
    return [];
  }
}

// Spotify switched off its recommendations and related-artists endpoints for new apps in 2024,
// so suggestions are built from what is still open: the song's genres, its artists' other songs, and its album.
async function getSimilar(seed) {
  if (S.demo) return demo.demoSimilar(seed);
  if (S.cache.similar.has(seed.uri)) return S.cache.similar.get(seed.uri);

  const artists = (seed.artistRefs || []).filter((a) => a.id).slice(0, 3);
  const searchTracks = (q, offset = 0) => sp.searchTracks(q, offset).then((r) => r.tracks?.items || []);

  const genrePool = artists.length
    ? sp.getArtist(artists[0].id).then(async (artist) => {
      const genres = (artist.genres || []).slice(0, 2);
      const lists = await Promise.all(genres.map((g) =>
        searchTracks(`genre:"${quoteSafe(g)}"`, 10 * Math.floor(Math.random() * 3)).catch(() => [])));
      return interleave(lists);
    })
    : Promise.resolve([]);
  const artistPools = artists.map((a) => searchTracks(`artist:"${quoteSafe(a.name)}"`));
  const albumPool = seed.albumId
    ? getAlbumCached(seed.albumId).then((album) => (album.tracks?.items || []).map((t) => withAlbum(t, album)))
    : Promise.resolve([]);

  const settled = await Promise.allSettled([genrePool, artistPools[0], albumPool, ...artistPools.slice(1)].filter(Boolean));
  const pools = settled.map((r) => (r.status === 'fulfilled' ? (r.value || []).filter(Boolean).map(mapTrack) : []));

  const seen = new Set([seed.uri]);
  const seenSongs = new Set([songKey(seed)]);
  const out = [];
  for (const t of interleave(pools)) {
    if (!t?.playable || seen.has(t.uri) || seenSongs.has(songKey(t))) continue;
    seen.add(t.uri);
    seenSongs.add(songKey(t));
    out.push(t);
    if (out.length >= 20) break;
  }
  S.cache.similar.set(seed.uri, out);
  return out;
}

function interleave(lists) {
  const out = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

async function getAlbumCached(id) {
  if (!S.cache.albums.has(id)) S.cache.albums.set(id, sp.getAlbum(id).catch((e) => { S.cache.albums.delete(id); throw e; }));
  return S.cache.albums.get(id);
}

// ------------------------------------------------------------------ Liked + playlists
async function loaderLiked(sec) {
  if (S.demo) return { items: demo.DEMO_TRACKS.filter((t) => t.liked).map((t) => ({ ...t })), hasMore: false };
  const page = await sp.getLiked(sec.items.length);
  return { items: page.items.map((x) => mapTrack(x.track)).filter(Boolean), hasMore: !!page.next };
}

async function loaderPlaylists(sec) {
  if (S.demo) return { items: demo.DEMO_PLAYLISTS, hasMore: false };
  const page = await sp.getPlaylists(sec.items.length);
  return { items: page.items.filter(Boolean).map(mapPlaylist), hasMore: !!page.next };
}

function openPlaylist(p) {
  const playAllOpt = { contextUri: p.uri };
  if (!p.owned) {
    // Feb 2026 rule: track lists are only returned for playlists you own or collaborate on.
    push({
      title: p.name, sub: `Playlist by ${p.ownerName}`, art: p.image, playAll: playAllOpt,
      note: 'Spotify only lists songs for playlists you own or collaborate on. Play all still works.',
      sections: [],
    });
    return;
  }
  const page = pagedTracks({ context: p.uri, empty: 'This playlist is empty.' }, async (sec) => {
    if (S.demo) return { items: demo.demoContextTracks(p.uri).map((t) => ({ ...t })), hasMore: false };
    const res = await sp.getPlaylistItems(p.id, sec.items.length);
    const items = res.items
      .map((x) => x.item ?? x.track) // "item" since Feb 2026, "track" before
      .filter((t) => t && t.type !== 'episode')
      .map(mapTrack);
    return { items, hasMore: !!res.next };
  }, { title: p.name, sub: `${p.total ?? '?'} songs`, art: p.image, playAll: playAllOpt });
  push(page);
  startSections(page);
}

// ------------------------------------------------------------------ search: songs, artists, albums
el.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = el.searchInput.value.trim();
  if (!query) return;
  el.searchInput.blur();
  runSearch(query);
});

async function runSearch(query) {
  const songs = { heading: 'Songs', kind: 'tracks', items: [], limit: 10, loading: true, empty: 'No songs matched.' };
  const artists = { heading: 'Artists', kind: 'artists', items: [], limit: 4, loading: true, empty: 'No artists matched.' };
  const albums = { heading: 'Albums', kind: 'albums', items: [], limit: 6, loading: true, empty: 'No albums matched.' };
  const page = { query, sections: [songs, artists, albums] };
  S.searchPage = page;
  if (S.view !== 'search') return;
  S.stack = [page];
  render();

  try {
    if (S.demo) {
      const r = demo.demoSearch(query);
      songs.items = r.tracks; artists.items = r.artists; albums.items = r.albums;
    } else {
      const r = await sp.searchAll(query);
      songs.items = (r.tracks?.items || []).filter(Boolean).map(mapTrack);
      artists.items = (r.artists?.items || []).filter(Boolean).map(mapArtist);
      albums.items = (r.albums?.items || []).filter(Boolean).map(mapAlbum);
      // More songs come 10 at a time (the Development Mode search limit).
      songs.hasMore = !!r.tracks?.next;
      songs.more = async (sec) => {
        const res = await sp.searchTracks(query, sec.items.length);
        const known = new Set(sec.items.map((t) => t.uri));
        return {
          items: (res.tracks?.items || []).filter(Boolean).map(mapTrack).filter((t) => !known.has(t.uri)),
          hasMore: !!res.tracks?.next && sec.items.length + 10 < 100,
        };
      };
      songs.started = true;
    }
  } catch (err) {
    console.error(err);
    if (err instanceof AuthError) return showGate(explain(err));
    songs.error = explain(err);
  }
  // Put the strongest kind of match first: an exact artist name puts Artists on top.
  const q = query.toLowerCase();
  if (artists.items[0]?.name.toLowerCase() === q) page.sections = [artists, songs, albums];
  else if (albums.items[0]?.name.toLowerCase() === q && songs.items[0]?.name.toLowerCase() !== q) page.sections = [albums, songs, artists];
  for (const s of page.sections) s.loading = false;
  if (isTop(page)) render();
}

async function openAlbum(a) {
  const tracks = { kind: 'tracks', items: [], context: a.uri, loading: true, empty: 'No songs on this album.' };
  const page = {
    title: a.name, sub: [a.type === 'single' ? 'Single' : 'Album', a.artists, a.year].filter(Boolean).join(', '),
    art: a.image, playAll: { contextUri: a.uri }, sections: [tracks],
  };
  push(page);
  try {
    if (S.demo) {
      tracks.items = demo.demoAlbum(a.id).tracks;
    } else {
      const album = await getAlbumCached(a.id);
      tracks.items = (album.tracks?.items || []).map((t) => mapTrack(withAlbum(t, album)));
      page.art = pickImage(album.images, 64) || page.art;
      if (album.tracks?.next) {
        tracks.hasMore = true;
        tracks.more = async (sec) => {
          const res = await sp.getAlbumTracks(a.id, sec.items.length);
          return { items: res.items.map((t) => mapTrack(withAlbum(t, album))), hasMore: !!res.next };
        };
      }
    }
  } catch (err) {
    console.error(err);
    if (err instanceof AuthError) return showGate(explain(err));
    tracks.error = explain(err);
  }
  tracks.loading = false;
  if (isTop(page)) render();
}

async function openArtist(a) {
  // Spotify removed "artist top tracks" for new apps, so the artist's songs come from search.
  const songs = { heading: 'Songs', kind: 'tracks', items: [], limit: 10, loading: true, empty: 'No songs found.' };
  const albums = { heading: 'Albums and singles', kind: 'albums', items: [], limit: 6, loading: true, empty: 'No albums found.' };
  const page = {
    title: a.name, sub: a.genres?.length ? a.genres.slice(0, 3).join(', ') : 'Artist',
    art: a.image, playAll: { contextUri: a.uri }, sections: [songs, albums],
  };
  push(page);

  if (S.demo) {
    const r = demo.demoArtist(a.id);
    songs.items = r.tracks; albums.items = r.albums;
  } else {
    const q = `artist:"${quoteSafe(a.name)}"`;
    const byThisArtist = (list) => {
      const mapped = list.filter(Boolean).map(mapTrack);
      const own = mapped.filter((t) => t.artistRefs.some((x) => x.id === a.id));
      return own.length ? own : mapped;
    };
    const [songRes, albumRes] = await Promise.allSettled([sp.searchTracks(q), sp.getArtistAlbums(a.id)]);
    if (songRes.status === 'fulfilled') {
      songs.items = byThisArtist(songRes.value.tracks?.items || []);
      songs.hasMore = !!songRes.value.tracks?.next;
      songs.started = true;
      songs.more = async (sec) => {
        const res = await sp.searchTracks(q, sec.items.length);
        const known = new Set(sec.items.map((t) => t.uri));
        return { items: byThisArtist(res.tracks?.items || []).filter((t) => !known.has(t.uri)), hasMore: !!res.tracks?.next };
      };
    } else {
      if (songRes.reason instanceof AuthError) return showGate(explain(songRes.reason));
      songs.error = explain(songRes.reason);
    }
    if (albumRes.status === 'fulfilled') albums.items = (albumRes.value.items || []).filter(Boolean).map(mapAlbum);
    else albums.error = explain(albumRes.reason);
  }
  songs.loading = false;
  albums.loading = false;
  if (isTop(page)) render();
}

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
  if (uris) demoQueue = uris.map((u) => demo.DEMO_TRACKS.find((t) => t.uri === u)).filter(Boolean);
  else if (contextUri) demoQueue = demo.demoContextTracks(contextUri);
  let start = 0;
  if (typeof offset === 'number') start = offset;
  else if (offset) start = Math.max(0, demoQueue.findIndex((t) => t.uri === offset));
  demoLoad(start, false);
}
function demoLoad(index, paused) {
  if (!demoQueue.length) demoQueue = demo.DEMO_TRACKS.slice();
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
    setView('home');
    if (new URLSearchParams(location.search).has('playing')) {
      demoQueue = demo.DEMO_TRACKS.slice();
      demoLoad(2, false);
    }
    return;
  }

  S.me = await sp.getMe();
  el.who.textContent = S.me.display_name || S.me.id;
  setView('home');
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
