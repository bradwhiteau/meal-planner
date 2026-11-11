# Changelog

Earlier versions are described in the git log (each release commit starts with its version).

## 2.10.0

- **Eaten from frozen:** tick it on a recipe (CREAMi ice cream) and its portions stay put: the cook sheet sends them
  all to the freezer, and there's no night-before "move to the fridge" reminder.
- **Where Cook from frozen lives:** Recipes → **Ingredients** → tap an ingredient. It's for ingredients; recipes now have
  their own tick (above).

## 2.9.0

- **Take it out of the freezer:** the evening before a meal is cooked, Today's prep checks its ingredients. If the
  fridge and pantry don't hold enough but a freezer does, it says "Take 300 g Costco beef bulgogi out of the Chest
  Freezer to thaw in the fridge", with **Move to fridge** to move it in the Larder. Packs, tins and pieces come out
  whole. Meals eaten from cooked portions keep their own "Move N × … to the fridge" reminder.
- **Cook from frozen:** tick it on an ingredient (frozen peas, chips) and it never gets a thaw reminder.
- **Night before:** a recipe can carry a note, e.g. "Cook the rice" on Bulgogi. It shows in the evening prep (and the
  calendar file) the day before that recipe is cooked.

## 2.8.0

- **Stores fold:** on the Shopping list, tap a store's heading to fold it shut or open it again. The heading still shows
  how many are in the trolley and the store's total. Each phone remembers which stores you left shut; a store it hasn't
  seen starts open.
- **Done stores fold away:** ticking the last item in a store shuts it and marks it ✓, so the store you're in is easy
  to find. Open it again any time.
- **Expand all / Collapse all stores:** one button next to "Hide ticked items".

## 2.7.0

- **Leftovers say where, not when:** a leftovers meal on Today shows where its portions are ("1 in the Fridge, 4 in the
  Freezer") in place of "Leftovers from Mon dinner". If there are none (the cook was skipped, or they've been eaten), it
  says **none in the larder** in orange. Before the cook happens later in the week it says "from the larder once cooked".
  The Week tab says "from the larder". The cooked date stays on Larder portions for the eat-or-freeze warning.
- **1 serve and the whole cook:** a recipe opened from Today lists each ingredient for 1 serve, and when that meal is
  cooking, a second column for the whole cook ("Cooking 6"), headed with what the serves are for. Opened anywhere else
  it shows the single serve only.

## 2.6.0

- **One shopping list:** generate any time and the list covers everything still needed up to the end of the week you're
  looking at: this week's remaining meals as well as that week's, plus "Keep at least" top-ups, less what's in the Larder
  (counted once). Earlier weeks' unbought lines fold in: generated ones are worked out again on the new list, and
  hand-added ones move across ("carried over"), once. Ticked lines stay where they were bought. Before, each week had its
  own list, so a top-up (cat biscuits) could sit on this week's list while you shopped from next week's.
- The Shop tab opens on the list to shop from, and a later week's header says "covers now to Sun 8 Nov".
- Quick adds from Claude go onto that list too.
- "Meal Planner Now" only shows a week's list while something on it is unbought.

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
