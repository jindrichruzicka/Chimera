---
title: 'Post-1.0 Future Extensions'
description: 'E1–E5: Auto-Update/Distribution Hardening, Accessibility Baseline, Spectator Mode, Localisation (i18n), and Connection Quality Telemetry. Tracked under the Post-1.0 Future Extensions milestone; not committed to any release date.'
tags: [future, extensions, auto-update, accessibility, spectator, i18n, telemetry]
---

# Post-1.0 Future Extensions

> Not committed to any release date. Tracked under the `Post-1.0 — Future Extensions` milestone.
> Architecture sections: §Appendix E.1–E.5

---

## E1 — Auto-Update and Distribution Hardening `§Appendix E.1`

`electron-updater` integration, stable / beta channels, macOS notarization, Windows EV code signing, engine version check in `WELCOME` handshake.

---

## E2 — Accessibility Baseline `§Appendix E.2`

`settings.display.reducedMotion`, `highContrast`, `fontScale`. Focus rings, skip-to-content, ARIA labels on all shell components.

---

## E3 — Spectator Mode `§Appendix E.3`

`role: 'player' | 'spectator'` in `LobbyPlayerEntry`, `projectForSpectator()` on `StateProjector`, spectator action allowlist (chat only).

---

## E4 — Localisation / i18n `§Appendix E.4`

`translations/<locale>.json` bundles, `react-i18next` in renderer, `settings.display.locale` override, `PlayerProfile.locale` as default.

---

## E5 — Connection Quality Telemetry `§Appendix E.5`

EWMA RTT + jitter + loss estimate in `NetworkProbe`, `connectionHealthStore`, per-player quality indicator in lobby UI. Local-only, no automatic export.

---

## Cross-References

- [Player Profiles & Directory](../core-components/player-profiles-directory.md) — `PlayerProfile.locale` (E4)
- [State Projection Interfaces](../core-components/state-projection-interfaces.md) — `projectForSpectator()` (E3)
- [GameShell & UI Design System](../core-components/gameshell-ui-design-system.md) — `--ch-motion-*` tokens tie to `reducedMotion` (E2)
- [Multiplayer Provider & WebSocket](../core-components/multiplayer-provider-websocket.md) — `WELCOME` handshake version check (E1)
