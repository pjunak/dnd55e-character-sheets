export type RulesStatus = "unchecked" | "missing-engine" | "connection-error" | "ready" | "missing" | "unavailable" | "incompatible" | "stale";
export interface RulesDiagnostics {
  readonly status: RulesStatus;
  readonly errors: readonly string[];
  readonly identity?: Readonly<Record<string, unknown>>;
  readonly checkedAt?: number;
  readonly code?: string;
}
export const identityFields = ["engineAddonId", "engineContractVersion", "engineGeneration", "engineBindingRevision", "providerAddonId", "providerContractVersion", "providerGeneration", "contentRevision", "rulesetId", "rulesetVersion", "edition"] as const;
export type IdentityField = typeof identityFields[number];

export function savedProviderStatus(saved: unknown, current: Readonly<Record<string, unknown>> | undefined): "none" | "unverified" | "same" | "changed" {
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || !Object.keys(saved).length) return "none";
  if (!current) return "unverified";
  const previous = saved as Record<string, unknown>;
  const comparable = identityFields.filter(key => previous[key] !== undefined && current[key] !== undefined);
  if (comparable.some(key => previous[key] !== current[key])) return "changed";
  // Sparse converted provenance cannot prove the complete engine/data identity.
  return identityFields.every(key => previous[key] !== undefined && current[key] !== undefined) ? "same" : "unverified";
}

export function serviceFailure(error: unknown): Pick<RulesDiagnostics, "status" | "errors" | "code"> {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
  const status = code === "STALE_BINDING" || code === "STALE_GENERATION" ? "stale" : "connection-error";
  return { status, errors: error instanceof Error && error.message ? [error.message] : [], ...(code ? { code } : {}) };
}
