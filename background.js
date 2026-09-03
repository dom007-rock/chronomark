importScripts("lib/organize.js");

const PENDING_KEY = "pendingBookmarkIds";
const ORGANIZING_FLAG_KEY = "organizeInProgress";

async function getPending() {
  const data = await chrome.storage.local.get(PENDING_KEY);
  return data[PENDING_KEY] || [];
}

async function updateBadge(count) {
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
}

async function setPending(ids) {
  await chrome.storage.local.set({ [PENDING_KEY]: ids });
  await updateBadge(ids.length);
}

// MV3 service workers don't stay alive between events and hold no reliable
// in-memory state, so the badge has to be rehydrated from storage on wake.
chrome.runtime.onStartup.addListener(async () => updateBadge((await getPending()).length));
chrome.runtime.onInstalled.addListener(async () => updateBadge((await getPending()).length));

chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (!bookmark.url) return; // folders don't need filing

  // While a bulk operation (organize / repair) is running in the popup, its
  // own creates fire this same event hundreds or thousands of times. Skip
  // all of them outright rather than re-checking each one individually.
  const { [ORGANIZING_FLAG_KEY]: organizing } = await chrome.storage.local.get(ORGANIZING_FLAG_KEY);
  if (organizing) return;

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
  const { [ORGANIZING_FLAG_KEY]: organizing } = await chrome.storage.local.get(ORGANIZING_FLAG_KEY);
  if (organizing) return;

  const pending = await getPending();
  if (pending.includes(id)) {
    await setPending(pending.filter(pendingId => pendingId !== id));
  }
});
