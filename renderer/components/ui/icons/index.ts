// Folder barrel for the icon system. Pure re-exports so the public
// `components/ui` barrel can surface <Icon> while staying side-effect-free
// (Invariant #96). ICON_REGISTRY is re-exported here for tests and future
// intra-folder use; the public barrel deliberately withholds it (games consume
// icons only through `<Icon name>`).
export { Icon } from './Icon';
export type { IconProps } from './Icon';
export { ICON_REGISTRY } from './registry';
export type { IconGlyph, IconName } from './registry';
