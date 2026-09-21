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

  // A bookmark that lands inside Organized Bookmarks by some other route
  // (Chrome defaulting the save dialog to a folder in the archive) doesn't
  // need filing, but might need correcting into the right Year/Month.
  const root = await findOrganizedRoot();
  if (root && await isDescendantOfFolder(bookmark.parentId, root.id)) {
    await fixPlacementIfNeeded(bookmark, root);
    return;
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

// A bookmark dragged out of Organized Bookmarks is unfiled again and needs
// picking up; one dragged INTO it should be treated as already filed. Moves
// that don't cross that boundary (e.g. reshuffling within the Bookmarks Bar,
// or between Year/Month folders) don't change filed status either way.
chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  if (await isBulkOperationActive()) return;

  const root = await findOrganizedRoot();
  if (!root) return;

  const wasInside = await isDescendantOfFolder(moveInfo.oldParentId, root.id);
  const isInside = await isDescendantOfFolder(moveInfo.parentId, root.id);
  if (wasInside === isInside) return; // didn't cross the boundary

  let bookmark;
  try {
    [bookmark] = await chrome.bookmarks.get(id);
  } catch {
    return;
  }
  if (!bookmark || !bookmark.url) return; // folders don't need filing

  const pending = await getPending();
  if (isInside) {
    if (pending.includes(id)) {
      await setPending(pending.filter(pendingId => pendingId !== id));
    }
    await fixPlacementIfNeeded(bookmark, root);
  } else if (!pending.includes(id)) {
    pending.push(id);
    await setPending(pending);
  }
});
