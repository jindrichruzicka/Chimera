/**
 * electron/dev-tools/test-support/MalformedAssetFileError.ts
 *
 * The PARSE-failure type the asset-fact readers raise. They parse binary
 * containers a game committed to disk, and every way those bytes can disagree
 * with their own headers is the same finding: this file is not the thing it
 * claims to be.
 *
 * Not the only error they can produce — a missing file surfaces as the
 * underlying `ENOENT`, and an out-of-range `sampleAt` index is a `RangeError`,
 * since neither is a statement about the file's contents.
 *
 * It carries the path because these readers are called from a loop over a
 * manifest — the assertion that fails names a cue offset or a bone, and without
 * the path the reader would not say WHICH of a game's assets was unreadable.
 */
export class MalformedAssetFileError extends Error {
    /** Path of the file that could not be read, exactly as given to the reader. */
    public readonly filePath: string;

    constructor(filePath: string, reason: string) {
        super(`${filePath} is not readable as declared: ${reason}`);
        this.name = 'MalformedAssetFileError';
        this.filePath = filePath;
        // Maintain the prototype chain in environments that transpile classes,
        // so `instanceof` survives — matching MalformedAssetRefError's posture.
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
