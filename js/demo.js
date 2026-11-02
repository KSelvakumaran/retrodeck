// Made-up tracks for demo mode (?demo=1). No Spotify calls are made in demo mode.
const t = (n, name, artists, album, seconds) => ({
  uri: `demo:track:${n}`, id: `demo${n}`, name, artists, album,
  art: '', thumb: '', duration: seconds * 1000, url: null, playable: true, liked: n % 3 === 0,
});

export const DEMO_TRACKS = [
  t(1, 'Night Shift on Hosur Road', 'The Clutch Plates', 'Low Gear Sessions', 214),
  t(2, 'Chrome & Filter Coffee', 'Mira Vale', 'Steam Dial', 187),
  t(3, 'Rewind the Monsoon', 'Tapehead Society', 'Side B Weather', 243),
  t(4, 'Redline Lullaby', 'The Clutch Plates', 'Low Gear Sessions', 199),
  t(5, 'Signal Lost at Nandi Hills', 'Analog Ghosts', 'Static Bloom', 262),
  t(6, 'Magnetic North', 'Mira Vale', 'Steam Dial', 176),
  t(7, 'Cassette Heart', 'Tapehead Society', 'Side B Weather', 228),
  t(8, 'Long Way Round (Dub)', 'Analog Ghosts', 'Static Bloom', 305),
];

export const DEMO_PLAYLISTS = [
  { id: 'p1', uri: 'demo:playlist:1', name: 'Sunday ride mix', image: '', owned: true, total: 8, slice: 0 },
  { id: 'p2', uri: 'demo:playlist:2', name: 'Late night desk', image: '', owned: true, total: 5, slice: 3 },
  { id: 'p3', uri: 'demo:playlist:3', name: 'Friend’s road trip list', image: '', owned: false, ownerName: 'arjun', total: 40, slice: 2 },
];
