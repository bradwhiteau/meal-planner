# Meal Planner style guide

How the app looks and reads, so changes stay consistent. The app is used one-handed on a phone, often in a shop or a
kitchen: fewer words, fewer big buttons, and nothing destructive within easy reach of a thumb.

## Colour

Colours are CSS variables in `styles.css`, each with a light-mode version. Use the variables, never raw colours.

| Variable | Means | Used for |
|---|---|---|
| `--accent` | Go, done | The primary button, ticks, links |
| `--muted` | Secondary | Hints, labels, sub-lines, Cancel |
| `--warn` (amber) | Look at this soon | Use by within 3 days, past best before, eat-or-freeze, Keep at least running low |
| `--fail` (red) | Act now, or destructive | Past use by; Remove and Delete actions |

Amber, not yellow: yellow text can't be read on the light theme. A warning on a row is **bold and coloured** on the
name, with the reason in the sub-line ("use by tomorrow").

## Sheets (the panels that slide up)

Every sheet follows the same shape, top to bottom:

1. **Title.** The thing's name. If the sheet is about one item and the item itself can be edited elsewhere (an
   ingredient, a recipe), a small **✎** beside the title opens that. No "Edit ingredient" button.
2. **Fields.** Related fields share a row (Amount + Unit, Use by + Best before, Store + Aisle). A field stands alone
   only when nothing pairs with it.
3. **A small text action sits beside the field it changes**, right-aligned on the label line: "Location … Move…".
4. **Hints:** at most one short line, in muted small text, under the field it explains. Say what it does, not how it
   works ("Across all locations. Tops up the shopping list."). If a hint needs two sentences, cut one.
5. **One big primary button**, full width: Save, Log it, Save and log.
6. **A quiet footer**: the destructive action as red text on the left ("Remove from larder", "Delete recipe"), and
   Cancel as muted text on the right. Destructive actions are never big buttons and never next to the primary button.

Menu-style sheets (a list of choices, like the meal ⋯ menu) are the exception: each choice is a wide button, and the
footer has just Cancel or Close.

The helpers in `app.js` build this: `sheetFoot(action, label, { del })`, `delLink`, `editIcon`, `fieldWith`, `hint`.
Use them for new sheets rather than writing buttons by hand.

## Words

- Short, plain, Australian English (colour, organise, flavour). Sentence case for labels and buttons.
- Name actions by what happens: "Remove from larder", not "Delete"; "Had something else", not "Swap".
- Dates as `Tue 25 Nov`; "today" and "tomorrow" where they read better.
- Amounts in metric with a space: `500 g`, `1.5 kg`, `2 L`.
- Explain once, then get out of the way: a feature's how-it-works belongs in README.md and the changelog, not on screen.

## Lists and screens

- Sections fold (stores on the shopping list, locations in the larder); the fold is remembered on the device.
- A section heading carries a count and, when something inside needs attention, a ⚠ in the matching colour.
- One tap for the common action (Eaten, tick an item); everything else sits behind ⋯ or the $ / sheet.
- Tap targets at least 40 px tall.

## Checking a change

The test suite checks behaviour, not looks. For a visual change, open the app in test mode and look at it at phone
width (about 390 px) in both light and dark mode before publishing.
