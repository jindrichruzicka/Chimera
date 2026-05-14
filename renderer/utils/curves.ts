export type EasingFn = (t: number) => number;

export function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * t;
}

export function linear(t: number): number {
    return t;
}

export function easeIn(t: number): number {
    return t * t;
}

export function easeOut(t: number): number {
    return t * (2 - t);
}

export function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
