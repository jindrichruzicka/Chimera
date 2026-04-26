import { useMemo } from 'react';
import type { GameAPI, LogsAPI, PlayerId } from '@chimera/electron/preload/api-types.js';
import type { LogEntry, LogErrorInfo } from '@chimera/shared/logging.js';

interface ChimeraBridge {
    readonly __chimera?: {
        readonly game?: GameAPI;
        readonly logs?: LogsAPI;
    };
}

export interface SeatSwitchBridge {
    readonly game: GameAPI;
    readonly logs: LogsAPI;
}

export interface SeatSwitchApi {
    switchSeat(playerId: PlayerId): Promise<void>;
}

const MISSING_BRIDGE_ERROR = 'Chimera API not available';

function now(): number {
    return Date.now();
}

function toErrorInfo(error: unknown): LogErrorInfo {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            ...(error.stack !== undefined && { stack: error.stack }),
        };
    }

    return {
        name: 'UnknownError',
        message: String(error),
    };
}

function makeSeatSwitchFailureEntry(playerId: PlayerId, error: unknown): LogEntry {
    return {
        level: 'error',
        message: 'Failed to switch active seat',
        timestamp: now(),
        source: {
            process: 'renderer',
            module: 'seat-switcher',
        },
        context: {
            playerId,
        },
        error: toErrorInfo(error),
    };
}

export function getSeatSwitchBridge(source: unknown = globalThis): SeatSwitchBridge | null {
    const bridge = source as ChimeraBridge;

    if (!bridge.__chimera?.game || !bridge.__chimera.logs) {
        return null;
    }

    return {
        game: bridge.__chimera.game,
        logs: bridge.__chimera.logs,
    };
}

export function useSeatSwitch(): SeatSwitchApi {
    return useMemo(
        () => ({
            async switchSeat(playerId: PlayerId): Promise<void> {
                const bridge = getSeatSwitchBridge();
                if (bridge === null) {
                    throw new Error(MISSING_BRIDGE_ERROR);
                }

                try {
                    await bridge.game.switchActiveSeat(playerId);
                } catch (error) {
                    bridge.logs.emit(makeSeatSwitchFailureEntry(playerId, error));
                }
            },
        }),
        [],
    );
}
