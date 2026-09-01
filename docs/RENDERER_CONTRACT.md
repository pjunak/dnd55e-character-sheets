# Renderer status

`dnd-sheets.renderer` v2 is retired in Add-on API v3.

The character sheet now renders its own additive, scoped section. No external
package receives a character snapshot or returns executable HTML. This is a
deliberate architecture boundary, not a temporary compatibility gap.

If alternate sheet presentations become useful later, design a v3 contract
around serializable models, package-owned schemas, explicit host selection,
bounded results, generation lifecycle, and failure fallback. Do not restore
the old browser function-object API or branch on renderer add-on IDs.
