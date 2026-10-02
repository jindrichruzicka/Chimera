/**
 * environment-map.spec.ts
 * §4.10 — image-based lighting, resolved through the manifest and rendered
 * offline.
 *
 * TWO claims, and the second is the one the feature exists for.
 *
 * THE HDRI REACHES THE SCREEN. The menu's mirror ball is a `meshStandardMaterial`
 * at full metalness, so it has no diffuse term: with no environment map it
 * renders near-black under any number of lights, and what it shows IS the sky.
 * The sky is green, and nothing else in the action arena is — amber, sky-blue
 * and slate primitives on a near-black floor — so green pixels on screen came
 * from a decoded, uploaded, pre-filtered HDRI and from nothing else. That is
 * what makes ONE frame enough, with no before-and-after to arrange.
 *
 * NOTHING WAS FETCHED FROM OUTSIDE. The offline path is the reason this asset
 * kind exists rather than a CDN preset, so "it renders" is only half the claim:
 * a spec that checked pixels alone would pass just as happily with a download
 * quietly succeeding on a developer's machine. The main process records the URLs
 * its session requests, and the spec asserts each one used a local scheme. The
 * recorder is installed from HERE rather than shipped: nothing test-only belongs
 * in the main process.
 *
 * WHAT THE RECORDER CANNOT SEE. It is attached from the spec, so it starts after
 * the app has booted. This test does not take the `mainWindow` fixture, which
 * resolves only once the document has reached `domcontentloaded`; it attaches
 * first and waits for the window after, which is as early as a spec can reach and
 * still not the whole of startup. What it covers is every request from that point
 * on, which is where an environment map's fetch would live.
 *
 * The recorder has a positive control of its own. A list of zero outbound
 * requests is equally consistent with a recorder that was never wired, so the
 * spec asserts it saw the app's own traffic too — otherwise the strongest claim
 * here would be the easiest one to pass by accident.
 */

import { expect, test } from '../fixtures/electron.fixture';
import { openE2eWindow } from '../fixtures/open-window';
import { decodePngToRgbaFrame } from '../../../../tools/e2e/canvas-frames';
import { countLitGreen } from '../helpers/canvas-hues';
import { SHELL_LOAD_TIMEOUT_MS } from '../helpers/enter-match';
import { ActionShellBackgroundPage } from '../pages/ActionShellBackgroundPage';

test.use({ actionPort: '7821' });

/** Where the main-process recorder parks the URLs it saw. */
const REQUEST_LOG_KEY = '__chimeraEnvironmentMapRequests';

/**
 * How many green pixels mean "the ball is reflecting the sky".
 *
 * Measured on this scene: the reflection covers about 13,000 pixels, and the
 * brightest green anywhere else in the frame falls below the classifier's
 * brightness floor entirely. A quarter of the measurement leaves room for a
 * different viewport without admitting a stray element.
 */
const MIN_REFLECTED_PIXELS = 3_000;

/** The budget for the deferred sky to load and the ball to appear. */
const REFLECTION_TIMEOUT_MS = 40_000;

/** Schemes the app serves itself from. Anything else left the machine. */
const LOCAL_SCHEMES: ReadonlySet<string> = new Set(['chimera', 'data', 'blob', 'devtools']);

test.describe('Action environment map', () => {
    test('reflects a manifest-declared HDRI on a PBR material, with no outbound request', async ({
        electronApp,
    }) => {
        test.slow();

        // Attached before this spec waits for the window, rather than taking
        // the `mainWindow` fixture — that one resolves only once the document has
        // reached `domcontentloaded`, which would put every resource the page
        // pulls on the way up outside the recording.
        await electronApp.evaluate(({ session }, key) => {
            const host = globalThis as unknown as Record<string, string[]>;
            host[key] = [];
            session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
                host[key]?.push(details.url);
                callback({});
            });
        }, REQUEST_LOG_KEY);

        const mainWindow = await openE2eWindow(electronApp);

        const background = new ActionShellBackgroundPage(mainWindow);
        await background.waitForGameBackground(SHELL_LOAD_TIMEOUT_MS);

        let counts = { green: 0, visible: 0 };
        await expect
            .poll(
                async () => {
                    const shot = await background.scene.screenshot({ type: 'png' });
                    counts = countLitGreen(decodePngToRgbaFrame(shot));
                    return counts.green;
                },
                { timeout: REFLECTION_TIMEOUT_MS },
            )
            .toBeGreaterThan(MIN_REFLECTED_PIXELS);

        const requested: string[] = await electronApp.evaluate(
            (_electron, key) => (globalThis as unknown as Record<string, string[]>)[key] ?? [],
            REQUEST_LOG_KEY,
        );

        // The control: a recorder that never fired would report no outbound
        // request just as convincingly as an app that made none.
        expect(requested.length).toBeGreaterThan(0);
        expect(
            requested.filter((url) => !LOCAL_SCHEMES.has(url.split(':')[0] ?? '')),
            `outbound requests among the ${requested.length} recorded`,
        ).toEqual([]);

        // And the sky specifically came from the app's own protocol, so the
        // pixels above are this manifest's asset rather than some other green.
        expect(requested).toContain(
            'chimera://renderer/game-assets/action/environment/menu-sky.hdr',
        );
    });
});
