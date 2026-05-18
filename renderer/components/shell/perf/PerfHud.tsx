'use client';

/**
 * renderer/components/shell/perf/PerfHud.tsx
 *
 * Floating performance metrics overlay (§4.16).
 *
 * Architecture reference: §4.16 — Performance HUD
 * Issue: #583
 *
 * Visibility:
 *  - Toggled by F3 (engine:toggle-perf-hud InputAction) OR
 *  - Force-visible when engine.gameplay.showPerfHud === true in settings.
 *  - Off by default in production.
 *
 * Rules:
 *  - 'use client' — renderer component.
 *  - Named export only (§coding-standards §8.3).
 *  - useInputAction must be called before any conditional return (React hooks rules).
 *  - No imports from simulation/, electron/main/, ai/, or games/* (module boundary §3).
 *  - All visual values use var(--ch-*) design tokens (invariants #86, #91).
 */

import React, { useCallback } from 'react';

import type { InputEvent } from '@chimera/renderer/input/InputAction.js';
import { useInputAction } from '@chimera/renderer/input/useInputAction.js';
import { useSettingsStore } from '@chimera/renderer/state/settingsStore.js';
import { usePerfStore } from './perfStore.js';

// ── FPS colour threshold helper ───────────────────────────────────────────────

function fpsStatus(fps: number): 'good' | 'warn' | 'bad' {
    if (fps >= 55) return 'good';
    if (fps >= 30) return 'warn';
    return 'bad';
}

// ── Null display helper ───────────────────────────────────────────────────────

function fmt(value: number | null, suffix = ''): string {
    if (value === null) return '—';
    return `${value.toFixed(1)}${suffix}`;
}

function fmtInt(value: number | null, suffix = ''): string {
    if (value === null) return '—';
    return `${Math.round(value)}${suffix}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PerfHud(): React.ReactElement | null {
    // ── Read metrics with narrow selectors ───────────────────────────────────
    const fps = usePerfStore((s) => s.sample.fps);
    const frameMsAvg = usePerfStore((s) => s.sample.frameMsAvg);
    const frameMsP95 = usePerfStore((s) => s.sample.frameMsP95);
    const simTick = usePerfStore((s) => s.sample.simTick);
    const actionsPerSec = usePerfStore((s) => s.sample.actionsPerSec);
    const actionRoundTripMs = usePerfStore((s) => s.sample.actionRoundTripMs);
    const pingMs = usePerfStore((s) => s.sample.pingMs);
    const heapMb = usePerfStore((s) => s.sample.heapMb);
    const drawCalls = usePerfStore((s) => s.sample.drawCalls);
    const triangles = usePerfStore((s) => s.sample.triangles);
    const visible = usePerfStore((s) => s.visible);

    // ── Settings: force-visible flag ──────────────────────────────────────────
    const settingsShowPerfHud = useSettingsStore((state) => {
        const gameId = state.activeGameId ?? '__engine__';
        const s = state.settings[gameId] as Record<string, unknown> | undefined;
        const gameplay = s?.['gameplay'] as Record<string, unknown> | undefined;
        return (gameplay?.['showPerfHud'] as boolean | undefined) ?? false;
    });

    // ── F3 toggle — must be called unconditionally (React hooks rules) ────────
    const handleToggle = useCallback((_event: InputEvent) => {
        usePerfStore.getState().toggle();
    }, []);

    useInputAction('engine:toggle-perf-hud', handleToggle);

    // ── Visibility gate ───────────────────────────────────────────────────────
    const shouldShow = visible || settingsShowPerfHud;
    if (!shouldShow) {
        return null;
    }

    // ── Computed values ───────────────────────────────────────────────────────
    const fpsStat = fpsStatus(fps);

    // ── Overlay styles (all via design tokens) ────────────────────────────────
    const overlayStyle: React.CSSProperties = {
        position: 'fixed',
        top: 'var(--ch-space-sm)',
        right: 'var(--ch-space-sm)',
        zIndex: 'var(--ch-z-tooltip)',
        background: 'var(--ch-color-surface-overlay)',
        border: 'var(--ch-border-width-sm) solid var(--ch-color-border)',
        borderRadius: 'var(--ch-radius-md)',
        padding: 'var(--ch-space-sm) var(--ch-space-md)',
        fontFamily: 'var(--ch-font-mono)',
        fontSize: 'var(--ch-font-size-sm)',
        color: 'var(--ch-color-text-primary)',
        boxShadow: 'var(--ch-shadow-md)',
        lineHeight: '1.6',
        pointerEvents: 'none',
        userSelect: 'none',
    };

    return (
        <div data-testid="perf-hud" style={overlayStyle}>
            <div data-testid="perf-fps" data-status={fpsStat}>
                FPS: {Math.round(fps)}
            </div>
            <div data-testid="perf-frame-ms-avg">Frame avg: {fmt(frameMsAvg, ' ms')}</div>
            <div data-testid="perf-frame-ms-p95">Frame p95: {fmt(frameMsP95, ' ms')}</div>
            <div data-testid="perf-sim-tick">Sim tick: {simTick}</div>
            <div data-testid="perf-actions-sec">Actions/s: {Math.round(actionsPerSec)}</div>
            <div data-testid="perf-action-rtt">Action RTT: {fmtInt(actionRoundTripMs, ' ms')}</div>
            <div data-testid="perf-ping">Ping: {fmtInt(pingMs, ' ms')}</div>
            <div data-testid="perf-heap">Heap: {fmt(heapMb, ' MB')}</div>
            <div data-testid="perf-draw-calls">Draw calls: {drawCalls}</div>
            <div data-testid="perf-triangles">Triangles: {triangles}</div>
        </div>
    );
}
