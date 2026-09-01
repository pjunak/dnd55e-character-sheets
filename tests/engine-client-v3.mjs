import test from "node:test";
import assert from "node:assert/strict";
import { RulesEngineClient, materializeHydration } from "../web/engine-client.js";
import { blankSheet } from "../web/sheet-state.js";

test("engine client sends contract-owned v3 requests", async () => {
  const calls = [];
  const handle = {
    available: true,
    providers: [{ addonId: "dnd-engine", contractVersion: "3.0.0", generation: "a".repeat(64), bindingRevision: 1 }],
    async call(method, params, options) {
      calls.push({ method, params, deadlineMs: options.deadlineMs });
      return method === "builder-plan" ? { available: false, status: "missing", errors: [] } : { records: [] };
    },
  };
  const client = new RulesEngineClient(handle, new AbortController().signal);
  await client.builderPlan(blankSheet());
  assert.equal(calls[0].method, "builder-plan");
  assert.equal(calls[0].params.contractVersion, "rules-engine-builder-plan.v1");
  assert.equal(calls[0].deadlineMs, 15000);
  assert.equal(client.providerLabel, "dnd-engine");
});

test("materialization updates durable fallback fields while preserving play state", () => {
  const sheet = blankSheet();
  sheet.hp = 7;
  sheet.inventory.push({ id: "rope", name: "Rope", qty: 1, location: "pack", notes: "" });
  const result = materializeHydration(sheet, {
    identity: { edition: "2024", contentRevision: "r1" },
    warnings: [],
    sheet: {
      totalLevel: 4,
      abilities: { STR: { score: 16 }, DEX: { score: 12 } },
      derived: { maxHp: 36, armorClass: 17, initiative: 1, speed: 30, proficiencyBonus: 2 },
      saves: { STR: { proficient: true } },
      skills: { athletics: { proficient: true, expertise: true } },
    },
  });
  assert.equal(result.level, 4);
  assert.equal(result.maxHp, 36);
  assert.equal(result.hp, 7);
  assert.equal(result.ac, 17);
  assert.equal(result.abilities.STR, 16);
  assert.equal(result.skillExpertise.athletics, true);
  assert.equal(result.inventory[0].name, "Rope");
  assert.equal(result.ruleset, "2024");
});
