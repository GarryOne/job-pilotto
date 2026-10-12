// The false readings the replays found and nobody has fixed yet (lib/replay-truth.mjs againstLedger): case name -> the exact failure lines. Each line is a bug, never a loosened assert;
// a listed line that does not show is said as GONE? in the replay log (some depend on timing): remove it once its fix landed. Lines are only removed, never added to pass a case. Imported (not read by path) so a change to it starts the replays (tools/replay-files.mjs).
export const FALSE_READINGS = {
};
