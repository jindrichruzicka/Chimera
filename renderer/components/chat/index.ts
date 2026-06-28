// renderer/components/chat/index.ts
//
// Public barrel for the shared chat component.
//
// `ChatPanel` is a higher-level, stateful feature component — wired to renderer
// stores and the host IPC bridge — as opposed to the stateless design primitives
// exported from `renderer/components/ui`. Games consume it through the single
// public specifier `@chimera-engine/renderer/components/chat` (the
// `chimera/no-game-renderer-internals` lint rule whitelists this barrel alongside
// the UI primitive barrel; deep imports into the directory remain forbidden).
//
// A game mounts the chat panel from one of its own renderer surfaces — e.g.
// Tactics renders it inside `TacticsGameHud`. The engine never mounts it for a
// game implicitly, and no engine shell surface (lobby included) mounts it:
// chat is an in-match-only UI.
//
// Architecture reference: §4.29 Chat System, §4.35 UI Design System,
// §3 Module Boundaries.

export { ChatPanel } from './ChatPanel';
export type { ChatPanelProps } from './ChatPanel';
