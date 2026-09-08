import { connectRulesEngine } from "./engine-client.js";
import { defineSheetElement } from "./sheet-element.js";
import { registerRuntime } from "./runtime.js";
import { SheetRepository } from "./sheet-repository.js";
export async function activate(context) {
    context.capabilities.require("ui.contributions");
    context.signal.throwIfAborted();
    const engine = await connectRulesEngine(context);
    context.signal.throwIfAborted();
    const repository = new SheetRepository(context.data.recordExtension("characters", "dnd-sheets"), context.signal);
    const unregister = registerRuntime(context.addon.generation, { repository, engine, connectEngine: signal => connectRulesEngine(context, signal), signal: context.signal });
    const sheetElementTag = defineSheetElement(context.addon.generation);
    const binding = context.ui.bind("sheet.section", { kind: "element", tag: sheetElementTag });
    let disposed = false;
    return Object.freeze({
        dispose() {
            if (disposed)
                return;
            disposed = true;
            binding.dispose();
            unregister();
        },
    });
}
