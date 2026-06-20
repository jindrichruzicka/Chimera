/**
 * Public API of the simulation host sub-module.
 *
 * Exposes the composable `SimulationHost` and its `AgentCoordinator` port so
 * any host shell (Electron main, or a plain Node consumer) can drive a hosted
 * session's agent lifecycle from the simulation tick loop without depending on
 * the AI framework directly (Appendix C.3 / §C.4 — Composable SimulationHost).
 */

export { SimulationHost } from './SimulationHost.js';
export type { AgentCoordinator } from './AgentCoordinator.js';
