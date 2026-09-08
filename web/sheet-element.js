import { applyDecisions, materializeHydration } from "./engine-client.js";
import { runtimeFor } from "./runtime.js";
import { parseSheet, serializeSheet } from "./sheet-transfer.js";
import { abilities, cloneSheet, createId } from "./sheet-state.js";
import { SheetEditor } from "./sheet-editor.js";
import { abilityRail, backpack, combatDetails, el, preferredLayout, vitals } from "./play-view.js";
import { equipmentKinds, equipmentPicker, foundationEditor, playReview, restControls, spellBrowser, rows as asRecords } from "./workflow-view.js";
import { copySpellForm, grantedSpells, spellSwapHistory, swapSpellForm } from "./spell-tools.js";
import { equipmentCandidates, equipInventory } from "./equipment-state.js";
import { builderProgress, builderSummary, builderTabs, extraFeatForm, extraFeats } from "./builder-view.js";
import { sheetText } from "./sheet-catalogs.js";
import { providerStatus } from "./provider-view.js";
const tabs = [["sheet", "tab.sheet"], ["combat", "tab.combat"], ["spells", "tab.spells"], ["notes", "tab.notes"], ["builder", "tab.builder"], ["tools", "tab.tools"]];
export function defineSheetElement(generation) {
    const sheetElementTag = `dnd-character-sheet-${generation}`;
    if (customElements.get(sheetElementTag) !== undefined)
        return sheetElementTag;
    class CharacterSheetElement extends HTMLElement {
        #contribution;
        #runtime;
        #editor;
        get #snapshot() { return this.#editor?.snapshot; }
        #epoch = 0;
        #typing = false;
        #deferredRender = false;
        #pointerDown = false;
        #changingControl = false;
        #requestedRender = false;
        #layout = "compact";
        #editing = false;
        #tab = "sheet";
        #busy = false;
        #message = "";
        #messageKind = "status";
        #hydration;
        #builderPlan;
        #classRecords = [];
        #featRecords = [];
        #speciesRecords = [];
        #backgroundRecords = [];
        #subclassRecords = [];
        #spellRecords;
        #spellOptions;
        #spellBrowser = { classId: "", query: "", level: "" };
        #dialog;
        #dialogDirty = false;
        #equipmentRecords = [];
        #builderGuidance;
        #builderTab = "character";
        #builderLevel = "";
        #builderRailOpen = true;
        #providerRequest;
        #checkingRules = false;
        #t(key) { return sheetText(this.#contribution?.host.locale, key); }
        set codexContribution(value) {
            const previous = this.#contribution;
            this.#contribution = value;
            if (this.isConnected) {
                if (previous?.host.key !== value.host.key || previous?.host.canEdit !== value.host.canEdit)
                    void this.#connect();
                else if (previous?.host.locale !== value.host.locale)
                    this.#render(true);
                else
                    this.#publishEdits();
            }
        }
        constructor() {
            super();
            this.addEventListener("pointerdown", () => { this.#pointerDown = true; });
            this.addEventListener("change", () => {
                this.#changingControl = true;
                setTimeout(() => { this.#changingControl = false; if (this.isConnected && this.#deferredRender)
                    this.#render(true); }, 0);
            }, true);
            this.addEventListener("input", event => { if (this.#canEdit() && event.target instanceof HTMLElement && !event.target.closest(".dnd-builder-choices, .dnd-builder-classes, .dnd-spell-browser") && !event.target.hasAttribute("data-sheet-layout")) {
                this.#typing = true;
                this.#publishEdits();
            } });
            // Focus settles after blur/change. Replacing controls inside focusout can cancel the pending click.
            this.addEventListener("focusout", () => { setTimeout(() => { if (this.isConnected && this.#deferredRender && !this.contains(this.ownerDocument.activeElement))
                this.#render(); }, 0); });
        }
        connectedCallback() {
            this.classList.add("addon-dnd-sheets");
            this.ownerDocument.addEventListener("pointerup", this.#releasePointer);
            this.ownerDocument.addEventListener("pointercancel", this.#releasePointer);
            void this.#connect();
        }
        disconnectedCallback() {
            this.#providerRequest?.abort();
            this.#providerRequest = undefined;
            this.#closeDialog();
            this.#epoch++;
            this.#editor?.dispose();
            this.#runtime = undefined;
            this.#pointerDown = false;
            this.ownerDocument.removeEventListener("pointerup", this.#releasePointer);
            this.ownerDocument.removeEventListener("pointercancel", this.#releasePointer);
        }
        #releasePointer = () => {
            if (!this.#pointerDown)
                return;
            setTimeout(() => { this.#pointerDown = false; if (this.isConnected && this.#deferredRender)
                this.#render(true); }, 0);
        };
        async #connect() {
            this.#providerRequest?.abort();
            this.#providerRequest = undefined;
            this.#checkingRules = false;
            this.#closeDialog();
            const epoch = ++this.#epoch;
            this.#editor?.dispose();
            this.#editor = undefined;
            this.#typing = false;
            const contribution = this.#contribution;
            if (contribution === undefined || contribution.host.collection !== "characters") {
                this.#renderUnavailable("The host did not provide a character record context.");
                return;
            }
            const runtime = runtimeFor(contribution.addon.generation);
            if (runtime === undefined || runtime.signal.aborted) {
                this.#renderUnavailable("This character-sheet generation is no longer active.");
                return;
            }
            this.#runtime = runtime;
            try {
                this.#layout = preferredLayout(this.ownerDocument.defaultView?.localStorage, contribution.host.key);
            }
            catch {
                this.#layout = "compact";
            }
            this.#hydration = undefined;
            this.#builderPlan = undefined;
            this.#builderGuidance = undefined;
            this.#builderTab = "character";
            this.#builderLevel = "";
            this.#builderRailOpen = !this.ownerDocument.defaultView?.matchMedia("(max-width: 768px)").matches;
            this.#spellRecords = undefined;
            this.#spellOptions = undefined;
            this.#equipmentRecords = [];
            this.#message = "";
            this.#busy = true;
            this.#render();
            try {
                const snapshot = await runtime.repository.load(contribution.host.key);
                if (epoch !== this.#epoch)
                    return;
                this.#editor = new SheetEditor(runtime.repository, snapshot, () => { if (epoch === this.#epoch) {
                    this.#publishEdits();
                    this.#render(true);
                } });
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, this.#t("load.failed"));
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#publishEdits();
                    this.#render();
                }
            }
        }
        #render(preserveFocus = false) {
            if (!preserveFocus)
                this.#requestedRender = true;
            this.#publishEdits();
            if (this.#pointerDown || this.#changingControl) {
                this.#deferredRender = true;
                return;
            }
            this.#updateStatus();
            const focused = this.ownerDocument.activeElement;
            if (!this.#busy && focused !== null && this.contains(focused) && ((preserveFocus && !this.#requestedRender) || focused.matches("input, textarea, select"))) {
                this.#deferredRender = true;
                return;
            }
            this.#deferredRender = false;
            this.#requestedRender = false;
            const snapshot = this.#snapshot;
            if (snapshot === undefined) {
                if (this.#busy)
                    this.replaceChildren(messageBlock(this.ownerDocument, this.#t("load.sheet"), "status"));
                else
                    this.#renderUnavailable(this.#message || this.#t("load.failed"));
                return;
            }
            const document = this.ownerDocument;
            const root = document.createElement("section");
            root.className = `dnd-sheet-shell dse-layout-${this.#layout}`;
            const heading = document.createElement("div");
            heading.className = "dnd-sheet-heading";
            const title = document.createElement("div");
            const h2 = document.createElement("h2");
            h2.textContent = snapshot.state.className || this.#t("sheet.title");
            const subtitle = document.createElement("p");
            subtitle.textContent = identityLine(snapshot.state);
            title.append(h2, subtitle);
            const engine = actionButton(document, this.#t(`providers.${this.#runtime.engine.diagnostics.status}`), () => {
                this.#tab = "tools";
                this.#render();
                this.querySelector(".dnd-provider-status")?.focus({ preventScroll: false });
            }, undefined, this.#busy);
            engine.className = "dnd-sheet-engine";
            engine.title = this.#t("providers.title");
            heading.append(title, engine);
            if (this.#contribution?.host.canEdit)
                heading.append(actionButton(document, this.#t(this.#editing ? "sheet.done" : "sheet.edit"), () => {
                    if (this.#busy || this.#editor?.dirty)
                        return;
                    this.#editing = !this.#editing;
                    this.#render();
                }, "small", this.#busy || this.#editor?.dirty === true));
            root.append(heading, this.#renderTabs(document));
            const status = document.createElement("div");
            status.className = "dnd-save-status";
            root.append(status);
            const panel = document.createElement("div");
            panel.className = "dnd-sheet-panel";
            panel.inert = this.#busy;
            panel.id = `dnd-panel-${this.#tab}`;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", `dnd-tab-${this.#tab}`);
            switch (this.#tab) {
                case "sheet":
                    this.#renderSheet(panel, snapshot.state);
                    break;
                case "combat":
                    this.#renderCombat(panel, snapshot.state);
                    break;
                case "spells":
                    this.#renderSpells(panel, snapshot.state);
                    break;
                case "builder":
                    this.#renderBuilder(panel, snapshot.state);
                    break;
                case "notes":
                    this.#renderNotes(panel, snapshot.state);
                    break;
                case "tools":
                    this.#renderTools(panel, snapshot.state);
                    break;
            }
            root.append(panel);
            this.replaceChildren(root);
            this.#updateStatus();
        }
        #publishEdits() { this.#contribution?.edits.set({ dirty: this.#typing || this.#dialogDirty || this.#editor?.dirty === true, saving: this.#editor?.saving === true || this.#busy }); }
        #updateStatus() {
            const area = this.querySelector(".dnd-save-status");
            if (area === null)
                return;
            const editor = this.#editor;
            const signature = JSON.stringify([this.#contribution?.host.locale, editor?.error === undefined ? null : errorStatus(editor.error) ?? "failed", editor?.saving, editor?.dirty, this.#message, this.#messageKind]);
            if (area.getAttribute("data-status") === signature)
                return;
            area.setAttribute("data-status", signature);
            area.replaceChildren();
            if (editor?.error !== undefined) {
                const conflict = errorStatus(editor.error) === 409;
                area.append(messageBlock(this.ownerDocument, this.#t(conflict ? "save.conflict" : "save.failed"), "alert"));
                area.append(actionButton(this.ownerDocument, this.#t("save.export"), () => downloadSheet(editor.snapshot.state)), actionButton(this.ownerDocument, this.#t("save.reload"), () => void this.#connect()));
                if (!conflict)
                    area.append(actionButton(this.ownerDocument, this.#t("save.retry"), () => void this.#retrySave()));
            }
            else if (editor?.saving)
                area.append(messageBlock(this.ownerDocument, this.#t("save.saving"), "status"));
            else if (editor?.dirty)
                area.append(messageBlock(this.ownerDocument, this.#t("save.dirty"), "status"));
            else if (this.#message)
                area.append(messageBlock(this.ownerDocument, this.#message, this.#messageKind));
        }
        async #retrySave() {
            const editor = this.#editor, epoch = this.#epoch;
            if (!editor)
                return;
            const saved = await editor.save();
            if (epoch !== this.#epoch)
                return;
            if (saved) {
                this.#message = this.#t("save.saved");
                this.#messageKind = "status";
            }
            this.#render(true);
        }
        #renderTabs(document) {
            const navigation = document.createElement("nav");
            navigation.className = "dnd-sheet-tabs codex-tab-strip";
            navigation.setAttribute("role", "tablist");
            navigation.setAttribute("aria-label", this.#t("sheet.sections"));
            for (const [id, label] of tabs) {
                const item = actionButton(document, this.#t(label), () => { this.#tab = id; this.#message = ""; this.#render(); });
                item.className = `codex-tab${id === this.#tab ? " is-active" : ""}${id === "builder" || id === "tools" ? " codex-tab-tool" : ""}`;
                item.id = `dnd-tab-${id}`;
                item.setAttribute("role", "tab");
                item.setAttribute("aria-selected", String(id === this.#tab));
                item.setAttribute("aria-controls", `dnd-panel-${id}`);
                item.tabIndex = id === this.#tab ? 0 : -1;
                item.addEventListener("keydown", event => {
                    const index = tabs.findIndex(([key]) => key === id);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1;
                    if (next < 0)
                        return;
                    event.preventDefault();
                    this.#tab = tabs[next][0];
                    this.#render();
                    this.querySelector(`#dnd-tab-${this.#tab}`)?.focus();
                });
                navigation.append(item);
            }
            return navigation;
        }
        #view(state) {
            return { document: this.ownerDocument, state, layout: this.#layout, editable: this.#canEdit(), save: change => { void this.#save(change); }, addItem: () => void this.#openEquipment(), equipment: this.#equipmentRecords,
                fillSlot: slot => void this.#openSlot(slot), clearSlot: id => void this.#saveEquipment(draft => { const item = draft.inventory.find(value => value.id === id); if (item?.["attuned"])
                    item["attuned"] = false;
                else if (item)
                    item.location = "pack"; }),
            };
        }
        #renderSheet(panel, state) {
            const view = this.#view(state), columns = el(panel.ownerDocument, "div", "dse-cols"), main = el(panel.ownerDocument, "div", "dse-cols-main");
            main.append(vitals(view), backpack(view));
            columns.append(abilityRail(view), main);
            panel.append(columns);
        }
        #renderCombat(panel, state) {
            const view = this.#view(state), columns = el(panel.ownerDocument, "div", "dse-cols"), main = el(panel.ownerDocument, "div", "dse-cols-main");
            main.append(vitals(view), restControls(view, this.#runtime?.engine.available === true, (change, review) => void this.#play(change, review)), combatDetails(view));
            columns.append(abilityRail(view), main);
            panel.append(columns);
        }
        #renderSpells(panel, state) {
            const document = panel.ownerDocument;
            panel.append(vitals(this.#view(state)));
            const section = card(document, "Spellbook");
            if (this.#runtime?.engine.available === true) {
                if (this.#spellRecords === undefined || this.#spellOptions === undefined)
                    section.append(actionButton(document, "Manage class spells", () => void this.#loadSpells(), undefined, this.#busy));
                else {
                    const change = (value) => { void this.#play(value); };
                    section.append(spellBrowser(this.#view(state), this.#spellRecords, this.#hydration?.sheet ?? asRecord(state.rulesProvider?.["materialized"]), this.#spellBrowser, change, {
                        options: this.#spellOptions,
                        copy: (spell, classId, cost) => this.#showDialog("Copy a spell", copySpellForm(document, state, spell, classId, cost, value => { this.#closeDialog(); void this.#play(value, true); })),
                        swap: (classId, eligible) => this.#showDialog("Level-up spell swap", swapSpellForm(document, state, classId, eligible, this.#spellRecords, value => { this.#closeDialog(); void this.#play(value, true); })),
                    }), grantedSpells(this.#view(state), this.#spellRecords, this.#spellOptions, change), spellSwapHistory(this.#view(state), this.#spellRecords));
                }
            }
            const saved = document.createElement("details");
            saved.className = "dnd-saved-spells";
            saved.append(el(document, "summary", "", `Saved & custom spells · ${state.spells.length}`), this.#spellTable(state.spells));
            section.append(saved);
            if (this.#canEdit())
                section.append(actionButton(document, "Add spell", () => void this.#save((draft) => { draft.spells.push({ id: createId("spell"), name: "New spell", level: 0, school: "", prepared: false, origin: "manual" }); })));
            panel.append(section);
        }
        #renderBuilder(panel, state) {
            const document = panel.ownerDocument;
            const section = card(document, this.#t("builder.title"));
            if (this.#runtime?.engine.available !== true) {
                section.append(messageBlock(document, this.#t(this.#runtime?.engine.diagnostics.status === "missing-engine" ? "builder.standalone" : "providers.manualHelp"), "status"), this.#providerStatus());
                panel.append(section);
                return;
            }
            const intro = document.createElement("p");
            intro.textContent = "Build your character and review its choices here. Equipment, notes and resources stay with the sheet.";
            section.append(intro);
            if (this.#builderPlan === undefined) {
                section.append(actionButton(document, this.#t(this.#busy ? "builder.loading" : "builder.load"), () => void this.#loadBuilder(), undefined, this.#busy), this.#providerStatus());
                panel.append(section);
                return;
            }
            const guidance = this.#builderGuidance ?? {}, classGuidance = asRecords(guidance["classes"]);
            if (this.#builderTab !== "character" && !classGuidance.some(value => value["classId"] === this.#builderTab))
                this.#builderTab = "character";
            section.append(builderSummary(document, guidance));
            const shell = el(document, "div", "dse-builder-shell"), main = el(document, "div", "dse-builder-main");
            if (this.#builderGuidance)
                shell.append(builderProgress(document, guidance, target => this.#navigateBuilder(target), this.#builderRailOpen, open => { this.#builderRailOpen = open; }));
            else
                shell.classList.add("dse-builder-without-guidance");
            shell.append(main);
            main.append(builderTabs(document, classGuidance, this.#builderTab, target => this.#navigateBuilder(target)));
            if (this.#builderTab !== "character") {
                main.append(this.#builderClassProgress(state, classGuidance.find(value => value["classId"] === this.#builderTab)));
                section.append(shell);
                panel.append(section);
                return;
            }
            main.append(foundationEditor(this.#view(state), this.#builderPlan, this.#speciesRecords, this.#backgroundRecords, change => void this.#changeBuild(change)));
            const classes = document.createElement("div");
            classes.className = "dnd-builder-classes";
            const heading = document.createElement("h4");
            heading.textContent = "Classes";
            classes.append(heading);
            const plannedClasses = this.#builderPlan.classes.length > 0 ? this.#builderPlan.classes : [{}];
            plannedClasses.forEach((selected, index) => classes.append(this.#classRow(selected, index)));
            if (this.#canEdit())
                classes.append(actionButton(document, "Add class", () => void this.#changeClasses([...plannedClasses, { classId: "", level: 1, subclass: "" }])));
            main.append(classes);
            const choices = [...this.#builderPlan.creationChoices, ...this.#builderPlan.creationAbilityChoices, ...(this.#builderGuidance ? [] : this.#builderPlan.classChoices)];
            const choiceSection = document.createElement("div");
            choiceSection.className = "dnd-builder-choices";
            const choiceHeading = document.createElement("h4");
            choiceHeading.textContent = "Choices";
            choiceSection.append(choiceHeading);
            if (choices.length === 0)
                choiceSection.append(messageBlock(document, "No unresolved choices are available for this build.", "status"));
            else
                for (const choice of choices)
                    choiceSection.append(this.#choiceEditor(choice, state));
            main.append(choiceSection, extraFeats(this.#view(state), this.#featRecords, change => void this.#changeBuild(change), () => {
                this.#showDialog("Add extra feat or reward", extraFeatForm(document, this.#featRecords, feat => { this.#closeDialog(); void this.#changeBuild(draft => { draft.extraFeats.push(feat); }); }, () => { this.#dialogDirty = true; this.#publishEdits(); }));
            }));
            const refresh = actionButton(document, "Recalculate and save fallback values", () => void this.#materialize(), "primary", this.#busy || !this.#canEdit());
            main.append(refresh);
            section.append(shell);
            panel.append(section);
        }
        #navigateBuilder(target) {
            if (target.tab === "spells") {
                this.#tab = "spells";
                this.#render();
                if (!this.#spellOptions)
                    void this.#loadSpells();
                return;
            }
            this.#builderTab = target.tab || "character";
            if (target.level)
                this.#builderLevel = `${this.#builderTab}:${target.level}`;
            this.#typing = false;
            this.#render();
            const epoch = this.#epoch;
            this.ownerDocument.defaultView?.requestAnimationFrame(() => {
                if (epoch !== this.#epoch || !this.isConnected)
                    return;
                const node = target.id === "tab" ? [...this.querySelectorAll("[data-builder-tab]")].find(value => value.dataset["builderTab"] === this.#builderTab)
                    : [...this.querySelectorAll("[data-choice], [data-builder-level]")].find(value => value.dataset["choice"] === target.id || value.dataset["builderLevel"] === this.#builderLevel);
                const foundationLabel = { abilities: "Base STR", species: "Species", background: "Background", lineage: "Lineage" };
                const label = foundationLabel[target.id ?? ""] ?? (target.id?.startsWith("class-") ? `Class ${Number(target.id.slice(6)) + 1}` : "");
                const focus = node?.matches("button") ? node : node?.querySelector("select, input, summary") ?? [...this.querySelectorAll("[aria-label]")].find(value => value.getAttribute("aria-label") === label);
                focus?.focus();
                (node ?? focus)?.scrollIntoView({ block: "nearest" });
            });
        }
        #builderClassProgress(state, classGuidance) {
            const document = this.ownerDocument, root = el(document, "section", "dnd-builder-progression"), classId = String(classGuidance["classId"]);
            const index = this.#builderPlan.classes.findIndex(value => value["classId"] === classId);
            root.append(el(document, "h4", "", String(classGuidance["name"])), this.#classRow(this.#builderPlan.classes[index], index));
            for (const level of asRecords(classGuidance["levels"])) {
                const at = Number(level["level"]), key = `${classId}:${at}`, row = el(document, "details", "dse-build-level");
                row.dataset["builderLevel"] = key;
                row.open = this.#builderLevel === key;
                row.addEventListener("toggle", () => { if (row.isConnected) {
                    if (row.open)
                        this.#builderLevel = key;
                    else if (this.#builderLevel === key)
                        this.#builderLevel = "";
                } });
                const choices = this.#builderPlan.classChoices.filter(choice => choice["classId"] === classId && Number(asRecord(choice["source"])["level"] ?? 1) === at);
                const needs = choices.filter(choice => asRecord(asRecord(this.#builderGuidance?.["choices"])[choice.id])["done"] !== true).length;
                const summary = el(document, "summary", "dse-build-level-head");
                summary.append(el(document, "strong", "", `Level ${at}`));
                const featureNames = asRecords(level["features"]).map(value => String(value["label"]));
                if (featureNames.length)
                    summary.append(el(document, "span", "", featureNames.join(" · ")));
                if (needs)
                    summary.append(el(document, "span", "dse-build-pending", `${needs} ${needs === 1 ? "choice" : "choices"} remaining`));
                row.append(summary);
                for (const choice of choices) {
                    const guidance = asRecord(asRecord(this.#builderGuidance?.["choices"])[choice.id]);
                    const options = asRecords(guidance["options"]), count = Number(choice.count ?? 1);
                    const labels = Array.from({ length: count }, (_, slot) => state.featureChoices[count > 1 ? `${choice.id}#${slot}` : choice.id] ?? (slot === 0 ? choice["default"] : undefined)).map(value => options.find(option => option["id"] === value)?.["label"]).filter(Boolean);
                    if (choice.kind === "asiMode" && state.featureChoices[choice.id] === "feat") {
                        const selected = state.featureChoices[asRecord(choice["feat"])["id"]];
                        const feat = this.#featRecords.find(value => value.id === selected);
                        if (feat)
                            labels.push(feat.name ?? feat.id);
                    }
                    if (labels.length)
                        summary.append(el(document, "span", "dnd-builder-choice-summary", labels.join(" · ")));
                }
                const editors = el(document, "div", "dnd-builder-choices");
                if (at === Number(classGuidance["subclassLevel"]) && asRecords(classGuidance["subclasses"]).length) {
                    const field = fieldWrapper(document, "Subclass"), select = document.createElement("select");
                    select.setAttribute("aria-label", `${String(classGuidance["name"])} subclass`);
                    select.disabled = !this.#canEdit();
                    select.append(option(document, "", "Choose subclass…"));
                    for (const value of asRecords(classGuidance["subclasses"]))
                        select.append(option(document, String(value["id"]), String(value["label"])));
                    select.value = String(this.#builderPlan.classes[index]["subclass"] ?? "");
                    select.addEventListener("change", () => void this.#changeBuild(draft => { draft.classes[index] = { ...this.#builderPlan.classes[index], subclass: select.value }; }));
                    field.append(select);
                    editors.append(field);
                }
                for (const choice of choices)
                    editors.append(this.#choiceEditor(choice, state));
                for (const feature of asRecords(level["features"]))
                    if (feature["description"]) {
                        const text = el(document, "details", "dnd-builder-feature");
                        text.append(el(document, "summary", "", String(feature["label"])), el(document, "p", "", String(feature["description"])));
                        editors.append(text);
                    }
                for (const swap of state.spellSwaps.filter(value => value["classId"] === classId && Number(value["classLevel"] ?? value["level"]) === at))
                    editors.append(el(document, "p", "dse-empty", `Spell change: ${String(swap["out"])} → ${String(swap["in"])}`));
                row.append(editors);
                root.append(row);
            }
            return root;
        }
        #renderNotes(panel, state) {
            const section = card(panel.ownerDocument, "Notes");
            const textarea = panel.ownerDocument.createElement("textarea");
            textarea.rows = 14;
            textarea.value = state.notes;
            textarea.disabled = !this.#canEdit();
            textarea.setAttribute("aria-label", "Sheet notes");
            textarea.addEventListener("change", () => void this.#save((draft) => { draft.notes = textarea.value; }));
            section.append(textarea);
            panel.append(section);
        }
        #renderTools(panel, state) {
            const document = panel.ownerDocument;
            const presentation = card(document, this.#t("tools.presentation"));
            const layout = document.createElement("select");
            layout.setAttribute("aria-label", this.#t("tools.layout"));
            layout.dataset["sheetLayout"] = "";
            layout.append(option(document, "compact", this.#t("tools.compact")), option(document, "classic", this.#t("tools.classic")));
            layout.value = this.#layout;
            layout.addEventListener("change", () => {
                this.#layout = layout.value === "classic" ? "classic" : "compact";
                try {
                    this.ownerDocument.defaultView?.localStorage.setItem(`dse-ui:renderer:${this.#snapshot?.key}`, `builtin:${this.#layout}`);
                }
                catch { /* This view still changes when browser storage is disabled. */ }
                layout.blur();
                this.#typing = false;
                this.#render();
            });
            presentation.append(layout);
            const identity = card(document, this.#t("tools.identity"));
            const fields = document.createElement("div");
            fields.className = "dnd-sheet-form-grid";
            fields.append(this.#textField(this.#t("field.player"), state.player, (draft, value) => { draft.player = value; }), this.#textField(this.#t("field.class"), state.className, (draft, value) => { draft.className = value; }), this.#textField(this.#t("field.subclass"), state.subclass, (draft, value) => { draft.subclass = value; }), this.#numberField(this.#t("field.level"), state.level, (draft, value) => { draft.level = Math.max(1, Math.trunc(value)); }, 1), this.#textField(this.#t("field.species"), state.species || state.race, (draft, value) => { draft.species = value; draft.race = value; }), this.#textField(this.#t("field.background"), state.background, (draft, value) => { draft.background = value; }), this.#textField(this.#t("field.alignment"), state.alignment, (draft, value) => { draft.alignment = value; }), this.#numberField(this.#t("field.initiative"), state.initiative, (draft, value) => { draft.initiative = value; }));
            identity.append(fields);
            const resources = card(document, this.#t("tools.resources"));
            resources.append(this.#resourceTable(state.resources));
            if (this.#canEdit())
                resources.append(actionButton(document, this.#t("tools.addResource"), () => void this.#save(draft => { draft.resources.push({ id: createId("resource"), name: "New resource", current: 1, max: 1 }); })));
            panel.append(presentation, identity, resources, this.#providerStatus());
            const engine = card(document, this.#t("tools.rules"));
            const mode = document.createElement("p");
            mode.textContent = this.#t(state.rulesMode === "manual" ? "tools.manual" : "tools.auto");
            engine.append(mode);
            if (this.#runtime?.engine.available === true)
                engine.append(actionButton(document, this.#t("tools.preview"), () => void this.#previewHydration(), undefined, this.#busy));
            if (this.#hydration !== undefined) {
                const pre = document.createElement("pre");
                pre.className = "dnd-sheet-computed";
                pre.textContent = computedSummary(this.#hydration);
                engine.append(pre);
                if (this.#canEdit() && this.#hydration.identity)
                    engine.append(actionButton(document, this.#t("tools.apply"), () => void this.#materialize(), "primary", this.#busy));
            }
            const transfer = card(document, this.#t("tools.transfer"));
            const explanation = document.createElement("p");
            explanation.textContent = this.#t("tools.transferHelp");
            transfer.append(explanation, actionButton(document, this.#t("tools.export"), () => downloadSheet(state)));
            if (this.#canEdit()) {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "application/json,.json";
                input.setAttribute("aria-label", this.#t("tools.import"));
                input.addEventListener("change", () => { const file = input.files?.[0]; if (file !== undefined)
                    void this.#importFile(file); });
                transfer.append(input);
            }
            panel.append(engine, transfer);
        }
        #providerStatus() { return providerStatus(this.ownerDocument, this.#runtime.engine, this.#snapshot.state, this.#contribution?.host.locale, this.#checkingRules || this.#busy, () => void this.#checkRules()); }
        async #checkRules() {
            const runtime = this.#runtime, contribution = this.#contribution;
            if (!runtime || !contribution || this.#busy || this.#editor?.saving)
                return;
            const epoch = this.#epoch, request = new AbortController();
            this.#providerRequest?.abort();
            this.#providerRequest = request;
            this.#busy = true;
            this.#checkingRules = true;
            this.#render();
            try {
                const engine = await runtime.connectEngine(AbortSignal.any([request.signal, contribution.signal]));
                await engine.inspect();
                if (epoch !== this.#epoch || request.signal.aborted)
                    return;
                // Replace only this mounted sheet's connection; an older request keeps
                // its own provider identity and another mount's connection is untouched.
                this.#runtime = { ...runtime, engine };
                this.#hydration = undefined;
                this.#builderPlan = undefined;
                this.#builderGuidance = undefined;
                this.#classRecords = [];
                this.#subclassRecords = [];
                this.#featRecords = [];
                this.#speciesRecords = [];
                this.#backgroundRecords = [];
                this.#spellRecords = undefined;
                this.#spellOptions = undefined;
                this.#equipmentRecords = [];
            }
            catch (error) {
                if (epoch === this.#epoch && !request.signal.aborted)
                    this.#fail(error, this.#t("providers.connection-error"));
            }
            finally {
                if (epoch === this.#epoch && !request.signal.aborted) {
                    this.#busy = false;
                    this.#checkingRules = false;
                    this.#render();
                }
            }
        }
        #classRow(selected, index) {
            const document = this.ownerDocument;
            const row = document.createElement("div");
            row.className = "dnd-builder-class-row";
            const select = document.createElement("select");
            select.disabled = !this.#canEdit();
            select.setAttribute("aria-label", `Class ${index + 1}`);
            select.append(option(document, "", "Choose class…"));
            for (const record of this.#classRecords)
                select.append(option(document, record.id, record.name ?? record.id));
            select.value = typeof selected["classId"] === "string" ? selected["classId"] : "";
            const level = numberInput(document, typeof selected["level"] === "number" ? selected["level"] : 1, !this.#canEdit(), 1, 20);
            level.setAttribute("aria-label", `Class ${index + 1} level`);
            const subclass = document.createElement("select");
            subclass.disabled = !this.#canEdit();
            subclass.setAttribute("aria-label", `Class ${index + 1} subclass`);
            subclass.append(option(document, "", "Choose subclass…"));
            const available = this.#subclassRecords.filter(item => item["classId"] === selected["classId"]);
            for (const item of available)
                subclass.append(option(document, item.id, item.name ?? item.id));
            const savedSubclass = typeof selected["subclass"] === "string" ? selected["subclass"] : "";
            if (savedSubclass && !available.some(item => item.id === savedSubclass))
                subclass.append(option(document, savedSubclass, `${savedSubclass} (saved)`));
            subclass.value = savedSubclass;
            const update = () => { if (!level.reportValidity())
                return; const classes = this.#builderPlan?.classes.map((item) => ({ ...item })) ?? []; classes[index] = { ...classes[index], classId: select.value, level: Math.trunc(numberValue(level, 1)), subclass: select.value === selected["classId"] ? subclass.value : "" }; void this.#changeClasses(classes); };
            select.addEventListener("change", update);
            level.addEventListener("change", update);
            subclass.addEventListener("change", update);
            row.append(select, level, subclass);
            if (this.#canEdit())
                row.append(actionButton(document, "Remove", () => { const classes = (this.#builderPlan?.classes ?? []).filter((_, candidate) => candidate !== index); void this.#changeClasses(classes.length > 0 ? classes : [{ classId: "", level: 1, subclass: "" }]); }, "danger"));
            return row;
        }
        #choiceEditor(choice, state) {
            const document = this.ownerDocument;
            const item = document.createElement("fieldset");
            item.dataset["choice"] = choice.id;
            const guidance = asRecord(asRecord(this.#builderGuidance?.["choices"])[choice.id]);
            const legend = document.createElement("legend");
            legend.textContent = choice.prompt ?? (choice.kind === "abilityBudget" ? "Origin ability scores" : choice.kind === "asiMode" ? `${titleCase(String(choice["classId"] ?? "Class"))} level ${String(choice["level"])} advancement` : titleCase(choice.id.replaceAll(/[-_:]/g, " ")));
            item.append(legend);
            if (choice.kind === "abilityBudget") {
                item.append(this.#abilityChoiceEditor(choice));
                return item;
            }
            if (choice.kind === "asiMode") {
                const selectedMode = typeof state.featureChoices[choice.id] === "string" ? state.featureChoices[choice.id] : "";
                const mode = document.createElement("select");
                mode.disabled = !this.#canEdit();
                mode.setAttribute("aria-label", `${legend.textContent} mode`);
                mode.append(option(document, "", "Choose…"), option(document, "asi", "Ability score increase"), option(document, "feat", "Feat"));
                mode.value = selectedMode;
                mode.addEventListener("change", () => void this.#applyBuilderChoice(choice.id, mode.value));
                item.append(mode);
                const ability = asRecord(choice["ability"]);
                if (selectedMode === "asi" && typeof ability["id"] === "string")
                    item.append(this.#abilityChoiceEditor(ability));
                const feat = asRecord(choice["feat"]);
                if (selectedMode === "feat" && typeof feat["id"] === "string") {
                    const featSelect = document.createElement("select");
                    featSelect.disabled = !this.#canEdit();
                    featSelect.append(option(document, "", "Choose feat…"));
                    featSelect.setAttribute("aria-label", `${legend.textContent} feat`);
                    const featOptions = Array.isArray(guidance["featOptions"]) ? asRecords(guidance["featOptions"]) : this.#featRecords.filter(record => !Array.isArray(feat["categories"]) || feat["categories"].includes(record["category"])).map(record => ({ id: record.id, label: record.name ?? record.id }));
                    for (const value of featOptions)
                        featSelect.append(option(document, String(value["id"]), String(value["label"])));
                    const selectedFeat = state.featureChoices[feat["id"]];
                    if (typeof selectedFeat === "string")
                        featSelect.value = selectedFeat;
                    featSelect.addEventListener("change", () => void this.#applyBuilderChoice(feat["id"], featSelect.value));
                    item.append(featSelect);
                    const featAbility = asRecord(feat["ability"]);
                    if (Array.isArray(featAbility["eligible"]) && featAbility["eligible"].length > 0)
                        item.append(this.#abilityChoiceEditor(featAbility));
                }
                return item;
            }
            const count = Math.max(1, Number(choice.count ?? 1));
            const selectedValues = Array.from({ length: count }, (_, slot) => state.featureChoices[count > 1 ? `${choice.id}#${slot}` : choice.id] ?? (slot === 0 ? choice["default"] : undefined)).filter(value => typeof value === "string" && value.length > 0);
            item.append(el(document, "p", "dnd-builder-progress", `${new Set(selectedValues).size} / ${count} selected`));
            for (let slot = 0; slot < count; slot += 1) {
                const select = document.createElement("select");
                select.disabled = !this.#canEdit();
                select.setAttribute("aria-label", `${legend.textContent} ${slot + 1}`);
                select.append(option(document, "", "Choose…"));
                const key = count > 1 ? `${choice.id}#${slot}` : choice.id;
                const current = state.featureChoices[key] ?? (slot === 0 ? choice["default"] : undefined);
                const used = new Set(Array.from({ length: count }, (_, other) => other !== slot ? state.featureChoices[count > 1 ? `${choice.id}#${other}` : choice.id] ?? (other === 0 ? choice["default"] : undefined) : undefined));
                const options = this.#choiceOptions(choice);
                for (const value of options) {
                    const node = option(document, value.id, value.label);
                    node.disabled = used.has(value.id) && value.id !== current;
                    select.append(node);
                }
                if (typeof current === "string") {
                    if (![...select.options].some(option => option.value === current))
                        select.append(option(document, current, `${titleCase(current)} (saved)`));
                    select.value = current;
                }
                const choiceSlot = slot;
                select.addEventListener("change", () => void this.#applyBuilderChoice(choice.id, select.value, choiceSlot));
                item.append(select);
            }
            if (this.#choiceOptions(choice).length === 0)
                item.append(el(document, "p", "dse-empty", "No choices are available from the current rules data."));
            if (choice["changeOn"])
                item.append(el(document, "p", "dse-empty", `May change on ${titleCase(String(choice["changeOn"]))}.`));
            return item;
        }
        #choiceOptions(choice) {
            const guidance = asRecord(asRecord(this.#builderGuidance?.["choices"])[choice.id]);
            if (Array.isArray(guidance["options"]))
                return asRecords(guidance["options"]).map(value => ({ id: String(value["id"]), label: String(value["label"]) }));
            if (Array.isArray(choice.from))
                return choice.from.map((id) => ({ id, label: titleCase(id) }));
            if (choice.kind === "feat")
                return this.#featRecords.filter(record => !choice["category"] || choice["category"] === record["category"]).map((record) => ({ id: record.id, label: record.name ?? record.id }));
            if (choice.kind === "expertise")
                return Object.entries(this.#snapshot?.state.skillProf ?? {}).filter(([, value]) => value).map(([id]) => ({ id, label: titleCase(id) }));
            return [];
        }
        #abilityChoiceEditor(descriptor) {
            const document = this.ownerDocument;
            const wrapper = document.createElement("div");
            wrapper.className = "dnd-builder-ability";
            const eligible = Array.isArray(descriptor["eligible"]) ? descriptor["eligible"].filter((value) => typeof value === "string") : [...abilities];
            const assigned = asRecord(this.#snapshot?.state.abilityGrants.find(item => item["id"] === descriptor["id"])?.["assign"]);
            wrapper.append(el(document, "p", "dnd-builder-progress", `${Object.values(assigned).reduce((sum, value) => sum + Number(value || 0), 0)} / ${String(descriptor["budget"] ?? 0)} ability points assigned`));
            for (const ability of eligible) {
                const field = fieldWrapper(document, ability);
                const amount = numberInput(document, Number(assigned[ability] ?? 0), !this.#canEdit(), 0, Number(descriptor["perAbilityMax"] ?? descriptor["budget"] ?? 2));
                amount.setAttribute("aria-label", `${String(descriptor["id"])} ${ability}`);
                amount.addEventListener("change", () => { if (amount.reportValidity())
                    void this.#applyBuilderChoice(String(descriptor["id"]), { ability, amount: numberValue(amount, 0) }); });
                field.append(amount);
                wrapper.append(field);
            }
            return wrapper;
        }
        #spellTable(items) { return this.#editableTable(items, ["name", "level", "school", "prepared"], (draft) => draft.spells); }
        #resourceTable(items) { return this.#editableTable(items, ["name", "current", "max"], (draft) => draft.resources); }
        #editableTable(items, fields, list) {
            const document = this.ownerDocument;
            const table = document.createElement("div");
            table.className = "dnd-sheet-table";
            for (const item of items) {
                const row = document.createElement("div");
                row.className = "dnd-sheet-row";
                for (const field of fields) {
                    const current = item[field];
                    const input = document.createElement("input");
                    if (field === "prepared") {
                        input.type = "checkbox";
                        input.checked = current === true;
                    }
                    else {
                        input.type = typeof current === "number" ? "number" : "text";
                        input.value = String(current ?? "");
                    }
                    input.disabled = !this.#canEdit();
                    input.setAttribute("aria-label", titleCase(field));
                    input.addEventListener("change", () => void this.#save((draft) => {
                        const target = list(draft).find((candidate) => candidate.id === item.id);
                        if (target !== undefined)
                            target[field] = input.type === "checkbox" ? input.checked : input.type === "number" ? numberValue(input, 0) : input.value;
                    }));
                    row.append(input);
                }
                if (this.#canEdit())
                    row.append(actionButton(document, "Remove", () => void this.#save((draft) => { const target = list(draft); const index = target.findIndex((candidate) => candidate.id === item.id); if (index >= 0)
                        target.splice(index, 1); }), "danger"));
                table.append(row);
            }
            if (items.length === 0)
                table.append(messageBlock(document, "Nothing here yet.", "status"));
            return table;
        }
        #textField(label, value, update) {
            const wrapper = fieldWrapper(this.ownerDocument, label);
            const input = this.ownerDocument.createElement("input");
            input.type = "text";
            input.value = value;
            input.disabled = !this.#canEdit();
            input.addEventListener("change", () => void this.#save((draft) => update(draft, input.value)));
            wrapper.append(input);
            return wrapper;
        }
        #numberField(label, value, update, min) {
            const wrapper = fieldWrapper(this.ownerDocument, label);
            const input = numberInput(this.ownerDocument, value, !this.#canEdit(), min);
            input.addEventListener("change", () => void this.#save((draft) => update(draft, numberValue(input, value))));
            wrapper.append(input);
            return wrapper;
        }
        async #save(mutate) {
            const editor = this.#editor;
            if (editor === undefined || !this.#canEdit())
                return false;
            this.#typing = false;
            this.#message = "";
            const pending = editor.change(mutate);
            this.#spellOptions = undefined;
            this.#builderPlan = undefined;
            this.#builderGuidance = undefined;
            this.#render();
            const saved = await pending;
            if (editor !== this.#editor)
                return false;
            if (saved) {
                this.#message = this.#t("save.saved");
                this.#messageKind = "status";
            }
            this.#publishEdits();
            this.#render(true);
            return saved;
        }
        async #loadBuilder() {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#message = "Loading builder…";
            this.#render();
            try {
                const [result, classes, feats, species, backgrounds, subclasses] = await Promise.all([runtime.engine.builderPlan(snapshot.state), runtime.engine.queryAll("class"), runtime.engine.queryAll("feat"), runtime.engine.queryAll("species"), runtime.engine.queryAll("background"), runtime.engine.queryAll("subclass")]);
                if (epoch !== this.#epoch)
                    return;
                if (!result.available || result.plan === undefined)
                    throw new Error(result.errors.join(" ") || "The rules data needed by the builder is unavailable.");
                this.#builderPlan = result.plan;
                this.#classRecords = classes;
                this.#featRecords = feats;
                this.#message = "";
                this.#builderGuidance = result.guidance;
                this.#speciesRecords = species;
                this.#backgroundRecords = backgrounds;
                this.#subclassRecords = subclasses;
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not load the builder.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #changeClasses(classes) {
            return this.#changeBuild(changed => { changed.classes = classes.map(item => structuredClone(item)); });
        }
        async #changeBuild(change) {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            try {
                const changed = cloneSheet(snapshot.state);
                change(changed);
                const reconciled = await runtime.engine.reconcile(changed);
                if (epoch !== this.#epoch)
                    return;
                if (!reconciled.available)
                    throw new Error(reconciled.errors.join(" ") || "The engine could not reconcile this build.");
                const decisions = applyDecisions(changed, reconciled.decisions);
                const hydration = await runtime.engine.hydrate(decisions);
                if (epoch !== this.#epoch)
                    return;
                const materialized = this.#withClassFallback(materializeHydration(decisions, hydration, runtime.engine.providerIdentity));
                if (epoch !== this.#epoch || !await this.#save((draft) => replaceState(draft, materialized)))
                    return;
                this.#builderPlan = undefined;
                const plan = await runtime.engine.builderPlan(materialized).catch(() => undefined);
                if (epoch !== this.#epoch)
                    return;
                this.#builderPlan = plan?.plan;
                this.#builderGuidance = plan?.guidance;
                this.#hydration = hydration;
                this.#message = "Build updated and fallback values saved.";
                this.#messageKind = "status";
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not update the build.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #applyBuilderChoice(choiceId, value, slot) {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            try {
                const change = slot === undefined ? { choiceId, value } : { choiceId, slot, value };
                const applied = await runtime.engine.applyChoice(snapshot.state, change);
                if (epoch !== this.#epoch)
                    return;
                if (!applied.available)
                    throw new Error(applied.errors.join(" ") || "The engine rejected this choice.");
                const decisions = applyDecisions(snapshot.state, applied.decisions);
                const hydration = await runtime.engine.hydrate(decisions);
                if (epoch !== this.#epoch)
                    return;
                const materialized = this.#withClassFallback(materializeHydration(decisions, hydration, runtime.engine.providerIdentity));
                if (epoch !== this.#epoch || !await this.#save((draft) => replaceState(draft, materialized)))
                    return;
                this.#builderPlan = undefined;
                const plan = await runtime.engine.builderPlan(materialized).catch(() => undefined);
                if (epoch !== this.#epoch)
                    return;
                this.#builderPlan = plan?.plan;
                this.#builderGuidance = plan?.guidance;
                this.#hydration = hydration;
                this.#message = "Choice saved and fallback values refreshed.";
                this.#messageKind = "status";
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not apply this builder choice.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #previewHydration() {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            try {
                const hydration = await runtime.engine.hydrate(snapshot.state);
                if (epoch !== this.#epoch)
                    return;
                this.#hydration = hydration;
                this.#message = this.#hydration.warnings.length > 0 ? this.#hydration.warnings.join(" ") : "Computed preview refreshed.";
                this.#messageKind = "status";
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not compute this sheet.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        #closeDialog() {
            const dialog = this.#dialog;
            dialog?.close();
            dialog?.remove();
            this.#dialog = undefined;
            this.#dialogDirty = false;
            this.#publishEdits();
            if (dialog && this.isConnected)
                this.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
        }
        #showDialog(title, content) {
            this.#closeDialog();
            const document = this.ownerDocument, dialog = document.createElement("dialog");
            dialog.className = "addon-dnd-sheets dnd-workflow-dialog";
            dialog.setAttribute("aria-label", title);
            const heading = el(document, "div", "dnd-workflow-controls");
            heading.append(el(document, "h3", "", title), actionButton(document, "Cancel", () => this.#closeDialog()));
            dialog.append(heading, content);
            dialog.addEventListener("cancel", event => { event.preventDefault(); this.#closeDialog(); });
            this.#dialog = dialog;
            document.body.append(dialog);
            dialog.showModal();
        }
        async #openEquipment() {
            if (!this.#canEdit() || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch, engine = this.#runtime?.engine;
            this.#busy = true;
            this.#render();
            try {
                const catalog = [];
                let unavailable = engine?.available !== true;
                if (engine?.available) {
                    const results = await Promise.allSettled(equipmentKinds.map(kind => engine.queryAll(kind)));
                    for (const result of results) {
                        if (result.status === "fulfilled")
                            catalog.push(...result.value);
                        else
                            unavailable = true;
                    }
                }
                if (epoch !== this.#epoch)
                    return;
                this.#equipmentRecords = catalog;
                const picker = equipmentPicker(this.ownerDocument, catalog, unavailable, dirty => { this.#dialogDirty = dirty; this.#publishEdits(); }, items => {
                    this.#closeDialog();
                    void this.#saveEquipment(draft => { draft.inventory.push(...items); });
                });
                this.#showDialog("Add equipment", picker);
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not open equipment.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #loadSpells() {
            const runtime = this.#runtime, snapshot = this.#snapshot;
            if (!runtime || !snapshot || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            try {
                const [catalog, hydration] = await Promise.all([runtime.engine.queryAll("spell"), runtime.engine.spellOptions(snapshot.state)]);
                if (epoch !== this.#epoch)
                    return;
                if (!hydration.identity)
                    throw new Error(hydration.warnings.join(" ") || "The spell catalog is unavailable.");
                this.#spellRecords = catalog;
                this.#hydration = hydration;
                this.#spellOptions = hydration.options;
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not load spells.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #openSlot(slot) {
            if (!this.#canEdit() || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            try {
                if (this.#runtime?.engine.available) {
                    const kinds = ["armor", "magic-item"];
                    const records = await Promise.allSettled(kinds.map(kind => this.#runtime.engine.queryAll(kind)));
                    if (epoch !== this.#epoch)
                        return;
                    records.forEach((result, index) => { if (result.status === "fulfilled")
                        this.#equipmentRecords = [...this.#equipmentRecords.filter(item => item.kind !== kinds[index]), ...result.value]; });
                }
                if (epoch !== this.#epoch || !this.#snapshot)
                    return;
                const panel = el(this.ownerDocument, "div", "dnd-slot-picker");
                for (const item of equipmentCandidates(this.#snapshot.state, slot, this.#equipmentRecords))
                    panel.append(actionButton(this.ownerDocument, item.name, () => { this.#closeDialog(); void this.#saveEquipment(draft => equipInventory(draft, item.id, slot, this.#equipmentRecords)); }));
                if (!panel.children.length)
                    panel.append(el(this.ownerDocument, "p", "dse-empty", "No matching items in your backpack. Add equipment first."));
                this.#showDialog(`Choose ${slot === "attuned" ? "attunement item" : slot}`, panel);
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not open this equipment slot.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #saveEquipment(change) {
            const snapshot = this.#snapshot, runtime = this.#runtime;
            if (!snapshot || !this.#canEdit() || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            let next = cloneSheet(snapshot.state);
            change(next);
            try {
                if (runtime?.engine.available) {
                    try {
                        const hydration = await runtime.engine.hydrate(next);
                        if (epoch !== this.#epoch)
                            return;
                        if (hydration.identity && Number(asRecord(hydration.sheet["derived"])["maxHp"]) > 0)
                            next = materializeHydration(next, hydration, runtime.engine.providerIdentity);
                    }
                    catch { /* Authored equipment changes remain usable without rules data. */ }
                }
                if (epoch === this.#epoch)
                    await this.#save(draft => replaceState(draft, next));
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #play(change, review = false) {
            const runtime = this.#runtime, snapshot = this.#snapshot;
            if (!runtime || !snapshot || !this.#canEdit() || this.#busy || this.#editor?.dirty)
                return;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            try {
                const result = await runtime.engine.playChange(snapshot.state, change);
                if (epoch !== this.#epoch)
                    return;
                if (!result.available || !result.identity)
                    throw new Error(result.errors.join(" ") || "The rules data for this action is unavailable.");
                const next = materializeHydration(applyDecisions(snapshot.state, result.decisions), result, runtime.engine.providerIdentity);
                // Keep human-readable spell snapshots when the catalog is later removed.
                for (const spell of next.spells) {
                    if (spell.origin !== "snapshot")
                        continue;
                    const source = this.#spellRecords?.find(item => `snapshot:${item.id}` === spell.id);
                    if (source && spell.name === source.id) {
                        spell.name = source.name ?? source.id;
                        spell.level = Number(source["level"] ?? 0);
                        spell.school = String(source["school"] ?? "");
                    }
                }
                const commit = async () => {
                    if (epoch !== this.#epoch || this.#snapshot?.revision !== snapshot.revision || this.#editor?.dirty)
                        return;
                    this.#closeDialog();
                    if (await this.#save(draft => replaceState(draft, next))) {
                        this.#hydration = result;
                        this.#spellOptions = result.options;
                        this.#message = change.operation === "cast-ritual" ? "Ritual cast. No spell slot used." : change.operation.startsWith("cast-") ? "Spell cast. Resources saved." : "Changes saved.";
                        this.#messageKind = "status";
                        this.#render();
                    }
                };
                if (review) {
                    const content = playReview(this.ownerDocument, snapshot.state, next);
                    if (change.operation === "copy-spell") {
                        content.replaceChildren(el(this.ownerDocument, "p", "", `Copy ${this.#spellRecords?.find(item => item.id === change.ref)?.name ?? change.ref} into the spellbook.`), el(this.ownerDocument, "p", "", `GP: ${snapshot.state.currency["gp"] ?? 0} → ${next.currency["gp"] ?? 0}`));
                        if (change.scrollId)
                            content.append(el(this.ownerDocument, "p", "", `Consume one ${snapshot.state.inventory.find(item => item.id === change.scrollId)?.name ?? "scroll"}.`));
                    }
                    if (change.operation === "swap-spell")
                        content.replaceChildren(el(this.ownerDocument, "p", "", `${this.#spellRecords?.find(item => item.id === change.out)?.name ?? change.out} → ${this.#spellRecords?.find(item => item.id === change.ref)?.name ?? change.ref}`));
                    content.append(actionButton(this.ownerDocument, "Apply changes", () => void commit(), "primary"));
                    this.#showDialog(change.operation === "rest" ? (change.rest === "long" ? "Review long rest" : "Review short rest") : change.operation === "copy-spell" ? "Review spell copying" : change.operation === "swap-spell" ? "Review spell swap" : "Review hit-die healing", content);
                }
                else
                    await commit();
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not apply this action.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #materialize() {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy || this.#editor?.dirty)
                return;
            const refreshBuilder = this.#builderPlan !== undefined;
            const epoch = this.#epoch;
            this.#busy = true;
            this.#render();
            try {
                const hydration = await runtime.engine.hydrate(snapshot.state);
                const materialized = this.#withClassFallback(materializeHydration(snapshot.state, hydration, runtime.engine.providerIdentity));
                if (epoch !== this.#epoch || !await this.#save((draft) => replaceState(draft, materialized)))
                    return;
                this.#hydration = hydration;
                this.#message = "Computed fallback values saved.";
                this.#messageKind = "status";
                if (refreshBuilder) {
                    const result = await runtime.engine.builderPlan(materialized).catch(() => undefined);
                    if (epoch !== this.#epoch)
                        return;
                    this.#builderPlan = result?.plan;
                    this.#builderGuidance = result?.guidance;
                }
            }
            catch (error) {
                if (epoch === this.#epoch)
                    this.#fail(error, "Could not refresh computed values.");
            }
            finally {
                if (epoch === this.#epoch) {
                    this.#busy = false;
                    this.#render();
                }
            }
        }
        async #importFile(file) {
            if (!this.#canEdit() || this.#snapshot === undefined)
                return;
            const epoch = this.#epoch;
            try {
                const imported = parseSheet(await file.text());
                if (epoch !== this.#epoch)
                    return;
                await this.#save((draft) => replaceState(draft, imported));
            }
            catch (error) {
                if (epoch === this.#epoch) {
                    this.#fail(error, "Could not import this sheet.");
                    this.#render();
                }
            }
        }
        #canEdit() { return this.#contribution?.host.canEdit === true && this.#editing; }
        #withClassFallback(state) {
            const selected = state.classes.filter((item) => typeof item["classId"] === "string" && item["classId"] !== "");
            if (selected.length === 0)
                return state;
            state.className = selected.map((item) => {
                const classID = item["classId"];
                const name = this.#classRecords.find((record) => record.id === classID)?.name ?? classID;
                return selected.length > 1 ? `${name} ${Number(item["level"] ?? 1)}` : name;
            }).join(" / ");
            state.subclass = selected.map(item => this.#subclassRecords.find(record => record.id === item["subclass"])?.name ?? String(item["subclass"] ?? "")).filter(Boolean).join(" / ");
            return state;
        }
        #fail(error, fallback) { this.#message = errorMessage(error, fallback); this.#messageKind = "alert"; }
        #renderUnavailable(message) { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); }
    }
    customElements.define(sheetElementTag, CharacterSheetElement);
    return sheetElementTag;
}
function replaceState(target, source) { for (const key of Object.keys(target))
    delete target[key]; Object.assign(target, cloneSheet(source)); }
function identityLine(state) { return [state.subclass, state.className, `Level ${state.level}`, state.species || state.race, state.background].filter((value) => value !== "").join(" · "); }
function card(document, title) { const section = document.createElement("section"); section.className = "dnd-sheet-card"; const heading = document.createElement("h3"); heading.textContent = title; section.append(heading); return section; }
function fieldWrapper(document, label) { const wrapper = document.createElement("label"); wrapper.className = "dnd-sheet-field"; const text = document.createElement("span"); text.textContent = label; wrapper.append(text); return wrapper; }
function numberInput(document, value, disabled, min, max) { const input = document.createElement("input"); input.type = "number"; input.value = String(value); input.disabled = disabled; if (min !== undefined)
    input.min = String(min); if (max !== undefined)
    input.max = String(max); return input; }
function numberValue(input, fallback) { const value = input.valueAsNumber; return Number.isFinite(value) ? value : fallback; }
function option(document, value, label) { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function actionButton(document, label, action, style, disabled = false) { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = disabled; if (style !== undefined)
    button.className = style; button.addEventListener("click", action); return button; }
function messageBlock(document, message, role) { const block = document.createElement("div"); block.className = `dnd-sheet-message ${role}`; block.setAttribute("role", role); block.textContent = message; return block; }
function titleCase(value) { return value.replaceAll(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function errorMessage(error, fallback) { return error instanceof Error && error.message.length > 0 ? error.message : fallback; }
function errorStatus(error) { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined; }
function computedSummary(hydration) { const derived = typeof hydration.sheet["derived"] === "object" && hydration.sheet["derived"] !== null ? hydration.sheet["derived"] : {}; return JSON.stringify({ derived, warnings: hydration.warnings }, null, 2); }
function downloadSheet(state) { const blob = new Blob([serializeSheet(state)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "dnd-character-sheet.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
function asRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}; }
