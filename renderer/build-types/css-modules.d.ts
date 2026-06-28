// Build-only ambient declaration for the @chimera-engine/renderer dist build (issue #773).
//
// The standalone `tsc -p tsconfig.build.json` build compiles the component barrels
// WITHOUT the Next.js language-service plugin and WITHOUT `next-env.d.ts` /
// `.next/types` in its program, so it loses the `*.module.css` module typing Next
// provides — every `import styles from './Foo.module.css'` would otherwise be a
// TS2307. This ambient restores it for the build program only.
//
// It lives in its own `build-types/` directory (excluded from renderer/tsconfig.json)
// rather than `renderer/types/` so it never enters the renderer's own
// `tsc --noEmit -p renderer` program alongside Next's identical declaration.
declare module '*.module.css' {
    const classes: { readonly [key: string]: string };
    export default classes;
}
