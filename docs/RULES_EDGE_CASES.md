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

If any service call fails, nothing is persisted. If the stored extension
revision changed, the package reloads the newest state and asks the user to
repeat the edit. It never silently overwrites concurrent play changes.

## Durable fallback and authored play state

Materialization may refresh class display, level, abilities, maximum HP, armor
class, initiative, speed, proficiency bonus, save/skill proficiency, expertise,
trait snapshots, and engine-derived spell snapshots. It preserves current HP
within the new maximum, temporary HP, manually entered spells, inventory,
currency, resources, and notes.

The materialization marker stores both engine binding identity and rules-data
identity. The package does not automatically recompute merely because a page
rendered or a provider changed. A user explicitly loads the Builder or requests
a refresh, keeping changes reviewable.

## Legacy campaign data

There is no permanent legacy-save subsystem. During supervised cutover, the
host's one-time converter copies each old
`character.addonData["dnd-sheets"]` value into the v3 record extension with the
same ID. The schema and normalizer accept older sparse blobs and preserve
unknown safe JSON fields. The separately downloaded campaign backups remain
the rollback source until both conversions are verified.

## Presentation

The package owns one scoped built-in presentation. The v2
`dnd-sheets.renderer` service was removed because it exchanged live browser
objects and HTML rather than a serializable, schema-validated contract. This
reduces authority, lifecycle coupling, and failure modes without affecting
saved campaign data.
