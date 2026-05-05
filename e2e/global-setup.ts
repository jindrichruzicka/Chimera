import { execSync } from 'child_process';
import path from 'path';

/**
 * Playwright global setup — runs once before all E2E tests.
 * Compiles the renderer bundle so tests can load the real UI.
 */
export default function globalSetup(): void {
    const root = path.resolve(__dirname, '..');
    execSync('pnpm build:renderer', { cwd: root, stdio: 'inherit' });
}
