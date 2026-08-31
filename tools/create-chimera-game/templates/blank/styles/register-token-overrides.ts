// Side-effect module: importing it installs this game's `--ch-*` token
// overrides. A module of its own rather than a bare `import` at each site, so
// every surface that needs the tokens before it renders names the SAME import
// and the bundler dedupes it to one stylesheet.
//
// Without it `tokens-override.css` is inert — nothing in a Next app loads a
// stylesheet no module imports — and the file reads as a working theme while
// changing nothing. `renderer/loaders.ts` awaits this module as the first thing
// the shell loader does; awaited, not fire-and-forget, because the shell renders
// as soon as that loader resolves and tokens installed after first paint are a
// visible flash of the engine defaults.
import './tokens-override.css';
