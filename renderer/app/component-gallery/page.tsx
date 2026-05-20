import { notFound } from 'next/navigation';
import React from 'react';
import { isGalleryEnabled } from './galleryGate';
import ComponentGalleryClient from './ComponentGalleryClient';

/**
 * Component Gallery — dev/test-gated route.
 *
 * Available in development and during E2E test builds
 * (`NEXT_PUBLIC_CHIMERA_E2E=1`). Returns 404 in production otherwise.
 *
 * Architecture: §4.35, §4.37; invariants #91–#94.
 */
export default function ComponentGalleryPage(): React.ReactElement {
    if (!isGalleryEnabled()) {
        notFound();
    }

    return <ComponentGalleryClient />;
}
