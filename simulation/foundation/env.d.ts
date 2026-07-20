// simulation/foundation/env.d.ts
//
// Ambient declaration for the debug flag, read by TWO sites that must both keep
// dot access: `IS_DEBUG_MODE` in `simulation/foundation/constants.ts`, and the
// character-identical inlined copy that gates the debug bridge in
// `electron/main/index.ts`. `noPropertyAccessFromIndexSignature` forbids dot
// access on index-signature-only properties, but both need it so bundler
// `define` replacement can inline them at build time (Invariant #27) — the gate
// is inlined precisely because esbuild cannot fold the imported constant.
//
// NOTE: `NODE_ENV` is deliberately NOT declared here. This file is pulled into
// three programs, and they need different shapes:
//   - root program → `simulation/foundation/env-node.d.ts` (optional; may be unset at runtime)
//   - renderer program → `next/types/global.d.ts` (required; Next guarantees it)
//   - `electron/tsconfig.json` + `tsconfig.build.json` list this file explicitly,
//     because their `include` is package-relative and would otherwise miss it
//     (see the note there); they take the root/Node shape.

declare namespace NodeJS {
    interface ProcessEnv {
        /** `'1'` enables the runtime debug layer outside production (§4.12). */
        readonly CHIMERA_DEBUG?: string;
    }
}
