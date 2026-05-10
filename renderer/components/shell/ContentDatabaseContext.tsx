'use client';

import React, { createContext, useContext, type ReactNode } from 'react';
import type { ContentDatabase } from '@chimera/simulation/content/index.js';

export const ContentDatabaseContext = createContext<ContentDatabase | null>(null);

export interface ContentDatabaseProviderProps {
    readonly value: ContentDatabase | null;
    readonly children: ReactNode;
}

export function ContentDatabaseProvider({
    value,
    children,
}: ContentDatabaseProviderProps): React.ReactElement {
    return (
        <ContentDatabaseContext.Provider value={value}>{children}</ContentDatabaseContext.Provider>
    );
}

export function useContentDatabase(): ContentDatabase {
    const ctx = useContext(ContentDatabaseContext);
    if (ctx === null) {
        throw new Error('useContentDatabase() must be used inside <MatchShell>.');
    }
    return ctx;
}
