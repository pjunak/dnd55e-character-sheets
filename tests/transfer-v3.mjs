import test from "node:test";
import assert from "node:assert/strict";
import { parseSheet, serializeSheet, transferFormat } from "../web/sheet-transfer.js";
import { blankSheet } from "../web/sheet-state.js";

test("sheet transfer is versioned and round trips", () => {
  const sheet = blankSheet();
  sheet.className = "Ranger";
  const text = serializeSheet(sheet);
  assert.equal(JSON.parse(text).format, transferFormat);
  assert.equal(parseSheet(text).className, "Ranger");
});

test("bounded parser accepts a legacy raw sheet and rejects unsafe keys", () => {
  assert.equal(parseSheet('{"v":2,"className":"Cleric"}').className, "Cleric");
  assert.throws(() => parseSheet('{"v":2,"constructor":{"x":1}}'), /unsafe/);
});
