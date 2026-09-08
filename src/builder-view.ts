import type { RuleRecord } from "./engine-client.js";
import { button, el, type PlayView } from "./play-view.js";
import { record, rows } from "./workflow-view.js";
import { createId, type SheetState } from "./sheet-state.js";

export interface BuilderTarget { tab: string; level?: number; id?: string }
export function builderProgress(document: Document, guidance: Record<string, unknown>, navigate: (target: BuilderTarget) => void, open: boolean, toggle: (open: boolean) => void): HTMLElement {
  const rail = el(document, "details", "dse-build-rail"); rail.setAttribute("aria-label", "Build progress"); rail.open = open;
  rail.addEventListener("toggle", () => toggle(rail.open));
  const total = Number(guidance["total"] ?? 0), complete = Number(guidance["complete"] ?? 0), remaining = total - complete;
  const summary = el(document, "summary", "dse-build-progress-head");
  summary.append(el(document, "span", "dse-stat-label", "Character builder"), el(document, "h3", "", "Build progress"));
  const progress = el(document, "progress", "dse-build-meter"); progress.max = total || 1; progress.value = complete; progress.setAttribute("aria-label", "Build completion");
  summary.append(progress, el(document, "strong", "", remaining ? `${remaining} ${remaining === 1 ? "choice" : "choices"} remaining` : "Build choices complete")); rail.append(summary);
  const titles: Record<string, string> = { foundation: "Foundation", progression: "Class progression", spells: "Spell choices" };
  for (const section of rows(guidance["sections"])) {
    const step = el(document, "section", `dse-build-step${Number(section["complete"]) === Number(section["total"]) ? " is-complete" : ""}`);
    const head = el(document, "div", "dse-build-step-head"); head.append(el(document, "strong", "", titles[String(section["id"])] ?? String(section["id"])), el(document, "span", "", `${String(section["complete"])}/${String(section["total"])}`)); step.append(head);
    for (const issue of rows(section["issues"])) step.append(button(document, `${String(issue["label"])} →`, () => navigate({ tab: String(issue["tab"]), level: Number(issue["level"]), id: String(issue["id"]) }), false, String(issue["label"])));
    rail.append(step);
  }
  return rail;
}

export function builderTabs(document: Document, classes: readonly Record<string, unknown>[], active: string, navigate: (target: BuilderTarget) => void): HTMLElement {
  const tabs = [{ classId: "character", name: "Character" }, ...classes], nav = el(document, "div", "codex-tab-strip dnd-builder-tabs"); nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", "Builder sections");
  tabs.forEach((tab, index) => {
    const id = String(tab["classId"]), selected = id === active;
    const item = button(document, `${String(tab["name"])}${tab["level"] ? ` ${String(tab["level"])}` : ""}`, () => navigate({ tab: id }));
    item.className = `codex-tab${selected ? " is-active" : ""}`; item.setAttribute("role", "tab"); item.setAttribute("aria-selected", String(selected)); item.tabIndex = selected ? 0 : -1; item.dataset["builderTab"] = id;
    item.addEventListener("keydown", event => {
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1;
      if (next >= 0) { event.preventDefault(); navigate({ tab: String(tabs[next]!["classId"]), id: "tab" }); }
    }); nav.append(item);
  }); return nav;
}

export function builderSummary(document: Document, guidance: Record<string, unknown>): HTMLElement {
  const derived = record(guidance["derived"]), root = el(document, "div", "dse-builder-summary");
  for (const [label, value] of [["Maximum HP", derived["maxHp"]], ["Armor class", derived["armorClass"]], ["Proficiency", derived["proficiencyBonus"]]]) {
    const stat = el(document, "div", "codex-tile"); stat.append(el(document, "span", "dse-stat-label", String(label)), el(document, "strong", "", String(value ?? "—"))); root.append(stat);
  }
  return root;
}

export function extraFeats(view: PlayView, catalog: readonly RuleRecord[], change: (mutate: (draft: SheetState) => void) => void, add: () => void): HTMLElement {
  const { document, state, editable } = view, section = el(document, "section", "dnd-extra-feats"); section.append(el(document, "h4", "", "Extra feats & rewards"));
  for (const feat of state.extraFeats) {
    const source = catalog.find(value => value.id === feat["featId"]), name = String(source?.name ?? feat["name"] ?? feat["featId"] ?? "Reward");
    const row = el(document, "div", "dnd-extra-feat"); row.append(el(document, "strong", "", name));
    const note = el(document, "input", ""); note.type = "text"; note.value = String(feat["sourceNote"] ?? ""); note.maxLength = 500; note.setAttribute("aria-label", `${name} source note`); note.disabled = !editable;
    note.addEventListener("change", () => change(draft => { const current = draft.extraFeats.find(value => value["id"] === feat["id"]); if (current) current["sourceNote"] = note.value; })); row.append(note);
    if (editable) row.append(button(document, "Remove", () => change(draft => { draft.extraFeats = draft.extraFeats.filter(value => value["id"] !== feat["id"]); }), false, `Remove extra feat ${name}`)); section.append(row);
  }
  if (!state.extraFeats.length) section.append(el(document, "p", "dse-empty", "No extra feats or rewards."));
  if (editable) section.append(button(document, "Add extra feat or reward", add)); return section;
}

export function extraFeatForm(document: Document, catalog: readonly RuleRecord[], submit: (feat: Record<string, unknown>) => void, dirty: () => void): HTMLElement {
  const form = el(document, "form", "dnd-extra-feat-form");
  const selected = el(document, "select", ""); selected.setAttribute("aria-label", "Extra feat"); selected.append(new Option("Custom reward…", ""));
  for (const feat of catalog) selected.append(new Option(feat.name ?? feat.id, feat.id));
  const name = el(document, "input", ""), note = el(document, "input", ""); name.placeholder = "Custom reward name"; name.setAttribute("aria-label", "Custom reward name"); name.maxLength = 200; name.required = true;
  note.placeholder = "Source note"; note.setAttribute("aria-label", "Source note"); note.maxLength = 500;
  selected.addEventListener("change", () => { name.disabled = selected.value !== ""; name.required = selected.value === ""; dirty(); }); form.addEventListener("input", dirty);
  const apply = button(document, "Add reward", () => {}); apply.type = "submit";
  form.addEventListener("submit", event => { event.preventDefault(); if (!selected.value && !name.value.trim()) return; submit({ id: createId("xfeat"), featId: selected.value || null, name: selected.value ? "" : name.value.trim(), sourceNote: note.value }); });
  form.append(selected, name, note, apply); return form;
}
