export const identityFields = ["engineAddonId", "engineContractVersion", "engineGeneration", "engineBindingRevision", "providerAddonId", "providerContractVersion", "providerGeneration", "contentRevision", "rulesetId", "rulesetVersion", "edition"];
export function savedProviderStatus(saved, current) {
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || !Object.keys(saved).length)
        return "none";
    if (!current)
        return "unverified";
    const previous = saved;
    const comparable = identityFields.filter(key => previous[key] !== undefined && current[key] !== undefined);
    if (comparable.some(key => previous[key] !== current[key]))
        return "changed";
    // Sparse converted provenance cannot prove the complete engine/data identity.
    return identityFields.every(key => previous[key] !== undefined && current[key] !== undefined) ? "same" : "unverified";
}
export function serviceFailure(error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
    const status = code === "STALE_BINDING" || code === "STALE_GENERATION" ? "stale" : "connection-error";
    return { status, errors: error instanceof Error && error.message ? [error.message] : [], ...(code ? { code } : {}) };
}
