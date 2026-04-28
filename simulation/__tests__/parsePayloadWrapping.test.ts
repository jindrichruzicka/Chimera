import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function countMatches(haystack: string, needle: string): number {
    let index = 0;
    let count = 0;

    while (true) {
        index = haystack.indexOf(needle, index);
        if (index === -1) {
            return count;
        }
        count += 1;
        index += needle.length;
    }
}

describe('parsePayload schema error wrapping location', () => {
    it('exists in exactly one place in simulation/engine', () => {
        const repoRoot = path.resolve(__dirname, '../..');
        const stateReducerSource = readFileSync(
            path.join(repoRoot, 'simulation/engine/StateReducer.ts'),
            'utf8',
        );
        const actionPipelineSource = readFileSync(
            path.join(repoRoot, 'simulation/engine/ActionPipeline.ts'),
            'utf8',
        );

        const wrappingMarker = 'throw new ActionSchemaError(';
        const markerCount =
            countMatches(stateReducerSource, wrappingMarker) +
            countMatches(actionPipelineSource, wrappingMarker);

        expect(markerCount).toBe(1);
    });
});
