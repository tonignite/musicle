/** Centralized runtime config, sourced from env (loaded via node --env-file). */

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
    redirectUri:
      process.env.SPOTIFY_REDIRECT_URI ?? 'http://localhost:3000/auth/spotify/callback',
    scopes: [
      'user-library-read',
      'playlist-read-private',
      'playlist-read-collaborative',
    ],
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
