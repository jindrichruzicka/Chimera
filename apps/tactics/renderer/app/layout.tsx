// Thin re-export of the engine root layout from @chimera/renderer (F65 Phase 2c).
// The app owns the route file; the shell (html/body, AppShell, the provider +
// bootstrap tree, GameRegistrationBootstrap) ships from the package dist.
export { default, metadata } from '@chimera/renderer/shell/layout';
