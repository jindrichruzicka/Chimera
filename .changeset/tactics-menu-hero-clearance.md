---
'@chimera-engine/tactics': patch
---

Lift the tactics main-menu hero clear of the menu column, and measure the clearance in the real
window so it cannot silently close again.

The hero (title + subtitle) and the button column are two independently positioned layers: the game
paints the hero as background chrome offset above centre, while the engine lays the buttons out from
`tacticsMainMenuDefinition.layout.offsetY`. Neither side can see the other's extent, and a menu grows
symmetrically about its own centre — so adding **Continue** walked the column's top edge up by half a
button-plus-gap and put the first button underneath the subtitle. The overlap measured 31px: the
subtitle was painted across the Continue button.

`TacticsShellBackground.module.css` raises the overlay from `translateY(-160px)` to
`translateY(-240px)`. The hero moves rather than the column because the column's own bottom margin is
already where it should be. Measured in the launched window at the default 1280×800 size (772px of
content height): 48.8px between the subtitle and the first button, 109.5px above the title's box, and
85px below Quit.

Because both layers are anchored to the viewport centre, those relations are viewport-independent —
they hold identically in the packaged windowed-fullscreen window.

`main-menu-custom.spec.ts` gains the guard that makes the fix a property rather than a tuned number:
it measures the hero's bottom against the first button's top in the launched app and requires a
visible break between them, plus a title that is not pushed off the top and a last button that is not
pushed off the bottom. The threshold is `--ch-space-lg` (24px), which is below the shipped 49px by
less than the 32px one more menu entry would cost — so the next button added to this menu reds the
test instead of shipping a second overlap.
