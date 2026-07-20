import { notFound } from 'next/navigation';
import React from 'react';
import { isDebugInspectorRouteEnabled } from './debugRouteGate';
import DebugInspectorClient from './DebugInspectorClient';

/**
 * Debug Inspector — dev-only route (§4.12).
 *
 * Available in every launch (VSCode task, bare `electron apps/tactics`, plain
 * `next build`, E2E) except the packaged production app: only the
 * `package:tactics*` scripts set `NEXT_PUBLIC_CHIMERA_PACKAGED=1`, which makes
 * this route return 404.
 *
 * Architecture: §4.12; invariants #27–#29.
 */
export default function DebugInspectorPage(): React.ReactElement {
    if (!isDebugInspectorRouteEnabled()) {
        notFound();
    }

    return <DebugInspectorClient />;
}
