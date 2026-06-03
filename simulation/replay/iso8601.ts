/**
 * simulation/replay/iso8601.ts
 *
 * Shared ISO-8601 UTC timestamp validation for the replay sub-module.
 * Pure functions — zero I/O, no Node.js APIs, no wall-clock reads.
 *
 * Used by both `ReplayFile.ts` (deterministic replays) and
 * `PerspectiveReplayFile.ts` (perspective replays) to validate `recordedAt`.
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #1  — simulation/ has zero runtime deps on React, DOM, or networking
 *   #43 — validation is pure; no I/O, no Date.now()
 */

const ISO_8601_UTC_TIMESTAMP_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?Z$/u;

/**
 * Returns `true` when `value` is a syntactically valid ISO-8601 UTC timestamp
 * (e.g. `2026-06-02T10:00:00.000Z`) with a real calendar day (leap years and
 * days-per-month honoured). Does not read the wall clock.
 */
export function isIso8601UtcTimestamp(value: string): boolean {
    const match = ISO_8601_UTC_TIMESTAMP_PATTERN.exec(value);
    if (match === null) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return day >= 1 && day <= getDaysInMonth(year, month);
}

function getDaysInMonth(year: number, month: number): number {
    if (month === 2) {
        return isLeapYear(year) ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
