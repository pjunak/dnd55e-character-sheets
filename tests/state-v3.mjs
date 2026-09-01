import test from "node:test";
import assert from "node:assert/strict";
import { abilityModifier, blankSheet, normalizeSheet } from "../web/sheet-state.js";

test("legacy sheet blobs normalize without losing unknown fields", () => {
  const normalized = normalizeSheet({
    v: 1,
    className: "Wizard",
    abilities: { INT: 17 },
    saveProf: { INT: true },
    inventory: [{ id: "book", name: "Spellbook" }],
    homebrewCampaignField: { intact: true },
  });

  assert.equal(normalized.v, 3);
  assert.equal(normalized.className, "Wizard");
  assert.equal(normalized.abilities.INT, 17);
  assert.equal(normalized.abilities.STR, 10);
  assert.equal(normalized.manualSaveProf.INT, true);
  assert.equal(normalized.inventory[0].qty, 1);
  assert.deepEqual(normalized.homebrewCampaignField, { intact: true });
});

test("blank sheets remain fully usable without a rules engine", () => {
  const sheet = blankSheet();
  assert.equal(sheet.level, 1);
  assert.equal(sheet.ac, 10);
  assert.equal(sheet.speed, 30);
  assert.equal(abilityModifier(sheet.abilities.STR), 0);
  assert.deepEqual(sheet.inventory, []);
});
