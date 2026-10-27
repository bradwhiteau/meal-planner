# Changelog

Earlier versions are described in the git log (each release commit starts with its version).

## 2.2.1

- Fix: the shopping list now counts spare portions an earlier week plans to cook but hasn't yet. A Sunday tuna mornay
  cooking 2 (eating 1) now covers Monday's mornay lunch, and a batch bolognese cooked on the weekend covers the next
  week's bolognese, so their ingredients aren't bought twice. Once those meals are marked cooked, the portions are
  counted from the Larder instead, never both.
