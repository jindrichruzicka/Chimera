// The `?raw` CSS import form, for tests that need a stylesheet's TEXT rather
// than its class-name map. jsdom applies no bundler transform and computes no
// layout, so a click-through assertion has to inject the real rules into the
// document and let `getComputedStyle` resolve the cascade — which needs the
// source, not the hashed names `*.module.css` hands back.
//
// Mirrors `apps/tactics/raw-css.d.ts` and `renderer/types/raw-css.d.ts`; the
// vitest side of it is the `chimera-css-raw` plugin in `vitest.config.mts`.
declare module '*.css?raw' {
    const content: string;
    export default content;
}
