/**
 * apps/action/e2e/helpers/action-snapshot.ts
 *
 * Reads the ARENA out of the projected `PlayerSnapshot` the running renderer
 * holds, so a spec can assert where a primitive is without looking at pixels.
 *
 * Why the snapshot and not the canvas: a primitive's position is a WebGL
 * transform, which the DOM cannot see at all, and a pixel probe of a small
 * shaded mesh answers "something moved" rather than "it is at cell (−3, 0)".
 * The snapshot is the same record the playfield renders from, so what this reads
 * is what is on screen.
 *
 * NOT A CLOCK, though. What the bridge answers with is the last snapshot the
 * host actually SENT, and a beat that changed nothing takes the engine's
 * clock-only path — the renderer's tick advances while no new snapshot is
 * broadcast. So `tick` is deliberately not read here: the live clock is the HUD's
 * own readout (`ActionMatchPage.hudTick`), and a spec that wants to let time pass
 * waits on that.
 *
 * The narrowing goes through the app's OWN `isActionPrimitiveEntity` — the guard
 * the reducers and the scene model use — so a record this suite accepts is a
 * record the simulation would accept. The guard runs in the RUNNER, over the
 * plain JSON `page.evaluate` returns; nothing of this module is shipped into the
 * page except the bridge read itself.
 *
 * Module boundary: `@playwright/test` types and this app's own game-core
 * modules. Must NOT import from electron/main/, renderer/ or another app.
 */

import type { Page } from '@playwright/test';
import type { BaseEntityState } from '@chimera-engine/simulation/engine/types.js';
import { isActionPrimitiveEntity } from '@chimera-engine/action/simulation/entity-guards.js';

/** One primitive, as this suite reads it off the projection. */
export interface ActionPrimitiveProjection {
    readonly id: string;
    readonly shape: string;
    readonly x: number;
    readonly y: number;
    readonly dx: number;
    readonly dy: number;
    readonly ownerId: string | null;
}

/** An arena cell — the pair a movement assertion compares. */
export interface ActionCell {
    readonly x: number;
    readonly y: number;
}

/** The host-authored setup the quick start wrote, as projected to this seat. */
export interface ActionSetupProjection {
    readonly gameParams: Readonly<Record<string, string>>;
    readonly playerAttributes: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

interface SnapshotProjection {
    readonly viewerId?: unknown;
    readonly tick?: unknown;
    readonly entities?: unknown;
    readonly setup?: unknown;
}

/**
 * The raw projected snapshot, or `null` while the bridge or the session is
 * absent. `null` rather than a throw: every caller polls, and a match that has
 * not started yet is the ordinary case rather than a failure.
 */
async function readSnapshot(page: Page): Promise<SnapshotProjection | null> {
    const snapshot = await page.evaluate(async () => {
        const gameApi = (
            globalThis as {
                readonly __chimera?: {
                    readonly game?: { readonly getCurrentSnapshot?: () => Promise<unknown> };
                };
            }
        ).__chimera?.game;

        if (typeof gameApi?.getCurrentSnapshot !== 'function') {
            return null;
        }
        return gameApi.getCurrentSnapshot();
    });

    // No assertion: every field of `SnapshotProjection` is optional `unknown`,
    // so a non-null object already satisfies it — and each reader below narrows
    // the field it wants rather than trusting the shape.
    return typeof snapshot === 'object' && snapshot !== null ? snapshot : null;
}

/**
 * Every primitive the viewer can see, sorted by entity id.
 *
 * Sorted so a comparison between two reads is a comparison of the arena rather
 * than of whatever order the record arrived in. Empty while no match is live.
 */
export async function readActionPrimitives(page: Page): Promise<ActionPrimitiveProjection[]> {
    const snapshot = await readSnapshot(page);
    const entities = snapshot?.entities;
    if (typeof entities !== 'object' || entities === null) {
        return [];
    }

    const primitives: ActionPrimitiveProjection[] = [];
    for (const record of Object.values(entities as Record<string, unknown>)) {
        // Cast to the guard's own parameter type and let the GUARD do the
        // narrowing: the app's own predicate, so a malformed record is refused
        // here exactly as a reducer would refuse it — never coerced into a cell
        // at NaN.
        const entity = record as BaseEntityState | undefined;
        if (!isActionPrimitiveEntity(entity)) {
            continue;
        }
        primitives.push({
            id: entity.id,
            shape: entity.shape,
            x: entity.x,
            y: entity.y,
            dx: entity.dx,
            dy: entity.dy,
            ownerId: entity.ownerId,
        });
    }

    primitives.sort((left, right) => left.id.localeCompare(right.id));
    return primitives;
}

/** The primitive `seatId` drives, or `null` while that seat drives none. */
export async function readSeatPrimitive(
    page: Page,
    seatId: string,
): Promise<ActionPrimitiveProjection | null> {
    return (await readActionPrimitives(page)).find((one) => one.ownerId === seatId) ?? null;
}

/** Just the cell, for a poll that compares positions. */
export function cellOf(primitive: ActionPrimitiveProjection | null): ActionCell | null {
    return primitive === null ? null : { x: primitive.x, y: primitive.y };
}

/** The seat this window plays, or `null` while no match is live. */
export async function readViewerId(page: Page): Promise<string | null> {
    const viewerId = (await readSnapshot(page))?.viewerId;
    return typeof viewerId === 'string' ? viewerId : null;
}

/** The host-authored setup, or `null` while no match is live. */
export async function readActionSetup(page: Page): Promise<ActionSetupProjection | null> {
    const setup = (await readSnapshot(page))?.setup;
    if (typeof setup !== 'object' || setup === null) {
        return null;
    }
    const record = setup as { gameParams?: unknown; playerAttributes?: unknown };
    if (typeof record.gameParams !== 'object' || record.gameParams === null) return null;
    if (typeof record.playerAttributes !== 'object' || record.playerAttributes === null)
        return null;
    return setup as ActionSetupProjection;
}
