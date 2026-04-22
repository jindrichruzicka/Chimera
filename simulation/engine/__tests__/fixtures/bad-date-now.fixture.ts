// bad-date-now.fixture.ts
// This file exists only to trigger the no-restricted-syntax ESLint rule.
// DO NOT import this file from production code.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validate(): number {
    return Date.now();
}
