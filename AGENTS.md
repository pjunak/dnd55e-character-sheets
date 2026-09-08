# AGENTS.md — addon-dnd-character-sheets

This repository owns the `dnd-sheets` Add-on API v3 TypeScript package for the
sibling `ttrpg-codex` host. The add-on ID and record-extension ID are permanent
saved-data namespaces. Do not rename either without an explicit campaign data
migration.

## Read by task

Sibling paths in this guide assume the named repositories are checked out
next to this one. For an independent checkout, locate the compatible public
host/consumer contracts only when needed; do not assume parent workspace
instructions were loaded or read unrelated sibling implementations.

1. [`README.md`](README.md) for setup, behavior or commands.
2. [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) for service,
   materialization or failure-semantics changes.
3. [`../ttrpg-codex/examples/addons/API_V3.md`](../ttrpg-codex/examples/addons/API_V3.md)
   when changing the manifest, host integration, permissions or lifecycle.
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
  Writes use optimistic revisions; conflicts retain the local draft for export
  and explicit reload instead of overwriting concurrent changes.
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
- Runtime source is TypeScript under `src/`; never hand-edit generated `web/`
  or `dist/`. Regenerate and commit intentionally tracked `web/` outputs with
  source changes; install ZIPs and staging directories remain transient.

## Working loop

For prose or agent-guidance-only changes, review the diff, check local links,
and verify changed commands or contract claims. Runtime builds and operational
acceptance are required only for the affected behavior below. Reuse successful
checks on unchanged inputs; preserve complete CI and release gates.

Run npm run check for source/build changes. Build a package for installation,
manifest/schema/package changes and release candidates. Each package command
performs its own build; keep that standalone guarantee. During iteration use
focused tests and reuse a successful build only through an existing checked
script, not by silently bypassing package preparation.

```powershell
npm run check
npm run package
```

Use the host inspector on the produced ZIP when manifest, contract, or package
layout changes:

```powershell
go run ./cmd/codex-addon-inspect ../addon-dnd-character-sheets/dist/dnd-sheets-3.0.0.zip
```

Integration uses the staged-package review and activation lifecycle. Source
checkout edits never become a runtime generation directly.

Create logical commits after validation. Never push, deploy, or convert live
campaign data without explicit instruction.
