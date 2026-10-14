// Heavy background work (export, FFmpeg, offline speech engines) runs at below-normal CPU
// priority, so the rest of the computer stays responsive. Windows still gives it all idle CPU.
const os = require('node:os');

function setPriority(pid, priority) {
  try { if (pid) os.setPriority(pid, priority); } catch {}
}

/** Lowers a spawned child's priority; returns the child for chaining. */
function background(child) {
  setPriority(child?.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  return child;
}

const lower = pid => setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
const restore = pid => setPriority(pid, os.constants.priority.PRIORITY_NORMAL);

module.exports = { background, lower, restore };
