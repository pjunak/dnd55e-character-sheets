import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../addon.json", import.meta.url), "utf8"));

test("compiled v3 entry binds one additive section and disposes cleanly", async () => {
  const originalHTMLElement = globalThis.HTMLElement;
  const originalCustomElements = globalThis.customElements;
  const definitions = new Map();
  globalThis.HTMLElement = class {};
  globalThis.customElements = { define: (name, constructor) => definitions.set(name, constructor), get: name => definitions.get(name) };
  try {
    const { activate } = await import("../web/index.js?smoke-v3");
    const controller = new AbortController();
    const bindings = [];
    const extensionCalls = [];
    let serviceConnect;
    const context = {
      addon: { id: manifest.id, version: manifest.version, generation: "a".repeat(64) },
      signal: controller.signal,
      capabilities: { require: capability => assert.equal(capability, "ui.contributions") },
      data: {
        recordExtension: (target, id) => {
          extensionCalls.push({ target, id });
          return { get: async () => assert.fail("not loaded during activation"), put: async () => assert.fail("not saved during activation") };
        },
      },
      services: {
        connect: async (contract, options) => {
          serviceConnect = { contract, options };
          return { available: false, providers: [], call: async () => assert.fail("optional engine is absent") };
        },
      },
      ui: {
        bind: (id, binding) => {
          const entry = { id, binding, disposed: false };
          bindings.push(entry);
          return { dispose: () => { entry.disposed = true; } };
        },
      },
    };

    const disposable = await activate(context);
    assert.deepEqual(extensionCalls, [{ target: "characters", id: "dnd-sheets" }]);
    assert.equal(serviceConnect.contract, "dnd5e.rules-engine");
    assert.equal(serviceConnect.options.range, "^3.0.0");
    assert.deepEqual(bindings.map(entry => ({ id: entry.id, tag: entry.binding.tag })), [{ id: "sheet.section", tag: "dnd-character-sheet" }]);
    assert.ok(definitions.has("dnd-character-sheet"));
    disposable.dispose();
    assert.equal(bindings[0].disposed, true);
    disposable.dispose();
  } finally {
    if (originalHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = originalHTMLElement;
    if (originalCustomElements === undefined) delete globalThis.customElements;
    else globalThis.customElements = originalCustomElements;
  }
});
