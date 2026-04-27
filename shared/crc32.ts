/**
 * Pure-TypeScript CRC32 utility.
 *
 * Uses the standard CRC32 polynomial 0xEDB88320 (reversed/reflected form).
 * The lookup table is built once at module load time.
 *
 * Return type: number (32-bit signed integer — JavaScript bitwise ops yield signed int32).
 */

function buildTable(): Int32Array {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            if (c & 1) {
                c = (c >>> 1) ^ 0xedb88320;
            } else {
                c = c >>> 1;
            }
        }
        table[i] = c;
    }
    return table;
}

const TABLE = buildTable();

/**
 * Computes the CRC32 of a UTF-8 encoded string.
 * Returns a 32-bit signed integer (matching JavaScript bitwise semantics).
 */
export function crc32(input: string): number {
    let crc = 0xffffffff;
    const bytes = new TextEncoder().encode(input);
    for (const byte of bytes) {
        crc = (crc >>> 8) ^ (TABLE[(crc ^ byte) & 0xff] ?? 0);
    }
    return (crc ^ 0xffffffff) | 0;
}

/**
 * Convenience wrapper: computes CRC32 of JSON.stringify(value).
 */
export function crc32Json(value: unknown): number {
    return crc32(JSON.stringify(value));
}
