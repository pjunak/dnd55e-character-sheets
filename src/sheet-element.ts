import { applyDecisions, materializeHydration, type BuilderChoice, type BuilderPlan, type Hydration, type PlayChange, type RuleRecord } from "./engine-client.js";
import { runtimeFor, type SheetRuntime } from "./runtime.js";
import type { ContributionContext } from "./sdk.js";
import { parseSheet, serializeSheet } from "./sheet-transfer.js";
import { abilities, cloneSheet, createId, type ResourceItem, type SheetState, type SpellItem } from "./sheet-state.js";
import type { SheetSnapshot } from "./sheet-repository.js";
import { SheetEditor } from "./sheet-editor.js";
import { abilityRail, backpack, combatDetails, el, preferredLayout, vitals, type Layout, type PlayView } from "./play-view.js";
import { equipmentKinds, equipmentPicker, foundationEditor, playReview, restControls, spellBrowser, type SpellBrowserState } from "./workflow-view.js";
import { copySpellForm, grantedSpells, spellSwapHistory, swapSpellForm } from "./spell-tools.js";
import { equipmentCandidates, equipInventory, type EquipmentSlot } from "./equipment-state.js";

type Tab = "sheet" | "combat" | "spells" | "builder" | "notes" | "tools";
const tabs: readonly (readonly [Tab, string])[] = [["sheet", "Character Sheet"], ["combat", "Combat"], ["spells", "Spellbook"], ["notes", "Notes"], ["builder", "Builder"], ["tools", "Settings"]];

export function defineSheetElement(generation: string): string {
  const sheetElementTag = `dnd-character-sheet-${generation}`;
  if (customElements.get(sheetElementTag) !== undefined) return sheetElementTag;
  class CharacterSheetElement extends HTMLElement {
    #contribution: ContributionContext | undefined;
    #runtime: SheetRuntime | undefined;
    #editor: SheetEditor | undefined;
    get #snapshot(): SheetSnapshot | undefined { return this.#editor?.snapshot; }
    #epoch = 0;
    #typing = false;
    #deferredRender = false;
    #pointerDown = false;
    #changingControl = false;
    #requestedRender = false;
    #layout: Layout = "compact";
    #editing = false;
    #tab: Tab = "sheet";
    #busy = false;
    #message = "";
    #messageKind: "status" | "alert" = "status";
    #hydration: Hydration | undefined;
    #builderPlan: BuilderPlan | undefined;
    #classRecords: readonly RuleRecord[] = [];
    #featRecords: readonly RuleRecord[] = [];
    #speciesRecords: readonly RuleRecord[] = [];
    #backgroundRecords: readonly RuleRecord[] = [];
    #subclassRecords: readonly RuleRecord[] = [];
    #spellRecords: readonly RuleRecord[] | undefined;
    #spellOptions: Record<string, unknown> | undefined;
    #spellBrowser: SpellBrowserState = { classId: "", query: "", level: "" };
    #dialog: HTMLDialogElement | undefined;
    #dialogDirty = false;
    #equipmentRecords: readonly RuleRecord[] = [];

    set codexContribution(value: ContributionContext) {
      const previous = this.#contribution;
      this.#contribution = value;
      if (this.isConnected) {
        if (previous?.host.key !== value.host.key || previous?.host.canEdit !== value.host.canEdit) void this.#connect();
        else this.#publishEdits();
      }
    }

    constructor() {
      super();
      this.addEventListener("pointerdown", () => { this.#pointerDown = true; });
      this.addEventListener("change", () => {
        this.#changingControl = true;
        setTimeout(() => { this.#changingControl = false; if (this.isConnected && this.#deferredRender) this.#render(true); }, 0);
      }, true);
      this.addEventListener("input", event => { if (this.#canEdit() && event.target instanceof HTMLElement && !event.target.closest(".dnd-builder-choices, .dnd-builder-classes, .dnd-spell-browser") && event.target.getAttribute("aria-label") !== "Sheet layout") { this.#typing = true; this.#publishEdits(); } });
      // Focus settles after blur/change. Replacing controls inside focusout can cancel the pending click.
      this.addEventListener("focusout", () => { setTimeout(() => { if (this.isConnected && this.#deferredRender && !this.contains(this.ownerDocument.activeElement)) this.#render(); }, 0); });
    }
    connectedCallback(): void {
      this.classList.add("addon-dnd-sheets");
      this.ownerDocument.addEventListener("pointerup", this.#releasePointer);
      this.ownerDocument.addEventListener("pointercancel", this.#releasePointer);
      void this.#connect();
    }
    disconnectedCallback(): void {
      this.#closeDialog();
      this.#epoch++; this.#editor?.dispose(); this.#runtime = undefined; this.#pointerDown = false;
      this.ownerDocument.removeEventListener("pointerup", this.#releasePointer);
      this.ownerDocument.removeEventListener("pointercancel", this.#releasePointer);
    }
    readonly #releasePointer = (): void => {
      if (!this.#pointerDown) return;
      setTimeout(() => { this.#pointerDown = false; if (this.isConnected && this.#deferredRender) this.#render(true); }, 0);
    };

    async #connect(): Promise<void> {
      this.#closeDialog();
      const epoch = ++this.#epoch;
      this.#editor?.dispose(); this.#editor = undefined; this.#typing = false;
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
      try { this.#layout = preferredLayout(this.ownerDocument.defaultView?.localStorage, contribution.host.key); } catch { this.#layout = "compact"; }
      this.#hydration = undefined;
      this.#builderPlan = undefined;
      this.#spellRecords = undefined;
      this.#spellOptions = undefined;
      this.#equipmentRecords = [];
      this.#message = "";
      this.#busy = true;
      this.#render();
      try {
        const snapshot = await runtime.repository.load(contribution.host.key);
        if (epoch !== this.#epoch) return;
        this.#editor = new SheetEditor(runtime.repository, snapshot, () => { if (epoch === this.#epoch) { this.#publishEdits(); this.#render(true); } });
      }
      catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not load this character sheet."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#publishEdits(); this.#render(); } }
    }

    #render(preserveFocus = false): void {
      if (!preserveFocus) this.#requestedRender = true;
      this.#publishEdits();
      if (this.#pointerDown || this.#changingControl) { this.#deferredRender = true; return; }
      this.#updateStatus();
      const focused = this.ownerDocument.activeElement;
      if (!this.#busy && focused !== null && this.contains(focused) && ((preserveFocus && !this.#requestedRender) || focused.matches("input, textarea, select"))) { this.#deferredRender = true; return; }
      this.#deferredRender = false;
      this.#requestedRender = false;
      const snapshot = this.#snapshot;
      if (snapshot === undefined) {
        if (this.#busy) this.replaceChildren(messageBlock(this.ownerDocument, "Loading character sheet…", "status"));
        else this.#renderUnavailable(this.#message || "Could not load this character sheet.");
        return;
      }
      const document = this.ownerDocument;
      const root = document.createElement("section");
      root.className = `dnd-sheet-shell dse-layout-${this.#layout}`;
      const heading = document.createElement("div");
      heading.className = "dnd-sheet-heading";
      const title = document.createElement("div");
      const h2 = document.createElement("h2");
      h2.textContent = snapshot.state.className || "D&D Character Sheet";
      const subtitle = document.createElement("p");
      subtitle.textContent = identityLine(snapshot.state);
      title.append(h2, subtitle);
      const engine = document.createElement("span");
      engine.className = `dnd-sheet-engine ${this.#runtime?.engine.available === true ? "available" : "standalone"}`;
      engine.textContent = this.#runtime?.engine.available === true ? "Rules engine connected" : "Standalone";
      heading.append(title, engine);
      if (this.#contribution?.host.canEdit) heading.append(actionButton(document, this.#editing ? "Done editing" : "Edit sheet", () => {
        if (this.#busy || this.#editor?.dirty) return;
        this.#editing = !this.#editing; this.#render();
      }, "small", this.#busy || this.#editor?.dirty === true));
      root.append(heading, this.#renderTabs(document));
      const status = document.createElement("div"); status.className = "dnd-save-status"; root.append(status);
      const panel = document.createElement("div");
      panel.className = "dnd-sheet-panel";
      panel.inert = this.#busy;
      panel.id = `dnd-panel-${this.#tab}`; panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", `dnd-tab-${this.#tab}`);
      switch (this.#tab) {
        case "sheet": this.#renderSheet(panel, snapshot.state); break;
        case "combat": this.#renderCombat(panel, snapshot.state); break;
        case "spells": this.#renderSpells(panel, snapshot.state); break;
        case "builder": this.#renderBuilder(panel, snapshot.state); break;
        case "notes": this.#renderNotes(panel, snapshot.state); break;
        case "tools": this.#renderTools(panel, snapshot.state); break;
      }
      root.append(panel);
      this.replaceChildren(root);
      this.#updateStatus();
    }

    #publishEdits(): void { this.#contribution?.edits.set({ dirty: this.#typing || this.#dialogDirty || this.#editor?.dirty === true, saving: this.#editor?.saving === true || this.#busy }); }
    #updateStatus(): void {
      const area = this.querySelector(".dnd-save-status"); if (area === null) return;
      const editor = this.#editor;
      const signature = JSON.stringify([editor?.error === undefined ? null : errorStatus(editor.error) ?? "failed", editor?.saving, editor?.dirty, this.#message, this.#messageKind]);
      if (area.getAttribute("data-status") === signature) return;
      area.setAttribute("data-status", signature);
      area.replaceChildren();
      if (editor?.error !== undefined) {
        const conflict = errorStatus(editor.error) === 409;
        area.append(messageBlock(this.ownerDocument, conflict ? "The sheet changed elsewhere. Your edits are kept here. Export your draft before reloading the saved sheet." : "Could not save. Your edits are kept here; retry when the connection is available.", "alert"));
        area.append(actionButton(this.ownerDocument, "Export draft", () => downloadSheet(editor.snapshot.state)), actionButton(this.ownerDocument, "Reload saved sheet", () => void this.#connect()));
        if (!conflict) area.append(actionButton(this.ownerDocument, "Retry save", () => void editor.save()));
      } else if (editor?.saving) area.append(messageBlock(this.ownerDocument, "Saving…", "status"));
      else if (editor?.dirty) area.append(messageBlock(this.ownerDocument, "Unsaved changes.", "status"));
      else if (this.#message) area.append(messageBlock(this.ownerDocument, this.#message, this.#messageKind));
    }

    #renderTabs(document: Document): HTMLElement {
      const navigation = document.createElement("nav");
      navigation.className = "dnd-sheet-tabs codex-tab-strip"; navigation.setAttribute("role", "tablist");
      navigation.setAttribute("aria-label", "Character sheet sections");
      for (const [id, label] of tabs) {
        const item = actionButton(document, label, () => { this.#tab = id; this.#message = ""; this.#render(); });
        item.className = `codex-tab${id === this.#tab ? " is-active" : ""}${id === "builder" || id === "tools" ? " codex-tab-tool" : ""}`;
        item.id = `dnd-tab-${id}`; item.setAttribute("role", "tab"); item.setAttribute("aria-selected", String(id === this.#tab)); item.setAttribute("aria-controls", `dnd-panel-${id}`); item.tabIndex = id === this.#tab ? 0 : -1;
        item.addEventListener("keydown", event => {
          const index = tabs.findIndex(([key]) => key === id);
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : -1;
          if (next < 0) return; event.preventDefault(); this.#tab = tabs[next]![0]; this.#render(); this.querySelector<HTMLButtonElement>(`#dnd-tab-${this.#tab}`)?.focus();
        });
        navigation.append(item);
      }
      return navigation;
    }

    #view(state: SheetState): PlayView { return { document: this.ownerDocument, state, layout: this.#layout, editable: this.#canEdit(), save: change => { void this.#save(change); }, addItem: () => void this.#openEquipment(), equipment: this.#equipmentRecords,
      fillSlot: slot => void this.#openSlot(slot), clearSlot: id => void this.#saveEquipment(draft => { const item = draft.inventory.find(value => value.id === id); if (item?.["attuned"]) item["attuned"] = false; else if (item) item.location = "pack"; }),
    }; }

    #renderSheet(panel: HTMLElement, state: SheetState): void {
      const view = this.#view(state), columns = el(panel.ownerDocument, "div", "dse-cols"), main = el(panel.ownerDocument, "div", "dse-cols-main");
      main.append(vitals(view), backpack(view)); columns.append(abilityRail(view), main); panel.append(columns);
    }

    #renderCombat(panel: HTMLElement, state: SheetState): void {
      const view = this.#view(state), columns = el(panel.ownerDocument, "div", "dse-cols"), main = el(panel.ownerDocument, "div", "dse-cols-main");
      main.append(vitals(view), restControls(view, this.#runtime?.engine.available === true, (change, review) => void this.#play(change, review)), combatDetails(view)); columns.append(abilityRail(view), main); panel.append(columns);
    }

    #renderSpells(panel: HTMLElement, state: SheetState): void {
      const document = panel.ownerDocument;
      panel.append(vitals(this.#view(state)));
      const section = card(document, "Spellbook");
      if (this.#runtime?.engine.available === true) {
        if (this.#spellRecords === undefined || this.#spellOptions === undefined) section.append(actionButton(document, "Manage class spells", () => void this.#loadSpells(), undefined, this.#busy));
        else {
          const change = (value: PlayChange): void => { void this.#play(value); };
          section.append(spellBrowser(this.#view(state), this.#spellRecords, this.#hydration?.sheet ?? asRecord(state.rulesProvider?.["materialized"]), this.#spellBrowser, change, {
            options: this.#spellOptions,
            copy: (spell, classId, cost) => this.#showDialog("Copy a spell", copySpellForm(document, state, spell, classId, cost, value => { this.#closeDialog(); void this.#play(value, true); })),
            swap: (classId, eligible) => this.#showDialog("Level-up spell swap", swapSpellForm(document, state, classId, eligible, this.#spellRecords!, value => { this.#closeDialog(); void this.#play(value, true); })),
          }), grantedSpells(this.#view(state), this.#spellRecords, this.#spellOptions, change), spellSwapHistory(this.#view(state), this.#spellRecords));
        }
      }
      const saved = document.createElement("details"); saved.className = "dnd-saved-spells";
      saved.append(el(document, "summary", "", `Saved & custom spells · ${state.spells.length}`), this.#spellTable(state.spells)); section.append(saved);
      if (this.#canEdit()) section.append(actionButton(document, "Add spell", () => void this.#save((draft) => { draft.spells.push({ id: createId("spell"), name: "New spell", level: 0, school: "", prepared: false, origin: "manual" }); })));
      panel.append(section);
    }

    #renderBuilder(panel: HTMLElement, state: SheetState): void {
      const document = panel.ownerDocument;
      const section = card(document, "Guided builder");
      if (this.#runtime?.engine.available !== true) {
        section.append(messageBlock(document, "No compatible rules engine is selected. The rest of the sheet remains fully editable.", "status")); panel.append(section); return;
      }
      const intro = document.createElement("p"); intro.textContent = "Build your character and review its choices here. Equipment, notes and resources stay with the sheet.";
      section.append(intro);
      if (this.#builderPlan === undefined) {
        section.append(actionButton(document, this.#busy ? "Loading…" : "Load builder", () => void this.#loadBuilder(), undefined, this.#busy)); panel.append(section); return;
      }
      section.append(foundationEditor(this.#view(state), this.#builderPlan, this.#speciesRecords, this.#backgroundRecords, change => void this.#changeBuild(change)));
      const classes = document.createElement("div"); classes.className = "dnd-builder-classes";
      const heading = document.createElement("h4"); heading.textContent = "Classes"; classes.append(heading);
      const plannedClasses = this.#builderPlan.classes.length > 0 ? this.#builderPlan.classes : [{}];
      plannedClasses.forEach((selected, index) => classes.append(this.#classRow(selected, index)));
      if (this.#canEdit()) classes.append(actionButton(document, "Add class", () => void this.#changeClasses([...plannedClasses, { classId: "", level: 1, subclass: "" }] )));
      section.append(classes);
      const choices = [...this.#builderPlan.creationChoices, ...this.#builderPlan.creationAbilityChoices, ...this.#builderPlan.classChoices];
      const choiceSection = document.createElement("div"); choiceSection.className = "dnd-builder-choices";
      const choiceHeading = document.createElement("h4"); choiceHeading.textContent = "Choices"; choiceSection.append(choiceHeading);
      if (choices.length === 0) choiceSection.append(messageBlock(document, "No unresolved choices are available for this build.", "status"));
      else for (const choice of choices) choiceSection.append(this.#choiceEditor(choice, state));
      section.append(choiceSection);
      const refresh = actionButton(document, "Recalculate and save fallback values", () => void this.#materialize(), "primary", this.#busy || !this.#canEdit());
      section.append(refresh); panel.append(section);
    }

    #renderNotes(panel: HTMLElement, state: SheetState): void {
      const section = card(panel.ownerDocument, "Notes");
      const textarea = panel.ownerDocument.createElement("textarea"); textarea.rows = 14; textarea.value = state.notes; textarea.disabled = !this.#canEdit();
      textarea.setAttribute("aria-label", "Sheet notes");
      textarea.addEventListener("change", () => void this.#save((draft) => { draft.notes = textarea.value; }));
      section.append(textarea); panel.append(section);
    }

    #renderTools(panel: HTMLElement, state: SheetState): void {
      const document = panel.ownerDocument;
      const presentation = card(document, "Presentation");
      const layout = document.createElement("select"); layout.setAttribute("aria-label", "Sheet layout");
      layout.append(option(document, "compact", "Compact"), option(document, "classic", "Classic")); layout.value = this.#layout;
      layout.addEventListener("change", () => {
        this.#layout = layout.value === "classic" ? "classic" : "compact";
        try { this.ownerDocument.defaultView?.localStorage.setItem(`dse-ui:renderer:${this.#snapshot?.key}`, `builtin:${this.#layout}`); } catch { /* This view still changes when browser storage is disabled. */ }
        layout.blur(); this.#typing = false; this.#render();
      }); presentation.append(layout);
      const identity = card(document, "Identity");
      const fields = document.createElement("div"); fields.className = "dnd-sheet-form-grid";
      fields.append(
        this.#textField("Player", state.player, (draft, value) => { draft.player = value; }),
        this.#textField("Class", state.className, (draft, value) => { draft.className = value; }),
        this.#textField("Subclass", state.subclass, (draft, value) => { draft.subclass = value; }),
        this.#numberField("Level", state.level, (draft, value) => { draft.level = Math.max(1, Math.trunc(value)); }, 1),
        this.#textField("Species", state.species || state.race, (draft, value) => { draft.species = value; draft.race = value; }),
        this.#textField("Background", state.background, (draft, value) => { draft.background = value; }),
        this.#textField("Alignment", state.alignment, (draft, value) => { draft.alignment = value; }),
        this.#numberField("Initiative", state.initiative, (draft, value) => { draft.initiative = value; }),
      ); identity.append(fields);
      const resources = card(document, "Manual resources"); resources.append(this.#resourceTable(state.resources));
      if (this.#canEdit()) resources.append(actionButton(document, "Add resource", () => void this.#save(draft => { draft.resources.push({ id: createId("resource"), name: "New resource", current: 1, max: 1 }); })));
      panel.append(presentation, identity, resources);
      const engine = card(document, "Rules state");
      const mode = document.createElement("p"); mode.textContent = state.rulesMode === "manual" ? "Manual values are authoritative." : "Engine values may be refreshed explicitly; stored fallback values remain authoritative between refreshes.";
      engine.append(mode);
      if (this.#runtime?.engine.available === true) engine.append(actionButton(document, "Preview computed values", () => void this.#previewHydration(), undefined, this.#busy));
      if (this.#hydration !== undefined) {
        const pre = document.createElement("pre"); pre.className = "dnd-sheet-computed"; pre.textContent = computedSummary(this.#hydration);
        engine.append(pre);
        if (this.#canEdit()) engine.append(actionButton(document, "Apply computed fallback values", () => void this.#materialize(), "primary", this.#busy));
      }
      const transfer = card(document, "Transfer this sheet");
      const explanation = document.createElement("p"); explanation.textContent = "Export or import this character's D&D sheet, including equipment and notes. The character's story and portrait stay in the article.";
      transfer.append(explanation, actionButton(document, "Export JSON", () => downloadSheet(state)));
      if (this.#canEdit()) {
        const input = document.createElement("input"); input.type = "file"; input.accept = "application/json,.json";
        input.setAttribute("aria-label", "Import sheet JSON");
        input.addEventListener("change", () => { const file = input.files?.[0]; if (file !== undefined) void this.#importFile(file); });
        transfer.append(input);
      }
      panel.append(engine, transfer);
    }

    #classRow(selected: Record<string, unknown>, index: number): HTMLElement {
      const document = this.ownerDocument;
      const row = document.createElement("div"); row.className = "dnd-builder-class-row";
      const select = document.createElement("select"); select.disabled = !this.#canEdit();
      select.setAttribute("aria-label", `Class ${index + 1}`);
      select.append(option(document, "", "Choose class…"));
      for (const record of this.#classRecords) select.append(option(document, record.id, record.name ?? record.id));
      select.value = typeof selected["classId"] === "string" ? selected["classId"] : "";
      const level = numberInput(document, typeof selected["level"] === "number" ? selected["level"] : 1, !this.#canEdit(), 1, 20);
      level.setAttribute("aria-label", `Class ${index + 1} level`);
      const subclass = document.createElement("select"); subclass.disabled = !this.#canEdit(); subclass.setAttribute("aria-label", `Class ${index + 1} subclass`); subclass.append(option(document, "", "Choose subclass…"));
      const available = this.#subclassRecords.filter(item => item["classId"] === selected["classId"]);
      for (const item of available) subclass.append(option(document, item.id, item.name ?? item.id));
      const savedSubclass = typeof selected["subclass"] === "string" ? selected["subclass"] : "";
      if (savedSubclass && !available.some(item => item.id === savedSubclass)) subclass.append(option(document, savedSubclass, `${savedSubclass} (saved)`)); subclass.value = savedSubclass;
      const update = (): void => { if (!level.reportValidity()) return; const classes = this.#builderPlan?.classes.map((item) => ({ ...item })) ?? []; classes[index] = { ...classes[index], classId: select.value, level: Math.trunc(numberValue(level, 1)), subclass: select.value === selected["classId"] ? subclass.value : "" }; void this.#changeClasses(classes); };
      select.addEventListener("change", update); level.addEventListener("change", update);
      subclass.addEventListener("change", update); row.append(select, level, subclass);
      if (this.#canEdit()) row.append(actionButton(document, "Remove", () => { const classes = (this.#builderPlan?.classes ?? []).filter((_, candidate) => candidate !== index); void this.#changeClasses(classes.length > 0 ? classes : [{ classId: "", level: 1, subclass: "" }]); }, "danger"));
      return row;
    }

    #choiceEditor(choice: BuilderChoice, state: SheetState): HTMLElement {
      const document = this.ownerDocument;
      const item = document.createElement("fieldset");
      const legend = document.createElement("legend"); legend.textContent = choice.prompt ?? (choice.kind === "abilityBudget" ? "Origin ability scores" : choice.kind === "asiMode" ? `${titleCase(String(choice["classId"] ?? "Class"))} level ${String(choice["level"])} advancement` : titleCase(choice.id.replaceAll(/[-_:]/g, " "))); item.append(legend);
      if (choice.kind === "abilityBudget") {
        item.append(this.#abilityChoiceEditor(choice));
        return item;
      }
      if (choice.kind === "asiMode") {
        const selectedMode = typeof state.featureChoices[choice.id] === "string" ? state.featureChoices[choice.id] as string : "";
        const mode = document.createElement("select");
        mode.disabled = !this.#canEdit();
        mode.append(option(document, "", "Choose…"), option(document, "asi", "Ability score increase"), option(document, "feat", "Feat"));
        mode.value = selectedMode;
        mode.addEventListener("change", () => void this.#applyBuilderChoice(choice.id, mode.value));
        item.append(mode);
        const ability = asRecord(choice["ability"]);
        if (selectedMode === "asi" && typeof ability["id"] === "string") item.append(this.#abilityChoiceEditor(ability));
        const feat = asRecord(choice["feat"]);
        if (selectedMode === "feat" && typeof feat["id"] === "string") {
          const featSelect = document.createElement("select"); featSelect.disabled = !this.#canEdit(); featSelect.append(option(document, "", "Choose feat…"));
          for (const record of this.#featRecords.filter(record => !Array.isArray(feat["categories"]) || feat["categories"].includes(record["category"]))) featSelect.append(option(document, record.id, record.name ?? record.id));
          const selectedFeat = state.featureChoices[feat["id"]]; if (typeof selectedFeat === "string") featSelect.value = selectedFeat;
          featSelect.addEventListener("change", () => void this.#applyBuilderChoice(feat["id"] as string, featSelect.value));
          item.append(featSelect);
          const featAbility = asRecord(feat["ability"]);
          if (Array.isArray(featAbility["eligible"]) && featAbility["eligible"].length > 0) item.append(this.#abilityChoiceEditor(featAbility));
        }
        return item;
      }
      const count = Math.max(1, Number(choice.count ?? 1));
      const selectedValues = Array.from({ length: count }, (_, slot) => state.featureChoices[count > 1 ? `${choice.id}#${slot}` : choice.id] ?? (slot === 0 ? choice["default"] : undefined)).filter(value => typeof value === "string" && value.length > 0);
      item.append(el(document, "p", "dnd-builder-progress", `${new Set(selectedValues).size} / ${count} selected`));
      for (let slot = 0; slot < count; slot += 1) {
        const select = document.createElement("select"); select.disabled = !this.#canEdit();
        select.setAttribute("aria-label", `${legend.textContent} ${slot + 1}`);
        select.append(option(document, "", "Choose…"));
        for (const value of this.#choiceOptions(choice)) select.append(option(document, value.id, value.label));
        const key = count > 1 ? `${choice.id}#${slot}` : choice.id;
        const current = state.featureChoices[key] ?? (slot === 0 ? choice["default"] : undefined);
        if (typeof current === "string") {
          if (![...select.options].some(option => option.value === current)) select.append(option(document, current, `${titleCase(current)} (saved)`)); select.value = current;
        }
        const choiceSlot = slot;
        select.addEventListener("change", () => void this.#applyBuilderChoice(choice.id, select.value, choiceSlot));
        item.append(select);
      }
      return item;
    }

    #choiceOptions(choice: BuilderChoice): readonly { readonly id: string; readonly label: string }[] {
      if (Array.isArray(choice.from)) return choice.from.map((id) => ({ id, label: titleCase(id) }));
      if (choice.kind === "feat") return this.#featRecords.filter(record => !choice["category"] || choice["category"] === record["category"]).map((record) => ({ id: record.id, label: record.name ?? record.id }));
      if (choice.kind === "expertise") return Object.entries(this.#snapshot?.state.skillProf ?? {}).filter(([, value]) => value).map(([id]) => ({ id, label: titleCase(id) }));
      return [];
    }

    #abilityChoiceEditor(descriptor: Record<string, unknown>): HTMLElement {
      const document = this.ownerDocument; const wrapper = document.createElement("div"); wrapper.className = "dnd-builder-ability";
      const eligible = Array.isArray(descriptor["eligible"]) ? descriptor["eligible"].filter((value): value is string => typeof value === "string") : [...abilities];
      const assigned = asRecord(this.#snapshot?.state.abilityGrants.find(item => item["id"] === descriptor["id"])?.["assign"]);
      wrapper.append(el(document, "p", "dnd-builder-progress", `${Object.values(assigned).reduce<number>((sum, value) => sum + Number(value || 0), 0)} / ${String(descriptor["budget"] ?? 0)} ability points assigned`));
      for (const ability of eligible) {
        const field = fieldWrapper(document, ability);
        const amount = numberInput(document, Number(assigned[ability] ?? 0), !this.#canEdit(), 0, Number(descriptor["perAbilityMax"] ?? descriptor["budget"] ?? 2));
        amount.setAttribute("aria-label", `${String(descriptor["id"])} ${ability}`);
        amount.addEventListener("change", () => { if (amount.reportValidity()) void this.#applyBuilderChoice(String(descriptor["id"]), { ability, amount: numberValue(amount, 0) }); }); field.append(amount); wrapper.append(field);
      }
      return wrapper;
    }

    #spellTable(items: readonly SpellItem[]): HTMLElement { return this.#editableTable(items, ["name", "level", "school", "prepared"], (draft) => draft.spells); }
    #resourceTable(items: readonly ResourceItem[]): HTMLElement { return this.#editableTable(items, ["name", "current", "max"], (draft) => draft.resources); }

    #editableTable<T extends { id: string }>(items: readonly T[], fields: readonly string[], list: (draft: SheetState) => T[]): HTMLElement {
      const document = this.ownerDocument; const table = document.createElement("div"); table.className = "dnd-sheet-table";
      for (const item of items) {
        const row = document.createElement("div"); row.className = "dnd-sheet-row";
        for (const field of fields) {
          const current = (item as Record<string, unknown>)[field];
          const input = document.createElement("input");
          if (field === "prepared") { input.type = "checkbox"; input.checked = current === true; }
          else { input.type = typeof current === "number" ? "number" : "text"; input.value = String(current ?? ""); }
          input.disabled = !this.#canEdit(); input.setAttribute("aria-label", titleCase(field));
          input.addEventListener("change", () => void this.#save((draft) => {
            const target = list(draft).find((candidate) => candidate.id === item.id) as Record<string, unknown> | undefined;
            if (target !== undefined) target[field] = input.type === "checkbox" ? input.checked : input.type === "number" ? numberValue(input, 0) : input.value;
          }));
          row.append(input);
        }
        if (this.#canEdit()) row.append(actionButton(document, "Remove", () => void this.#save((draft) => { const target = list(draft); const index = target.findIndex((candidate) => candidate.id === item.id); if (index >= 0) target.splice(index, 1); }), "danger"));
        table.append(row);
      }
      if (items.length === 0) table.append(messageBlock(document, "Nothing here yet.", "status"));
      return table;
    }

    #textField(label: string, value: string, update: (draft: SheetState, value: string) => void): HTMLElement {
      const wrapper = fieldWrapper(this.ownerDocument, label); const input = this.ownerDocument.createElement("input"); input.type = "text"; input.value = value; input.disabled = !this.#canEdit(); input.addEventListener("change", () => void this.#save((draft) => update(draft, input.value))); wrapper.append(input); return wrapper;
    }
    #numberField(label: string, value: number, update: (draft: SheetState, value: number) => void, min?: number): HTMLElement {
      const wrapper = fieldWrapper(this.ownerDocument, label); const input = numberInput(this.ownerDocument, value, !this.#canEdit(), min); input.addEventListener("change", () => void this.#save((draft) => update(draft, numberValue(input, value)))); wrapper.append(input); return wrapper;
    }
    async #save(mutate: (draft: SheetState) => void): Promise<boolean> {
      const editor = this.#editor;
      if (editor === undefined || !this.#canEdit()) return false;
      this.#typing = false; this.#message = "";
      const pending = editor.change(mutate);
      this.#spellOptions = undefined;
      this.#render();
      const saved = await pending;
      if (editor !== this.#editor) return false;
      if (saved) { this.#message = "Saved."; this.#messageKind = "status"; }
      this.#publishEdits(); this.#render(true); return saved;
    }

    async #loadBuilder(): Promise<void> {
      const runtime = this.#runtime; const snapshot = this.#snapshot; if (runtime === undefined || snapshot === undefined || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#message = "Loading builder…"; this.#render();
      try {
        const [result, classes, feats, species, backgrounds, subclasses] = await Promise.all([runtime.engine.builderPlan(snapshot.state), runtime.engine.queryAll("class"), runtime.engine.queryAll("feat"), runtime.engine.queryAll("species"), runtime.engine.queryAll("background"), runtime.engine.queryAll("subclass")]);
        if (epoch !== this.#epoch) return;
        if (!result.available || result.plan === undefined) throw new Error(result.errors.join(" ") || "The rules data needed by the builder is unavailable.");
        this.#builderPlan = result.plan; this.#classRecords = classes; this.#featRecords = feats; this.#message = "";
        this.#speciesRecords = species; this.#backgroundRecords = backgrounds; this.#subclassRecords = subclasses;
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not load the builder."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #changeClasses(classes: readonly Record<string, unknown>[]): Promise<void> {
      return this.#changeBuild(changed => { changed.classes = classes.map(item => structuredClone(item)); });
    }

    async #changeBuild(change: (draft: SheetState) => void): Promise<void> {
      const runtime = this.#runtime; const snapshot = this.#snapshot; if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      try {
        const changed = cloneSheet(snapshot.state); change(changed);
        const reconciled = await runtime.engine.reconcile(changed);
        if (epoch !== this.#epoch) return;
        if (!reconciled.available) throw new Error(reconciled.errors.join(" ") || "The engine could not reconcile this build.");
        const decisions = applyDecisions(changed, reconciled.decisions);
        const hydration = await runtime.engine.hydrate(decisions);
        if (epoch !== this.#epoch) return;
        const materialized = this.#withClassFallback(materializeHydration(decisions, hydration, runtime.engine.providerIdentity));
        if (epoch !== this.#epoch || !await this.#save((draft) => replaceState(draft, materialized))) return;
        this.#builderPlan = undefined;
        const plan = await runtime.engine.builderPlan(materialized).catch(() => undefined);
        if (epoch !== this.#epoch) return; this.#builderPlan = plan?.plan;
        this.#hydration = hydration; this.#message = "Build updated and fallback values saved."; this.#messageKind = "status";
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not update the build."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #applyBuilderChoice(choiceId: string, value: unknown, slot?: number): Promise<void> {
      const runtime = this.#runtime; const snapshot = this.#snapshot; if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      try {
        const change = slot === undefined ? { choiceId, value } : { choiceId, slot, value };
        const applied = await runtime.engine.applyChoice(snapshot.state, change);
        if (epoch !== this.#epoch) return;
        if (!applied.available) throw new Error(applied.errors.join(" ") || "The engine rejected this choice.");
        const decisions = applyDecisions(snapshot.state, applied.decisions);
        const hydration = await runtime.engine.hydrate(decisions);
        if (epoch !== this.#epoch) return;
        const materialized = this.#withClassFallback(materializeHydration(decisions, hydration, runtime.engine.providerIdentity));
        if (epoch !== this.#epoch || !await this.#save((draft) => replaceState(draft, materialized))) return;
        this.#builderPlan = undefined;
        const plan = await runtime.engine.builderPlan(materialized).catch(() => undefined);
        if (epoch !== this.#epoch) return; this.#builderPlan = plan?.plan;
        this.#hydration = hydration; this.#message = "Choice saved and fallback values refreshed."; this.#messageKind = "status";
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not apply this builder choice."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #previewHydration(): Promise<void> {
      const runtime = this.#runtime; const snapshot = this.#snapshot; if (runtime === undefined || snapshot === undefined || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      try { const hydration = await runtime.engine.hydrate(snapshot.state); if (epoch !== this.#epoch) return; this.#hydration = hydration; this.#message = this.#hydration.warnings.length > 0 ? this.#hydration.warnings.join(" ") : "Computed preview refreshed."; this.#messageKind = "status"; }
      catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not compute this sheet."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    #closeDialog(): void {
      const dialog = this.#dialog;
      dialog?.close(); dialog?.remove(); this.#dialog = undefined; this.#dialogDirty = false; this.#publishEdits();
      if (dialog && this.isConnected) this.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    }

    #showDialog(title: string, content: HTMLElement): void {
      this.#closeDialog();
      const document = this.ownerDocument, dialog = document.createElement("dialog");
      dialog.className = "addon-dnd-sheets dnd-workflow-dialog"; dialog.setAttribute("aria-label", title);
      const heading = el(document, "div", "dnd-workflow-controls"); heading.append(el(document, "h3", "", title), actionButton(document, "Cancel", () => this.#closeDialog()));
      dialog.append(heading, content); dialog.addEventListener("cancel", event => { event.preventDefault(); this.#closeDialog(); });
      this.#dialog = dialog; document.body.append(dialog); dialog.showModal();
    }

    async #openEquipment(): Promise<void> {
      if (!this.#canEdit() || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch, engine = this.#runtime?.engine;
      this.#busy = true; this.#render();
      try {
        const catalog: RuleRecord[] = []; let unavailable = engine?.available !== true;
        if (engine?.available) {
          const results = await Promise.allSettled(equipmentKinds.map(kind => engine.queryAll(kind)));
          for (const result of results) { if (result.status === "fulfilled") catalog.push(...result.value); else unavailable = true; }
        }
        if (epoch !== this.#epoch) return;
        this.#equipmentRecords = catalog;
        const picker = equipmentPicker(this.ownerDocument, catalog, unavailable, dirty => { this.#dialogDirty = dirty; this.#publishEdits(); }, items => {
          this.#closeDialog();
          void this.#saveEquipment(draft => { draft.inventory.push(...items); });
        });
        this.#showDialog("Add equipment", picker);
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not open equipment."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #loadSpells(): Promise<void> {
      const runtime = this.#runtime, snapshot = this.#snapshot;
      if (!runtime || !snapshot || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      try {
        const [catalog, hydration] = await Promise.all([runtime.engine.queryAll("spell"), runtime.engine.spellOptions(snapshot.state)]);
        if (epoch !== this.#epoch) return;
        if (!hydration.identity) throw new Error(hydration.warnings.join(" ") || "The spell catalog is unavailable.");
        this.#spellRecords = catalog; this.#hydration = hydration; this.#spellOptions = hydration.options;
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not load spells."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #openSlot(slot: EquipmentSlot): Promise<void> {
      if (!this.#canEdit() || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      try {
        if (this.#runtime?.engine.available) {
          const kinds = ["armor", "magic-item"];
          const records = await Promise.allSettled(kinds.map(kind => this.#runtime!.engine.queryAll(kind)));
          if (epoch !== this.#epoch) return;
          records.forEach((result, index) => { if (result.status === "fulfilled") this.#equipmentRecords = [...this.#equipmentRecords.filter(item => item.kind !== kinds[index]), ...result.value]; });
        }
        if (epoch !== this.#epoch || !this.#snapshot) return;
        const panel = el(this.ownerDocument, "div", "dnd-slot-picker");
        for (const item of equipmentCandidates(this.#snapshot.state, slot, this.#equipmentRecords)) panel.append(actionButton(this.ownerDocument, item.name, () => { this.#closeDialog(); void this.#saveEquipment(draft => equipInventory(draft, item.id, slot, this.#equipmentRecords)); }));
        if (!panel.children.length) panel.append(el(this.ownerDocument, "p", "dse-empty", "No matching items in your backpack. Add equipment first."));
        this.#showDialog(`Choose ${slot === "attuned" ? "attunement item" : slot}`, panel);
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not open this equipment slot."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #saveEquipment(change: (draft: SheetState) => void): Promise<void> {
      const snapshot = this.#snapshot, runtime = this.#runtime;
      if (!snapshot || !this.#canEdit() || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      let next = cloneSheet(snapshot.state); change(next);
      try {
        if (runtime?.engine.available) {
          try {
            const hydration = await runtime.engine.hydrate(next);
            if (epoch !== this.#epoch) return;
            if (hydration.identity && Number(asRecord(hydration.sheet["derived"])["maxHp"]) > 0) next = materializeHydration(next, hydration, runtime.engine.providerIdentity);
          } catch { /* Authored equipment changes remain usable without rules data. */ }
        }
        if (epoch === this.#epoch) await this.#save(draft => replaceState(draft, next));
      } finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #play(change: PlayChange, review = false): Promise<void> {
      const runtime = this.#runtime, snapshot = this.#snapshot;
      if (!runtime || !snapshot || !this.#canEdit() || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      try {
        const result = await runtime.engine.playChange(snapshot.state, change);
        if (epoch !== this.#epoch) return;
        if (!result.available || !result.identity) throw new Error(result.errors.join(" ") || "The rules data for this action is unavailable.");
        const next = materializeHydration(applyDecisions(snapshot.state, result.decisions), result, runtime.engine.providerIdentity);
        // Keep human-readable spell snapshots when the catalog is later removed.
        for (const spell of next.spells) {
          if (spell.origin !== "snapshot") continue;
          const source = this.#spellRecords?.find(item => `snapshot:${item.id}` === spell.id);
          if (source && spell.name === source.id) { spell.name = source.name ?? source.id; spell.level = Number(source["level"] ?? 0); spell.school = String(source["school"] ?? ""); }
        }
        const commit = async (): Promise<void> => {
          if (epoch !== this.#epoch || this.#snapshot?.revision !== snapshot.revision || this.#editor?.dirty) return;
          this.#closeDialog();
          if (await this.#save(draft => replaceState(draft, next))) { this.#hydration = result; this.#spellOptions = result.options; this.#message = change.operation === "cast-ritual" ? "Ritual cast. No spell slot used." : change.operation.startsWith("cast-") ? "Spell cast. Resources saved." : "Changes saved."; this.#messageKind = "status"; this.#render(); }
        };
        if (review) {
          const content = playReview(this.ownerDocument, snapshot.state, next);
          if (change.operation === "copy-spell") {
            content.replaceChildren(el(this.ownerDocument, "p", "", `Copy ${this.#spellRecords?.find(item => item.id === change.ref)?.name ?? change.ref} into the spellbook.`), el(this.ownerDocument, "p", "", `GP: ${snapshot.state.currency["gp"] ?? 0} → ${next.currency["gp"] ?? 0}`));
            if (change.scrollId) content.append(el(this.ownerDocument, "p", "", `Consume one ${snapshot.state.inventory.find(item => item.id === change.scrollId)?.name ?? "scroll"}.`));
          }
          if (change.operation === "swap-spell") content.replaceChildren(el(this.ownerDocument, "p", "", `${this.#spellRecords?.find(item => item.id === change.out)?.name ?? change.out} → ${this.#spellRecords?.find(item => item.id === change.ref)?.name ?? change.ref}`));
          content.append(actionButton(this.ownerDocument, "Apply changes", () => void commit(), "primary"));
          this.#showDialog(change.operation === "rest" ? (change.rest === "long" ? "Review long rest" : "Review short rest") : change.operation === "copy-spell" ? "Review spell copying" : change.operation === "swap-spell" ? "Review spell swap" : "Review hit-die healing", content);
        } else await commit();
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not apply this action."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #materialize(): Promise<void> {
      const runtime = this.#runtime; const snapshot = this.#snapshot; if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy || this.#editor?.dirty) return;
      const epoch = this.#epoch; this.#busy = true; this.#render();
      try {
        const hydration = await runtime.engine.hydrate(snapshot.state); const materialized = this.#withClassFallback(materializeHydration(snapshot.state, hydration, runtime.engine.providerIdentity));
        if (epoch !== this.#epoch || !await this.#save((draft) => replaceState(draft, materialized))) return; this.#hydration = hydration; this.#message = "Computed fallback values saved."; this.#messageKind = "status";
      } catch (error) { if (epoch === this.#epoch) this.#fail(error, "Could not refresh computed values."); }
      finally { if (epoch === this.#epoch) { this.#busy = false; this.#render(); } }
    }

    async #importFile(file: File): Promise<void> {
      if (!this.#canEdit() || this.#snapshot === undefined) return;
      const epoch = this.#epoch;
      try { const imported = parseSheet(await file.text()); if (epoch !== this.#epoch) return; await this.#save((draft) => replaceState(draft, imported)); }
      catch (error) { if (epoch === this.#epoch) { this.#fail(error, "Could not import this sheet."); this.#render(); } }
    }

    #canEdit(): boolean { return this.#contribution?.host.canEdit === true && this.#editing; }
    #withClassFallback(state: SheetState): SheetState {
      const selected = state.classes.filter((item) => typeof item["classId"] === "string" && item["classId"] !== "");
      if (selected.length === 0) return state;
      state.className = selected.map((item) => {
        const classID = item["classId"] as string;
        const name = this.#classRecords.find((record) => record.id === classID)?.name ?? classID;
        return selected.length > 1 ? `${name} ${Number(item["level"] ?? 1)}` : name;
      }).join(" / ");
      state.subclass = selected.map(item => this.#subclassRecords.find(record => record.id === item["subclass"])?.name ?? String(item["subclass"] ?? "")).filter(Boolean).join(" / ");
      return state;
    }
    #fail(error: unknown, fallback: string): void { this.#message = errorMessage(error, fallback); this.#messageKind = "alert"; }
    #renderUnavailable(message: string): void { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); }
  }
  customElements.define(sheetElementTag, CharacterSheetElement);
  return sheetElementTag;
}

function replaceState(target: SheetState, source: SheetState): void { for (const key of Object.keys(target)) delete target[key]; Object.assign(target, cloneSheet(source)); }
function identityLine(state: SheetState): string { return [state.subclass, state.className, `Level ${state.level}`, state.species || state.race, state.background].filter((value) => value !== "").join(" · "); }
function card(document: Document, title: string): HTMLElement { const section = document.createElement("section"); section.className = "dnd-sheet-card"; const heading = document.createElement("h3"); heading.textContent = title; section.append(heading); return section; }
function fieldWrapper(document: Document, label: string): HTMLLabelElement { const wrapper = document.createElement("label"); wrapper.className = "dnd-sheet-field"; const text = document.createElement("span"); text.textContent = label; wrapper.append(text); return wrapper; }
function numberInput(document: Document, value: number, disabled: boolean, min?: number, max?: number): HTMLInputElement { const input = document.createElement("input"); input.type = "number"; input.value = String(value); input.disabled = disabled; if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max); return input; }
function numberValue(input: HTMLInputElement, fallback: number): number { const value = input.valueAsNumber; return Number.isFinite(value) ? value : fallback; }
function option(document: Document, value: string, label: string): HTMLOptionElement { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function actionButton(document: Document, label: string, action: () => void, style?: "primary" | "danger" | "small", disabled = false): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = disabled; if (style !== undefined) button.className = style; button.addEventListener("click", action); return button; }
function messageBlock(document: Document, message: string, role: "status" | "alert"): HTMLElement { const block = document.createElement("div"); block.className = `dnd-sheet-message ${role}`; block.setAttribute("role", role); block.textContent = message; return block; }
function titleCase(value: string): string { return value.replaceAll(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function errorMessage(error: unknown, fallback: string): string { return error instanceof Error && error.message.length > 0 ? error.message : fallback; }
function errorStatus(error: unknown): number | undefined { return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined; }
function computedSummary(hydration: Hydration): string { const derived = typeof hydration.sheet["derived"] === "object" && hydration.sheet["derived"] !== null ? hydration.sheet["derived"] : {}; return JSON.stringify({ derived, warnings: hydration.warnings }, null, 2); }
function downloadSheet(state: SheetState): void { const blob = new Blob([serializeSheet(state)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "dnd-character-sheet.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
function asRecord(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
