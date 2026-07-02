import { notFound } from 'next/navigation';
import React from 'react';
import { isGalleryEnabled } from './galleryGate';
import ComponentGalleryClient from './ComponentGalleryClient';

/**
 * Component Gallery — dev/test-gated route.
 *
 * Available in every launch (VSCode task, bare `electron apps/tactics`, plain
 * `next build`, E2E) except the packaged production app: only the
 * `package:tactics*` scripts set `NEXT_PUBLIC_CHIMERA_PACKAGED=1`, which makes
 * this route return 404.
 *
 * Architecture: §4.35, §4.37; invariants #91–#94.
 */
export default function ComponentGalleryPage(): React.ReactElement {
    if (!isGalleryEnabled()) {
        notFound();
    }

    return <ComponentGalleryClient />;
}
