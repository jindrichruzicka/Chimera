import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { isInsidePath } from './path-containment';

describe('isInsidePath', () => {
    const base = path.resolve('/srv/app/replays');

    it('accepts the base directory itself', () => {
        expect(isInsidePath(base, base)).toBe(true);
    });

    it('accepts a file directly inside the base', () => {
        expect(isInsidePath(base, path.join(base, 'tactics', 'abc.chimera-replay'))).toBe(true);
    });

    it('rejects a parent-traversal path that escapes the base', () => {
        expect(isInsidePath(base, path.join(base, '..', '..', 'etc', 'passwd'))).toBe(false);
    });

    it('rejects a sibling directory that merely shares the base as a name prefix', () => {
        // `/srv/app/replays-evil` starts with `/srv/app/replays` but is NOT
        // inside it — the separator guard is what makes this false.
        expect(isInsidePath(base, `${base}-evil/leak.chimera-replay`)).toBe(false);
    });

    it('resolves relative candidates before comparing', () => {
        const relativeInside = path.relative(
            process.cwd(),
            path.join(base, 'tactics', 'r.chimera-replay'),
        );
        expect(isInsidePath(base, relativeInside)).toBe(true);
    });

    it('resolves a relative base before comparing', () => {
        const relativeBase = path.relative(process.cwd(), base);
        expect(isInsidePath(relativeBase, path.join(base, 'tactics', 'r.chimera-replay'))).toBe(
            true,
        );
    });
});
