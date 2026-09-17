importScripts("lib/organize.js");

// MV3 service workers don't stay alive between events and hold no reliable
// in-memory state, so the badge has to be rehydrated from storage on wake.
// This is also a guaranteed, deterministic point to clear the bulk-operation
// flag -- no legitimate run can span a browser restart or extension reload,
// so if it's stuck "active" here, it's stuck, full stop.
async function onWake() {
  await endBulkOperation();
  await updateBadge((await getPending()).length);
}
chrome.runtime.onStartup.addListener(onWake);
chrome.runtime.onInstalled.addListener(onWake);

chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (!bookmark.url) return; // folders don't need filing

  // While a bulk operation (organize / repair) is running in the popup, its
  // own creates fire this same event hundreds or thousands of times. Skip
  // all of them outright rather than re-checking each one individually.
  if (await isBulkOperationActive()) return;

  // Ignore bookmarks that land inside Organized Bookmarks by some other
  // route too. Read-only lookup -- never creates the folder -- so this
  // listener can't itself cause the duplicate-folder bug.
  const root = await findOrganizedRoot();
  if (root) {
    let parentId = bookmark.parentId;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) {
      if (parentId === root.id) return;
      visited.add(parentId);
      try {
        const [node] = await chrome.bookmarks.get(parentId);
        parentId = node.parentId;
      } catch {
        break;
      }
    }
  }

  const pending = await getPending();
  if (!pending.includes(id)) {
    pending.push(id);
    await setPending(pending);
  }
});

// A bookmark removed before it was ever filed should drop off the pending
// count too -- otherwise the badge keeps showing a bookmark that no longer
// exists until the next unrelated file/organize click happens to clear it.
chrome.bookmarks.onRemoved.addListener(async (id) => {
  if (await isBulkOperationActive()) return;

  const pending = await getPending();
  if (pending.includes(id)) {
    await setPending(pending.filter(pendingId => pendingId !== id));
  }
});
