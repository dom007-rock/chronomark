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
const duplicatesBtn = document.getElementById("duplicatesBtn");
const duplicatesResults = document.getElementById("duplicatesResults");
const autoCleanDuplicatesToggle = document.getElementById("autoCleanDuplicatesToggle");

deleteOriginalsToggle.addEventListener("change", () => {
  setDeleteOriginalsEnabled(deleteOriginalsToggle.checked);
});
getDeleteOriginalsEnabled().then(enabled => {
  deleteOriginalsToggle.checked = enabled;
});

autoCleanDuplicatesToggle.addEventListener("change", () => {
  setAutoCleanDuplicatesEnabled(autoCleanDuplicatesToggle.checked);
});
getAutoCleanDuplicatesEnabled().then(enabled => {
  autoCleanDuplicatesToggle.checked = enabled;
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

// Shared "load N more (M remaining)" button used by both the search results
// and the duplicates list, so neither is stuck at a hard 50-item ceiling.
function makeLoadMoreButton(container, totalCount, shownCount, onClick) {
  const remaining = totalCount - shownCount;
  const btn = document.createElement("button");
  btn.className = "load-more-btn";
  btn.textContent = `Show ${Math.min(MAX_SEARCH_RESULTS, remaining)} more (${remaining} remaining)`;
  btn.addEventListener("click", onClick);
  container.appendChild(btn);
}

let duplicateGroups = [];
let duplicatesShownCount = 0;

// Hidden until findDuplicateGroups() (run once at startup, below) actually
// finds something. Clicking toggles the list open/closed -- the groups
// themselves were already computed at startup, so this is just rendering.
duplicatesBtn.addEventListener("click", async () => {
  const isHidden = !duplicatesResults.classList.contains("visible");
  if (!isHidden) {
    duplicatesResults.classList.remove("visible");
    duplicatesResults.innerHTML = "";
    return;
  }

  duplicatesResults.innerHTML = "";
  duplicatesShownCount = 0;
  await renderMoreDuplicates();
  duplicatesResults.classList.add("visible");
});

async function renderMoreDuplicates() {
  const existingBtn = duplicatesResults.querySelector(".load-more-btn");
  if (existingBtn) existingBtn.remove();

  const nextBatch = duplicateGroups.slice(duplicatesShownCount, duplicatesShownCount + MAX_SEARCH_RESULTS);
  for (const group of nextBatch) {
    const groupEl = document.createElement("div");
    groupEl.className = "search-result";

    const title = document.createElement("a");
    title.className = "search-result-title";
    title.href = group[0].url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = group[0].title || group[0].url;
    groupEl.appendChild(title);

    for (const node of group) {
      const location = await getLocationLabel(node);
      const meta = document.createElement("div");
      meta.className = "search-result-meta";
      meta.textContent = location ? `${location} — ${node.url}` : node.url;
      groupEl.appendChild(meta);
    }

    duplicatesResults.appendChild(groupEl);
  }
  duplicatesShownCount += nextBatch.length;

  if (duplicatesShownCount < duplicateGroups.length) {
    makeLoadMoreButton(duplicatesResults, duplicateGroups.length, duplicatesShownCount, renderMoreDuplicates);
  }
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
let currentSearchMatches = [];
let searchShownCount = 0;

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

  currentSearchMatches = bookmarksOnly;
  searchShownCount = 0;
  searchResults.innerHTML = "";

  if (bookmarksOnly.length === 0) {
    searchResults.innerHTML = `<div class="search-note">No matches.</div>`;
    return;
  }

  await renderMoreSearchResults(myGeneration);
}

async function renderMoreSearchResults(myGeneration) {
  const existingBtn = searchResults.querySelector(".load-more-btn");
  if (existingBtn) existingBtn.remove();

  const nextBatch = currentSearchMatches.slice(searchShownCount, searchShownCount + MAX_SEARCH_RESULTS);
  for (const node of nextBatch) {
    const location = await getLocationLabel(node);
    if (myGeneration !== searchGeneration) return; // bail if superseded mid-loop

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
  searchShownCount += nextBatch.length;

  if (searchShownCount < currentSearchMatches.length) {
    makeLoadMoreButton(searchResults, currentSearchMatches.length, searchShownCount, () => renderMoreSearchResults(searchGeneration));
  }
}

(async () => {
  // Safety net: catch anything the background listeners might have missed
  // (see reconcilePending() / reconcilePlacement() in lib/organize.js)
  // before showing the count.
  const caught = await reconcilePending();
  const corrected = await reconcilePlacement();
  await refreshPendingLine();

  // Silent scan -- runs once here, not from a live listener. Either reports
  // (default) or, if the auto-clean toggle is on, resolves everything in
  // one shot with no per-group review.
  const foundGroups = await findDuplicateGroups();
  const autoClean = await getAutoCleanDuplicatesEnabled();
  let cleaned = 0;
  if (autoClean && foundGroups.length > 0) {
    cleaned = await cleanupDuplicateGroups(foundGroups);
    await setKnownDuplicateUrls(new Set()); // just resolved -- nothing left to remember
  } else {
    duplicateGroups = foundGroups;
    if (duplicateGroups.length > 0) {
      // Compare against what was already known as of the last popup-open,
      // so a repeat visit doesn't re-announce the exact same list -- only
      // genuinely new duplicates get called out specifically.
      const knownUrls = await getKnownDuplicateUrls();
      const newGroups = duplicateGroups.filter(g => !knownUrls.has(g[0].url));
      await setKnownDuplicateUrls(new Set(duplicateGroups.map(g => g[0].url)));

      duplicatesBtn.textContent = (newGroups.length > 0 && newGroups.length < duplicateGroups.length)
        ? `Found ${newGroups.length} new duplicate URL${newGroups.length === 1 ? "" : "s"} (${duplicateGroups.length} total) — click to view`
        : `Found ${duplicateGroups.length} bookmarked URL${duplicateGroups.length === 1 ? "" : "s"} saved more than once — click to view`;
      duplicatesBtn.classList.add("visible");
    } else {
      await setKnownDuplicateUrls(new Set());
    }
  }

  const notes = [];
  if (caught > 0) {
    notes.push(`Found ${caught} bookmark${caught === 1 ? "" : "s"} that didn't get picked up automatically — now ready to file.`);
  }
  if (corrected > 0) {
    notes.push(`Corrected ${corrected} misplaced bookmark${corrected === 1 ? "" : "s"} into the right Year/Month folder.`);
  }
  if (cleaned > 0) {
    notes.push(`Cleaned up ${cleaned} duplicate bookmark${cleaned === 1 ? "" : "s"}, kept the most recent copy of each.`);
  }
  if (notes.length > 0) {
    status.textContent = notes.join(" ");
  }
})();
