import { applyDecisions, materializeHydration } from "./engine-client.js";
import { runtimeFor } from "./runtime.js";
import { parseSheet, serializeSheet } from "./sheet-transfer.js";
import { abilities, abilityModifier, cloneSheet, createId, signed, skills } from "./sheet-state.js";
export const sheetElementTag = "dnd-character-sheet";
const tabs = [["sheet", "Sheet"], ["combat", "Combat"], ["spells", "Spells"], ["inventory", "Inventory"], ["builder", "Builder"], ["notes", "Notes"], ["tools", "Tools"]];
export function defineSheetElement() {
    if (customElements.get(sheetElementTag) !== undefined)
        return;
    class CharacterSheetElement extends HTMLElement {
        #contribution;
        #runtime;
        #snapshot;
        #tab = "sheet";
        #busy = false;
        #message = "";
        #messageKind = "status";
        #hydration;
        #builderPlan;
        #classRecords = [];
        #featRecords = [];
        set codexContribution(value) {
            const previousKey = this.#contribution?.host.key;
            this.#contribution = value;
            if (this.isConnected) {
                if (previousKey !== value.host.key)
                    void this.#connect();
                else
                    this.#render();
            }
        }
        connectedCallback() { this.classList.add("addon-dnd-sheets"); void this.#connect(); }
        disconnectedCallback() { this.#runtime = undefined; }
        async #connect() {
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
            this.#snapshot = undefined;
            this.#hydration = undefined;
            this.#builderPlan = undefined;
            this.#message = "";
            this.#busy = true;
            this.#render();
            try {
                this.#snapshot = await runtime.repository.load(contribution.host.key);
            }
            catch (error) {
                this.#fail(error, "Could not load this character sheet.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        #render() {
            const snapshot = this.#snapshot;
            if (snapshot === undefined) {
                if (this.#busy)
                    this.replaceChildren(messageBlock(this.ownerDocument, "Loading character sheet…", "status"));
                return;
            }
            const document = this.ownerDocument;
            const root = document.createElement("section");
            root.className = "dnd-sheet-shell";
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
            engine.textContent = this.#runtime?.engine.available === true ? `Rules: ${this.#runtime.engine.providerLabel}` : "Standalone";
            heading.append(title, engine);
            root.append(heading, this.#renderTabs(document));
            if (this.#message.length > 0)
                root.append(messageBlock(document, this.#message, this.#messageKind));
            const panel = document.createElement("div");
            panel.className = "dnd-sheet-panel";
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
                case "inventory":
                    this.#renderInventory(panel, snapshot.state);
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
        }
        #renderTabs(document) {
            const navigation = document.createElement("nav");
            navigation.className = "dnd-sheet-tabs";
            navigation.setAttribute("aria-label", "Character sheet sections");
            for (const [id, label] of tabs) {
                const item = actionButton(document, label, () => { this.#tab = id; this.#message = ""; this.#render(); });
                item.className = id === this.#tab ? "active" : "";
                item.setAttribute("aria-current", id === this.#tab ? "page" : "false");
                navigation.append(item);
            }
            return navigation;
        }
        #renderSheet(panel, state) {
            const document = panel.ownerDocument;
            const identity = card(document, "Identity");
            const fields = document.createElement("div");
            fields.className = "dnd-sheet-form-grid";
            fields.append(this.#textField("Player", state.player, (draft, value) => { draft.player = value; }), this.#textField("Class", state.className, (draft, value) => { draft.className = value; }), this.#textField("Subclass", state.subclass, (draft, value) => { draft.subclass = value; }), this.#numberField("Level", state.level, (draft, value) => { draft.level = Math.max(1, Math.trunc(value)); }, 1), this.#textField("Species", state.species || state.race, (draft, value) => { draft.species = value; draft.race = value; }), this.#textField("Background", state.background, (draft, value) => { draft.background = value; }), this.#textField("Alignment", state.alignment, (draft, value) => { draft.alignment = value; }));
            identity.append(fields);
            const scores = card(document, "Ability scores");
            const scoreGrid = document.createElement("div");
            scoreGrid.className = "dnd-sheet-abilities";
            for (const ability of abilities) {
                const tile = document.createElement("label");
                const name = document.createElement("span");
                name.textContent = ability;
                const input = numberInput(document, state.abilities[ability], !this.#canEdit(), 1, 30);
                input.addEventListener("change", () => void this.#save((draft) => { draft.abilities[ability] = numberValue(input, state.abilities[ability]); }));
                const modifier = document.createElement("strong");
                modifier.textContent = signed(abilityModifier(state.abilities[ability]));
                tile.append(name, input, modifier);
                scoreGrid.append(tile);
            }
            scores.append(scoreGrid);
            const proficiencies = card(document, "Proficiencies");
            const columns = document.createElement("div");
            columns.className = "dnd-sheet-proficiencies";
            const saves = document.createElement("div");
            const saveTitle = document.createElement("h4");
            saveTitle.textContent = "Saving throws";
            saves.append(saveTitle);
            for (const ability of abilities)
                saves.append(this.#proficiencyToggle(ability, state.saveProf[ability] === true, (draft, checked) => { draft.saveProf[ability] = checked; draft.manualSaveProf[ability] = checked; }, signed(abilityModifier(state.abilities[ability]) + (state.saveProf[ability] ? state.profBonus : 0))));
            const skillList = document.createElement("div");
            const skillTitle = document.createElement("h4");
            skillTitle.textContent = "Skills";
            skillList.append(skillTitle);
            for (const [skill, ability] of skills) {
                const expertise = state.skillExpertise[skill] === true;
                const bonus = abilityModifier(state.abilities[ability]) + (state.skillProf[skill] ? state.profBonus : 0) + (expertise ? state.profBonus : 0);
                skillList.append(this.#proficiencyToggle(titleCase(skill), state.skillProf[skill] === true, (draft, checked) => { draft.skillProf[skill] = checked; if (!checked)
                    draft.skillExpertise[skill] = false; }, `${signed(bonus)}${expertise ? " expertise" : ""}`, (draft) => { draft.skillExpertise[skill] = !draft.skillExpertise[skill]; draft.skillProf[skill] = true; }));
            }
            columns.append(saves, skillList);
            proficiencies.append(columns);
            panel.append(identity, scores, proficiencies);
        }
        #renderCombat(panel, state) {
            const document = panel.ownerDocument;
            const vitals = card(document, "Vitals");
            const grid = document.createElement("div");
            grid.className = "dnd-sheet-vitals";
            grid.append(this.#numberField("Current HP", state.hp, (draft, value) => { draft.hp = Math.max(0, Math.min(value, Math.max(draft.maxHp, value))); }, 0), this.#numberField("Maximum HP", state.maxHp, (draft, value) => { draft.maxHp = Math.max(0, value); draft.hp = Math.min(draft.hp, draft.maxHp); }, 0), this.#numberField("Temporary HP", state.tempHp, (draft, value) => { draft.tempHp = Math.max(0, value); }, 0), this.#numberField("Armor class", state.ac, (draft, value) => { draft.ac = value; }), this.#numberField("Initiative", state.initiative, (draft, value) => { draft.initiative = value; }), this.#numberField("Speed", state.speed, (draft, value) => { draft.speed = Math.max(0, value); }, 0), this.#numberField("Proficiency", state.profBonus, (draft, value) => { draft.profBonus = value; }));
            vitals.append(grid);
            const resources = card(document, "Resources");
            resources.append(this.#resourceTable(state.resources));
            if (this.#canEdit())
                resources.append(actionButton(document, "Add resource", () => void this.#save((draft) => { draft.resources.push({ id: createId("resource"), name: "New resource", current: 0, max: 1 }); })));
            panel.append(vitals, resources);
        }
        #renderSpells(panel, state) {
            const document = panel.ownerDocument;
            const section = card(document, "Spellbook");
            section.append(this.#spellTable(state.spells));
            if (this.#canEdit())
                section.append(actionButton(document, "Add spell", () => void this.#save((draft) => { draft.spells.push({ id: createId("spell"), name: "New spell", level: 0, school: "", prepared: false, origin: "manual" }); })));
            panel.append(section);
        }
        #renderInventory(panel, state) {
            const document = panel.ownerDocument;
            const currency = card(document, "Currency");
            const coins = document.createElement("div");
            coins.className = "dnd-sheet-currency";
            for (const coin of ["pp", "gp", "ep", "sp", "cp"])
                coins.append(this.#numberField(coin.toUpperCase(), state.currency[coin] ?? 0, (draft, value) => { draft.currency[coin] = Math.max(0, value); }, 0));
            currency.append(coins);
            const inventory = card(document, "Inventory");
            inventory.append(this.#inventoryTable(state.inventory));
            if (this.#canEdit())
                inventory.append(actionButton(document, "Add item", () => void this.#save((draft) => { draft.inventory.push({ id: createId("item"), name: "New item", qty: 1, location: "pack", notes: "" }); })));
            panel.append(currency, inventory);
        }
        #renderBuilder(panel, state) {
            const document = panel.ownerDocument;
            const section = card(document, "Guided builder");
            if (this.#runtime?.engine.available !== true) {
                section.append(messageBlock(document, "No compatible rules engine is selected. The rest of the sheet remains fully editable.", "status"));
                panel.append(section);
                return;
            }
            const intro = document.createElement("p");
            intro.textContent = "The engine validates rules choices. Changes are saved together with ordinary fallback values, so the sheet still works if the engine is later removed.";
            section.append(intro);
            if (this.#builderPlan === undefined) {
                section.append(actionButton(document, this.#busy ? "Loading…" : "Load builder", () => void this.#loadBuilder(), undefined, this.#busy));
                panel.append(section);
                return;
            }
            const classes = document.createElement("div");
            classes.className = "dnd-builder-classes";
            const heading = document.createElement("h4");
            heading.textContent = "Classes";
            classes.append(heading);
            const plannedClasses = this.#builderPlan.classes.length > 0 ? this.#builderPlan.classes : [{}];
            plannedClasses.forEach((selected, index) => classes.append(this.#classRow(selected, index)));
            if (this.#canEdit())
                classes.append(actionButton(document, "Add class", () => void this.#changeClasses([...plannedClasses, { classId: "", level: 1, subclass: "" }])));
            section.append(classes);
            const choices = [...this.#builderPlan.creationChoices, ...this.#builderPlan.creationAbilityChoices, ...this.#builderPlan.classChoices];
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
            section.append(choiceSection);
            const refresh = actionButton(document, "Recalculate and save fallback values", () => void this.#materialize(), "primary", this.#busy || !this.#canEdit());
            section.append(refresh);
            panel.append(section);
        }
        #renderNotes(panel, state) {
            const section = card(panel.ownerDocument, "Notes");
            const textarea = panel.ownerDocument.createElement("textarea");
            textarea.rows = 14;
            textarea.value = state.notes;
            textarea.disabled = !this.#canEdit();
            textarea.addEventListener("change", () => void this.#save((draft) => { draft.notes = textarea.value; }));
            section.append(textarea);
            panel.append(section);
        }
        #renderTools(panel, state) {
            const document = panel.ownerDocument;
            const engine = card(document, "Rules state");
            const mode = document.createElement("p");
            mode.textContent = state.rulesMode === "manual" ? "Manual values are authoritative." : "Engine values may be refreshed explicitly; stored fallback values remain authoritative between refreshes.";
            engine.append(mode);
            if (this.#runtime?.engine.available === true)
                engine.append(actionButton(document, "Preview computed values", () => void this.#previewHydration(), undefined, this.#busy));
            if (this.#hydration !== undefined) {
                const pre = document.createElement("pre");
                pre.className = "dnd-sheet-computed";
                pre.textContent = computedSummary(this.#hydration);
                engine.append(pre);
                if (this.#canEdit())
                    engine.append(actionButton(document, "Apply computed fallback values", () => void this.#materialize(), "primary", this.#busy));
            }
            const transfer = card(document, "Transfer this sheet");
            const explanation = document.createElement("p");
            explanation.textContent = "Export or import only this character's D&D sheet data. Campaign conversion is handled separately during the rewrite cutover.";
            transfer.append(explanation, actionButton(document, "Export JSON", () => downloadSheet(state)));
            if (this.#canEdit()) {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "application/json,.json";
                input.addEventListener("change", () => { const file = input.files?.[0]; if (file !== undefined)
                    void this.#importFile(file); });
                transfer.append(input);
            }
            panel.append(engine, transfer);
        }
        #classRow(selected, index) {
            const document = this.ownerDocument;
            const row = document.createElement("div");
            row.className = "dnd-builder-class-row";
            const select = document.createElement("select");
            select.disabled = !this.#canEdit();
            select.append(option(document, "", "Choose class…"));
            for (const record of this.#classRecords)
                select.append(option(document, record.id, record.name ?? record.id));
            select.value = typeof selected["classId"] === "string" ? selected["classId"] : "";
            const level = numberInput(document, typeof selected["level"] === "number" ? selected["level"] : 1, !this.#canEdit(), 1, 20);
            const update = () => { const classes = this.#builderPlan?.classes.map((item) => ({ ...item })) ?? []; classes[index] = { ...classes[index], classId: select.value, level: numberValue(level, 1), subclass: typeof classes[index]?.["subclass"] === "string" ? classes[index]["subclass"] : "" }; void this.#changeClasses(classes); };
            select.addEventListener("change", update);
            level.addEventListener("change", update);
            row.append(select, level);
            if (this.#canEdit())
                row.append(actionButton(document, "Remove", () => { const classes = (this.#builderPlan?.classes ?? []).filter((_, candidate) => candidate !== index); void this.#changeClasses(classes.length > 0 ? classes : [{ classId: "", level: 1, subclass: "" }]); }, "danger"));
            return row;
        }
        #choiceEditor(choice, state) {
            const document = this.ownerDocument;
            const item = document.createElement("fieldset");
            const legend = document.createElement("legend");
            legend.textContent = choice.prompt ?? titleCase(choice.id.replaceAll(/[-_:]/g, " "));
            item.append(legend);
            if (choice.kind === "abilityBudget") {
                const eligible = Array.isArray(choice["eligible"]) ? choice["eligible"].filter((value) => typeof value === "string") : [...abilities];
                const ability = document.createElement("select");
                for (const value of eligible)
                    ability.append(option(document, value, value));
                const amount = numberInput(document, 1, !this.#canEdit(), 0, Number(choice["perAbilityMax"] ?? choice["budget"] ?? 2));
                item.append(ability, amount, actionButton(document, "Apply", () => void this.#applyBuilderChoice(choice.id, { ability: ability.value, amount: numberValue(amount, 0) }), "primary", !this.#canEdit() || this.#busy));
                return item;
            }
            if (choice.kind === "asiMode") {
                const selectedMode = typeof state.featureChoices[choice.id] === "string" ? state.featureChoices[choice.id] : "";
                const mode = document.createElement("select");
                mode.disabled = !this.#canEdit();
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
                    for (const record of this.#featRecords)
                        featSelect.append(option(document, record.id, record.name ?? record.id));
                    const selectedFeat = state.featureChoices[feat["id"]];
                    if (typeof selectedFeat === "string")
                        featSelect.value = selectedFeat;
                    featSelect.addEventListener("change", () => void this.#applyBuilderChoice(feat["id"], featSelect.value));
                    item.append(featSelect);
                }
                return item;
            }
            const count = Math.max(1, Number(choice.count ?? 1));
            for (let slot = 0; slot < count; slot += 1) {
                const select = document.createElement("select");
                select.disabled = !this.#canEdit();
                select.append(option(document, "", "Choose…"));
                for (const value of this.#choiceOptions(choice))
                    select.append(option(document, value.id, value.label));
                const key = count > 1 ? `${choice.id}#${slot}` : choice.id;
                const current = state.featureChoices[key];
                if (typeof current === "string")
                    select.value = current;
                const choiceSlot = slot;
                select.addEventListener("change", () => void this.#applyBuilderChoice(choice.id, select.value, choiceSlot));
                item.append(select);
            }
            return item;
        }
        #choiceOptions(choice) {
            if (Array.isArray(choice.from))
                return choice.from.map((id) => ({ id, label: titleCase(id) }));
            if (choice.kind === "feat")
                return this.#featRecords.map((record) => ({ id: record.id, label: record.name ?? record.id }));
            return [];
        }
        #abilityChoiceEditor(descriptor) {
            const document = this.ownerDocument;
            const wrapper = document.createElement("span");
            wrapper.className = "dnd-builder-ability";
            const eligible = Array.isArray(descriptor["eligible"]) ? descriptor["eligible"].filter((value) => typeof value === "string") : [...abilities];
            const ability = document.createElement("select");
            for (const value of eligible)
                ability.append(option(document, value, value));
            const amount = numberInput(document, 1, !this.#canEdit(), 0, Number(descriptor["perAbilityMax"] ?? descriptor["budget"] ?? 2));
            wrapper.append(ability, amount, actionButton(document, "Apply ability", () => void this.#applyBuilderChoice(descriptor["id"], { ability: ability.value, amount: numberValue(amount, 0) }), "primary", !this.#canEdit() || this.#busy));
            return wrapper;
        }
        #inventoryTable(items) { return this.#editableTable(items, ["name", "qty", "location", "notes"], (draft) => draft.inventory); }
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
                    const input = field === "prepared" ? document.createElement("input") : document.createElement("input");
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
        #proficiencyToggle(label, checked, update, value, expertise) {
            const wrapper = this.ownerDocument.createElement("div");
            wrapper.className = "dnd-sheet-prof-row";
            const input = this.ownerDocument.createElement("input");
            input.type = "checkbox";
            input.checked = checked;
            input.disabled = !this.#canEdit();
            input.addEventListener("change", () => void this.#save((draft) => update(draft, input.checked)));
            const text = this.ownerDocument.createElement("span");
            text.textContent = label;
            const total = this.ownerDocument.createElement("strong");
            total.textContent = value;
            wrapper.append(input, text, total);
            if (expertise !== undefined && this.#canEdit())
                wrapper.append(actionButton(this.ownerDocument, "Expertise", () => void this.#save(expertise), "small"));
            return wrapper;
        }
        async #save(mutate) {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy)
                return;
            this.#busy = true;
            this.#message = "Saving…";
            this.#messageKind = "status";
            this.#render();
            try {
                this.#snapshot = await runtime.repository.save(snapshot, mutate);
                this.#message = "Saved.";
            }
            catch (error) {
                if (errorStatus(error) === 409) {
                    try {
                        this.#snapshot = await runtime.repository.load(snapshot.key);
                    }
                    catch { /* original conflict remains most useful */ }
                    this.#message = "The sheet changed elsewhere. The newest version was reloaded; please make your edit again.";
                }
                else
                    this.#message = errorMessage(error, "Could not save the sheet.");
                this.#messageKind = "alert";
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        async #loadBuilder() {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || this.#busy)
                return;
            this.#busy = true;
            this.#message = "Loading builder…";
            this.#render();
            try {
                const [result, classes, feats] = await Promise.all([runtime.engine.builderPlan(snapshot.state), runtime.engine.queryAll("class"), runtime.engine.queryAll("feat")]);
                if (!result.available || result.plan === undefined)
                    throw new Error(result.errors.join(" ") || "The rules data needed by the builder is unavailable.");
                this.#builderPlan = result.plan;
                this.#classRecords = classes;
                this.#featRecords = feats;
                this.#message = "";
            }
            catch (error) {
                this.#fail(error, "Could not load the builder.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        async #changeClasses(classes) {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || !this.#canEdit())
                return;
            this.#busy = true;
            this.#render();
            try {
                const changed = cloneSheet(snapshot.state);
                changed.classes = classes.map((item) => structuredClone(item));
                const reconciled = await runtime.engine.reconcile(changed);
                if (!reconciled.available)
                    throw new Error(reconciled.errors.join(" ") || "The engine could not reconcile this build.");
                const decisions = applyDecisions(changed, reconciled.decisions);
                const hydration = await runtime.engine.hydrate(decisions);
                const materialized = this.#withClassFallback(materializeHydration(decisions, hydration, runtime.engine.providerIdentity));
                this.#snapshot = await runtime.repository.save(snapshot, (draft) => replaceState(draft, materialized));
                const plan = await runtime.engine.builderPlan(this.#snapshot.state);
                this.#builderPlan = plan.plan;
                this.#hydration = hydration;
                this.#message = "Build updated and fallback values saved.";
                this.#messageKind = "status";
            }
            catch (error) {
                this.#fail(error, "Could not update the classes.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        async #applyBuilderChoice(choiceId, value, slot) {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy)
                return;
            this.#busy = true;
            this.#render();
            try {
                const change = slot === undefined ? { choiceId, value } : { choiceId, slot, value };
                const applied = await runtime.engine.applyChoice(snapshot.state, change);
                if (!applied.available)
                    throw new Error(applied.errors.join(" ") || "The engine rejected this choice.");
                const decisions = applyDecisions(snapshot.state, applied.decisions);
                const hydration = await runtime.engine.hydrate(decisions);
                const materialized = this.#withClassFallback(materializeHydration(decisions, hydration, runtime.engine.providerIdentity));
                this.#snapshot = await runtime.repository.save(snapshot, (draft) => replaceState(draft, materialized));
                const plan = await runtime.engine.builderPlan(this.#snapshot.state);
                this.#builderPlan = plan.plan;
                this.#hydration = hydration;
                this.#message = "Choice saved and fallback values refreshed.";
                this.#messageKind = "status";
            }
            catch (error) {
                this.#fail(error, "Could not apply this builder choice.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        async #previewHydration() {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || this.#busy)
                return;
            this.#busy = true;
            this.#render();
            try {
                this.#hydration = await runtime.engine.hydrate(snapshot.state);
                this.#message = this.#hydration.warnings.length > 0 ? this.#hydration.warnings.join(" ") : "Computed preview refreshed.";
                this.#messageKind = "status";
            }
            catch (error) {
                this.#fail(error, "Could not compute this sheet.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        async #materialize() {
            const runtime = this.#runtime;
            const snapshot = this.#snapshot;
            if (runtime === undefined || snapshot === undefined || !this.#canEdit() || this.#busy)
                return;
            this.#busy = true;
            this.#render();
            try {
                const hydration = await runtime.engine.hydrate(snapshot.state);
                const materialized = this.#withClassFallback(materializeHydration(snapshot.state, hydration, runtime.engine.providerIdentity));
                this.#snapshot = await runtime.repository.save(snapshot, (draft) => replaceState(draft, materialized));
                this.#hydration = hydration;
                this.#message = "Computed fallback values saved.";
                this.#messageKind = "status";
            }
            catch (error) {
                this.#fail(error, "Could not refresh computed values.");
            }
            finally {
                this.#busy = false;
                this.#render();
            }
        }
        async #importFile(file) {
            if (!this.#canEdit() || this.#snapshot === undefined)
                return;
            try {
                const imported = parseSheet(await file.text());
                await this.#save((draft) => replaceState(draft, imported));
                this.#message = "Imported sheet saved.";
            }
            catch (error) {
                this.#fail(error, "Could not import this sheet.");
                this.#render();
            }
        }
        #canEdit() { return this.#contribution?.host.canEdit === true; }
        #withClassFallback(state) {
            const selected = state.classes.filter((item) => typeof item["classId"] === "string" && item["classId"] !== "");
            if (selected.length === 0)
                return state;
            state.className = selected.map((item) => {
                const classID = item["classId"];
                const name = this.#classRecords.find((record) => record.id === classID)?.name ?? classID;
                return selected.length > 1 ? `${name} ${Number(item["level"] ?? 1)}` : name;
            }).join(" / ");
            return state;
        }
        #fail(error, fallback) { this.#message = errorMessage(error, fallback); this.#messageKind = "alert"; }
        #renderUnavailable(message) { this.replaceChildren(messageBlock(this.ownerDocument, message, "alert")); }
    }
    customElements.define(sheetElementTag, CharacterSheetElement);
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
