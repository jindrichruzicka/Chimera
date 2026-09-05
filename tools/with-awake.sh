#!/bin/sh
# tools/with-awake.sh
#
# Holds a macOS sleep assertion around a long-running local command.
#
# A Mac that idle-sleeps (`pmset -g custom`, `sleep`) does so during an
# unattended `pnpm test` or Playwright run, and what comes back names a test —
# a vitest worker whose reply timed out, a cue that never arrived — never the
# sleep. `caffeinate -dims` asserts against display sleep, idle system sleep,
# disk idle and AC system sleep for exactly as long as the command runs. Where
# there is no `caffeinate` (Linux CI) the command runs directly. The command's
# exit status is the wrapper's either way.
#
# Usage: sh tools/with-awake.sh <command> [args...]
if [ "$#" -eq 0 ]; then
    # A bare `caffeinate -dims --` holds its assertions until it is killed, and
    # a bare `exec` is a silent no-op: neither is a run of anything.
    echo "usage: sh tools/with-awake.sh <command> [args...]" >&2
    exit 64
fi
if command -v caffeinate >/dev/null 2>&1; then
    exec caffeinate -dims -- "$@"
fi
exec "$@"
