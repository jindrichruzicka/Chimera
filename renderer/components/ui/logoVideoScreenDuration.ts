// Watchdog safety net for a stalled logo-video load — the video's `ended`
// event is the primary exit, but the timeout hard-truncates playback, so it
// must exceed the shipped cut's length. tools/logo-asset-budget.test.ts locks
// the committed brand video against this cap; a plain .ts module (not the
// component .tsx) so the jsx-less root tools project can import it.
export const LOGO_VIDEO_DEFAULT_DURATION_MS = 10_000;
