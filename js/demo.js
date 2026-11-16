// Made-up library for demo mode (?demo=1). No Spotify calls are made in demo mode.
const ARTISTS = {
  clutch: { name: 'The Clutch Plates', genres: ['garage rock', 'indie rock'] },
  mira: { name: 'Mira Vale', genres: ['dream pop', 'indie pop'] },
  tape: { name: 'Tapehead Society', genres: ['lo-fi', 'indie rock'] },
  ghosts: { name: 'Analog Ghosts', genres: ['synthwave', 'dub'] },
};
const ALBUMS = {
  low: { name: 'Low Gear Sessions', artist: 'clutch', year: '2021' },
  steam: { name: 'Steam Dial', artist: 'mira', year: '2023' },
  sideb: { name: 'Side B Weather', artist: 'tape', year: '2019' },
  static: { name: 'Static Bloom', artist: 'ghosts', year: '2024' },
};

const t = (n, name, artistKeys, albumKey, seconds) => ({
  uri: `demo:track:${n}`, id: `demo${n}`, name,
  artists: artistKeys.map((k) => ARTISTS[k].name).join(', '),
  artistRefs: artistKeys.map((k) => ({ id: k, name: ARTISTS[k].name })),
  album: ALBUMS[albumKey].name, albumId: albumKey, albumUri: `demo:album:${albumKey}`,
  art: '', thumb: '', duration: seconds * 1000, url: null, playable: true, liked: n % 3 === 0,
});

export const DEMO_TRACKS = [
  t(1, 'Night Shift on Hosur Road', ['clutch'], 'low', 214),
  t(2, 'Chrome & Filter Coffee', ['mira'], 'steam', 187),
  t(3, 'Rewind the Monsoon', ['tape'], 'sideb', 243),
  t(4, 'Redline Lullaby', ['clutch'], 'low', 199),
  t(5, 'Signal Lost at Nandi Hills', ['ghosts'], 'static', 262),
  t(6, 'Magnetic North', ['mira'], 'steam', 176),
  t(7, 'Cassette Heart', ['tape', 'mira'], 'sideb', 228),
  t(8, 'Long Way Round (Dub)', ['ghosts'], 'static', 305),
  t(9, 'Kickstart at Dawn', ['clutch', 'tape'], 'low', 181),
  t(10, 'Paper Moon Frequency', ['ghosts'], 'static', 240),
  t(11, 'Rain on the Tank', ['tape'], 'sideb', 201),
  t(12, 'Glasshouse Echo', ['mira'], 'steam', 222),
];

export const DEMO_ALBUMS = Object.entries(ALBUMS).map(([id, a]) => ({
  id, uri: `demo:album:${id}`, name: a.name, artists: ARTISTS[a.artist].name,
  year: a.year, type: 'album', image: '', art: '', total: DEMO_TRACKS.filter((x) => x.albumId === id).length,
}));

export const DEMO_ARTISTS = Object.entries(ARTISTS).map(([id, a]) => ({
  id, uri: `demo:artist:${id}`, name: a.name, image: '', genres: a.genres,
}));

export const DEMO_PLAYLISTS = [
  { id: 'p1', uri: 'demo:playlist:1', name: 'Sunday ride mix', image: '', owned: true, total: 12, slice: 0 },
  { id: 'p2', uri: 'demo:playlist:2', name: 'Late night desk', image: '', owned: true, total: 9, slice: 3 },
  { id: 'p3', uri: 'demo:playlist:3', name: 'Friend’s road trip list', image: '', owned: false, ownerName: 'arjun', total: 40, slice: 2 },
];

const copy = (list) => list.map((x) => ({ ...x }));
const byArtist = (id) => DEMO_TRACKS.filter((x) => x.artistRefs.some((a) => a.id === id));

export const demoRecent = () => copy([DEMO_TRACKS[4], DEMO_TRACKS[1], DEMO_TRACKS[6], DEMO_TRACKS[0], DEMO_TRACKS[9], DEMO_TRACKS[2]]);

export function demoSimilar(seed) {
  const ids = new Set((seed.artistRefs || []).map((a) => a.id));
  const genres = new Set((seed.artistRefs || []).flatMap((a) => ARTISTS[a.id]?.genres || []));
  const score = (x) => (x.artistRefs.some((a) => ids.has(a.id)) ? 2 : 0)
    + (x.artistRefs.some((a) => (ARTISTS[a.id]?.genres || []).some((g) => genres.has(g))) ? 1 : 0);
  return copy(DEMO_TRACKS.filter((x) => x.uri !== seed.uri).sort((a, b) => score(b) - score(a)).slice(0, 8));
}

export function demoSearch(q) {
  const m = (s) => s.toLowerCase().includes(q.toLowerCase());
  return {
    tracks: copy(DEMO_TRACKS.filter((x) => m(`${x.name} ${x.artists} ${x.album}`))),
    artists: DEMO_ARTISTS.filter((a) => m(a.name)),
    albums: DEMO_ALBUMS.filter((a) => m(`${a.name} ${a.artists}`)),
  };
}

export const demoAlbum = (id) => ({
  album: DEMO_ALBUMS.find((a) => a.id === id),
  tracks: copy(DEMO_TRACKS.filter((x) => x.albumId === id)),
});

export const demoArtist = (id) => ({
  artist: DEMO_ARTISTS.find((a) => a.id === id),
  tracks: copy(byArtist(id)),
  albums: DEMO_ALBUMS.filter((a) => ALBUMS[a.id].artist === id),
});

// Tracks behind a context URI (album, artist or playlist), for demo playback.
export function demoContextTracks(uri) {
  const [, kind, id] = uri.split(':');
  if (kind === 'album') return DEMO_TRACKS.filter((x) => x.albumId === id);
  if (kind === 'artist') return byArtist(id);
  const pl = DEMO_PLAYLISTS.find((p) => p.uri === uri);
  return DEMO_TRACKS.slice(pl?.slice || 0);
}
