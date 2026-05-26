export type LobbyEntryTabId = 'host' | 'join';

export type PendingAction =
    | 'hosting'
    | 'joining'
    | 'leaving'
    | 'starting'
    | 'updating-ready'
    | null;
