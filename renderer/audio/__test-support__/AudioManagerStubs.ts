import type { AudioManager } from '../AudioManager';

export function createAudioManagerStub(): AudioManager {
    return {
        play(): never {
            throw new Error('unused audio manager stub');
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        stop(): void {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        stopAll(): void {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        duck(): void {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        dispose(): void {},
    };
}
