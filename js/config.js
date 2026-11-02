// Retrodeck configuration.
// 1. Create an app at https://developer.spotify.com/dashboard (pick "Web API" + "Web Playback SDK").
// 2. Paste its Client ID below. No client secret is needed: the app signs in with PKCE.
// 3. Add the exact URL you serve this folder from as a Redirect URI in the dashboard,
//    e.g. http://127.0.0.1:5500/ for local dev, or https://<you>.github.io/retrodeck/ when deployed.
//    Spotify does not accept "localhost"; use 127.0.0.1.

export const CONFIG = {
  clientId: '910036ebe2cc4c1e981a089924b2fc8c',

  // Leave empty to use the page's own URL (origin + path, without index.html).
  // Set it explicitly if your dashboard Redirect URI differs.
  redirectUri: '',

  // Name this player shows up as in Spotify Connect.
  deviceName: 'Retrodeck',

  scopes: [
    'streaming',                  // Web Playback SDK
    'user-read-email',            // required by the Web Playback SDK
    'user-read-private',          // required by the Web Playback SDK
    'user-read-playback-state',   // what's playing, devices
    'user-modify-playback-state', // play, pause, skip, seek, transfer
    'user-library-read',          // Liked Songs, heart state
    'user-library-modify',        // heart / un-heart
    'playlist-read-private',
    'playlist-read-collaborative',
  ],
};
