// Shared between background.js (service worker) and popup.js.
// Loaded via importScripts() in the service worker and a <script> tag in popup.html.

const ROOT_FOLDER_TITLE = "Organized Bookmarks";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

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

async function ensureOrganizedRoot() {
  const otherId = await getOtherBookmarksId();
  return getOrCreateFolder(otherId, ROOT_FOLDER_TITLE);
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
