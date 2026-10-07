# Meal Planner

An offline-first phone app (PWA) for planning the week's meals, turning the plan into a shopping list, tracking the pantry and logging what was eaten, with a running protein total.
Built to sit next to Lift Log: same stack (plain HTML/CSS/JS, no build step), same hosting (GitHub Pages), same look.

Everything is stored on the phone (IndexedDB). There is no server and no account; after the first load it works with no signal.
**Export regularly**, because the data only exists on the phone until you do.

## One-time setup

### 1. Host the app on GitHub Pages

1. In GitHub Desktop: **File → Add local repository**, pick this `meal-planner` folder, and create a repository when prompted. Then **Publish repository** (untick "Keep this code private"; free GitHub Pages needs a public repository. No personal data is in the code; it all stays on the phone).
2. On github.com, open the repository and go to **Settings → Pages**. Set Source to **Deploy from a branch**, Branch to **main / (root)**, then **Save**.
3. After a minute the app is live at `https://<your-username>.github.io/meal-planner/`.

### 2. Install it on the phone

1. Open the GitHub Pages URL in **Chrome** on Android.
2. **⋮ menu → Add to Home screen** (or **Install app**).
3. Bodyweight starts at 97 kg, giving a 194 g daily protein target (2 g × kg). Change it under **⋮ → Settings** as it moves.
4. Optional: **Turn on notifications** in Settings.

## Using it

- **Sunday (Week tab):** **Use template** (the seeded "Standard week") or **Copy last week**, tap any slot to change it, then **Generate list**.
  - A slot holds a **recipe** (servings eaten, plus servings to cook; the list buys for the servings cooked), **leftovers** of an earlier slot that week, or **free text** with an optional protein estimate.
  - Tap a day's training tag (Weights / Treadmill / HIIT / Rest) to change it. New weeks start from Lift Log's schedule.
  - **Save as template** keeps a week you like for later.
- **Shop tab:** grouped by store, then aisle. Tap a row to tick it. The **$** button sets price, quantity, store, aisle and "local".
  Store, aisle and local are saved to the ingredient, so you fix an item once. **Regenerate** after changing the plan or pantry; ticks, prices and hand-added items are kept.
  A week's first list brings over last week's unticked hand-added items.
- **Pantry tab:** what's on hand is taken off the list. **Baked sourdough** adds a loaf; **Collected eggs** adds eggs.
- **Today tab:** tap **Eaten** on each planned meal, or **Swap** to log what you had instead. **+ Shake** logs the post-workout shake in one tap; **+ Add food** logs anything off-plan.
  The first time you log a recipe with no protein figure, it asks once and saves it to the recipe.
- **Recipes tab:** search, filter by tag, add or edit. Typing a new ingredient name creates it; set its store and aisle under **Ingredients**.
  Recipes flagged "contains lactose" show a red ⚠ badge everywhere.

### Reminders

| Reminder | When |
|---|---|
| Load the rice cooker | Evening before a breakfast recipe tagged *rice cooker* |
| Move the freezer portion to the fridge | Evening before a leftovers slot marked *from the freezer* (set automatically for batch recipes 3+ days later) |
| Sunday batch cook | Sunday morning, listing next week's *batch* recipes |

Times are set in Settings. Android can't wake a closed web app at a set time, so notifications only fire while the app is open or in the background.
The reminders always show on the **Today** screen. For alerts you can rely on, tap **Settings → Add the next 7 days to my calendar** each Sunday and open the file with Google Calendar.

## Exporting for the Brad's Fitness project

**⋮ → Export data** downloads three files:

| File | Contents |
|---|---|
| `meal-planner-YYYY-MM-DD.json` | Every store (recipes, ingredients, week plans and templates, shopping lists, pantry, meal log, settings), with `schemaVersion` and a description of the fields |
| `meal-planner-YYYY-MM-DD-meal-log.csv` | One row per meal eaten: date, slot, training tag, planned vs swapped vs extra, recipe or text, servings, protein (g), lactose flag |
| `meal-planner-YYYY-MM-DD-shopping.csv` | One row per shopping item: week, store, aisle, qty, ticked, price (AUD), local, plan or manual |

**Settings → Share export to Drive…** sends the same files to Google Drive (or anywhere) via Android's share sheet.
The `training` column uses Lift Log's session types (`lift`, `walk`, `hiit`, `rest`), so it joins Lift Log's export on `date`.

**Import** (⋮ → Import data) restores from a JSON export. Records are merged by id, and whichever copy was changed most recently wins. Use it to move to a new phone.

## Changing things

- **Seed data** (recipes, ingredients, the starting template) is in `seed.js`. It's only loaded on a fresh install; after that, edit recipes in the app.
- **App changes:** edit the files, bump `CACHE` in `sw.js` (e.g. `meal-planner-v2`), commit and push in GitHub Desktop. The phone picks up the new version the second time the app is opened.
- **Testing on the PC:** run `python -m http.server 8766` in this folder and open `http://localhost:8766`.
