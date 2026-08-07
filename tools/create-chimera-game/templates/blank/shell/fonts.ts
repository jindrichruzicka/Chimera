import type { GameFontFace } from '@chimera-engine/simulation/foundation/game-shell-contract.js';

// Self-hosted game fonts: committed `.woff2` files under
// `assets/fonts/`, never an external URL. Populate by running
// `pnpm fetch:fonts --url "<google fonts css url>"` from the project root and
// pasting the snippet it prints; the downloads land in `assets/fonts/`.
export const gameFonts: readonly GameFontFace[] = [];
