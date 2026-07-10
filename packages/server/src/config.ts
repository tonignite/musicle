/** Centralized runtime config, sourced from env (loaded via node --env-file). */

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
    // Spotify requires HTTPS or a loopback IP; plain "localhost" is rejected.
    redirectUri:
      process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:3000/auth/spotify/callback',
    scopes: [
      'user-library-read',
      'playlist-read-private',
      'playlist-read-collaborative',
    ],
  },

  tidal: {
    clientId: process.env.TIDAL_CLIENT_ID ?? '',
    clientSecret: process.env.TIDAL_CLIENT_SECRET ?? '',
    redirectUri:
      process.env.TIDAL_REDIRECT_URI ?? 'http://127.0.0.1:3000/auth/tidal/callback',
    // Tidal's catalog is region-scoped; collection reads require a country code.
    countryCode: process.env.TIDAL_COUNTRY_CODE ?? 'US',
    scopes: ['user.read', 'collection.read', 'playlists.read'],
  },

  /** How many tracks to pull/match per player when building their library. */
  libraryTargetSize: Number(process.env.LIBRARY_TARGET_SIZE ?? 120),

  /**
   * Where to send the browser after a successful link. For the Flutter app
   * this is a custom-scheme deep link (e.g. musicle://linked). Empty => show a
   * plain HTML success page instead (useful during backend-only testing).
   */
  appReturnUrl: process.env.APP_RETURN_URL ?? '',
} as const;

export function spotifyConfigured(): boolean {
  return Boolean(config.spotify.clientId && config.spotify.clientSecret);
}

export function tidalConfigured(): boolean {
  return Boolean(config.tidal.clientId && config.tidal.clientSecret);
}
