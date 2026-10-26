# Meal and Shopping Planner: pack sizes, the Larder, and cooking

Spec for Claude Code. Repo: `meal-planner` (app.js, README.md, DATA.md, sw.js).

- **1.9.0, built:** pack sizes and per-pack prices, buying into the Larder, cooking out of it, locations, Run out.
- **2.0.0, agreed, not built:** prepared meals (portions) in the Larder, Cooked vs Eaten, Move to fridge, use-by flag,
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

## 2.0.0 (agreed, not built)

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
