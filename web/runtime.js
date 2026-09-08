const generations = new Map();
export function registerRuntime(generation, runtime) {
    generations.set(generation, runtime);
    return () => { if (generations.get(generation) === runtime)
        generations.delete(generation); };
}
export function runtimeFor(generation) { return generations.get(generation); }
