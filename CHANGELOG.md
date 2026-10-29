# Changelog

Earlier versions are described in the git log (each release commit starts with its version).

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
