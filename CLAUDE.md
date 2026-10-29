# Meal and Shopping Planner: notes for Claude

Brad's personal PWA (plain HTML/CSS/JS, no build step), hosted on GitHub Pages at https://bradwhiteau.github.io/meal-planner/.
Data lives on his phone (IndexedDB); Google Drive is a mailbox to Claude (see DATA.md). The spec history is in
`meal-planner-pack-sizes-and-pantry-spec.md`.

## Before publishing any change

1. **Run the tests.** Serve this folder (`python -m http.server 8766`) and open `http://localhost:8766/tests.html?auto`
   (or press Run). All checks must be green. The suite runs the real app in test mode (`index.html?test=1`, localhost
   only): its own database `meal-planner-test`, its own `mpt.` storage keys, no service worker, Google Drive faked.
   It never touches real data.
2. **Every bug gets a test.** Add a scenario or check to `tests/suite.js` that fails without the fix (try it: put the bug
   back, see red, restore). Named scenarios so far: Pack sizes, Bolognese, Tuna mornay, Bulgogi, Kitty litter, Pepsi Max, Extras-only meal card, Import rules,
   Drive mailbox, View-only.
3. **Bump `APP_VERSION`** in app.js (shown in Settings → Data) and **`CACHE`** in sw.js, or phones keep the old version.
4. Check nothing private is staged: no Drive folder IDs, tokens or personal data (the OAuth client ID in config.js is
   public by design). `*.json` and `meal-planner-data/` are git-ignored.
5. Commit, push to `main`, and confirm the new `APP_VERSION` is live on GitHub Pages.

## Things to know

- "Larder" on screen = `pantryItems` in the data (kept for compatibility). One row per ingredient and location; prepared
  meals are rows with `recipeId` (portions).
- When testing locally by hand, an old service worker can serve stale files: unregister it and clear caches first
  (the test page does this itself).
- Data changes from Claude go through inbox patch files (DATA.md), never by editing Brad's data directly.
