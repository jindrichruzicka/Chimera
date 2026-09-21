/**
 * renderer/components/r3f/__test-support__/intrinsicProps.ts
 *
 * Read back the props React actually committed for one r3f intrinsic.
 *
 * **Why the DOM cannot answer this.** Under `fakeFiberRoot` the r3f intrinsics
 * render as inert DOM through react-dom, and that round trip is LOSSY for
 * exactly the props a material is configured with. Measured against
 * react-dom 19.2.5, rendering
 * `<meshBasicMaterial map={t} transparent toneMapped={false} alphaTest={0.01} />`
 * produces `<meshbasicmaterial map="[object Object]" alphatest="0.01">` — a
 * boolean-valued prop on an unrecognised element is DROPPED, so `transparent`
 * and `toneMapped={false}` leave no attribute at all and an attribute read
 * cannot tell `transparent` from `transparent={false}` from neither. Only the
 * number survives, lowercased and stringified.
 *
 * React's own committed-props key on the host node carries the values
 * unconverted: `{ transparent: true, toneMapped: false, alphaTest: 0.01 }`. It
 * is a react-dom internal, so this throws rather than answering `{}` when the
 * key is gone; which assertions that throw protects is pinned in
 * `intrinsicProps.test.ts`.
 */

/** The prefix react-dom 19 uses for the committed-props key on a host node. */
const COMMITTED_PROPS_PREFIX = '__reactProps$';

/**
 * The props React committed for `element`, by value and unconverted.
 *
 * @throws rather than answering `{}`; `intrinsicProps.test.ts` enumerates the
 * conditions.
 */
export function intrinsicProps(element: Element): Readonly<Record<string, unknown>> {
    const tag = element.tagName.toLowerCase();
    const holder: Record<string, unknown> = element as unknown as Record<string, unknown>;
    const key = Object.keys(holder).find((candidate) =>
        candidate.startsWith(COMMITTED_PROPS_PREFIX),
    );

    if (key === undefined) {
        throw new Error(
            `intrinsicProps: no '${COMMITTED_PROPS_PREFIX}*' key on <${tag}>. react-dom no longer ` +
                `exposes committed host props under that name, so every assertion reading through ` +
                `this helper is unpinned until it is ported.`,
        );
    }

    const props = holder[key];
    if (props === null || typeof props !== 'object') {
        throw new Error(
            `intrinsicProps: '${key}' on <${tag}> is ${props === null ? 'null' : typeof props}, ` +
                `not the props object this helper reads.`,
        );
    }

    return props as Record<string, unknown>;
}
