# Retrodeck

A neo-brutalist tape-deck player for your Spotify library. It's a plain HTML/CSS/JS PWA with no build step and no backend.

- **Deck:** a cassette whose reels spin and whose tape moves from the left reel to the right as the song plays. Album art is printed on the label.
- **LCD readout:** title (scrolls when it's long), artist, album and time.
- **Transport keys:** shuffle, previous, play/pause, next, repeat (off → all → one).
- **Heart:** like or unlike the current track, plus a volume fader.
- **Speaker picker (Spotify Connect):** play in the browser, or use Retrodeck as a remote for your phone, PC or speaker.
- **Crate:** Liked Songs, your playlists, and track search.
- Light and dark themes, keyboard shortcuts (Space, N, P), lock-screen media controls, and installable as an app.
- **Demo mode** with made-up tracks: open `?demo=1`.

## Setup (5 minutes)

1. Go to https://developer.spotify.com/dashboard and choose **Create app**.
   - APIs used: tick **Web API** and **Web Playback SDK**.
   - Redirect URI: `http://127.0.0.1:5500/` for local use. Spotify rejects `localhost`, so use `127.0.0.1`.
2. Copy the app's **Client ID** into `js/config.js`. You don't need a client secret, because sign-in uses PKCE.
3. Serve the folder on that address. Pick any of these:
   ```
   python -m http.server 5500 --bind 127.0.0.1
   npx serve -l 5500
   ```
   VS Code Live Server also works on port 5500.
4. Open http://127.0.0.1:5500/ and sign in.

### Deploying (e.g. GitHub Pages)

Add the deployed URL as a second Redirect URI in the dashboard, for example `https://<you>.github.io/retrodeck/`. Include the trailing slash and match the URL exactly. HTTPS is required for anything other than `127.0.0.1`.

## Spotify rules that shape this app (as of Nov 2026)

New apps run in **Development Mode**:

- **Premium:** the app owner needs Spotify Premium, and so does anyone who plays music in the browser.
- **Users:** at most **5 allowlisted users** per app. Add friends under *User Management* in the dashboard.
- **Search:** returns **10 results per page**, so the crate has *Load more*.
- **Playlists:** track lists come back only for playlists you **own or collaborate on**. Other playlists still play with **Play all**.
- **API changes:** the code uses the post-Feb-2026 endpoints (`/playlists/{id}/items`, `/me/library?uris=…`).

## Phone use

Spotify's Web Playback SDK doesn't play audio in most mobile browsers. On a phone, open the speaker button and pick another device (the Spotify app on that phone, your PC, a speaker). Retrodeck then works as a remote and polls what's playing every few seconds.

## Branding

Spotify's design guidelines ask apps to credit Spotify and link back to it. The deck shows "Music and metadata from Spotify" and an *Open in Spotify* link. Before you share the app, add the official Spotify logo from https://developer.spotify.com/documentation/design next to that line. Don't redraw the logo.

## Files

```
index.html            markup (sign-in gate, deck, crate)
styles.css            the whole look
js/config.js          your Client ID + scopes
js/auth.js            PKCE sign-in and token refresh
js/api.js             Web API calls
js/app.js             player logic, Playback SDK, polling, UI
js/demo.js            fake tracks for ?demo=1
sw.js, manifest.webmanifest, icons/   PWA bits
```
