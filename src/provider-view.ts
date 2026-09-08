import type { RulesEngineClient } from "./engine-client.js";
import { identityFields, savedProviderStatus } from "./rules-status.js";
import { sheetText } from "./sheet-catalogs.js";
import type { SheetState } from "./sheet-state.js";

export function providerStatus(document: Document, engine: RulesEngineClient, state: SheetState, locale: unknown, checking: boolean, check: () => void): HTMLElement {
  const t = (key: Parameters<typeof sheetText>[1]) => sheetText(locale, key), diagnostics = engine.diagnostics;
  const section = document.createElement("section"); section.className = "dnd-sheet-card dnd-provider-status"; section.tabIndex = -1; section.setAttribute("aria-label", t("providers.title"));
  const title = document.createElement("h3"), summary = document.createElement("p"), help = document.createElement("p"), button = document.createElement("button");
  title.textContent = t("providers.title"); summary.textContent = t(`providers.${diagnostics.status}`); summary.className = "dnd-provider-summary"; summary.dataset["rulesStatus"] = diagnostics.status;
  help.textContent = diagnostics.status === "ready" || diagnostics.status === "unchecked" ? t("providers.checkHelp") : `${t("providers.manualHelp")} ${t("providers.checkAgain")}`;
  button.type = "button"; button.textContent = t(checking ? "providers.checking" : "providers.check"); button.disabled = checking; button.addEventListener("click", check);
  section.append(title, summary, help, button);
  const saved = state.rulesProvider?.["identity"], current = diagnostics.status === "ready" ? { ...engine.providerIdentity, ...diagnostics.identity } : undefined;
  const comparison = document.createElement("p"); comparison.dataset["providerComparison"] = savedProviderStatus(saved, current); comparison.textContent = t(`providers.${savedProviderStatus(saved, current)}`); section.append(comparison);
  const details = document.createElement("details"), label = document.createElement("summary"); label.textContent = t("providers.details"); details.append(label);
  const identityTable = (name: string, value: unknown): void => {
    const heading = document.createElement("h4"), list = document.createElement("dl"); heading.textContent = name;
    const fields = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    for (const key of identityFields) {
      const term = document.createElement("dt"), description = document.createElement("dd"); term.textContent = t(`identity.${key}`);
      const entry = fields[key]; description.textContent = typeof entry === "string" || typeof entry === "number" ? String(entry) : t("providers.unknown"); list.append(term, description);
    }
    details.append(heading, list);
  };
  identityTable(t("providers.current"), { ...engine.providerIdentity, ...diagnostics.identity }); identityTable(t("providers.saved"), saved);
  if (diagnostics.checkedAt !== undefined) { const time = document.createElement("p"); time.textContent = `${t("providers.lastCheck")}: ${new Intl.DateTimeFormat(locale === "cs" ? "cs" : "en", { dateStyle: "medium", timeStyle: "medium" }).format(diagnostics.checkedAt)}`; details.append(time); }
  if (diagnostics.code) { const code = document.createElement("p"); code.textContent = `${t("providers.errorCode")}: ${diagnostics.code}`; details.append(code); }
  if (diagnostics.errors.length) {
    const heading = document.createElement("h4"), list = document.createElement("ul"); heading.textContent = t("providers.errors");
    for (const error of diagnostics.errors) { const entry = document.createElement("li"); entry.textContent = error; list.append(entry); }
    details.append(heading, list);
  }
  section.append(details); return section;
}
