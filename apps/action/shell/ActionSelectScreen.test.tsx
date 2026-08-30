// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getShellState, setShellDraft } from '@chimera-engine/renderer/game';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import { InputManagerProvider, type InputManager } from '@chimera-engine/renderer/input';
import type { InputActionId, InputEvent } from '@chimera-engine/renderer/input';

import { actionBundleEn } from './translations/en.js';
import screenCss from './ActionSelectScreen.module.css?raw';
import screenStyles from './ActionSelectScreen.module.css';
import { ActionSelectScreen } from './ActionSelectScreen';

// The two engine verbs this page drives. Doubled rather than mocked away
// wholesale: `useShellState` / `setShellDraft` / `getShellState` stay REAL, so
// every draft assertion below runs against the store the background reads.
const quickStart = vi.hoisted(() => ({ start: vi.fn(async () => {}) }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@chimera-engine/renderer/game', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        useQuickStart: () => quickStart,
        useShellNavigate: () => navigate,
    };
});

// ── An InputManager double that lets a test push key events ──────────────────

type Subscribers = Map<InputActionId, Set<(event: InputEvent) => void>>;

let subscribers: Subscribers;
let inputManager: InputManager;

function makeInputManagerDouble(): InputManager {
    return {
        onAction: vi.fn((id: InputActionId, callback: (event: InputEvent) => void) => {
            const forId = subscribers.get(id) ?? new Set();
            forId.add(callback);
            subscribers.set(id, forId);
            return () => {
                forId.delete(callback);
            };
        }),
        isPressed: vi.fn(() => false),
        rebind: vi.fn(),
        getBindings: vi.fn(() => ({})),
        dispose: vi.fn(),
    } as unknown as InputManager;
}

function fireInput(id: InputActionId, pressed = true): void {
    act(() => {
        for (const callback of subscribers.get(id) ?? []) {
            callback({
                actionId: id,
                code: 'Key',
                modifiers: [],
                repeat: false,
                pressed,
                timestamp: 0,
            });
        }
    });
}

/** Clear the two draft fields this page writes, so each case starts empty. */
function resetDraft(): void {
    setShellDraft({ hostAttributes: {}, localSeats: [] });
}

function renderPage(): void {
    render(
        <I18nProvider gameOverride={actionBundleEn}>
            <InputManagerProvider inputManager={inputManager}>
                <ActionSelectScreen />
            </InputManagerProvider>
        </I18nProvider>,
    );
}

const hostPick = (): string | undefined => getShellState().draft.hostAttributes?.['primitive'];
const secondSeat = (): Readonly<Record<string, string>> | undefined =>
    getShellState().draft.localSeats?.[0]?.attributes;

beforeEach(() => {
    subscribers = new Map();
    inputManager = makeInputManagerDouble();
    resetDraft();
    quickStart.start.mockReset();
    quickStart.start.mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetDraft();
});

describe('ActionSelectScreen — the draft', () => {
    it('lands the default pick in the draft on mount', () => {
        // What the player sees ringed has to be what the match receives; a page
        // that only DISPLAYED a default would start the match on nothing.
        renderPage();

        expect(hostPick()).toBe('cube');
    });

    it('leaves an existing pick alone on mount', () => {
        // A trip through Settings and back remounts this page. Re-writing the
        // default there would throw away the pick the player made.
        setShellDraft({ hostAttributes: { primitive: 'cone' } });

        renderPage();

        expect(hostPick()).toBe('cone');
    });

    it('shows which shape each seat drives', () => {
        setShellDraft({
            hostAttributes: { primitive: 'sphere' },
            localSeats: [{ attributes: { primitive: 'cone', control: 'wasd' } }],
        });

        renderPage();

        expect(screen.getByTestId('action-select-host-pick')).toHaveTextContent('sphere');
        expect(screen.getByTestId('action-select-second-pick')).toHaveTextContent('cone');
    });

    it('names no second pick while the seat is closed', () => {
        renderPage();

        expect(screen.queryByTestId('action-select-second-pick')).not.toBeInTheDocument();
    });
});

describe('ActionSelectScreen — pre-match input', () => {
    it('steps the host ring RIGHT on the movement action, before any match exists', () => {
        renderPage();

        fireInput('game:move-right');

        expect(hostPick()).toBe('sphere');
    });

    it('steps the host ring LEFT, wrapping onto the last shape', () => {
        renderPage();

        fireInput('game:move-left');

        expect(hostPick()).toBe('cone');
    });

    it('steps once per tap, not once per edge', () => {
        // The input layer dispatches on key down AND key up; a handler that
        // ignored `pressed` would move the ring twice for one press.
        renderPage();

        fireInput('game:move-right', true);
        fireInput('game:move-right', false);

        expect(hostPick()).toBe('sphere');
    });

    it('subscribes only the horizontal actions of each cluster', () => {
        // The three primitives sit in ONE row; subscribing up/down would claim a
        // second axis the row does not have.
        renderPage();

        expect([...subscribers.keys()].sort()).toEqual([
            'game:move-left',
            'game:move-right',
            'game:p2-move-left',
            'game:p2-move-right',
        ]);
    });

    it('moves NOTHING on the second cluster while the seat is closed', () => {
        renderPage();

        fireInput('game:p2-move-right');

        expect(secondSeat()).toBeUndefined();
        expect(hostPick()).toBe('cube');
    });

    it('moves the SECOND ring on the WASD cluster once the seat is open', () => {
        renderPage();
        act(() => {
            screen.getByTestId('action-select-second-player').click();
        });
        expect(secondSeat()?.['primitive']).toBe('sphere');

        fireInput('game:p2-move-right');

        expect(secondSeat()?.['primitive']).toBe('cone');
        expect(hostPick()).toBe('cube');
    });

    it('steps a ring PAST the shape the other seat holds', () => {
        setShellDraft({
            hostAttributes: { primitive: 'cube' },
            localSeats: [{ attributes: { primitive: 'sphere', control: 'wasd' } }],
        });
        renderPage();

        fireInput('game:move-right');

        expect(hostPick()).toBe('cone');
    });
});

describe('ActionSelectScreen — the second player', () => {
    it('opens a WASD-marked seat on a free shape', () => {
        renderPage();

        act(() => {
            screen.getByTestId('action-select-second-player').click();
        });

        expect(secondSeat()).toEqual({ primitive: 'sphere', control: 'wasd' });
    });

    it('closes the seat again by emptying the list', () => {
        // An omitted key would leave the seat in the draft: `setShellDraft`
        // merges per key, so the match would still open two seats.
        renderPage();
        act(() => {
            screen.getByTestId('action-select-second-player').click();
        });

        act(() => {
            screen.getByTestId('action-select-second-player').click();
        });

        expect(getShellState().draft.localSeats).toEqual([]);
    });

    it('reflects a seat the draft already carries', () => {
        setShellDraft({ localSeats: [{ attributes: { primitive: 'cone', control: 'wasd' } }] });

        renderPage();

        expect(screen.getByTestId('action-select-second-player')).toBeChecked();
    });
});

describe('ActionSelectScreen — starting', () => {
    it('starts the DRAFT rather than a config of its own', () => {
        // `start()` reads the draft at call time; naming a config here would
        // restate the picks and let the two disagree.
        renderPage();

        screen.getByTestId('action-select-start').click();

        expect(quickStart.start).toHaveBeenCalledTimes(1);
        expect(quickStart.start).toHaveBeenCalledWith();
    });

    it('starts with the picks the page wrote', () => {
        renderPage();
        fireInput('game:move-right');

        screen.getByTestId('action-select-start').click();

        expect(hostPick()).toBe('sphere');
        expect(quickStart.start).toHaveBeenCalled();
    });

    it('tells the player when the start is refused', async () => {
        // Every refusal shape leaves the player on this page, so an unreported
        // rejection is a Start button that visibly does nothing.
        quickStart.start.mockRejectedValue(new Error('a session is already live'));
        renderPage();

        await act(async () => {
            screen.getByTestId('action-select-start').click();
            await Promise.resolve();
        });

        expect(screen.getByTestId('action-select-start-failed')).toBeInTheDocument();
    });

    it('says nothing about a failure that has not happened', () => {
        renderPage();

        screen.getByTestId('action-select-start').click();

        expect(screen.queryByTestId('action-select-start-failed')).not.toBeInTheDocument();
    });

    it('clears a previous failure when Start is pressed again', async () => {
        quickStart.start.mockRejectedValueOnce(new Error('refused'));
        renderPage();
        await act(async () => {
            screen.getByTestId('action-select-start').click();
            await Promise.resolve();
        });
        expect(screen.getByTestId('action-select-start-failed')).toBeInTheDocument();

        await act(async () => {
            screen.getByTestId('action-select-start').click();
            await Promise.resolve();
        });

        expect(screen.queryByTestId('action-select-start-failed')).not.toBeInTheDocument();
    });
});

describe('ActionSelectScreen — leaving', () => {
    it('returns to the main menu through the context-preserving hop', () => {
        // A bare `router.push('/main-menu')` would drop `?gameId=`, and the menu
        // would arrive with no game in context — no menu, no fonts, no
        // background.
        renderPage();

        screen.getByTestId('action-select-back').click();

        expect(navigate).toHaveBeenCalledWith('/main-menu');
    });
});

/**
 * The click-through construction this page owes under the game's
 * interactive-background opt-in (§4.37.9).
 *
 * jsdom performs no layout and ships no `document.elementFromPoint`, so nothing
 * here is a coordinate hit-test. What it does instead is resolve the real
 * cascade: the page's OWN stylesheet is injected with the CSS-module class names
 * substituted in from the module itself, and `getComputedStyle` — which honours
 * `<style>` rules, the child combinator and the inheritance of `pointer-events`
 * — answers for each element the page rendered. A typo in the selector, a wrong
 * property, or a class that never reaches the container each fail here. The
 * coordinate-level proof needs a real browser and a hit test, which nothing
 * here is.
 */
describe('ActionSelectScreen — the pass-through container', () => {
    let styleEl: HTMLStyleElement;

    beforeEach(() => {
        styleEl = document.createElement('style');
        styleEl.textContent = screenCss
            .replaceAll('.container', `.${screenStyles['container'] ?? 'container'}`)
            .replaceAll('.header', `.${screenStyles['header'] ?? 'header'}`)
            .replaceAll('.footer', `.${screenStyles['footer'] ?? 'footer'}`)
            .replaceAll('.picks', `.${screenStyles['picks'] ?? 'picks'}`)
            .replaceAll('.actions', `.${screenStyles['actions'] ?? 'actions'}`);
        document.head.appendChild(styleEl);
    });

    afterEach(() => {
        styleEl.remove();
    });

    const pointerEventsOf = (element: Element): string => getComputedStyle(element).pointerEvents;

    it('refuses pointer input on the container so a click reaches the scene behind it', () => {
        renderPage();

        expect(pointerEventsOf(screen.getByTestId('action-select-page'))).toBe('none');
    });

    it('restores pointer input on every direct child, so the controls stay usable', () => {
        // `> *` rather than a list of names, so whatever this page grows next is
        // clickable the day it is added.
        renderPage();

        const container = screen.getByTestId('action-select-page');
        expect(container.children.length).toBeGreaterThan(0);
        for (const child of container.children) {
            expect(pointerEventsOf(child), child.className).toBe('auto');
        }
    });

    it('leaves the controls themselves hit-testable through inheritance', () => {
        renderPage();

        expect(pointerEventsOf(screen.getByTestId('action-select-start'))).toBe('auto');
        expect(pointerEventsOf(screen.getByTestId('action-select-back'))).toBe('auto');
    });
});
