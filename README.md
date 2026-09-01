# D&D Character Sheets

`dnd-sheets` is the hand-fillable D&D character sheet for TTRPG Codex. It is
an Add-on API v3 integrated TypeScript package and adds a section beneath the
host-owned character profile. The host continues to own identity, portrait,
lore, relationships, routing, and authorization.

## What it provides

- Directly editable identity, abilities, saves, skills, vitals, resources,
  spells, inventory, currency, and notes.
- A useful read-only view for players without edit authority.
- Versioned per-sheet JSON export and import.
- An optional guided Builder through `dnd5e.rules-engine` v3.
- Durable materialized values after every successful Builder change, so a
  sheet remains useful when the engine or rules data is unavailable.

The package does not implement D&D rules or carry rulebook data. Those belong
to the selected rules engine and its selected rules-data provider. Missing or
failing services never block ordinary hand editing.

## Saved state

The add-on ID and record-extension ID are both permanently `dnd-sheets`. API v3
stores the value at:

```text
(characters, character ID, dnd-sheets, dnd-sheets)
```

This is the deliberate destination for the old
`character.addonData["dnd-sheets"]` blob during the one-time campaign
conversion. The v3 schema describes known fields but permits unknown fields so
older and homebrew values survive that move. Runtime normalization preserves
those values as well.

## Architecture

- `src/index.ts` activates the generation, connects the optional service, and
  binds the declared section.
- `src/sheet-element.ts` owns presentation and browser interaction.
- `src/sheet-state.ts` owns defaults, forward normalization, and manual math.
- `src/sheet-repository.ts` owns revisioned record-extension persistence.
- `src/engine-client.ts` is the only rules-engine service boundary.
- `src/sheet-transfer.ts` owns bounded per-sheet JSON transfer.
- `contracts/sheet-state.schema.json` is the durable storage contract.

The former `dnd-sheets.renderer` browser-object service is intentionally not
part of v3. Styles no longer receive character blobs or inject HTML across an
add-on boundary. Presentation is package-owned and scoped; future alternate
renderers should use a serializable host-selected renderer contract if there is
a real second consumer.

## Develop

Use Node.js 26:

```powershell
npm install
npm run check
npm run package
```

`npm run package` produces a deterministic release archive under `dist/` with
SHA-256 checksums. Inspect it from the host repository before the supervised
browser test:

```powershell
go run ./cmd/codex-addon-inspect ../addon-dnd-character-sheets/dist/dnd-sheets-3.0.0.zip
```

Deployment and campaign conversion are intentionally performed later with the
site owner present.
