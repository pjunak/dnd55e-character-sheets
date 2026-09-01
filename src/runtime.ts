import type { RulesEngineClient } from "./engine-client.js";
import type { SheetRepository } from "./sheet-repository.js";

export interface SheetRuntime { readonly repository: SheetRepository; readonly engine: RulesEngineClient; readonly signal: AbortSignal }
interface RuntimeRegistry { readonly generations: Map<string, SheetRuntime> }
const registryKey = "__ttrpgCodexDndSheetsV3";

export function registerRuntime(generation: string, runtime: SheetRuntime): () => void {
  const registry = runtimeRegistry();
  registry.generations.set(generation, runtime);
  return () => { if (registry.generations.get(generation) === runtime) registry.generations.delete(generation); };
}

export function runtimeFor(generation: string): SheetRuntime | undefined { return runtimeRegistry().generations.get(generation); }

function runtimeRegistry(): RuntimeRegistry {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  const current = root[registryKey];
  if (isRegistry(current)) return current;
  const created: RuntimeRegistry = { generations: new Map() };
  root[registryKey] = created;
  return created;
}
function isRegistry(value: unknown): value is RuntimeRegistry { return typeof value === "object" && value !== null && (value as { generations?: unknown }).generations instanceof Map; }
