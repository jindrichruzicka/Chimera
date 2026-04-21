# Chimera GitHub Label Catalogue

Run these once to set up the full label set. Use `|| true` on each line so the script is idempotent.

```bash
export GH_REPO=jindrichruzicka/Chimera

# Issue type
gh label create "feature"         --color "0075ca" --description "Feature-level issue"                        --repo $GH_REPO || true
gh label create "task"            --color "e4e669" --description "Atomic implementation task"                 --repo $GH_REPO || true
gh label create "bug"             --color "d73a4a" --description "Something isn't working"                    --repo $GH_REPO || true
gh label create "post-1.0"        --color "c5def5" --description "Deferred to post-1.0.0 (Appendix E)"       --repo $GH_REPO || true

# Milestones
gh label create "milestone:M1"    --color "bfd4f2" --description "M1 — Skeleton"                             --repo $GH_REPO || true
gh label create "milestone:M2"    --color "bfd4f2" --description "M2 — Networked Lobby"                      --repo $GH_REPO || true
gh label create "milestone:M3"    --color "bfd4f2" --description "M3 — Action Registry + Game Loop"          --repo $GH_REPO || true
gh label create "milestone:M3.5"  --color "bfd4f2" --description "M3.5 — AI Framework"                      --repo $GH_REPO || true
gh label create "milestone:M4"    --color "bfd4f2" --description "M4 — State Projection + Obfuscation"       --repo $GH_REPO || true
gh label create "milestone:M5"    --color "bfd4f2" --description "M5 — E2E Testing Layer"                    --repo $GH_REPO || true
gh label create "milestone:M6"    --color "bfd4f2" --description "M6 — 3D Render Integration"                --repo $GH_REPO || true
gh label create "milestone:M7"    --color "bfd4f2" --description "M7 — Hardening"                            --repo $GH_REPO || true

# Module area
gh label create "simulation"      --color "f9d0c4" --description "simulation/ package"                        --repo $GH_REPO || true
gh label create "networking"      --color "f9d0c4" --description "networking/ package"                        --repo $GH_REPO || true
gh label create "renderer"        --color "f9d0c4" --description "renderer/ package"                          --repo $GH_REPO || true
gh label create "electron"        --color "f9d0c4" --description "electron/ main + preload"                   --repo $GH_REPO || true
gh label create "ai"              --color "f9d0c4" --description "ai/ package"                                --repo $GH_REPO || true
gh label create "testing"         --color "f9d0c4" --description "Unit / integration / E2E tests"             --repo $GH_REPO || true
gh label create "tooling"         --color "f9d0c4" --description "tools/ scripts, CI, lint, build"           --repo $GH_REPO || true

# Cross-cutting
gh label create "invariant"       --color "e99695" --description "Touches or enforces an Appendix B invariant" --repo $GH_REPO || true
```
