const pendingLine = document.getElementById("pendingLine");
const fileNewBtn = document.getElementById("fileNewBtn");
const organizeAllBtn = document.getElementById("organizeAllBtn");
const fixDuplicatesBtn = document.getElementById("fixDuplicatesBtn");
const status = document.getElementById("status");

const PENDING_KEY = "pendingBookmarkIds";

async function refreshPendingLine() {
  const data = await chrome.storage.local.get(PENDING_KEY);
  const pending = data[PENDING_KEY] || [];
  if (pending.length === 0) {
    pendingLine.textContent = "You're all caught up — no new bookmarks waiting.";
    fileNewBtn.disabled = true;
  } else {
    pendingLine.textContent =
      `${pending.length} new bookmark${pending.length === 1 ? "" : "s"} ready to file.`;
    fileNewBtn.disabled = false;
  }
  return pending;
}

fileNewBtn.addEventListener("click", async () => {
  fileNewBtn.disabled = true;
  status.textContent = "Filing…";

  const pending = await refreshPendingLine();
  const nodes = [];
  for (const id of pending) {
    try {
      const [node] = await chrome.bookmarks.get(id);
      if (node && node.url) nodes.push(node);
    } catch {
      // bookmark was deleted before we got to it -- just skip it
    }
  }

  const result = await runAsBulkOperation(() => organizeBookmarks(nodes));
  await chrome.storage.local.set({ [PENDING_KEY]: [] });
  await chrome.action.setBadgeText({ text: "" });

  status.textContent =
    `Filed ${result.filed}, skipped ${result.skipped} already-filed duplicate${result.skipped === 1 ? "" : "s"}.`;
  await refreshPendingLine();
});

organizeAllBtn.addEventListener("click", async () => {
  organizeAllBtn.disabled = true;
  status.textContent = "Scanning all bookmarks… this may take a moment for large collections.";

  const result = await runAsBulkOperation(async () => {
    const root = await ensureOrganizedRoot();
    const bookmarks = await getAllBookmarks(root.id);
    return organizeBookmarks(bookmarks);
  });

  // A full sweep covers everything, including whatever was pending.
  await chrome.storage.local.set({ [PENDING_KEY]: [] });
  await chrome.action.setBadgeText({ text: "" });

  status.textContent =
    `Done. Filed ${result.filed} bookmarks, skipped ${result.skipped} already-filed duplicates, into "Organized Bookmarks".`;
  organizeAllBtn.disabled = false;
  await refreshPendingLine();
});

fixDuplicatesBtn.addEventListener("click", async () => {
  fixDuplicatesBtn.disabled = true;
  status.textContent = "Checking for duplicate 'Organized Bookmarks' folders…";

  const result = await runAsBulkOperation(() => consolidateDuplicateRoots());

  if (result.duplicatesRemoved === 0) {
    status.textContent = "No duplicate folders found — nothing to fix.";
  } else {
    status.textContent =
      `Merged ${result.merged} bookmark${result.merged === 1 ? "" : "s"} and removed ` +
      `${result.duplicatesRemoved} duplicate folder${result.duplicatesRemoved === 1 ? "" : "s"}. ` +
      `Everything now lives in one "Organized Bookmarks" folder.`;
  }

  fixDuplicatesBtn.disabled = false;
});

refreshPendingLine();
