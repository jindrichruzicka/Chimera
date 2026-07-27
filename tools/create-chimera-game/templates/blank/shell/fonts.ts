import type { GameFontFace } from '@chimera-engine/simulation/foundation/game-shell-contract.js';

// Self-hosted game fonts (Invariant #97): committed `.woff2` files under
// `assets/fonts/`, never an external URL. Populate by running the app's
// `fetch:fonts` script (replace `<google-css-url>` in package.json first) and
// pasting the snippet it prints; the downloads land in `assets/fonts/`.
export const gameFonts: readonly GameFontFace[] = [];
