const pendingLine = document.getElementById("pendingLine");
const fileNewBtn = document.getElementById("fileNewBtn");
const organizeAllBtn = document.getElementById("organizeAllBtn");
const fixDuplicatesBtn = document.getElementById("fixDuplicatesBtn");
const status = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const searchResults = document.getElementById("searchResults");
const normalSections = document.getElementById("normalSections");
const deleteOriginalsToggle = document.getElementById("deleteOriginalsToggle");

deleteOriginalsToggle.addEventListener("change", () => {
  setDeleteOriginalsEnabled(deleteOriginalsToggle.checked);
});
getDeleteOriginalsEnabled().then(enabled => {
  deleteOriginalsToggle.checked = enabled;
});

const MAX_SEARCH_RESULTS = 50;

async function refreshPendingLine() {
  const pending = await getPending();
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
  await setPending([]);

  status.textContent =
    `Filed ${result.filed}, skipped ${result.skipped} already-filed duplicate${result.skipped === 1 ? "" : "s"}.` +
    (result.originalsDeleted ? ` Deleted ${result.originalsDeleted} original${result.originalsDeleted === 1 ? "" : "s"}.` : "");
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
  await setPending([]);

  status.textContent =
    `Done. Filed ${result.filed} bookmarks, skipped ${result.skipped} already-filed duplicates, into "Organized Bookmarks".` +
    (result.originalsDeleted ? ` Deleted ${result.originalsDeleted} original${result.originalsDeleted === 1 ? "" : "s"}.` : "");
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

// Best-effort human-readable location for a search result: "2024 / June" for
// something already filed in the organized archive, or just the immediate
// parent folder's name (e.g. "Bookmarks bar") for anything not yet filed.
async function getLocationLabel(node) {
  if (!node.parentId) return "";
  let monthFolder;
  try {
    [monthFolder] = await chrome.bookmarks.get(node.parentId);
  } catch {
    return "";
  }
  if (!monthFolder?.parentId) return monthFolder?.title || "";

  try {
    const [yearFolder] = await chrome.bookmarks.get(monthFolder.parentId);
    if (yearFolder?.parentId) {
      const [root] = await chrome.bookmarks.get(yearFolder.parentId);
      if (root?.title === ROOT_FOLDER_TITLE) {
        return `${yearFolder.title} / ${monthFolder.title}`;
      }
    }
  } catch {
    // fall through to just the immediate parent below
  }
  return monthFolder.title || "";
}

// Two modes: normal (pending/organize/fix-duplicates, the everyday view) and
// searching (results get the room, everything else steps aside). The search
// bar itself is always visible either way -- only what's below it changes.
function setSearchMode(active) {
  normalSections.classList.toggle("hidden", active);
  searchResults.classList.toggle("visible", active);
  searchClear.classList.toggle("visible", active);
}

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchInput.focus();
  setSearchMode(false);
  searchResults.innerHTML = "";
});

let searchGeneration = 0;
let searchDebounceTimer = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(runSearch, 150);
});

async function runSearch() {
  const myGeneration = ++searchGeneration;
  const query = searchInput.value.trim();

  if (!query) {
    setSearchMode(false);
    searchResults.innerHTML = "";
    return;
  }
  setSearchMode(true);

  // Native Chrome API -- matches against both title and URL, across every
  // bookmark (filed or not), not just what's inside Organized Bookmarks.
  const matches = await chrome.bookmarks.search(query);
  const bookmarksOnly = matches.filter(node => node.url);
  if (myGeneration !== searchGeneration) return; // a newer keystroke superseded this

  if (bookmarksOnly.length === 0) {
    searchResults.innerHTML = `<div class="search-note">No matches.</div>`;
    return;
  }

  const shown = bookmarksOnly.slice(0, MAX_SEARCH_RESULTS);
  const rows = [];
  for (const node of shown) {
    const location = await getLocationLabel(node);
    if (myGeneration !== searchGeneration) return; // bail if superseded mid-loop
    rows.push({ node, location });
  }

  searchResults.innerHTML = "";
  for (const { node, location } of rows) {
    const row = document.createElement("div");
    row.className = "search-result";

    const link = document.createElement("a");
    link.className = "search-result-title";
    link.href = node.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = node.title || node.url;

    const meta = document.createElement("div");
    meta.className = "search-result-meta";
    meta.textContent = location ? `${location} — ${node.url}` : node.url;

    row.appendChild(link);
    row.appendChild(meta);
    searchResults.appendChild(row);
  }

  if (bookmarksOnly.length > MAX_SEARCH_RESULTS) {
    const note = document.createElement("div");
    note.className = "search-note";
    note.textContent =
      `Showing first ${MAX_SEARCH_RESULTS} of ${bookmarksOnly.length} matches — try a more specific search.`;
    searchResults.appendChild(note);
  }
}

(async () => {
  // Safety net: catch anything the background listener might have missed
  // (see reconcilePending() in lib/organize.js) before showing the count.
  const caught = await reconcilePending();
  await refreshPendingLine();
  if (caught > 0) {
    status.textContent =
      `Found ${caught} bookmark${caught === 1 ? "" : "s"} that didn't get picked up ` +
      `automatically — now ready to file.`;
  }
})();
