// Shared between background.js (service worker) and popup.js.
// Loaded via importScripts() in the service worker and a <script> tag in popup.html.

const ROOT_FOLDER_TITLE = "Organized Bookmarks";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const ORGANIZING_FLAG_KEY = "organizeInProgress";
const BULK_OP_STALE_MS = 10 * 60 * 1000; // 10 minutes -- far longer than any real run takes

async function beginBulkOperation() {
  await chrome.storage.local.set({ [ORGANIZING_FLAG_KEY]: { active: true, startedAt: Date.now() } });
}

async function endBulkOperation() {
  await chrome.storage.local.set({ [ORGANIZING_FLAG_KEY]: { active: false, startedAt: 0 } });
}

// Self-healing check used by the background listeners: if the flag has been
// "active" longer than any real bulk operation could plausibly take, treat
// it as stale and clear it. Guards against the popup closing mid-operation,
// which skips its `finally` block and would otherwise leave new bookmarks
// silently ignored forever.
async function isBulkOperationActive() {
  const { [ORGANIZING_FLAG_KEY]: flag } = await chrome.storage.local.get(ORGANIZING_FLAG_KEY);
  if (!flag || !flag.active) return false;
  if (Date.now() - (flag.startedAt || 0) > BULK_OP_STALE_MS) {
    await endBulkOperation();
    return false;
  }
  return true;
}

// Wraps a bulk bookmark-creating action so the background listener ignores
// every create/remove that happens along the way, instead of treating our
// own copies as new unfiled bookmarks.
async function runAsBulkOperation(fn) {
  await beginBulkOperation();
  try {
    return await fn();
  } finally {
    await endBulkOperation();
  }
}

async function findChildFolder(parentId, title) {
  const children = await chrome.bookmarks.getChildren(parentId);
  return children.find(c => !c.url && c.title === title) || null;
}

async function getOrCreateFolder(parentId, title) {
  const existing = await findChildFolder(parentId, title);
  if (existing) return existing;
  return chrome.bookmarks.create({ parentId, title });
}

async function getOtherBookmarksId() {
  const tree = await chrome.bookmarks.getTree();
  const roots = tree[0].children || [];
  // Chrome numbers "Other Bookmarks" as id "2". Fall back to a title match
  // in case a Chromium-based fork orders/numbers roots differently.
  const byId = roots.find(r => r.id === "2");
  if (byId) return byId.id;
  const byTitle = roots.find(r => /other/i.test(r.title));
  return (byTitle || roots[0]).id;
}

// Full-tree, read-only search for every folder named ROOT_FOLDER_TITLE,
// wherever it currently lives. Never creates anything -- safe to call from
// a passive event listener. Needed because the root folder is a regular
// bookmark folder the user can drag anywhere; a lookup scoped to a single
// fixed parent (e.g. "Other Bookmarks") stops finding it the moment it's
// moved, and every caller that only checked that one place would then
// create its own new copy -- which is exactly how the duplicate-folder bug
// happened.
async function findAllOrganizedRootFolders() {
  const tree = await chrome.bookmarks.getTree();
  const found = [];
  function walk(node) {
    if (!node.url && node.title === ROOT_FOLDER_TITLE) found.push(node);
    for (const child of node.children || []) walk(child);
  }
  for (const root of tree) walk(root);
  return found;
}

async function findOrganizedRoot() {
  const all = await findAllOrganizedRootFolders();
  return all[0] || null;
}

async function ensureOrganizedRoot() {
  const existing = await findOrganizedRoot();
  if (existing) return existing;
  const otherId = await getOtherBookmarksId();
  return chrome.bookmarks.create({ parentId: otherId, title: ROOT_FOLDER_TITLE });
}

// Scoped bookmark collector for a specific folder (used by the duplicate
// repair below) -- unlike getAllBookmarks(), this only walks *below* a
// given folder rather than the whole tree.
async function collectBookmarksUnder(folderId) {
  const results = [];
  async function walk(id) {
    const children = await chrome.bookmarks.getChildren(id);
    for (const child of children) {
      if (child.url) results.push(child);
      else await walk(child.id);
    }
  }
  await walk(folderId);
  return results;
}

// One-time repair for the duplicate-folder bug: merges every extra
// "Organized Bookmarks" folder's contents into the first one found
// (deduping by URL, same as a normal organize pass), then removes the
// now-empty duplicates. Only ever touches folders this extension created
// itself -- never anything from the user's original bookmarks.
async function consolidateDuplicateRoots() {
  const allRoots = await findAllOrganizedRootFolders();
  if (allRoots.length <= 1) {
    return { canonicalId: allRoots[0]?.id || null, merged: 0, duplicatesRemoved: 0 };
  }

  const canonical = allRoots[0];
  const duplicates = allRoots.slice(1);
  const existingUrls = await collectExistingUrls(canonical.id);
  let merged = 0;

  for (const dup of duplicates) {
    const bookmarksInDup = await collectBookmarksUnder(dup.id);
    for (const b of bookmarksInDup) {
      if (existingUrls.has(b.url)) continue;
      const d = new Date(b.dateAdded || Date.now());
      const year = String(d.getFullYear());
      const month = MONTH_NAMES[d.getMonth()];
      const yearFolder = await getOrCreateFolder(canonical.id, year);
      const monthFolder = await getOrCreateFolder(yearFolder.id, month);
      await chrome.bookmarks.create({
        parentId: monthFolder.id,
        title: b.title || b.url,
        url: b.url
      });
      existingUrls.add(b.url);
      merged++;
    }
    await chrome.bookmarks.removeTree(dup.id);
  }

  return { canonicalId: canonical.id, merged, duplicatesRemoved: duplicates.length };
}

// Every URL already filed anywhere under the organized root, so repeated
// runs (and duplicate original bookmarks) never create the same entry twice.
async function collectExistingUrls(rootId) {
  const urls = new Set();
  async function walk(id) {
    const children = await chrome.bookmarks.getChildren(id);
    for (const child of children) {
      if (child.url) urls.add(child.url);
      else await walk(child.id);
    }
  }
  await walk(rootId);
  return urls;
}

// Walks the whole bookmark tree and returns every bookmark (not folder),
// excluding anything already inside excludeRootId — so a full sweep never
// re-processes the copies it made on a previous run.
async function getAllBookmarks(excludeRootId) {
  const tree = await chrome.bookmarks.getTree();
  const results = [];

  function walk(node, skip) {
    const skipHere = skip || node.id === excludeRootId;
    if (node.url) {
      if (!skipHere) results.push(node);
      return;
    }
    for (const child of node.children || []) {
      walk(child, skipHere);
    }
  }

  for (const root of tree) walk(root, false);
  return results;
}

// Groups bookmarks by Year -> Month using their real dateAdded (ms since
// epoch, as chrome.bookmarks reports it -- NOT the seconds-based ADD_DATE
// used by exported Netscape bookmark HTML files, which is a different unit).
function groupByYearMonth(bookmarks) {
  const grouped = new Map();
  for (const b of bookmarks) {
    const d = new Date(b.dateAdded || Date.now());
    const year = String(d.getFullYear());
    const month = MONTH_NAMES[d.getMonth()];
    if (!grouped.has(year)) grouped.set(year, new Map());
    const yearMap = grouped.get(year);
    if (!yearMap.has(month)) yearMap.set(month, []);
    yearMap.get(month).push(b);
  }
  return grouped;
}

// Copies (never moves) the given bookmarks into Organized Bookmarks /
// <Year> / <Month>, skipping anything whose URL is already filed there.
async function organizeBookmarks(bookmarks) {
  const root = await ensureOrganizedRoot();
  const existingUrls = await collectExistingUrls(root.id);

  let filed = 0;
  let skipped = 0;
  const seenThisRun = new Set();

  const grouped = groupByYearMonth(bookmarks);
  const years = [...grouped.keys()].sort((a, b) => Number(b) - Number(a));

  for (const year of years) {
    const yearFolder = await getOrCreateFolder(root.id, year);
    const monthMap = grouped.get(year);
    const months = [...monthMap.keys()].sort(
      (a, b) => MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b)
    );

    for (const month of months) {
      const monthFolder = await getOrCreateFolder(yearFolder.id, month);
      const bookmarksInMonth = monthMap.get(month).slice().sort((a, b) =>
        (a.title || a.url).localeCompare(b.title || b.url, undefined, { sensitivity: "base" })
      );

      for (const b of bookmarksInMonth) {
        if (existingUrls.has(b.url) || seenThisRun.has(b.url)) {
          skipped++;
          continue;
        }
        await chrome.bookmarks.create({
          parentId: monthFolder.id,
          title: b.title || b.url,
          url: b.url
        });
        seenThisRun.add(b.url);
        filed++;
      }
    }
  }

  return { filed, skipped, rootId: root.id };
}
