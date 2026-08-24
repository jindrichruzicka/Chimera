/**
 * renderer/audio/index.ts
 *
 * Public audio barrel (`@chimera-engine/renderer/audio`).
 *
 * The reachability half of the cue/fade/crossfade design (§4.25). The verbs
 * themselves landed on `AudioManager`, but a game surface may
 * name only a public barrel (Invariant #96), and there was none for audio — so
 * `useSound` and `useMusicTrack` were unreachable from `apps/<game>/` and the
 * feature had no adopter. This barrel is that subpath.
 *
 * What it exports is the calling surface and nothing else: the hooks a game uses
 * (`useSound` to start a voice, `useMusicTrack` for the live-handle verbs,
 * `useAudioCues` to observe a voice's playhead, `useSpatialAudio` for the listener
 * pose and moving sources, `useAudioManager` for
 * the manager itself — Invariant #84 makes the context hook the only sanctioned way
 * to reach it), the provider those hooks read from, the two exported
 * constants a caller names (`MUSIC_PRIORITY`, `DEFAULT_FADE_CURVE`), the pure helper
 * that spells a musical interval as a `PlayOptions.rate` (`rateFromSemitones`), and
 * the option and handle types the calls take. `AudioManagerProvider` is here because a
 * hook a game may call is only half of what the game needs: its component tests
 * have to mount something that satisfies the hook, and without a provider the game
 * would be forced back onto the internal context object. The app root mounts the
 * one live provider; a game mounts its own only over a double.
 *
 * Everything else in `renderer/audio/` stays internal, by rule rather than by list:
 * what is not re-exported below is not reachable, so there is nothing here to keep
 * current.
 *
 * Re-export only: importing this barrel mounts nothing and starts no voice. It is
 * not import-inert the way `components/ui` is: `AudioBus` reads the bus volumes from
 * `settingsStore`, whose module-level singleton is eager, so importing this barrel
 * CONSTRUCTS that store. (The chat barrel carries stores too but creates them
 * lazily, so the comparison holds only at the graph level, not at evaluation.)
 * `__tests__/audio-barrel-side-effects.test.ts` pins that the settings store is the
 * only one it reaches, and the exported symbol set alongside it.
 */

export { useSound } from './useSound';
export { useMusicTrack, type AudioTrackControls } from './useMusicTrack';
export { useAudioCues } from './useAudioCues.js';
export { useSpatialAudio, type SpatialAudioControls } from './useSpatialAudio';
export { useAudioManager } from './AudioManagerContext.js';
export { AudioManagerProvider, type AudioManagerProviderProps } from './AudioManagerProvider.js';

export {
    MUSIC_PRIORITY,
    DEFAULT_FADE_CURVE,
    type AudioBusId,
    type AudioHandle,
    type AudioManager,
    type PlayOptions,
} from './AudioManager';

// Public because the per-play variation it serves is the GAME's to author: a game
// whose repeated SFX read as one sample twice authors the interval itself and hands
// it in as a rate.
export { rateFromSemitones } from './rate.js';

export type {
    Cue,
    CrossfadeOptions,
    CueAlignedCrossfadeOptions,
    CueAlignedFadeOutSpec,
    FadeCurve,
    FadeInSpec,
    FadeOutSpec,
    FadeToSpec,
    LoopRegion,
} from './Cue';

// The cue OBSERVATION surface: what a handler is handed, and the record it goes in.
// The three event shapes are exported alongside their union because the union alone
// cannot annotate one handler — a game extracting `onCue` into a named function would
// otherwise have to reach for `Extract<CueEvent, { kind: 'cue' }>`, which is not an API.
// The scheduler behind them stays internal: a game observes cues, it does not step them.
export type {
    CueCrossedEvent,
    CueEndEvent,
    CueEvent,
    CueHandlers,
    CueLoopEvent,
} from './cueMarkerScheduler.js';

// The spatial OPTION surface only. The resolution internals (`resolveSpatialSpec`,
// the resolved-spec shapes, the defaults and the hard-cutoff epsilon) stay behind
// the barrel: a game authors options, and the panner vocabulary is the engine's.
export type {
    AudioListenerPose,
    AudioPosition,
    DistanceFalloff,
    SetListenerOptions,
    SetVoicePositionOptions,
    SpatialOptions,
} from './Spatial';
