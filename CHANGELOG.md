# Changelog

Earlier versions are described in the git log (each release commit starts with its version).

## 2.5.0

- **Several items in one meal:** a meal can hold any number of planned items (a shake and eggs for breakfast). On the
  Week tab each item has its own line; tap it to change or remove it, and **+** beside the meal adds another. On Today each
  item has its own **Eaten** and **⋯** (had something else, didn't eat it, cooked ahead), so the shake and the eggs tick
  separately. Cooking, leftovers, the shopping list, the Larder, reminders and the Now doc count every item.
- Data: each meal (`day.slots.breakfast` etc.) is now a list of items with ids; planned meal logs name their `item`, and
  leftovers name the item they come from. Plans, templates and logs from earlier versions are converted when the app opens,
  and patches written the old way are still read. See DATA.md.

## 2.4.3

- Searching the Larder hides the heading and the four buttons while the search box is in use, so results show above the
  phone's keyboard. They come back when the search is cleared and you leave the box.

## 2.4.2

- Fix: name and aisle suggestions are now the app's own list under the box. Android Chrome's built-in suggestion pop-up
  could be left floating on screen (even after Save) when a sheet redrew under it; the built-in list is no longer used.

## 2.4.1

- **Search the larder:** a search box under the Larder buttons. Typing shows only matching items (and prepared meals), hides
  locations with none, and opens the rest, without changing which locations stay open normally.
- **Min:** items with a "Keep at least" show "Min: 2 pack" under the amount, orange when below it (replaces "below 2 pack"
  beside the name).

## 2.4.0

- **Keep at least:** set on any Larder item (tap it). The shopping list tops the item up so at least that much is left after
  the week's meals, counted across every location: kitty litter "keep at least 2 bags" adds a bag when one's finished, and
  rice tops up on top of what the week's meals use. The Larder marks items below their minimum, the line says why it's
  there, and a top-up already on another week's unbought list isn't added twice. A week with nothing planned can still
  generate a list for top-ups. "Meal Planner Now" shows each item's minimum. Claude can set it through a patch.
- Test fix: the Bolognese "+ Add food" check counts fridge portions instead of assuming there's one row (also day-of-week).

## 2.3.0

- A meal now cooks what the plan eats: this meal plus its Leftovers in later slots, not the whole recipe. Type
  "Servings to cook" to make extra for the larder. Batch recipes still cook at least the whole recipe.
- The meal card and the week say where the rest goes, e.g. "cook 3 · 2 for leftovers (Tue lunch, Wed dinner)" or
  "· 1 spare for the larder". The old "cook 4" with no reason is gone.
- Recipes are now written for one serving; the plan scales them.
- Test fix: the Bolognese scenario's "Freeze" check no longer depends on the day of the week.

## 2.2.1

- Fix: the shopping list now counts spare portions an earlier week plans to cook but hasn't yet. A Sunday tuna mornay
  cooking 2 (eating 1) now covers Monday's mornay lunch, and a batch bolognese cooked on the weekend covers the next
  week's bolognese, so their ingredients aren't bought twice. Once those meals are marked cooked, the portions are
  counted from the Larder instead, never both.
