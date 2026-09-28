# Chronomark

A Chrome extension that files your bookmarks into `Organized Bookmarks / <Year> / <Month>`
folders, finds duplicates across your entire bookmark collection, and lets you search everything
you've ever bookmarked — all without touching your originals unless you explicitly ask it to.

## Why

Years of unsorted bookmarks pile up fast. This extension keeps a tidy, chronological copy
alongside whatever mess already exists in your Bookmarks Bar or Other Bookmarks, so you get
organization with zero risk to what's already there by default.

## How it works

- **Organize ALL bookmarks now** — a full sweep. Copies every bookmark in your browser into
  `Other Bookmarks / Organized Bookmarks / <Year> / <Month>`, sorted alphabetically within each
  month. Already-filed bookmarks are skipped, so running it again is safe and just picks up
  anything new.
- **New bookmarks** — a background listener watches for new bookmarks. When you add one, the
  toolbar badge shows a count. Click the icon and hit **File new bookmarks** to copy them in —
  nothing is filed automatically without you seeing it first.
- **Search** — a search bar right in the popup finds any bookmark by title or URL, filed or not,
  and shows you where it's currently sitting.
- **Duplicate detection** — the popup silently checks for bookmarks saved more than once (not
  just inside the archive — anywhere) and shows a count if it finds any, with the option to view
  exactly which URLs and where. Normal original-plus-its-one-filed-copy pairs don't count; this
  only flags genuine accidental duplicates.
- **Misplaced-bookmark correction** — if a bookmark ends up inside "Organized Bookmarks" some
  other way (Chrome defaulting its save dialog to a folder inside the archive, a stray drag) it
  gets quietly moved into the Year/Month its own timestamp actually implies, live.
- **Originals are safe by default.** Everything above is additive — bookmarks get copied, your
  existing structure stays exactly as it was, unless you turn on one of the two opt-in toggles
  below.

### Opt-in toggles (both off by default)

| Toggle | What it does |
|---|---|
| **Delete originals after filing** | Once a bookmark is copied into the archive, its original gets deleted too — so your Bookmarks Bar stays as tidy as the archive, not just duplicated. |
| **Automatically clean up duplicates** | One-shot: keeps whichever copy of a duplicated URL was added most recently and deletes the rest. Resets itself back off after running — it's not a standing mode. |

Both explain exactly what they do via a hover (ⓘ) before you turn them on.

## Install (unpacked — not yet on the Chrome Web Store)

1. Clone this repo.
2. Go to `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked**, and select this folder.
4. Pin the extension icon so you can see the new-bookmark badge.

## Project status

Built to scratch a personal itch (thousands of unsorted bookmarks accumulated over years) and
open-sourced in case it's useful to anyone else. Core feature set (organize, search, dedup,
misplaced-bookmark correction) is built and has been through real-world testing and bug-fixing.
Not yet on the Chrome Web Store.

### Roadmap ideas (deliberately not in v1)
- Category folders (Travel, Food, etc.) — the hard part is auto-categorization without sending
  your bookmarks to an external service; still needs a proper design pass
- Domain-based grouping as an alternate view
- Firefox / Edge support

## License

MIT — see [LICENSE](LICENSE).
