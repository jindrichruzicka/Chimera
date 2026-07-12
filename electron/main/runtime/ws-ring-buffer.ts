/**
 * electron/main/runtime/ws-ring-buffer.ts
 *
 * O(1) ring-buffer for bounded WebSocket frame capture in CHIMERA_E2E mode.
 *
 * Replaces the O(n) Array.shift() eviction used by pushWsFrame when the buffer
 * is full. The public surface is a plain T[] — consumers (ws-inspector helpers,
 * Vitest matchers) see a normal array with correct insertion-order indices.
 *
 * Architecture: §13.9.
 */

/** Brand symbol — survives structured-clone but is opaque to callers. */
const RING_BUFFER_BRAND: unique symbol = Symbol.for('chimera.ring-buffer');

type BrandedArray<TItem> = TItem[] & { readonly [RING_BUFFER_BRAND]: true };

/**
 * Create a Proxy-backed ring buffer of `capacity` elements that presents as a
 * plain `TItem[]`. Eviction is O(1): when full, the oldest slot is overwritten and
 * the write head advances. Index access is remapped so `buf[0]` is always the
 * oldest element regardless of the internal write head.
 */
export function createRingBuffer<TItem>(capacity: number): TItem[] {
    const buf = new Array<TItem>(capacity);
    let writeHead = 0;
    let size = 0;

    const handler: ProxyHandler<TItem[]> = {
        get(_target, prop, _receiver) {
            if (prop === RING_BUFFER_BRAND) return true;

            if (prop === 'length') return size;

            if (prop === 'push') {
                return (...items: TItem[]): number => {
                    for (const item of items) {
                        buf[writeHead] = item;
                        writeHead = (writeHead + 1) % capacity;
                        if (size < capacity) size++;
                        // When full, writeHead overwrites the oldest slot (implicit eviction).
                    }
                    return size;
                };
            }

            if (prop === Symbol.iterator) {
                return function* () {
                    const start = (writeHead - size + capacity) % capacity;
                    for (let i = 0; i < size; i++) {
                        yield buf[(start + i) % capacity];
                    }
                };
            }

            if (typeof prop === 'string') {
                const idx = Number(prop);
                if (Number.isInteger(idx) && idx >= 0 && idx < size) {
                    const start = (writeHead - size + capacity) % capacity;
                    return buf[(start + idx) % capacity];
                }
            }

            // Delegate everything else (constructor, toString, Symbol.toStringTag, etc.)
            // to the underlying array so host code (Vitest, structured-clone) sees a
            // normal Array rather than a sparse custom object.
            // Cast through `unknown` first to prevent the no-unsafe-return lint rule
            // from firing on the `any` return type of Reflect.get.
            const reflected: unknown = Reflect.get(_target, prop, _receiver) as unknown;
            return reflected;
        },

        // Expose logical indices as own enumerable properties so that equality
        // checkers (Vitest's toEqual, Object.keys, Object.hasOwn) see real elements
        // rather than sparse holes.
        ownKeys(_target) {
            const keys: string[] = [];
            for (let i = 0; i < size; i++) keys.push(String(i));
            // `length` is non-configurable on Array targets — Proxy invariant
            // requires it to appear in the ownKeys result.
            keys.push('length');
            return keys;
        },

        getOwnPropertyDescriptor(_target, prop) {
            if (typeof prop === 'string') {
                const idx = Number(prop);
                if (Number.isInteger(idx) && idx >= 0 && idx < size) {
                    const start = (writeHead - size + capacity) % capacity;
                    return {
                        value: buf[(start + idx) % capacity],
                        writable: true,
                        enumerable: true,
                        configurable: true,
                    };
                }
            }
            if (prop === 'length') {
                return { value: size, writable: true, enumerable: false, configurable: false };
            }
            return undefined;
        },

        has(_target, prop) {
            if (typeof prop === 'string') {
                const idx = Number(prop);
                if (Number.isInteger(idx) && idx >= 0 && idx < size) return true;
            }
            return Reflect.has(_target, prop);
        },

        set(_target, prop, value) {
            // The set trap is reachable only from external code — push() writes
            // directly to `buf` and never triggers this path.
            // Reject any numeric index write that would exceed the allocated
            // capacity; doing so would silently grow `buf` beyond its ring size
            // and corrupt the ring invariant.
            if (typeof prop === 'string') {
                const idx = Number(prop);
                if (Number.isInteger(idx) && idx >= 0) {
                    if (idx >= capacity) {
                        throw new RangeError(
                            `RingBuffer: index ${idx} is out of bounds (capacity ${capacity}).`,
                        );
                    }
                    buf[idx] = value as TItem;
                    return true;
                }
            }
            return true;
        },
    };

    return new Proxy([] as TItem[], handler);
}

/**
 * Returns true when `arr` was created by `createRingBuffer`.
 * Use this to branch between the O(1) ring path and a legacy plain-array fallback.
 */
export function isRingBuffer<TItem>(arr: TItem[]): boolean {
    return (arr as BrandedArray<TItem>)[RING_BUFFER_BRAND] === true;
}
