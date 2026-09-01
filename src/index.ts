import { RulesEngineClient } from "./engine-client.js";
import { defineSheetElement, sheetElementTag } from "./sheet-element.js";
import { registerRuntime } from "./runtime.js";
import { SheetRepository } from "./sheet-repository.js";
import type { AddonContext, Disposable } from "./sdk.js";
import type { SheetState } from "./sheet-state.js";

export async function activate(context: AddonContext): Promise<Disposable> {
  context.capabilities.require("ui.contributions");
  context.signal.throwIfAborted();
  const service = await context.services.connect("dnd5e.rules-engine", { range: "^3.0.0", cardinality: "one", signal: context.signal });
  const repository = new SheetRepository(context.data.recordExtension<SheetState>("characters", "dnd-sheets"), context.signal);
  const unregister = registerRuntime(context.addon.generation, { repository, engine: new RulesEngineClient(service, context.signal), signal: context.signal });
  defineSheetElement();
  const binding = context.ui.bind("sheet.section", { kind: "element", tag: sheetElementTag });
  let disposed = false;
  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      binding.dispose();
      unregister();
    },
  });
}
