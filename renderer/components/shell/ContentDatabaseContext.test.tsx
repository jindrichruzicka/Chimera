// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useContentDatabase } from './ContentDatabaseContext.js';

afterEach(() => {
    cleanup();
});

describe('ContentDatabaseContext', () => {
    it('throws a descriptive error when used outside GameShell', () => {
        function Consumer(): React.ReactElement {
            useContentDatabase();
            return <div />;
        }

        expect(() => render(<Consumer />)).toThrow(
            'useContentDatabase() must be used inside <GameShell>.',
        );
    });
});
