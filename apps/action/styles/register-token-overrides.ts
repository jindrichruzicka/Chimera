// Side-effect module: importing it installs the action app's `--ch-*` token
// overrides. Kept as its own module (rather than a bare `import` at each site)
// so every surface that needs the tokens before it renders names the SAME
// import, and the bundler dedupes it to one stylesheet.
import './tokens-override.css';
