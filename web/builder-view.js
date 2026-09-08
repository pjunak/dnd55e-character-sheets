import { sheetTranslator, remainingChoices } from "./sheet-catalogs.js";
import { button, el } from "./play-view.js";
import { record, rows } from "./workflow-view.js";
import { createId } from "./sheet-state.js";
export function builderProgress(document, guidance, navigate, open, toggle, t = sheetTranslator()) {
    const rail = el(document, "details", "dse-build-rail");
    rail.setAttribute("aria-label", t("builder.progress"));
    rail.open = open;
    rail.addEventListener("toggle", () => toggle(rail.open));
    const total = Number(guidance["total"] ?? 0), complete = Number(guidance["complete"] ?? 0), remaining = total - complete;
    const summary = el(document, "summary", "dse-build-progress-head");
    summary.append(el(document, "span", "dse-stat-label", t("builder.characterBuilder")), el(document, "h3", "", t("builder.progress")));
    const progress = el(document, "progress", "dse-build-meter");
    progress.max = total || 1;
    progress.value = complete;
    progress.setAttribute("aria-label", t("builder.completion"));
    summary.append(progress, el(document, "strong", "", remaining ? remainingChoices(t, remaining) : t("builder.complete")));
    rail.append(summary);
    const titles = { foundation: t("builder.foundation"), progression: t("builder.progression"), spells: t("builder.spellChoices") };
    for (const section of rows(guidance["sections"])) {
        const step = el(document, "section", `dse-build-step${Number(section["complete"]) === Number(section["total"]) ? " is-complete" : ""}`);
        const head = el(document, "div", "dse-build-step-head");
        head.append(el(document, "strong", "", titles[String(section["id"])] ?? String(section["id"])), el(document, "span", "", `${String(section["complete"])}/${String(section["total"])}`));
        step.append(head);
        for (const issue of rows(section["issues"]))
            step.append(button(document, `${String(issue["label"])} →`, () => navigate({ tab: String(issue["tab"]), level: Number(issue["level"]), id: String(issue["id"]) }), false, String(issue["label"])));
        rail.append(step);
    }
    return rail;
}
export function builderTabs(document, classes, active, navigate, t = sheetTranslator()) {
    const tabs = [{ classId: "character", name: t("builder.character") }, ...classes], nav = el(document, "div", "codex-tab-strip dnd-builder-tabs");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", t("builder.sections"));
    tabs.forEach((tab, index) => {
        const id = String(tab["classId"]), selected = id === active;
        const item = button(document, `${String(tab["name"])}${tab["level"] ? ` ${String(tab["level"])}` : ""}`, () => navigate({ tab: id }));
        item.className = `codex-tab${selected ? " is-active" : ""}`;
        item.setAttribute("role", "tab");
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
        item.dataset["builderTab"] = id;
        item.addEventListener("keydown", event => {
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1;
            if (next >= 0) {
                event.preventDefault();
                navigate({ tab: String(tabs[next]["classId"]), id: "tab" });
            }
        });
        nav.append(item);
    });
    return nav;
}
export function builderSummary(document, guidance, t = sheetTranslator()) {
    const derived = record(guidance["derived"]), root = el(document, "div", "dse-builder-summary");
    for (const [label, value] of [[t("play.hpMax"), derived["maxHp"]], [t("play.ac"), derived["armorClass"]], [t("play.proficiency"), derived["proficiencyBonus"]]]) {
        const stat = el(document, "div", "codex-tile");
        stat.append(el(document, "span", "dse-stat-label", String(label)), el(document, "strong", "", String(value ?? "—")));
        root.append(stat);
    }
    return root;
}
export function extraFeats(view, catalog, change, add) {
    const t = sheetTranslator(view.locale);
    const { document, state, editable } = view, section = el(document, "section", "dnd-extra-feats");
    section.append(el(document, "h4", "", t("builder.rewards")));
    for (const feat of state.extraFeats) {
        const source = catalog.find(value => value.id === feat["featId"]), name = String(source?.name ?? feat["name"] ?? feat["featId"] ?? t("builder.reward"));
        const row = el(document, "div", "dnd-extra-feat");
        row.append(el(document, "strong", "", name));
        const note = el(document, "input", "");
        note.type = "text";
        note.value = String(feat["sourceNote"] ?? "");
        note.maxLength = 500;
        note.setAttribute("aria-label", t("builder.rewardSource", { name }));
        note.disabled = !editable;
        note.addEventListener("change", () => change(draft => { const current = draft.extraFeats.find(value => value["id"] === feat["id"]); if (current)
            current["sourceNote"] = note.value; }));
        row.append(note);
        if (editable)
            row.append(button(document, t("common.remove"), () => change(draft => { draft.extraFeats = draft.extraFeats.filter(value => value["id"] !== feat["id"]); }), false, t("builder.removeReward", { name })));
        section.append(row);
    }
    if (!state.extraFeats.length)
        section.append(el(document, "p", "dse-empty", t("builder.noRewards")));
    if (editable)
        section.append(button(document, t("builder.addReward"), add));
    return section;
}
export function extraFeatForm(document, catalog, submit, dirty, t = sheetTranslator()) {
    const form = el(document, "form", "dnd-extra-feat-form");
    const selected = el(document, "select", "");
    selected.setAttribute("aria-label", t("builder.extraFeat"));
    selected.append(new Option(t("builder.customReward"), ""));
    for (const feat of catalog)
        selected.append(new Option(feat.name ?? feat.id, feat.id));
    const name = el(document, "input", ""), note = el(document, "input", "");
    name.placeholder = t("builder.rewardName");
    name.setAttribute("aria-label", t("builder.rewardName"));
    name.maxLength = 200;
    name.required = true;
    note.placeholder = t("builder.sourceNote");
    note.setAttribute("aria-label", t("builder.sourceNote"));
    note.maxLength = 500;
    selected.addEventListener("change", () => { name.disabled = selected.value !== ""; name.required = selected.value === ""; dirty(); });
    form.addEventListener("input", dirty);
    const apply = button(document, t("builder.addRewardSubmit"), () => { });
    apply.type = "submit";
    form.addEventListener("submit", event => { event.preventDefault(); if (!selected.value && !name.value.trim())
        return; submit({ id: createId("xfeat"), featId: selected.value || null, name: selected.value ? "" : name.value.trim(), sourceNote: note.value }); });
    form.append(selected, name, note, apply);
    return form;
}
