# Sheet and rules-engine boundary

This document defines behavior owned by `dnd-sheets`. D&D computation belongs
to `dnd5e.rules-engine` v3; rulebook records belong to the selected
`dnd5e.rules-data` provider.

## Standalone is the baseline

The engine consumer is optional. With no provider, a stale binding, missing
rules data, a service error, or a disabled add-on, every ordinary sheet field
continues to load and save. The Builder reports why it is unavailable without
blocking the rest of the section.

The sheet never branches on engine or compendium add-on IDs. Provider identity
is diagnostic and reconciliation data, not runtime feature selection.

## Builder writes are atomic from the user's perspective

A structural or choice edit follows one path:

1. send the current decisions to the engine;
2. apply or reconcile the requested change;
3. hydrate the returned decisions;
4. materialize computed results into ordinary fallback fields;
5. save the new decisions and fallback values in one revisioned extension
   write.

If a service call fails before the write, nothing is persisted. Missing rules
data cannot materialize a partial universal result over saved values. A failed
post-save Builder-plan refresh leaves the successful write intact and allows
the Builder to be loaded again.

Builder guidance is read-only engine output: completion, option labels,
subclass/level requirements and spell-grant reminders use the same provider
snapshot. The progress rail navigates to Character controls, a class level or
the Spellbook. Character/class tabs support arrow/Home/End navigation and use
the original gold underline; the progress rail collapses on phone screens.
Advanced feature, mastery, expertise, tool and feat selectors consume declared
engine options, prevent repeated picks within one choice and retain unknown
saved references for correction. Missing guidance retains the flat form.

Extra feats and custom rewards retain stable IDs, names and source notes.
Catalog feats affect engine calculations; custom names are tracked only.
Add/remove/note edits use the same reconciliation/materialization write as
other Builder changes. A staged add dialog participates in the dirty guard.
Play operations keep calculated feats separate from manual ones, so a removed
reward does not survive a prior rest or cast. Ordinary manual edits invalidate
cached guidance; recalculation refreshes an already loaded Builder.

Ordinary edits update a mount-owned draft immediately and serialize writes
against acknowledged revisions. Failed writes retain that draft and pause
automatic retries. A conflict offers draft export and explicit reload; a
transient failure also offers Retry. An uncertain write may conflict on retry
and is never treated as permission to overwrite. Dirty and saving flags use
the host's navigation guard. They do not persist drafts across a forced browser
close or generation teardown. Late responses cannot update a different sheet.

## Durable fallback and authored play state

Materialization may refresh class display, level, abilities, maximum HP, armor
class, initiative, speed, proficiency bonus, save/skill proficiency, expertise,
trait snapshots, and engine-derived spell snapshots. It preserves current HP
within the new maximum, temporary HP, manually entered spells, inventory,
currency, resources, and notes.

The first materialization freezes the original ability inputs in `baseStats`
so repeated calculation does not apply grants twice. Existing spell snapshot
labels, annotations and prepared flags survive. Saved combat display includes
attacks, resource definitions, activations and attunement; tracker values stay
in authored `resourceUses` and manual resources remain independent.

The materialization marker stores both engine binding identity and rules-data
identity. The package does not automatically recompute merely because a page
rendered or a provider changed. A user explicitly loads the Builder or requests
a refresh, keeping changes reviewable.

## Play actions and equipment

`apply-play-change` returns decisions and hydration from the same rules-data
evaluation. Sheets saves them in one optimistic extension write. Rest and
average hit-die healing show a detached preview before confirmation; cancellation
does not write. Class spell selection validates list membership, level, preparation
limits and spellbook membership in the engine. Slot casting rejects unavailable
or undersized slots. Feature toggles use engine availability/exclusivity, and
rest recovery leaves manual resources untouched. Saved HP/AC/initiative/speed
overrides remain effective during materialization.

Equipment selections keep provider kind/ref, readable names and a record
snapshot alongside authored quantity, location and notes. The tray commits all
items in one write, retains the host's dirty guard while staged, and supports
custom entries when catalog calls fail. A failed commit leaves the resulting
sheet draft available for the ordinary Retry/export flow.

Equipment folders drill through kind and the original category facets;
breadcrumbs preserve the staged tray and search spans the catalog. Newly added
armor starts equipped, weapons ready and other items in the pack. Filling an
armor or shield slot moves the previous occupant to the pack; attunement stays
independent of item location. Saved snapshots keep slot classification useful
without a provider. Equipment writes refresh computed fallback values when
rules data is available, and retain them when it is not.

`spell-options` supplies eligible class/grant spells, casting abilities, free
uses, ritual eligibility, copy costs and allowed slots. The UI does not infer
edition rules from names. Granted-spell choices retain explicit empty lists;
clearing a default is not the same as leaving the choice unset. Free casts use
the existing `charge-<spell>` tracker keys and rest recovery.

Copying previews the engine's GP deduction and optional scroll consumption.
The learned spell, currency and inventory change are one revisioned write;
canceling writes nothing, and a failed write retains the complete draft for
Retry. Copying from another book consumes no scroll. Scroll matches use an
authored `spellRef` or the legacy readable scroll/spell name. Known-spell swaps
also require review and save class level, total level and both references in
`spellSwaps`; they record player-directed level-up changes without advancing
the character or automatically enforcing a level-up schedule.

## Legacy campaign data

There is no permanent legacy-save subsystem. During supervised cutover, the
host's one-time converter copies each old
`character.addonData["dnd-sheets"]` value into the v3 record extension with the
same ID. The schema and normalizer accept older sparse blobs and preserve
unknown safe JSON fields. The separately downloaded campaign backups remain
the rollback source until both conversions are verified.

## Presentation

The package owns scoped Compact and Classic presentations. Their per-character
browser preference uses the original renderer/layout keys; no sheet data
changes when switching layouts. Ability cards, vitals and the split backpack
use the preserved v1 theme primitives. Settings retains manual identity and
resource editing. Host `canEdit` remains authoritative, including the current
host policy allowing authenticated players to edit.

The v2
`dnd-sheets.renderer` service was removed because it exchanged live browser
objects and HTML rather than a serializable, schema-validated contract. This
reduces authority, lifecycle coupling, and failure modes without affecting
saved campaign data.
