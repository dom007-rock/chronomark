# Chrome Web Store listing draft

Draft copy and assets checklist for submitting Chronomark to the Chrome Web Store.
Everything here is plain text (the Store's fields don't render markdown) except this
file itself.

## Category
Productivity (Tools is the fallback if Productivity doesn't fit at submission time).

## Short description (max 132 characters)
Organizes bookmarks into Year/Month folders, finds duplicates, and makes everything searchable — 100% local.

(108 characters — room to spare if it needs adjusting.)

## Detailed description

```
Chronomark keeps years of accumulated bookmarks organized without any risk to what you already have.

WHAT IT DOES
- Files bookmarks into Organized Bookmarks / <Year> / <Month> folders automatically, based on when each one was actually saved
- Watches for new bookmarks and shows a badge count — click to file them in, nothing happens silently
- Searches your entire bookmark collection by title or URL, filed or not, and shows you where each result currently lives
- Detects genuine duplicate bookmarks (the same URL saved more than once) across your whole collection and reports them
- Corrects bookmarks that land in the wrong Year/Month folder automatically

SAFE BY DEFAULT
Everything above only copies bookmarks — your existing Bookmarks Bar and folder structure are never touched unless you turn on one of two optional toggles:
- Delete originals after filing (off by default)
- Automatically clean up duplicates (off by default, resets itself after each run)

Both explain exactly what they'll do before you turn them on.

100% LOCAL
Chronomark never sends your bookmarks anywhere. Everything runs entirely on your device using Chrome's own bookmarks and storage APIs — no analytics, no external servers, no accounts.
```

## Single purpose description
Chronomark organizes a user's Chrome bookmarks into dated folders, and helps find and
manage duplicate bookmarks — nothing else.

## Permissions justification

**bookmarks** — Required to read, create, move, and organize the user's own bookmarks
into dated folders, and to detect duplicate or misplaced bookmarks. Chronomark only
ever reads and modifies bookmarks — it does not access browsing history, open tabs,
or any other browser data.

**storage** — Used to store the extension's own local settings (the two opt-in
toggles) and small bookkeeping data (which bookmarks have already been filed, pending
counts) via `chrome.storage.local`. Nothing is synced to a Google account or
transmitted off the device.

## Privacy practices disclosure

Chronomark does not collect or transmit any user data off the device. It reads and
organizes the browser's own bookmarks locally via the `chrome.bookmarks` and
`chrome.storage` APIs. No analytics, tracking, or remote servers are used anywhere in
the code.

When filling out the Store dashboard's Privacy Practices tab, every data-collection
category (personally identifiable info, web history, user activity, etc.) should be
answered "not collected" on that basis — bookmark titles/URLs are processed locally
only, never transmitted. Note: I can't verify the dashboard's exact current wording or
whether it still demands a hosted privacy policy URL even for "collects nothing"
extensions — Google's requirements shift over time. Check the live dashboard at
submission time; a short policy page on withdach.com reusing the paragraph above would
cover it if one turns out to be required.

## Icon
`icons/icon128.png` already exists at the required 128x128 size — no action needed.

## Screenshots — still need to be captured, can't be generated here
Requirements: 1–5 images, 1280x800 or 640x400 (16:10), PNG or JPEG, no alpha channel.
I don't have access to your real Chrome/bookmarks to capture these, and the sandboxed
browser tool available to me can't load an unpacked extension (chrome:// is blocked
there) — these need to come from your own machine.

Suggested shots, in order of usefulness:
1. Popup with a few pending bookmarks and the "File new bookmarks" button visible
2. Chrome's bookmark manager showing the `Organized Bookmarks / <Year> / <Month>` tree
3. Search in action (a query with a few results shown)
4. Duplicate detection view (the "Found N bookmarked URLs saved more than once" list)
5. The two settings toggles with an info tooltip open

If your raw screenshots aren't exactly the right pixel dimensions, say so and I can
write a small crop/pad script (same pure-Python, no-dependencies style as
`tools/generate_icons.py`) rather than you doing it by hand.

## Still open before actual submission
- [ ] One-time $5 Chrome Web Store developer registration, if not already done
- [ ] Screenshots (above)
- [ ] Confirm current Privacy Practices tab wording on the real dashboard
- [ ] Decide: submit as unlisted first, or straight to public

None of the above has been submitted anywhere — this file is prep only.
