---
'@chimera-engine/simulation': patch
'@chimera-engine/electron': patch
---

Wire the compressed replay serializer, and stop pretty-printing replay files.

`CompressedReplaySerializer` gzips a `ReplayFile` and its own docblock said to inject it for
space-efficient storage — but `main()` wired the uncompressed `JsonReplaySerializer` into the
deterministic `FileReplayRepository`. Separately, `serializeReplay` called
`JSON.stringify(file, null, 2)`; the indentation is pure size for a file no human reads, and
`deserializeReplay` is indifferent to whitespace, so removing it changes nothing a consumer sees.

Both halves are dev/e2e-scoped: `createDeterministicReplayPort` returns `undefined` when
`app.isPackaged`, so a shipped build writes no deterministic replay at all.

The read path had to change with the write path. Both encodings share the `.chimera-replay`
extension, so nothing in the path distinguishes them, and `FileReplayRepository`
deserializes every matching file with no per-file tolerance — one unreadable replay would
take the whole listing, not just its own row. `deserializeReplayCompressed` therefore dispatches on
the gzip magic (`1f 8b`, RFC 1952) and falls through to plain JSON when it is absent, so a replay
already on disk still loads and a mixed directory still lists.

Dispatching on the magic rather than on a failed `gunzip` is the load-bearing half of that: a
truncated or corrupt gzip stream keeps its own error instead of falling through to be reported as
bad JSON. Both routes throw `ReplayParseError`, so the tests assert on the message — a check on the
error type alone cannot tell the two apart, and passes against the wrong implementation.

`durationTicks`, the file extension, the listing sort, `parseReplayFile`'s validation and the
`safeReviver` prototype-pollution guard are untouched.
