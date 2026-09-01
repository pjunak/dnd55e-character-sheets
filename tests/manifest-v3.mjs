import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest preserves the data namespace and optional engine boundary", async () => {
  const manifest = JSON.parse(await readFile(new URL("../addon.json", import.meta.url), "utf8"));
  assert.equal(manifest.id, "dnd-sheets");
  assert.equal(manifest.compatibility.addonApi, "^3.0.0");
  assert.deepEqual(manifest.runtime.ui, { mode: "integrated", entry: "web/index.js", styles: ["web/index.css"] });
  assert.deepEqual(manifest.recordExtensions, [{ id: "dnd-sheets", target: "characters", visibility: "public", schema: "contracts/sheet-state.schema.json", schemaVersion: "3.0.0" }]);
  assert.equal(manifest.services.consumes[0].contract, "dnd5e.rules-engine");
  assert.equal(manifest.services.consumes[0].required, false);
  assert.equal(manifest.contributions[0].surface, "article-section");
  assert.deepEqual(manifest.contributions[0].config, { collection: "characters" });
});

test("packaged sheet schema deliberately retains unknown legacy fields", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/sheet-state.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.additionalProperties, true);
  assert.equal(schema.properties.v.maximum, 3);
});
