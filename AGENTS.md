# AGENTS.md — addon-dnd-character-sheets

This repository contains the `dnd-sheets` addon for the sibling
`ttrpg-codex` host. The manifest ID is a permanent data namespace:
character state lives at `character.addonData["dnd-sheets"]`. Do not rename it
without a data migration.

The addon remains hand-fillable without services. When compatible
`dnd5e.rules-engine` and rules-data services are present, the engine hydrates a
guided builder and computed sheet. Sheet styles are selected per character and
per browser from built-ins plus compatible `dnd-sheets.renderer` providers.

## Read before editing

1. [`README.md`](README.md) for user-visible behavior and development commands.
2. [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) for sheet/engine
   reconciliation and renderer semantics.
3. [`docs/RENDERER_CONTRACT.md`](docs/RENDERER_CONTRACT.md) before changing
   renderer discovery, payloads, or authoring requirements.
4. `../ttrpg-codex/examples/addons/AGENTS.md` for the host contract.
5. `../addon-dnd-engine/AGENTS.md` and its `contract/` docs before changing
   rules-engine use.
6. A rules-data provider's schema only when changing record consumption.

`model.js` and the tests are authoritative for stored field names. Do not copy
the host authoring contract into this repository.

## Architecture

```text
addon.json              API-v2 manifest and consumed service contracts
entry.js                composition root and fragment registration
actions.*.js            domain controllers and owned cleanup
actions.shared.js       action-map registration helper
model.js                stored-blob migration, view model, builder mutations
provider-state.js       provider detection and per-character materialization
ui-state.js             session UI state and persisted view preferences
renderer-registry.js    built-in and discovered renderer normalization
builder-progress.js     pure Builder completion and navigation model
equipment-model.js      pure inventory/equipment resolution
sheet-transfer.js       bounded, versioned JSON import/export
panel.*.js              rendering only
ui.js / helpers.js      shared presentation helpers
locales/en.json         complete English UI source catalog
tests/                  smoke, renderer, state, transfer, and pure-module tests
```

The host wiki profile is the Overview tab. `panel.overview.js` renders the
Character Sheet tab and composes the backpack below it; `panel.sheet.js`
renders Combat. Preserve this naming unless doing a deliberate, tested rename.

## Boundaries that protect maintainability

- `entry.js` composes modules. Register each action in exactly one domain
  controller and pass dependencies explicitly.
- Panels render. They do not mutate stored blobs or implement rules math.
- `builder-progress.js` is the single completion model for the progress rail.
  Keep it pure and derive navigation targets from normalized choice
  descriptors rather than duplicating rulebook-specific checks in the panel.
- `model.js` owns migrations and mutations. Builder changes flow through
  `builderMutate()` and `materializeInto()` so computed state is copied into
  flat fallback fields. Builder discovery, choice mutation, and reconciliation
  delegate to the engine v2 normalized Builder API.
- The fallback fields are a durability contract: losing or disabling a
  provider must leave a usable hand-filled sheet rather than erase data.
- `provider-state.js` resolves provider availability per character. Do not
  assume a globally installed provider means every stored character is safe to
  recompute.
- Rules implementation and edition-dependent tables belong in a compatible
  engine addon; rulebook records belong in rules-data addons. This repository
  contains neither. Tests use a synthetic provider through the real engine.
- Add supplement mechanics through generic documented record fields. Do not
  branch on sourcebook IDs in the engine, model, panels, or actions.
- `ui-state.js` owns transient navigation, modal, wizard, and selection state.
  Persist only intentional view preferences. Renderer choice is keyed by
  character and browser, never stored in campaign/entity data.
- `renderer-registry.js` accepts providers by service contract, schema version,
  and granted permissions. Never add provider-id branches or a style whitelist.
  Renderer v2 applicability is declarative and may filter by class, subclass,
  edition, and ruleset without sheet-owned IDs.
  Missing/failing preferred renderers fall back to Compact without erasing the
  preference; Settings always remains owned by this addon.
- Domain controllers dispose their own timers, URLs, listeners, and other
  resources. The host disposes registrations.
- Optional services enhance the sheet but never become an accidental hard
  dependency. Probe through `host.useService()` / `host.listServices()` behind
  coherent standalone fallbacks.
- Action names are internal UI wiring. This addon does not publish a rules API;
  rules consumers discover the engine contract directly.

## UI and localization

- Escape dynamic and translated text with `host.h.esc()` at HTML boundaries.
- Use host actions/events and shared `.codex-*` components for common controls.
- Keep sheet composition and D&D-specific indicators scoped under
  `.addon-dnd-sheets`; build them from host tokens.
- Promote a component into the host only after it has a genuine second
  consumer. Keep game-specific semantics local.
- English source text lives in `locales/en.json`; other catalogs may be
  partial. Never register strings in core or read host language storage
  directly.
- Renderers handle missing providers, old sparse blobs, empty collections, and
  disposal/reload without throwing.

## Working loop

Run from this repository in PowerShell with sibling checkouts of the host and
`addon-dnd-engine`:

```text
node --test tests/*.mjs
```

Use relative test paths on Windows. From the host repository, install the
current source with:

```text
node scripts/dev-install-addon.cjs ../addon-dnd-character-sheets
```

Source edits are not visible in the app until reinstall. Client-only changes
need a refresh; host/server changes may require restart. Keep test metadata
aligned with `addon.json`, and run relevant host addon compatibility tests when
the manifest or facade use changes.

Development happens on `main`. The global Codex instructions govern task
commits. Do not create branches, releases, or pushes unless the maintainer
asks. The only durable suite backlog is
[`../ttrpg-codex/docs/BACKLOG.md`](../ttrpg-codex/docs/BACKLOG.md). Temporary
implementation plans belong only in the host repository's ignored
`docs/plans/` directory and must be deleted when the task closes. Do not create
repo-local TODO, roadmap, or planning files.

## Scope

- One rules-engine service is selected by the host; that engine selects one
  rules-data service. Stored overrides win over computed values.
- Builder choices remain editable and validation is advisory where possible.
- Combat resolution/automation is a separate addon concern.
- Structured 2014 support depends on a future compatible provider and must
  remain optional until one exists.
