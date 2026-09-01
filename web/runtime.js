const registryKey = "__ttrpgCodexDndSheetsV3";
export function registerRuntime(generation, runtime) {
    const registry = runtimeRegistry();
    registry.generations.set(generation, runtime);
    return () => { if (registry.generations.get(generation) === runtime)
        registry.generations.delete(generation); };
}
export function runtimeFor(generation) { return runtimeRegistry().generations.get(generation); }
function runtimeRegistry() {
    const root = globalThis;
    const current = root[registryKey];
    if (isRegistry(current))
        return current;
    const created = { generations: new Map() };
    root[registryKey] = created;
    return created;
}
function isRegistry(value) { return typeof value === "object" && value !== null && value.generations instanceof Map; }
