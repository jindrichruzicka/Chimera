/**
 * ESLint fixture: a raw `console.*` call from an electron/main module.
 *
 * Invariant #67 forbids this — structured logging flows through the injected
 * `Logger`. Lints as an error via the `no-console` zone in eslint.config.mjs;
 * asserted by eslint-no-console.test.ts. Never imported by production code.
 */
export function reportSomething(message: string): void {
    console.log(message);
}
