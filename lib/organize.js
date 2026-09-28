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

const PENDING_KEY = "pendingBookmarkIds";

async function getPending() {
  const data = await chrome.storage.local.get(PENDING_KEY);
  return data[PENDING_KEY] || [];
}

async function updateBadge(count) {
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  // Red, not the icon's own indigo -- since the icon was recolored to match
  // the popup's indigo accent, a same-color badge blended into it and read
  // as one bulky purple blob instead of a small distinct count.
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
}

async function setPending(ids) {
  await chrome.storage.local.set({ [PENDING_KEY]: ids });
  await updateBadge(ids.length);
}

// Tracks which specific bookmarks (by id) have actually been filed, as
// opposed to which URLs merely appear somewhere in the archive. The two are
// not the same thing: a URL can already exist in Organized Bookmarks (e.g.
// an older bookmark for that page that was manually moved or edited there,
// never through organizeBookmarks() at all) while a brand new, distinct
// bookmark for that same URL still deserves to be recognized and filed on
// its own. Dedup by URL is still used *within* a single run (see
// organizeBookmarks below) to collapse genuine simultaneous duplicates --
// this id-based tracking is what prevents re-filing the same bookmark
// across separate runs.
const FILED_IDS_KEY = "filedOriginalIds";

async function getFiledIds() {
  const { [FILED_IDS_KEY]: ids } = await chrome.storage.local.get(FILED_IDS_KEY);
  return new Set(ids || []);
}

async function addFiledIds(ids) {
  if (ids.length === 0) return;
  const current = await getFiledIds();
  for (const id of ids) current.add(id);
  await chrome.storage.local.set({ [FILED_IDS_KEY]: [...current] });
}

const DELETE_ORIGINALS_KEY = "deleteOriginalsEnabled";

async function getDeleteOriginalsEnabled() {
  const { [DELETE_ORIGINALS_KEY]: enabled } = await chrome.storage.local.get(DELETE_ORIGINALS_KEY);
  return !!enabled;
}

async function setDeleteOriginalsEnabled(enabled) {
  await chrome.storage.local.set({ [DELETE_ORIGINALS_KEY]: !!enabled });
}

const AUTO_CLEAN_DUPLICATES_KEY = "autoCleanDuplicatesEnabled";

async function getAutoCleanDuplicatesEnabled() {
  const { [AUTO_CLEAN_DUPLICATES_KEY]: enabled } = await chrome.storage.local.get(AUTO_CLEAN_DUPLICATES_KEY);
  return !!enabled;
}

async function setAutoCleanDuplicatesEnabled(enabled) {
  await chrome.storage.local.set({ [AUTO_CLEAN_DUPLICATES_KEY]: !!enabled });
}

// URLs already surfaced as duplicates as of the last popup-open, so a later
// scan can tell "still the same ones" apart from "something new showed up"
// instead of re-announcing the exact same list every single time.
const KNOWN_DUPLICATE_URLS_KEY = "knownDuplicateUrls";

async function getKnownDuplicateUrls() {
  const { [KNOWN_DUPLICATE_URLS_KEY]: urls } = await chrome.storage.local.get(KNOWN_DUPLICATE_URLS_KEY);
  return new Set(urls || []);
}

async function setKnownDuplicateUrls(urlSet) {
  await chrome.storage.local.set({ [KNOWN_DUPLICATE_URLS_KEY]: [...urlSet] });
}

// One-shot, no per-group review: keeps whichever bookmark in each group has
// the most recent dateAdded and removes the rest. Used only when the
// auto-clean toggle is on -- deliberately simple and deterministic rather
// than trying to be clever about archive-vs-not.
async function cleanupDuplicateGroups(groups) {
  let removed = 0;
  for (const group of groups) {
    const sorted = [...group].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    const toRemove = sorted.slice(1);
    for (const node of toRemove) {
      try {
        await chrome.bookmarks.remove(node.id);
        removed++;
      } catch {
        // already gone somehow -- fine
      }
    }
  }
  return removed;
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

// Walks up from folderId checking whether ancestorId is folderId itself or
// one of its ancestors. Shared by the onCreated/onMoved listeners to answer
// "is this bookmark inside Organized Bookmarks" regardless of nesting depth.
async function isDescendantOfFolder(folderId, ancestorId) {
  let currentId = folderId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) return true;
    visited.add(currentId);
    try {
      const [node] = await chrome.bookmarks.get(currentId);
      currentId = node.parentId;
    } catch {
      return false;
    }
  }
  return false;
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

// Checks a bookmark already known to be inside Organized Bookmarks and
// moves it into the Year/Month its own dateAdded implies, if it isn't there
// already -- catches bookmarks that land inside the archive some other way
// than through organizeBookmarks() (Chrome defaulting the save dialog to a
// folder inside the archive, or a manual drag into the wrong Year/Month).
// Called live from the onCreated/onMoved listeners, not as a manual sweep.
// The move this triggers fires another onMoved event, but since both its
// old and new parent are inside the archive, that listener's own
// boundary-crossing check makes it a no-op -- safe, not a loop.
async function fixPlacementIfNeeded(bookmark, root) {
  const d = new Date(bookmark.dateAdded || Date.now());
  const correctYear = String(d.getFullYear());
  const correctMonth = MONTH_NAMES[d.getMonth()];

  let currentParent;
  try {
    [currentParent] = await chrome.bookmarks.get(bookmark.parentId);
  } catch {
    return false;
  }

  const isRightMonth = currentParent && !currentParent.url && currentParent.title === correctMonth;
  let isRightYear = false;
  if (isRightMonth && currentParent.parentId) {
    try {
      const [grandparent] = await chrome.bookmarks.get(currentParent.parentId);
      isRightYear = !!grandparent && grandparent.title === correctYear;
    } catch {
      // isRightYear stays false -- treated as misplaced below
    }
  }
  if (isRightMonth && isRightYear) return false; // already correctly placed

  const yearFolder = await getOrCreateFolder(root.id, correctYear);
  const monthFolder = await getOrCreateFolder(yearFolder.id, correctMonth);
  if (bookmark.parentId === monthFolder.id) return false; // already there after all

  await chrome.bookmarks.move(bookmark.id, { parentId: monthFolder.id });
  return true;
}

// Safety net for the same reason reconcilePending() exists: the live
// onCreated/onMoved correction can miss (MV3 service-worker reliability
// gap), leaving something sitting misplaced with nothing to ever catch it
// again. Run alongside reconcilePending() when the popup opens.
//
// Deliberately NOT built on fixPlacementIfNeeded() per bookmark -- that
// looks up each bookmark's parent and grandparent with separate awaited
// calls, fine for a single live event but far too slow across hundreds of
// archived bookmarks (same class of bug as the duplicate-scan one). Instead,
// the Year/Month a folder represents is already known from walking down to
// reach it, so each bookmark's placement can be checked with zero extra
// lookups -- only bookmarks that actually turn out misplaced (rare) pay for
// a move.
async function reconcilePlacement() {
  const root = await ensureOrganizedRoot();
  let moved = 0;

  async function walk(folderId, yearTitle, monthTitle) {
    const children = await chrome.bookmarks.getChildren(folderId);
    for (const child of children) {
      if (child.url) {
        const d = new Date(child.dateAdded || Date.now());
        const correctYear = String(d.getFullYear());
        const correctMonth = MONTH_NAMES[d.getMonth()];
        if (yearTitle === correctYear && monthTitle === correctMonth) continue; // already right

        const yearFolder = await getOrCreateFolder(root.id, correctYear);
        const monthFolder = await getOrCreateFolder(yearFolder.id, correctMonth);
        if (child.parentId === monthFolder.id) continue; // already there after all
        await chrome.bookmarks.move(child.id, { parentId: monthFolder.id });
        moved++;
      } else {
        // Depth 0 (direct child of root) is a Year folder; depth 1 is Month.
        const nextYear = yearTitle === null ? child.title : yearTitle;
        const nextMonth = yearTitle === null ? null : child.title;
        await walk(child.id, nextYear, nextMonth);
      }
    }
  }

  await walk(root.id, null, null);
  return moved;
}

// Reporting only, never touches anything. Scans the ENTIRE bookmark tree
// (unlike getAllBookmarks(), nothing is excluded -- duplicates inside
// Organized Bookmarks count too) and groups every bookmark by URL. Run once
// per popup-open alongside reconcilePending()/reconcilePlacement(), not from
// a live listener -- a full-tree scan on every bookmark event would be
// wasteful for something that doesn't need millisecond-level freshness.
//
// One original still sitting outside the archive plus its one filed copy
// inside is the NORMAL, intended result of copy-only filing -- not a
// duplicate worth flagging. Only groups where more than one instance sits
// outside the archive, or more than one sits inside it, are genuine
// anomalies (bookmarked the same page twice, or filed more than once).
async function findDuplicateGroups() {
  const root = await ensureOrganizedRoot();
  const tree = await chrome.bookmarks.getTree();
  const byUrl = new Map();

  // "Inside the archive or not" gets computed for every node right here, in
  // the same single pass that's already walking the whole tree -- carried
  // down as a plain boolean, same pattern as getAllBookmarks()'s `skip` flag.
  // No per-node async lookups (that was the actual cause of the multi-second
  // delay: walking up the folder chain with a separate awaited call for
  // every single duplicate, one level at a time).
  function walk(node, insideArchive) {
    const isInside = insideArchive || node.id === root.id;
    if (node.url) {
      if (!byUrl.has(node.url)) byUrl.set(node.url, []);
      byUrl.get(node.url).push({ node, isInside });
    }
    for (const child of node.children || []) walk(child, isInside);
  }
  for (const r of tree) walk(r, false);

  const groups = [];
  for (const entries of byUrl.values()) {
    if (entries.length < 2) continue;

    const insideCount = entries.filter(e => e.isInside).length;
    const outsideCount = entries.length - insideCount;
    if (outsideCount <= 1 && insideCount <= 1) continue; // normal original+copy pair

    const nodes = entries.map(e => e.node);

    groups.push(nodes);
  }

  return groups.sort((a, b) => b.length - a.length);
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

// Safety net for chrome.bookmarks.onCreated occasionally not firing (a known
// MV3 service-worker reliability gap, not something app code can fully rule
// out) -- run whenever the popup opens to catch anything the background
// listener missed: any original bookmark that hasn't itself been filed and
// isn't already tracked as pending gets added to pending now. Checked by id
// (see FILED_IDS_KEY above), not by URL -- a URL already sitting in the
// archive doesn't mean THIS bookmark was ever accounted for. Returns how
// many were caught, so the popup can mention it if it's ever non-zero.
async function reconcilePending() {
  const root = await ensureOrganizedRoot();
  const allOriginals = await getAllBookmarks(root.id);
  const filedIds = await getFiledIds();
  const pending = await getPending();
  const pendingSet = new Set(pending);

  const missed = allOriginals.filter(b => !filedIds.has(b.id) && !pendingSet.has(b.id));
  if (missed.length > 0) {
    await setPending([...pending, ...missed.map(b => b.id)]);
  }
  return missed.length;
}

// Copies the given bookmarks into Organized Bookmarks / <Year> / <Month>.
// Skips anything whose specific id has already been filed before (tracked
// persistently -- see FILED_IDS_KEY above), or whose URL is shared by
// another bookmark already handled earlier in this same run. Deliberately
// does NOT skip just because the URL already exists somewhere in the
// archive from a past run -- that would silently swallow a genuinely new
// bookmark for a URL whose old copy got there some other way (moved,
// edited) without ever being tracked by id. Originals are left alone UNLESS
// the opt-in "delete originals after filing" setting is on (off by
// default), in which case each original is removed right after its own copy
// is successfully created.
async function organizeBookmarks(bookmarks) {
  const root = await ensureOrganizedRoot();
  const filedIds = await getFiledIds();
  const deleteOriginals = await getDeleteOriginalsEnabled();

  let filed = 0;
  let skipped = 0;
  let originalsDeleted = 0;
  const newlyFiledIds = [];

  // Pre-seed with the URLs of anything in THIS batch that's already been
  // filed by id, so every sibling sharing that URL gets skipped consistently
  // regardless of which order they happen to be processed in.
  const seenUrls = new Set(bookmarks.filter(b => filedIds.has(b.id)).map(b => b.url));

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
        if (filedIds.has(b.id) || seenUrls.has(b.url)) {
          skipped++;
          continue;
        }
        await chrome.bookmarks.create({
          parentId: monthFolder.id,
          title: b.title || b.url,
          url: b.url
        });
        seenUrls.add(b.url);
        newlyFiledIds.push(b.id);
        filed++;

        if (deleteOriginals) {
          try {
            await chrome.bookmarks.remove(b.id);
            originalsDeleted++;
          } catch {
            // already gone (e.g. removed by the user in the meantime) -- fine
          }
        }
      }
    }
  }

  await addFiledIds(newlyFiledIds);
  return { filed, skipped, originalsDeleted, rootId: root.id };
}
