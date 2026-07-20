// simulation/foundation/env.d.ts
//
// Ambient declaration for the debug flag read by the foundation constants.
// `noPropertyAccessFromIndexSignature` forbids dot access on
// index-signature-only properties, but `IS_DEBUG_MODE` must use dot access
// (`process.env.CHIMERA_DEBUG`) so bundler `define` replacement can inline it
// at build time (Invariant #27).
//
// NOTE: `NODE_ENV` is deliberately NOT declared here. This file is included
// by both compile programs, and the two need different shapes:
//   - root program → `simulation/foundation/env-node.d.ts` (optional; may be unset at runtime)
//   - renderer program → `next/types/global.d.ts` (required; Next guarantees it)

declare namespace NodeJS {
    interface ProcessEnv {
        /** `'1'` enables the runtime debug layer outside production (§4.12). */
        readonly CHIMERA_DEBUG?: string;
    }
}
