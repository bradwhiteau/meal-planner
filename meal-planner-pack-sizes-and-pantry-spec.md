# Meal and Shopping Planner: pack sizes, the Larder, and cooking

Spec for Claude Code. Repo: `meal-planner` (app.js, README.md, DATA.md, sw.js).

- **1.9.0, built:** pack sizes and per-pack prices, buying into the Larder, cooking out of it, locations, Run out.
- **2.0.0, built:** prepared meals (portions) in the Larder, Cooked vs Eaten, Move to fridge, use-by flag,
  portions covering the plan before shopping.

## Why

After the first real shop (Sun 25 Oct), three gaps showed up:

1. **Prices don't scale.** A line's price was copied to next week's line whatever the quantity, so a 500 g line inherited the price of the 1 kg bag.
2. **Buying didn't touch the pantry.** If the list wanted 500 g and the shop only sold 1 kg, the spare 500 g was forgotten.
3. **The pantry never went down.** Stock was subtracted from every future list forever.

Then a fourth: batch cooking. Six turkey bolognese made, one eaten, two in the fridge, three frozen with only two planned.
The spare should count before anything is bought again.

## Naming

**Larder** on screen; `pantryItems` in the data. The data name predates the rename and is kept so older exports, the
view-only tablet and Claude's patches keep working. DATA.md and code comments say so.

---

## 1.9.0 (built)

`APP_VERSION = '1.9.0'`, `CACHE = 'meal-planner-v15'`, `schemaVersion` stays 1 (all fields additive and optional).

### Pack sizes and per-pack price

- Ingredients gain optional `packQty`, `packUnit`, `packPrice` (AUD per pack) and `location`. `lastPrice` stays as the
  fallback line price when there's no pack size. No pack size → the line behaves as before.
- `generateShopping`: for an ingredient whose pack unit normalises to the need's base unit,
  `packs = ceil(need / packSize)`, `buyQty/buyUnit = packs × packQty` in the pack's unit; estimate = `packs × packPrice`,
  else `lastPrice`. Incomparable units (pack in `each`, need in `g`) ignore the pack size.
- Row: **Rice** · 1 × 1 kg · $4.50, with *need 1.2 kg · 200 g in larder* underneath (`needGross`, `larderQty` on the line).
- **$ sheet** for plan lines: Pack size, Bought (qty + unit), Price, Store, Aisle, Larder location, Local. Pack size,
  store, aisle, location and price are saved to the ingredient.
  - Price is "what this line cost". **Only a price typed in the sheet** updates the ingredient:
    `packPrice = price / packs bought` (2 dp) when there's a pack size, else `lastPrice = price`.
    *(Changed from the original spec, which divided by planned packs: wrong when Bought differs.)*
  - **Bought only counts when edited in the sheet**; untouched, it follows the current suggestion.
    *(Found in testing: setting a pack size left the old pre-filled amount looking like an override.)*
- Ingredient sheet: Larder location, Recipe unit, Pack size + unit, and "Price per pack" (or "Last price" without a pack size).

### Ticking puts it in the Larder

- Ticking a line with an `ingredientId` adds the bought amount (`boughtQty` → `buyQty` → `qty`) via `pantryAdd`, and
  records `pantryAdded: {qty, unit}` on the line. Unticking takes exactly that back out (never below 0).
- Hand-added lines with no ingredient (dog food) never touch the Larder; one whose name matches an ingredient does.
- Changing Bought on a ticked line moves the Larder by the difference.
- `generateShopping` never removes or re-quantifies a ticked line.

### Cooking takes it out

- **Eaten** on a planned cook slot draws the whole batch: `(cook || servings) / servings` of each ingredient.
  Leftover and free-text slots draw nothing.
- Off-plan recipe logs (+ Add food, Swap to a recipe, + Shake) draw `servings / recipe servings`.
  Skipped meals draw nothing. *(Swap to a recipe draws that recipe: it was cooked.)*
- Clamped at 0. The log records `pantryUsed: [{ingredientId, qty, unit}]`; Undo puts exactly that back.

### What the list counts

*(Changed from the original spec.)* `needsFor(week)` = ingredients of meals **not yet logged** (cooked, swapped or skipped
meals are skipped), minus what's in the Larder **now**. This replaces "subtract pantry minus this week's `pantryAdded`":
with cooking drawing stock down, counting already-cooked meals would over-ask mid-week, and the ticked-line rule already
stops a mid-shop Regenerate from deleting what was just bought.

### Larder screen

- Grouped by location in `settings.locations` order (default: Fridge, Freezer, Chest Freezer, Pantry Shelf 1–4,
  Pantry Ground; editable in Settings), then "No location". Each row shows when it last changed.
- Rows at 0 move to a collapsed **Run out (n)** group; tap to restock or **Remove from larder**.
- Locations: an ingredient's `location` is its usual spot; new Larder rows take it.

### Housekeeping

- `SHAPES` validation: new fields optional; bad values dropped, not fatal.
- Shopping CSV: `packs`, `buy_qty`, `buy_unit` after `unit`.
- DATA.md (and the Drive copy): new fields; Claude may set pack sizes, pack prices and locations freely, but changes
  Larder amounts only when asked.

### Tested (1.9.0)

Rice bowl (500 g rice, cooked Mon, leftovers Tue), Big rice next week (1.2 kg), soy sauce without a pack size, dog food by hand:

1. Pack 1 kg, need 500 g → 1 × 1 kg; $4.50 entered → packPrice 4.50. ✓
2. Next week 1.2 kg → 2 × 1 kg, $9.00. ✓
3. Tick → Larder 1 kg; Regenerate keeps it ticked; untick → 0. ✓
4. Bought 2 kg while ticked → Larder 2 kg; packPrice stays 4.50. ✓
5. Eaten on Mon dinner → rice 1.5 kg, soy 0; leftovers → no change; Undo → 2 kg, 30 ml. ✓
6. Next week with 1.5 kg in the Larder, 1.2 kg needed → no rice line. ✓
7. Dog food ticked → Larder unchanged. ✓
8. Soy (no pack size) ticked → +30 ml. ✓
9. Real `latest.json` imports cleanly; junk `packQty` / `packUnit` / `packPrice` dropped. ✓

---

## 2.0.0 (built)

`APP_VERSION = '2.0.0'`, `CACHE = 'meal-planner-v16'`, `schemaVersion` stays 1.

### As built

- **Prepared meals** are `pantryItems` rows with `recipeId` (no `ingredientId`): `qty` = portions, `unit: 'portion'`,
  `location`, `cookedOn`. One row per recipe, location and cook date; eaten down to 0 → removed. Larder → **Prepared meals**
  section at the top, with **+ Add a prepared meal** for meals already put away.
- **Eaten on a cook slot** that still needs cooking cooks it: if the cook leaves spare portions the button reads
  **Cooked & eaten** and a sheet asks where they went (Portions made, Eaten now, a stepper per fridge/freezer location;
  suggestion: next 3 days' meals of that recipe → Fridge, rest → Freezer). Single serves (oats) keep **Eaten** and skip the sheet.
  The slot records `cooked: {on, made, pantryUsed, portionsAdded}`.
- **⋯ → Cooked, eating later** cooks without eating (Sunday batch); **⋯ → Undo cooked** reverses it (only once the meal's
  own log is undone).
- **Eaten** on leftovers, a cooked slot, or a meal the Larder covers takes portions: fridge first, oldest first. The log
  keeps `portionsUsed`; Undo puts them back where they were. Off-plan recipes (+ Add food, Swap) take portions first and
  draw ingredients only for the rest.
- **Allocation (`weekAlloc`):** per recipe, servings still to eat that week vs portions free for that week. Portions are
  reserved for earlier weeks' meals first (from this week on), so planning next week doesn't count a portion already promised
  to this Thursday. *(Found in testing; not in the original plan.)* Batch recipes cook the full batch if anything is
  uncovered; others cook `min(cook, uncovered)` only when the Larder covers some, otherwise the plan's cook.
- **Week** shows "from the larder", "larder covers 3 · cooking 6 leaves 4 spare", or "cooked 6".
- **Night before:** if tomorrow's portion meals need more than the fridge holds and the freezer has some, Today's prep shows
  "Move N × recipe from the freezer to the fridge" with a **Move to fridge** button (replaces the old leftover `freezer` flag
  text for portion meals).
- **Use-by:** fridge portions cooked 3+ days ago show "eat or freeze" in the Larder and on Today's prep, with **Freeze**.
- Copies of a week and templates drop `cooked`; editing a cooked slot keeps it if the recipe is unchanged.
- Validation: portion rows, `slot.cooked`, `portionsUsed` and `cookedSlot` are optional and sanitised.

### Tested (2.0.0)

Bolognese (6 portions, tag batch: 1 kg mince, 700 g passata) cooked Mon lunch, leftovers Tue and Thu dinner; oats breakfast.

1. Mon lunch shows **Cooked & eaten**; oats show **Eaten**. ✓
2. Cooked & eaten → sheet suggests 1 fridge (Tue), 4 freezer; Save → mince and passata out, 5 portions in. ✓
3. Undo → ingredients back, portions gone, button back to Cooked & eaten. ✓
4. Tue leftovers → takes the fridge portion. ✓
5. Wed prep: "Move 1 × Bolognese from the freezer to the fridge"; button moves it. ✓
6. Next week needs 2, 4 portions with 1 promised to Thu → "from the larder", empty list. ✓
7. Next week needs 5 → "larder covers 3 · cooking 6 leaves 4 spare"; mince and passata on the list. ✓
8. Prepared meal added by hand (fridge, 4 days old) → "eat or freeze"; **Freeze** moves it. ✓
9. + Add food Bolognese → takes a portion, no ingredients. ✓
10. Cooked, eating later → 6 portions put away, button becomes Eaten; Undo cooked → back. ✓
11. Real `latest.json` (1.9 data): every tab renders, no errors. ✓

## 2.0.0 (as agreed beforehand)

### Prepared meals in the Larder

- A second kind of Larder row: **portions of a recipe** (`recipeId`, `portions`, `location` Fridge/Freezer/Chest Freezer,
  `cookedOn`). Stored in `pantryItems` alongside ingredients (no new store), told apart by `recipeId`.
- **Cooked** is its own step on a cook slot: ingredients out (as 1.9), portions in. The usual button is
  **Cooked & eaten**; a plain **Cooked** suits a Sunday batch cook ahead of time.
- On cooking, ask where the portions went, suggested from the plan: portions eaten now, portions needed in the next
  3 days → Fridge, the rest → Freezer.
- **Eaten** on a meal of that recipe (cook slot or leftovers) takes one portion (servings), fridge first.
- The night-before freezer reminder gains **Move to fridge**, which moves a portion's location.
- **Use-by flag:** fridge portions cooked more than 3 days ago get a gentle "eat or freeze" flag.

### Portions cover the plan before shopping

- `needsFor` first allocates Larder portions to the week's meals of that recipe; only uncovered servings need cooking.
- **Batch rule (decided):** recipes tagged *batch* (freeze well) cook the full batch when any servings are uncovered;
  the surplus goes to the Freezer and covers future weeks. Other recipes cook what the week needs (the slot's `cook`).
  If portions cover all of a recipe's meals that week, its cook (and its ingredients) drop off the list.
- Week shows it: *"Larder covers 2 · cooking 6 leaves 3 spare"*, so the cook number can be changed.
