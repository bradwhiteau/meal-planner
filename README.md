# Meal Planner

An offline-first phone app (PWA) for planning the week's meals, turning the plan into a shopping list, tracking the pantry and logging what was eaten, with a running protein total.
Built to sit next to Lift Log: same stack (plain HTML/CSS/JS, no build step), same hosting (GitHub Pages), same look.

Everything is stored on the phone (IndexedDB). The public site serves only code: anyone else who opens it gets an empty app.
Optional Google Drive sync gives Claude a mailbox to send changes in and read data out (see [DATA.md](DATA.md)).

## One-time setup

### 1. Host the app on GitHub Pages

Done: the app is at `https://bradwhiteau.github.io/meal-planner/`. Pushing to `main` updates it within a minute.

### 2. Google Drive sync (optional)

This needs a Google OAuth **client ID** (public by design, not a secret) in `config.js`.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project, e.g. **Meal Planner**. Check the project picker (top left) shows it for the steps below.
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. Search the console for **Google Auth Platform** (or **☰ → APIs & Services → OAuth consent screen**) and click **Get started**: app name **Meal Planner**, your email for support and contact, Audience **External**, then **Create**.
4. **Audience**: leave **Publishing status: Testing**, and under **Test users → Add users** add your own Google account. Nobody else can sign in.
5. **Data access → Add or remove scopes**: tick `.../auth/drive.readonly` and `.../auth/drive.file`.
6. **Clients → Create client**: type **Web application**. Under **Authorized JavaScript origins → Add URI** enter `https://bradwhiteau.github.io` (no path, no trailing slash). Leave redirect URIs empty. **Create**, then copy the **Client ID** (ends in `.apps.googleusercontent.com`).
7. Put the client ID in `config.js`, bump `CACHE` in `sw.js`, commit and push. (Done: the client ID is in `config.js`.)

Then on the phone: **⋮ → Settings → Google Drive**, tap **Find my folders in Drive** (or paste the **inbox** and **outbox** folder IDs or links), then **Test connection**.
Google will warn that the app isn't verified (it's your own, in Testing mode): tap **Continue**, and tick both Drive boxes.

### 3. Install it on the phone

1. Open the GitHub Pages URL in **Chrome** on Android.
2. **⋮ menu → Add to Home screen** (or **Install app**).
3. Set your bodyweight under **⋮ → Settings** (the protein target is 2 g × kg by default).

## Using it

- **Sunday (Week tab):** **Use template** or **Copy last week**, tap any slot to change it, then **Generate list**.
  - A slot holds a **recipe** (servings eaten, plus servings to cook; the list buys for the servings cooked), **leftovers** of an earlier slot that week, or **free text** with an optional protein estimate.
  - Tap a day's training tag (Weights / Treadmill / HIIT / Rest) to change it. New weeks start from Lift Log's schedule.
  - **Save as template** keeps a week you like for later.
- **Shop tab:** grouped by store, then aisle. Tap a row, or swipe it right, to tick it. The **$** button sets price, quantity, store, aisle and "local".
  Store, aisle and local are saved to the ingredient, so you fix an item once. **Regenerate** after changing the plan or pantry; ticks, prices and hand-added items are kept.
  A week's first list brings over last week's unticked hand-added items.
- **Larder tab:** what's on hand, grouped by location (Fridge, Freezer, Pantry Shelf 1…; edit the list in Settings). It works by itself:
  ticking a bought item on the Shop tab adds it, and tapping **Eaten** on a meal you cooked takes that recipe's ingredients out
  (the whole batch; leftovers take nothing). Undo puts it back. Anything at zero moves to **Run out**; tap it to restock or
  remove it. **Baked sourdough** adds a loaf; **Collected eggs** adds eggs.
- **Pack sizes:** on the Shop tab's **$** sheet (or in Ingredients), set how the shop sells it, e.g. 1 kg. The list then buys whole
  packs ("Rice · 1 × 1 kg", with "need 500 g · 200 g in larder" underneath), and the price you enter becomes the price per pack,
  so next week's estimate scales. Bought a different amount? Change **Bought** and the larder follows.
- **Cooking a batch:** a meal that makes more than you eat shows **Cooked & eaten**. Tap it and say where the other portions
  went (it suggests the fridge for the next 3 days' meals, the rest to the freezer); the ingredients come out of the larder and
  the portions go in, marked 🍲 in their fridge or freezer. Leftovers and later meals of that recipe then just say **Eaten** and take a portion,
  fridge first. Cooked ahead (Sunday batch)? Use **⋯ → Cooked, eating later**. Undo puts everything back.
- **Portions count before shopping:** spare portions in the larder cover the week's meals of that recipe first. Week shows it,
  e.g. "larder covers 2 · cooking 6 leaves 3 spare" or "from the larder". Batch recipes still cook a full batch when anything is
  short; the spare goes in the freezer.
- **Freezer and fridge:** the evening before a meal that needs a frozen portion, Today's prep shows **Move to fridge**. Cooked
  portions in the fridge for 3 days or more get an **eat or freeze** note with a **Freeze** button. Already have cooked meals
  put away? Larder → **🍲 + Prepared meal**.
- **Today tab:** each meal is a card with one line per item and its protein. Tap **Eaten**, or **⋯** (or hold **Eaten**) for *Had something else* or *Didn't eat it*. **+** on a card adds food to that meal; tap an item's name for its recipe. Swipe sideways to change day. **+ Shake** logs the post-workout shake in one tap; **+ Add food** logs anything off-plan.
  The first time you log a recipe with no protein figure, it asks once and saves it to the recipe.
  A swapped meal shows what you had as the headline, with the planned meal struck through underneath.
- **Picking a recipe** (Swap, Add food, or a Week slot): type to search names and tags, or tap from the list. **Usual** at the top is what you've logged most in the last six weeks, favouring the meal you're adding to.
  Recipe names lead with the food you'd look for, with brand and details in brackets at the end: *Bulgogi with rice (Costco)*, *Shake, post-workout (WPI, Oatly)*.
- **Recipes tab:** search, filter by tag, add or edit. Typing a new ingredient name creates it; set its store and aisle under **Ingredients**.
  Recipes flagged "contains lactose" show a red ⚠ badge everywhere.

### Drive sync

The chip next to the menu shows the state:

| Chip | Meaning |
|---|---|
| **Drive: sign in** | Tap to sign in to Google (one tap; a Google window flashes up). The sign-in is kept in memory only and lasts about an hour. Since 1.6.0 the app tries to renew it quietly when you open it, and remembers your account so the tap skips the account chooser. If the phone blocks the quiet attempt, tap the chip as before. |
| **Inbox 2** | Files from Claude are waiting. Tap to review: each shows Claude's note and a summary, with **Apply** or **Skip**. |
| **Drive •** | Changes are waiting to be saved to the outbox (about a minute after any change, or when you leave the app). |
| **Drive ✓** | Up to date. |
| **Drive ⚠** | Something failed; Settings shows the error. |

Applying a file never overwrites anything changed more recently on the phone, and the same file is never applied twice.
Logging works offline as usual; the outbox catches up the next time the app is open, online and signed in.
**Sign out** in Settings revokes the app's access.

### Other devices (kitchen tablet, PC)

Install the app on another device the same way (Chrome or Edge: **Add to Home screen** or the install icon), then **⋮ → Settings → Google Drive**:
set **This device** to **View-only** and tap **Find my folders in Drive** (it signs in and finds `meal-planner-data` for you;
pasting the outbox folder ID or link works too).

A view-only device shows the phone's Today, Week, shopping list, pantry and recipes, with a **Recipe** button for ingredients and method.
It replaces its own copy with `latest.json` on open, when you come back to it, every 5 minutes while showing, and when you tap the chip
(**View · 8:10 am** is when the phone last saved). It never writes to Drive and never reads the inbox, and editing is hidden.
Changes are made on the phone only. Only one device, the phone, should be the **Main phone**: a second main device would overwrite `latest.json`.

### Reminders

| Reminder | When |
|---|---|
| Load the rice cooker | Evening before a breakfast recipe tagged *rice cooker* |
| Move the freezer portion to the fridge | Evening before a leftovers slot marked *from the freezer* (set automatically for batch recipes 3+ days later) |
| Sunday batch cook | Sunday morning, listing next week's *batch* recipes |

Times are set in Settings. Android can't wake a closed web app at a set time, so notifications only fire while the app is open or in the background.
The reminders always show on the **Today** screen. For alerts you can rely on, tap **Settings → Add the next 7 days to my calendar** each Sunday and open the file with Google Calendar.

## Exporting

With Drive sync on, `latest.json` in the outbox is always the current full export. **⋮ → Export data** still downloads three files by hand:

| File | Contents |
|---|---|
| `meal-planner-YYYY-MM-DD.json` | Every store, with `schemaVersion` (same format as the outbox; see [DATA.md](DATA.md)) |
| `meal-planner-YYYY-MM-DD-meal-log.csv` | One row per meal eaten: date, slot, training tag, planned vs swapped vs extra, recipe or text, servings, protein (g), lactose flag |
| `meal-planner-YYYY-MM-DD-shopping.csv` | One row per shopping item: week, store, aisle, qty, ticked, price (AUD), local, plan or manual |

The `training` column uses Lift Log's session types (`lift`, `walk`, `hiit`, `rest`), so it joins Lift Log's export on `date`.

**Import** (⋮ → Import data) accepts a full export or a patch file, under the same merge rule as the inbox. Use it to move to a new phone.

## Changing things

- **App changes:** edit the files, bump `CACHE` in `sw.js` (e.g. `meal-planner-v3`), commit and push. The phone picks up the new version the second time the app is opened.
- **Data never goes in this repo.** It syncs to Drive, so `.gitignore` excludes `*.json` and `meal-planner-data/`. The data folders sit next to this one, not inside it.
- **Testing on the PC:** run `python -m http.server 8766` in this folder and open `http://localhost:8766`. Drive sign-in only works from the GitHub Pages address.
