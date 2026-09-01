# AGENTS.md — addon-dnd-character-sheets

This repository owns the `dnd-sheets` Add-on API v3 TypeScript package for the
sibling `ttrpg-codex` host. The add-on ID and record-extension ID are permanent
saved-data namespaces. Do not rename either without an explicit campaign data
migration.

## Read before editing

1. [`README.md`](README.md) for behavior and commands.
2. [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) for service,
   materialization, and failure semantics.
3. [`../ttrpg-codex/examples/addons/API_V3.md`](../ttrpg-codex/examples/addons/API_V3.md)
   for the public host contract.
4. [`../addon-dnd-engine/AGENTS.md`](../addon-dnd-engine/AGENTS.md) and its
   `contracts/` documents before changing rules-engine requests.

## Boundaries

- The host owns the core character record. This package contributes one
  additive `article-section`; it never replaces the host article or reads
  private host DOM.
- `sheet-state.ts` is authoritative for stored field names and forward
  normalization. Preserve unknown JSON fields so one-time conversion and
  homebrew data remain lossless.
- `sheet-repository.ts` is the only persistent record-extension boundary.
  Writes use optimistic revisions; conflicts reload instead of overwriting.
- `engine-client.ts` is the only rules-engine boundary. Requests and responses
  stay serializable and versioned. Never name a provider add-on in runtime
  policy.
- The sheet remains fully hand-fillable without services. Every successful
  Builder mutation materializes computed values into durable fallback fields.
- Current HP, inventory, currency, resources, spells, and notes are authored
  play state. Recalculation must preserve them unless a user explicitly edits
  them.
- Panels and controls do not implement edition-dependent rules. Local math is
  limited to display helpers such as an ability modifier.
- The removed v2 renderer service must not return as a live object/function or
  raw-HTML boundary. A future renderer contract must be serializable,
  schema-owned, selected by the host, and justified by a real consumer.
- Runtime source is TypeScript under `src/`; `web/` and `dist/` are generated.

## Working loop

```powershell
npm run check
npm run package
```

Use the host inspector on the produced ZIP when manifest, contract, or package
layout changes. Dev-install from the host only for supervised integration:

```powershell
node scripts/dev-install-addon.cjs ../addon-dnd-character-sheets
```

Create logical commits after validation. Never push, deploy, or convert live
campaign data without explicit instruction.
