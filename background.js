importScripts("lib/organize.js");

const PENDING_KEY = "pendingBookmarkIds";

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

  // Ignore bookmarks we ourselves just created inside Organized Bookmarks --
  // otherwise every "file new bookmarks" action would immediately re-flag
  // its own copies as new, unfiled bookmarks.
  const root = await ensureOrganizedRoot();
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

  const pending = await getPending();
  if (!pending.includes(id)) {
    pending.push(id);
    await setPending(pending);
  }
});
