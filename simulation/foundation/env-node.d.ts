// simulation/foundation/env-node.d.ts
//
// Ambient `NODE_ENV` declaration for the Node/Electron programs: the root
// tsconfig (electron, simulation, ai, games, networking, tools, e2e), plus
// `electron/tsconfig.json` and `electron/tsconfig.build.json`, which list this
// file explicitly because their `include` is package-relative and would
// otherwise miss it (see the note there).
//
// Optional on purpose: a plain `electron .` or `node` launch leaves NODE_ENV
// unset, so the type must admit `undefined`. Compare with inequality
// (`!== 'production'` / `=== 'production'`); never narrow exhaustively over
// the three literals — the absent case is real.
//
// The renderer program must NOT include this file: there
// `next/types/global.d.ts` declares NODE_ENV as required (the Next runtime
// guarantees a value), and merging the two mismatched declarations is a
// compile error — which is exactly the guard against accidental inclusion.

declare namespace NodeJS {
    interface ProcessEnv {
        readonly NODE_ENV?: 'development' | 'production' | 'test';
    }
}
