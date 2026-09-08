import type { RulesEngineClient } from "./engine-client.js";
import type { SheetRepository } from "./sheet-repository.js";

export interface SheetRuntime { readonly repository: SheetRepository; readonly engine: RulesEngineClient; readonly connectEngine: (signal: AbortSignal) => Promise<RulesEngineClient>; readonly signal: AbortSignal }
const generations = new Map<string, SheetRuntime>();

export function registerRuntime(generation: string, runtime: SheetRuntime): () => void {
  generations.set(generation, runtime);
  return () => { if (generations.get(generation) === runtime) generations.delete(generation); };
}

export function runtimeFor(generation: string): SheetRuntime | undefined { return generations.get(generation); }
