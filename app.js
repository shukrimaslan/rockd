// ─── rockd / app.js ────────────────────────────────────────────────────────

import { db } from "./firebase.js";
import {
  collection, query, where, orderBy,
  onSnapshot, doc, updateDoc, deleteDoc,
  addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser     = null;
let unsubscribe     = null;
let currentDetailId = null;
let checklists      = [];
let isGuest         = false;

// ─── Persist theme across refreshes ───────────────────────────────────────
let isDark = localStorage.getItem("rockd-theme") !== "light";
function applyTheme() {
  document.body.classList.toggle("light", !isDark);
  document.getElementById("theme-knob").style.left = isDark ? "2px" : "18px";
  localStorage.setItem("rockd-theme", isDark ? "dark" : "light");
}
applyTheme(); // apply on load before anything else

document.getElementById("theme-toggle").addEventListener("click", () => {
  isDark = !isDark;
  applyTheme();
});

// ─── Toast ────────────────────────────────────────────────────────────────
let toastTimer;
export function showToast(msg, type = "success") {
  const el  = document.getElementById("toast");
  const dot = document.getElementById("toast-dot");
  const txt = document.getElementById("toast-msg");
  txt.textContent = msg;
  dot.className   = "toast-dot" + (type === "error" ? " error" : "");
  el.style.display = "flex";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = "none"; }, 2500);
}

// ─── Navigation ───────────────────────────────────────────────────────────
let currentView = "dashboard";

function setView(view, checklistId = null) {
  currentView     = view;
  currentDetailId = checklistId;

  document.querySelectorAll(".nav-item").forEach(n =>
    n.classList.toggle("active", n.dataset.view === view));

  const titles = { dashboard: "Dashboard", templates: "Templates", archive: "Archive" };
  const isDetail = view === "detail";
  const c = isDetail ? checklists.find(x => x.id === checklistId) : null;
  const title = isDetail ? (c ? `${c.icon || ""} ${c.name}` : "") : (titles[view] || "");

  document.getElementById("topbar-title").textContent = title;
  document.getElementById("mobile-title").textContent  = isDetail ? (c?.name || "") : (titles[view] || "Rockd");

  // Mobile back button — show on detail, hide on top-level views
  const backBtn  = document.getElementById("btn-mobile-back");
  const mobileLogo = document.getElementById("mobile-logo");
  backBtn.style.display  = isDetail ? "flex" : "none";
  mobileLogo.style.display = isDetail ? "none" : "flex";

  if (view === "dashboard") renderDashboard();
  if (view === "templates") renderTemplates();
  if (view === "archive")   renderArchive();
  if (view === "detail")    renderDetail(checklistId);
}

// Mobile back button
document.getElementById("btn-mobile-back").addEventListener("click", () => setView("dashboard"));

document.querySelectorAll(".nav-item").forEach(item =>
  item.addEventListener("click", () => setView(item.dataset.view)));

document.getElementById("btn-new").addEventListener("click", showNewChecklistModal);

// ─── Init ─────────────────────────────────────────────────────────────────
export function initApp(user) {
  currentUser = user;
  isGuest     = !user;

  if (isGuest) {
    // Guest mode — use localStorage only, no Firestore
    checklists = JSON.parse(localStorage.getItem("rockd-guest-lists") || "[]");
    renderSidebar();
    setView("dashboard");
    showToast("Guest mode — lists won't be saved after closing");
    return;
  }

  listenChecklists();
  setView("dashboard");
}

function saveGuestLists() {
  if (isGuest) localStorage.setItem("rockd-guest-lists", JSON.stringify(checklists));
}

// ─── Firestore listener ────────────────────────────────────────────────────
function listenChecklists() {
  if (unsubscribe) unsubscribe();
  const q = query(
    collection(db, "checklists"),
    where("ownerUid", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );
  unsubscribe = onSnapshot(q, snap => {
    checklists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSidebar();
    if (currentView === "dashboard") renderDashboard();
    if (currentView === "archive")   renderArchive();
    if (currentView === "detail" && currentDetailId) renderDetail(currentDetailId);
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────
function renderSidebar() {
  const active = checklists.filter(c => !c.archived);
  const pinned = active.filter(c => c.pinned);
  const rest   = active.filter(c => !c.pinned);

  document.getElementById("sidebar-pinned").innerHTML = pinned.length
    ? pinned.map(c => sidebarItem(c, true)).join("")
    : `<div style="padding:4px 20px;font-size:11px;color:var(--text3)">No pinned lists</div>`;

  document.getElementById("sidebar-active").innerHTML = rest.map(c => sidebarItem(c, false)).join("");

  document.querySelectorAll(".sidebar-list-item").forEach(el =>
    el.addEventListener("click", () => setView("detail", el.dataset.id)));
}

function sidebarItem(c, pinned) {
  return `<div class="sidebar-list-item${currentDetailId === c.id ? " active" : ""}" data-id="${c.id}">
    <div class="sidebar-dot" style="background:${c.color || "var(--accent)"}"></div>
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.icon || ""} ${c.name}</span>
    ${pinned ? '<span class="sidebar-pin">📌</span>' : ""}
  </div>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────
function renderDashboard() {
  const active  = checklists.filter(c => !c.archived);
  const total   = active.reduce((s, c) => s + (c.taskCount || 0), 0);
  const done    = active.reduce((s, c) => s + (c.doneCount  || 0), 0);
  const pct     = total ? Math.round(done / total * 100) : 0;
  const pinned  = active.filter(c => c.pinned);
  const rest    = active.filter(c => !c.pinned).slice(0, 12);

  document.getElementById("content").innerHTML = `
    <div class="dashboard-grid">
      <div class="stat-card">
        <div class="stat-label">Active lists</div>
        <div class="stat-value">${active.length}</div>
        <div class="stat-sub">across all projects</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Overall progress</div>
        <div class="stat-value">${pct}%</div>
        <div class="stat-sub">${done} of ${total} tasks done</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Completed</div>
        <div class="stat-value" style="color:var(--green)">${done}</div>
        <div class="stat-sub">tasks across all lists</div>
      </div>
    </div>
    ${pinned.length ? `
      <div class="section-header"><div class="section-title">📌 Pinned</div></div>
      <div class="checklist-grid" style="margin-bottom:24px">${pinned.map(checklistCard).join("")}</div>` : ""}
    <div class="section-header"><div class="section-title">My Lists</div></div>
    ${rest.length
      ? `<div class="checklist-grid">${rest.map(checklistCard).join("")}</div>`
      : `<div class="empty-state">
           <div class="empty-state-icon">✦</div>
           <div class="empty-state-title">No checklists yet</div>
           <div class="empty-state-sub">Click "New Checklist" to get started,<br>or pick a template to hit the ground running.</div>
         </div>`}`;

  document.querySelectorAll(".checklist-card").forEach(el =>
    el.addEventListener("click", () => setView("detail", el.dataset.id)));
}

function checklistCard(c) {
  const total = c.taskCount || 0;
  const done  = c.doneCount  || 0;
  const pct   = total ? Math.round(done / total * 100) : 0;
  return `
    <div class="checklist-card${c.pinned ? " pinned" : ""}" data-id="${c.id}"
         style="--card-accent:${c.color || "var(--accent)"}">
      <div class="checklist-card-title">${c.icon || ""} ${c.name}</div>
      <div class="checklist-card-meta">${total} tasks · ${pct}% done</div>
      <div class="checklist-card-progress">
        <div class="checklist-card-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="checklist-card-footer">
        <span class="checklist-card-count">${done}/${total} completed</span>
        <span class="priority-badge p-${c.priority || "medium"}">${c.priority || "medium"}</span>
      </div>
    </div>`;
}

// ─── Archive ──────────────────────────────────────────────────────────────
function renderArchive() {
  const archived = checklists.filter(c => c.archived);
  // No duplicate title — topbar already shows "Archive"
  document.getElementById("content").innerHTML = archived.length
    ? `<div class="checklist-grid">${archived.map(c => `
        <div class="checklist-card archived" data-id="${c.id}" style="--card-accent:${c.color || "var(--accent)"}">
          <div class="checklist-card-title">${c.icon || ""} ${c.name}</div>
          <div class="checklist-card-meta">${c.taskCount || 0} tasks</div>
          <div class="checklist-card-footer">
            <span class="archive-badge">archived</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm restore-btn" data-id="${c.id}">Restore</button>
              <button class="btn btn-danger btn-sm delete-btn" data-id="${c.id}">Delete</button>
            </div>
          </div>
        </div>`).join("")}</div>`
    : `<div class="empty-state">
         <div class="empty-state-icon">📦</div>
         <div class="empty-state-title">Archive is empty</div>
         <div class="empty-state-sub">Completed lists you archive will appear here.</div>
       </div>`;

  document.querySelectorAll(".restore-btn").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); restoreChecklist(btn.dataset.id); }));
  document.querySelectorAll(".delete-btn").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); deleteChecklist(btn.dataset.id); }));
}

// ─── Templates ────────────────────────────────────────────────────────────
// Built-in templates
const BUILTIN_TEMPLATES = [
  { id:"web-launch",      name:"Website Launch",     cat:"Design",   icon:"🚀", color:"#7c6fff",
    groups:[
      { name:"Design",    tasks:["Finalise wireframes","Design system review","Mobile responsiveness","Accessibility audit"] },
      { name:"Technical", tasks:["CI/CD pipeline","SSL certificate","Performance (Core Web Vitals)","Analytics integration"] },
      { name:"Marketing", tasks:["SEO meta tags","OG images","Landing page copy","Social media assets"] },
      { name:"QA",        tasks:["Functional testing","Form testing","Load testing","Final sign-off"] }]},
  { id:"client-onboard",  name:"Client Onboarding",  cat:"Freelance",icon:"🤝", color:"#00d97e",
    groups:[
      { name:"Admin",     tasks:["Send welcome email","Contract & signature","Invoice for deposit","Kickoff call"] },
      { name:"Discovery", tasks:["Brand questionnaire","Gather assets & logins","Define scope","Set milestones"] },
      { name:"Setup",     tasks:["Shared drive folder","Slack channel","Project tool access","Brief team"] }]},
  { id:"travel-packing",  name:"Travel Packing",     cat:"Personal", icon:"✈️", color:"#3d9fff",
    groups:[
      { name:"Documents", tasks:["Passport","Itinerary & hotel","Travel insurance","Visa if required"] },
      { name:"Clothing",  tasks:["T-shirts","Pants / shorts","Underwear & socks","Jacket / rain layer"] },
      { name:"Essentials",tasks:["Phone charger","Power bank","Medications","Cash & cards"] }]},
  { id:"content-publish", name:"Content Publishing", cat:"Work",     icon:"📝", color:"#ffb020",
    groups:[
      { name:"Content",   tasks:["Copy review","SEO optimisation","Header image","Meta description"] },
      { name:"Technical", tasks:["Schedule publish date","Canonical URL","Sitemap","Mobile render check"] },
      { name:"Promotion", tasks:["Social media post","Email newsletter","Cross-post"] }]},
  { id:"invoice-followup",name:"Invoice Follow-up",  cat:"Freelance",icon:"💰", color:"#ff6ab2",
    groups:[
      { name:"Prepare",   tasks:["Verify invoice details","Check payment terms","Document deliverables"] },
      { name:"Outreach",  tasks:["Send reminder email","Follow-up call","Escalate if needed"] },
      { name:"Resolution",tasks:["Confirm payment","Send receipt","Update books"] }]},
  { id:"team-handoff",    name:"Team Handoff",       cat:"Work",     icon:"🔄", color:"#00d4d4",
    groups:[
      { name:"Documentation",tasks:["Project overview doc","Active tasks & status","Credentials & access","Key decisions"] },
      { name:"Transition",   tasks:["Handoff meeting","Walk through files","Introduce stakeholders","Transfer ownership"] }]},
  { id:"product-launch",  name:"Product Launch",     cat:"Design",   icon:"🎯", color:"#ff4d6d",
    groups:[
      { name:"Pre-launch", tasks:["Landing page live","Beta tester feedback","Press kit ready","Launch email drafted"] },
      { name:"Launch",     tasks:["Publish product","Post to socials","Submit to directories","Email list notify"] },
      { name:"Post-launch",tasks:["Monitor analytics","Respond to feedback","Fix critical bugs"] }]},
  { id:"weekly-review",   name:"Weekly Review",      cat:"Personal", icon:"📅", color:"#a78bfa",
    groups:[
      { name:"Review",    tasks:["What did I complete?","What slipped?","Energy level this week"] },
      { name:"Plan",      tasks:["Top 3 goals next week","Any blockers to address","Schedule key tasks"] }]},
];

function getCustomTemplates() {
  return JSON.parse(localStorage.getItem("rockd-custom-templates") || "[]");
}
function saveCustomTemplate(tpl) {
  const existing = getCustomTemplates();
  const idx = existing.findIndex(t => t.id === tpl.id);
  if (idx >= 0) existing[idx] = tpl; else existing.push(tpl);
  localStorage.setItem("rockd-custom-templates", JSON.stringify(existing));
}
function deleteCustomTemplate(id) {
  const existing = getCustomTemplates().filter(t => t.id !== id);
  localStorage.setItem("rockd-custom-templates", JSON.stringify(existing));
}

function renderTemplates() {
  const custom  = getCustomTemplates();
  const allTpls = [...BUILTIN_TEMPLATES, ...custom];
  const cats    = ["All", "Custom", ...new Set(BUILTIN_TEMPLATES.map(t => t.cat))];

  document.getElementById("content").innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div class="tabs" id="template-tabs" style="margin-bottom:0">
        ${cats.map((c, i) => `<div class="tab${i===0?" active":""}" data-cat="${c}">${c}${c==="Custom"?` (${custom.length})`:""}</div>`).join("")}
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-import-template" style="width:auto">＋ Import Template</button>
    </div>
    <div class="template-grid" id="template-grid">${allTpls.map(t => templateCard(t, custom.some(c=>c.id===t.id))).join("")}</div>`;

  document.querySelectorAll("#template-tabs .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#template-tabs .tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const cat = tab.dataset.cat;
      let filtered;
      if (cat === "All")    filtered = allTpls;
      else if (cat === "Custom") filtered = custom;
      else filtered = BUILTIN_TEMPLATES.filter(t => t.cat === cat);
      document.getElementById("template-grid").innerHTML = filtered.map(t => templateCard(t, custom.some(c=>c.id===t.id))).join("");
      bindTemplateUse();
    });
  });

  document.getElementById("btn-import-template").addEventListener("click", showImportTemplateModal);
  bindTemplateUse();
}

function templateCard(tpl, isCustom = false) {
  const count = tpl.groups.reduce((s,g) => s+g.tasks.length, 0);
  return `<div class="template-card" data-id="${tpl.id}">
    <div style="display:flex;align-items:start;justify-content:space-between">
      <div class="template-icon">${tpl.icon}</div>
      ${isCustom ? `<button class="btn btn-danger btn-sm delete-custom-tpl" data-id="${tpl.id}" style="width:auto;padding:3px 8px;font-size:10px">✕</button>` : ""}
    </div>
    <div class="template-name">${tpl.name}</div>
    <div class="template-cat">${tpl.cat} · ${count} tasks</div>
    <div style="margin-top:10px">
      <button class="btn btn-primary btn-sm use-template" data-id="${tpl.id}" style="width:100%;justify-content:center">Use template</button>
    </div>
  </div>`;
}

function bindTemplateUse() {
  document.querySelectorAll(".use-template").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const allTpls = [...BUILTIN_TEMPLATES, ...getCustomTemplates()];
      const tpl = allTpls.find(t => t.id === btn.dataset.id);
      if (tpl) createFromTemplate(tpl);
    });
  });
  document.querySelectorAll(".delete-custom-tpl").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if (confirm("Delete this custom template?")) {
        deleteCustomTemplate(btn.dataset.id);
        renderTemplates();
        showToast("Template deleted");
      }
    });
  });
}

// ─── Import template modal ─────────────────────────────────────────────────
function showImportTemplateModal() {
  const existing = document.getElementById("import-tpl-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "import-tpl-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">Import Template</div>
      <div class="modal-sub">Paste a JSON template or fill in the fields manually.</div>

      <div class="tabs" id="import-tabs" style="margin-bottom:16px">
        <div class="tab active" data-tab="manual">Manual</div>
        <div class="tab" data-tab="json">Paste JSON</div>
      </div>

      <div id="import-manual">
        <div class="modal-field">
          <label class="modal-label">Template name</label>
          <input id="itpl-name" class="modal-input" placeholder="e.g. Sprint Planning"/>
        </div>
        <div class="modal-field" style="display:flex;gap:8px">
          <div style="flex:1">
            <label class="modal-label">Icon (emoji)</label>
            <input id="itpl-icon" class="modal-input" placeholder="🗂️" maxlength="2"/>
          </div>
          <div style="flex:1">
            <label class="modal-label">Category</label>
            <input id="itpl-cat" class="modal-input" placeholder="Work"/>
          </div>
        </div>
        <div class="modal-field">
          <label class="modal-label">Groups & Tasks</label>
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:6px">One group per line starting with #, tasks below it</div>
          <textarea id="itpl-body" class="modal-input" rows="8" placeholder="# Design\nFinalise wireframes\nDesign system review\n\n# QA\nFunctional testing\nFinal sign-off" style="resize:vertical;line-height:1.6"></textarea>
        </div>
      </div>

      <div id="import-json" style="display:none">
        <div class="modal-field">
          <label class="modal-label">JSON template</label>
          <textarea id="itpl-json" class="modal-input" rows="10" placeholder='{"name":"My Template","icon":"🗂️","cat":"Work","color":"#7c6fff","groups":[{"name":"Group 1","tasks":["Task A","Task B"]}]}' style="resize:vertical;font-family:var(--mono);font-size:11px;line-height:1.6"></textarea>
        </div>
      </div>

      <div id="import-error" class="auth-error" style="margin-top:0;margin-bottom:12px"></div>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="save-import-btn" style="flex:1">Import Template</button>
        <button class="btn btn-ghost" id="cancel-import-btn" style="flex:0;width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-import-btn").addEventListener("click", () => modal.remove());

  // Tab switching
  modal.querySelectorAll("#import-tabs .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      modal.querySelectorAll("#import-tabs .tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("import-manual").style.display = tab.dataset.tab === "manual" ? "block" : "none";
      document.getElementById("import-json").style.display   = tab.dataset.tab === "json"   ? "block" : "none";
    });
  });

  document.getElementById("save-import-btn").addEventListener("click", () => {
    const errorEl   = document.getElementById("import-error");
    const activeTab = modal.querySelector("#import-tabs .tab.active").dataset.tab;
    errorEl.classList.remove("visible");

    let tpl;
    if (activeTab === "json") {
      try {
        tpl = JSON.parse(document.getElementById("itpl-json").value.trim());
        if (!tpl.name || !tpl.groups) throw new Error("Missing name or groups");
        tpl.id  = "custom_" + Date.now();
        tpl.cat = tpl.cat || "Custom";
      } catch(e) {
        errorEl.textContent = "Invalid JSON: " + e.message;
        errorEl.classList.add("visible");
        return;
      }
    } else {
      const name = document.getElementById("itpl-name").value.trim();
      const body = document.getElementById("itpl-body").value.trim();
      if (!name || !body) {
        errorEl.textContent = "Please fill in the name and groups.";
        errorEl.classList.add("visible");
        return;
      }
      // Parse the simple text format
      const groups = [];
      let currentGroup = null;
      body.split("\n").forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.startsWith("#")) {
          currentGroup = { name: trimmed.replace(/^#+\s*/, ""), tasks: [] };
          groups.push(currentGroup);
        } else if (currentGroup) {
          currentGroup.tasks.push(trimmed);
        }
      });
      if (!groups.length) {
        errorEl.textContent = "Add at least one group starting with #";
        errorEl.classList.add("visible");
        return;
      }
      tpl = {
        id:     "custom_" + Date.now(),
        name,
        icon:   document.getElementById("itpl-icon").value.trim() || "🗂️",
        cat:    document.getElementById("itpl-cat").value.trim()   || "Custom",
        color:  "#7c6fff",
        groups
      };
    }

    saveCustomTemplate(tpl);
    modal.remove();
    renderTemplates();
    showToast(`"${tpl.name}" template imported!`);
  });
}

// ─── Save checklist as template ────────────────────────────────────────────
function saveAsTemplate(checklistId) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c) return;

  const tpl = {
    id:     "custom_" + Date.now(),
    name:   c.name + " (template)",
    icon:   c.icon || "🗂️",
    cat:    "Custom",
    color:  c.color || "#7c6fff",
    groups: (c.groups || []).map(g => ({
      name:  g.name,
      tasks: (g.tasks || []).map(t => t.text)
    }))
  };
  saveCustomTemplate(tpl);
  showToast(`Saved as template "${tpl.name}"`);
}

// ─── Create checklist from template ───────────────────────────────────────
async function createFromTemplate(tpl) {
  const groups = tpl.groups.map((g, gi) => ({
    id: `g${gi}_${Date.now()}`, name: g.name, collapsed: false,
    tasks: g.tasks.map((t, ti) => ({
      id: `t${gi}_${ti}_${Date.now()}`, text: t,
      completed: false, priority: "medium", date: null
    }))
  }));

  if (isGuest) {
    const newList = {
      id: "guest_" + Date.now(), ownerUid: "guest",
      name: tpl.name, icon: tpl.icon, color: tpl.color,
      priority: "medium", pinned: false, archived: false,
      taskCount: groups.reduce((s,g)=>s+g.tasks.length,0), doneCount: 0,
      groups, collaborators: [], tags: [],
      createdAt: { toDate: () => new Date() }
    };
    checklists.unshift(newList);
    saveGuestLists();
    renderSidebar();
    showToast(`"${tpl.name}" created!`);
    setView("detail", newList.id);
    return;
  }

  try {
    const ref = await addDoc(collection(db, "checklists"), {
      ownerUid: currentUser.uid, name: tpl.name, icon: tpl.icon, color: tpl.color,
      priority: "medium", pinned: false, archived: false,
      taskCount: groups.reduce((s,g)=>s+g.tasks.length,0), doneCount: 0,
      groups, collaborators: [], tags: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    showToast(`"${tpl.name}" created!`);
    setView("detail", ref.id);
  } catch (err) {
    console.error(err);
    showToast("Failed to create from template", "error");
  }
}

// ─── Detail view ──────────────────────────────────────────────────────────
function renderDetail(id) {
  const c = checklists.find(x => x.id === id);
  if (!c) { setView("dashboard"); return; }

  const total  = c.taskCount || 0;
  const done   = c.doneCount  || 0;
  const pct    = total ? Math.round(done / total * 100) : 0;
  const groups = c.groups || [];

  // Update topbar title (no duplicate — only the topbar shows it)
  document.getElementById("topbar-title").textContent = `${c.icon || ""} ${c.name}`;
  document.getElementById("mobile-title").textContent  = c.name;

  document.getElementById("content").innerHTML = `
    <div class="detail-header">
      <div class="detail-title-wrap">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="icon-edit-btn" id="edit-icon-btn" title="Change icon" style="font-size:22px;cursor:pointer;background:none;border:none;padding:0;line-height:1">${c.icon || "📋"}</button>
          <div class="detail-title" id="detail-title-text" contenteditable="true" spellcheck="false"
               style="outline:none;border-bottom:1px dashed transparent;cursor:text"
               data-original="${c.name}"
               onblur="saveChecklistTitle('${c.id}', this)"
               onfocus="this.style.borderColor='var(--border3)'">${c.name}</div>
        </div>
        <div class="detail-meta">${total} tasks · ${done} done · created ${c.createdAt?.toDate?.()?.toLocaleDateString("en-MY",{month:"short",day:"numeric",year:"numeric"}) || "just now"}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
        <button class="btn btn-ghost btn-sm" id="detail-save-tpl" title="Save as template">💾 Save as template</button>
        <button class="btn btn-ghost btn-sm" id="detail-pin">${c.pinned ? "📌 Unpin" : "📌 Pin"}</button>
        <button class="btn btn-ghost btn-sm" id="detail-archive">${c.archived ? "Unarchive" : "Archive"}</button>
        <button class="btn btn-danger btn-sm" id="detail-delete">Delete</button>
      </div>
    </div>

    <div class="sticky-progress" id="sticky-progress">
      <div class="progress-bar-header">
        <span class="progress-bar-label">Progress</span>
        <span class="progress-bar-pct" id="progress-pct">${pct}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar-fill" id="progress-fill" style="width:${pct}%"></div>
      </div>
    </div>

    <div id="task-area">
      ${groups.length
        ? groups.map(g => renderGroup(c.id, g)).join("")
        : `<div class="empty-state" style="padding:24px 0">
             <div class="empty-state-icon">📋</div>
             <div class="empty-state-title">No tasks yet</div>
             <div class="empty-state-sub">Add a group below, then add tasks inside it.</div>
           </div>`}
    </div>

    <div style="margin-top:12px">
      <button class="btn btn-ghost btn-sm" id="btn-add-group" style="width:auto">＋ Add Group</button>
    </div>`;

  // Header buttons
  document.getElementById("detail-pin").addEventListener("click",      () => togglePin(c.id, c.pinned));
  document.getElementById("detail-archive").addEventListener("click",  () => archiveChecklist(c.id));
  document.getElementById("detail-delete").addEventListener("click",   () => deleteChecklist(c.id));
  document.getElementById("detail-save-tpl").addEventListener("click", () => saveAsTemplate(c.id));
  document.getElementById("btn-add-group").addEventListener("click",   () => showAddGroupModal(c.id, c.groups || []));

  // Icon picker
  document.getElementById("edit-icon-btn").addEventListener("click", () => showIconPicker(c.id));

  bindTaskEvents(c);
}

// ─── Icon picker ───────────────────────────────────────────────────────────
const ICONS = ["📋","🚀","✅","🎯","💡","🔥","⚡","🛠","📦","🗂","📝","🎨","💰","🤝","✈️","🏠","🎵","📅","🌍","🔔","⭐","🏆","🧪","🔐"];

function showIconPicker(checklistId) {
  const existing = document.getElementById("icon-picker-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "icon-picker-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal" style="max-width:320px">
      <div class="modal-title">Choose Icon</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
        ${ICONS.map(icon => `
          <button class="icon-option" data-icon="${icon}"
                  style="font-size:24px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;
                         width:44px;height:44px;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center">
            ${icon}
          </button>`).join("")}
      </div>
      <button class="btn btn-ghost" id="cancel-icon-btn" style="margin-top:14px">Cancel</button>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-icon-btn").addEventListener("click", () => modal.remove());

  modal.querySelectorAll(".icon-option").forEach(btn => {
    btn.addEventListener("click", async () => {
      const icon = btn.dataset.icon;
      modal.remove();
      await saveChecklistField(checklistId, { icon });
      showToast("Icon updated");
    });
  });
}

// ─── Save checklist title inline ───────────────────────────────────────────
window.saveChecklistTitle = async (checklistId, el) => {
  el.style.borderColor = "transparent";
  const newName = el.textContent.trim();
  const original = el.dataset.original;
  if (!newName || newName === original) { el.textContent = original; return; }
  await saveChecklistField(checklistId, { name: newName });
  document.getElementById("topbar-title").textContent = newName;
  document.getElementById("mobile-title").textContent  = newName;
};

async function saveChecklistField(checklistId, fields) {
  if (isGuest) {
    const idx = checklists.findIndex(x => x.id === checklistId);
    if (idx >= 0) { checklists[idx] = { ...checklists[idx], ...fields }; saveGuestLists(); renderSidebar(); }
    return;
  }
  try {
    await updateDoc(doc(db, "checklists", checklistId), { ...fields, updatedAt: serverTimestamp() });
  } catch(err) { console.error(err); showToast("Failed to save", "error"); }
}

// ─── Group HTML ────────────────────────────────────────────────────────────
function renderGroup(checklistId, group) {
  const remaining = (group.tasks || []).filter(t => !t.completed).length;
  const collapsed  = group.collapsed || false;
  return `
    <div class="task-group" data-group="${group.id}">
      <div class="task-group-header" data-collapse="${group.id}" style="cursor:pointer">
        <span class="group-drag-handle" title="Drag to reorder group" onclick="event.stopPropagation()">⠿</span>
        <span class="task-group-chevron${collapsed ? "" : " open"}">▸</span>
        <span class="task-group-title" contenteditable="true" spellcheck="false"
              style="outline:none;border-bottom:1px dashed transparent;cursor:text;flex:1"
              data-original="${group.name}"
              onblur="saveGroupTitle('${checklistId}','${group.id}',this)"
              onfocus="this.style.borderColor='var(--border3)'">${group.name}</span>
        <span class="task-group-count">${remaining} left</span>
      </div>
      <div class="task-list" data-group-body="${group.id}" style="display:${collapsed?"none":"block"}">
        ${(group.tasks || []).map(task => renderTask(checklistId, group.id, task)).join("")}
        <div class="add-task-row" data-group="${group.id}">
          <span style="color:var(--text3);font-size:13px">＋</span>
          <input class="add-task-input" placeholder="Add a task… (Enter to save)" data-group="${group.id}"/>
        </div>
      </div>
    </div>`;
}

window.saveGroupTitle = async (checklistId, groupId, el) => {
  el.style.borderColor = "transparent";
  const newName  = el.textContent.trim();
  const original = el.dataset.original;
  if (!newName || newName === original) { el.textContent = original; return; }
  const c = checklists.find(x => x.id === checklistId);
  if (!c) return;
  const groups = c.groups.map(g => g.id === groupId ? { ...g, name: newName } : g);
  await saveChecklistField(checklistId, { groups });
};

// ─── Task HTML ─────────────────────────────────────────────────────────────
function renderTask(checklistId, groupId, task) {
  const priorityColors = { low: "var(--green)", medium: "var(--blue)", high: "var(--amber)", critical: "var(--red)" };
  const pColor = priorityColors[task.priority] || priorityColors.medium;

  // Due date display
  let dateHtml = "";
  if (task.date) {
    const due     = new Date(task.date);
    const today   = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
    const isOverdue  = !task.completed && due < today;
    const isToday    = due.getTime() === today.getTime();
    const isTomorrow = due.getTime() === tomorrow.getTime();
    let label = due.toLocaleDateString("en-MY",{month:"short",day:"numeric"});
    if (isToday)    label = "Today";
    if (isTomorrow) label = "Tomorrow";
    const cls = isOverdue ? "overdue" : (isToday || isTomorrow ? "upcoming" : "");
    dateHtml = `<span class="task-date ${cls}">📅 ${label}</span>`;
  }

  return `
    <div class="task-item${task.completed ? " completed" : ""}" data-task="${task.id}" data-group="${groupId}"
         draggable="true">
      <div class="drag-handle" title="Drag to reorder">⠿</div>
      <div class="task-checkbox${task.completed ? " checked" : ""}" data-toggle data-task="${task.id}" data-group="${groupId}">
        ${task.completed ? `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,6 4.5,9 10.5,3"/></svg>` : ""}
      </div>
      <div class="task-content" style="flex:1;min-width:0">
        <div class="task-text" data-editable data-task="${task.id}" data-group="${groupId}">${task.text}</div>
        <div class="task-meta-row">
          <select class="priority-select" data-task="${task.id}" data-group="${groupId}"
                  style="font-size:10px;background:var(--bg3);border:1px solid ${pColor}44;border-radius:20px;
                         padding:2px 6px;color:${pColor};cursor:pointer;font-family:var(--mono);font-weight:600">
            <option value="low"      ${task.priority==="low"      ?"selected":""}>Low</option>
            <option value="medium"   ${task.priority==="medium"   ?"selected":""}>Medium</option>
            <option value="high"     ${task.priority==="high"     ?"selected":""}>High</option>
            <option value="critical" ${task.priority==="critical" ?"selected":""}>Critical</option>
          </select>
          ${dateHtml}
        </div>
      </div>
      <div class="task-actions">
        <div class="task-action-btn" data-date-pick data-task="${task.id}" data-group="${groupId}" title="Set due date"
             style="position:relative">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <input type="date" class="hidden-date-input" data-task="${task.id}" data-group="${groupId}"
                 value="${task.date || ""}"
                 style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"/>
        </div>
        <div class="task-action-btn del" data-delete data-task="${task.id}" data-group="${groupId}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </div>
      </div>
    </div>`;
}

// ─── Bind task events ──────────────────────────────────────────────────────
function bindTaskEvents(c) {
  const area = document.getElementById("content");

  // Collapse / expand groups
  area.querySelectorAll("[data-collapse]").forEach(header => {
    header.addEventListener("click", e => {
      // Don't collapse when clicking the editable title
      if (e.target.hasAttribute("contenteditable")) return;
      const groupId = header.dataset.collapse;
      const body    = area.querySelector(`[data-group-body="${groupId}"]`);
      const chevron = header.querySelector(".task-group-chevron");
      if (!body) return;
      const isHidden = body.style.display === "none";
      body.style.display = isHidden ? "block" : "none";
      chevron.classList.toggle("open", isHidden);
      // Persist collapsed state
      doUpdateGroupCollapsed(c.id, groupId, !isHidden);
    });
  });

  // Tick / untick
  area.querySelectorAll("[data-toggle]").forEach(el =>
    el.addEventListener("click", () => doToggleTask(c.id, el.dataset.group, el.dataset.task)));

  // Inline edit task text
  area.querySelectorAll("[data-editable]").forEach(el => {
    el.addEventListener("click", () => {
      if (el.querySelector("input")) return;
      const orig = el.textContent;
      el.innerHTML = `<input class="task-text-input" value="${orig.replace(/"/g,"&quot;")}"/>`;
      const inp = el.querySelector("input");
      inp.focus(); inp.select();
      const save = () => {
        const val = inp.value.trim() || orig;
        doEditTask(c.id, el.dataset.group, el.dataset.task, { text: val });
      };
      inp.addEventListener("blur", save);
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter")  { e.preventDefault(); inp.blur(); }
        if (e.key === "Escape") { el.textContent = orig; }
      });
    });
  });

  // Priority dropdown — recolour on change
  area.querySelectorAll(".priority-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const colors = { low: "var(--green)", medium: "var(--blue)", high: "var(--amber)", critical: "var(--red)" };
      sel.style.color       = colors[sel.value];
      sel.style.borderColor = colors[sel.value] + "44";
      doEditTask(c.id, sel.dataset.group, sel.dataset.task, { priority: sel.value });
    });
  });

  // Delete task
  area.querySelectorAll("[data-delete]").forEach(el =>
    el.addEventListener("click", () => doDeleteTask(c.id, el.dataset.group, el.dataset.task)));

  // Due date picker
  area.querySelectorAll(".hidden-date-input").forEach(inp => {
    inp.addEventListener("change", () => {
      doEditTask(c.id, inp.dataset.group, inp.dataset.task, { date: inp.value || null });
    });
  });

  // Add task on Enter
  area.querySelectorAll(".add-task-input").forEach(inp => {
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter" && inp.value.trim()) {
        doAddTask(c.id, inp.dataset.group, inp.value.trim(), c.groups || []);
        inp.value = "";
      }
    });
  });

  // ── Drag to reorder tasks (same group only) ────────────────────────────
  let dragSrc     = null;  // currently dragged task element
  let dragGroupId = null;  // group the drag started in

  area.querySelectorAll(".task-item[draggable]").forEach(el => {
    el.addEventListener("dragstart", e => {
      // Only allow drag via the handle
      if (!e.target.closest(".drag-handle")) { e.preventDefault(); return; }
      dragSrc     = el;
      dragGroupId = el.dataset.group;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => el.classList.add("dragging"), 0);
    });

    el.addEventListener("dragend", () => {
      dragSrc     = null;
      dragGroupId = null;
      area.querySelectorAll(".task-item").forEach(t => {
        t.classList.remove("drag-over");
        t.classList.remove("dragging");
      });
    });

    el.addEventListener("dragover", e => {
      // Reject if not a task drag or cross-group
      if (!dragSrc || el === dragSrc) return;
      if (el.dataset.group !== dragGroupId) return; // same group only
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      area.querySelectorAll(".task-item").forEach(t => t.classList.remove("drag-over"));
      el.classList.add("drag-over");
    });

    el.addEventListener("dragleave", e => {
      // Only remove highlight if leaving to something outside the task
      if (!el.contains(e.relatedTarget)) el.classList.remove("drag-over");
    });

    el.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation(); // prevent group drop handler from firing
      el.classList.remove("drag-over");
      if (!dragSrc || dragSrc === el) return;
      if (el.dataset.group !== dragGroupId) return; // same group only

      const groupId   = dragGroupId;
      const srcTaskId = dragSrc.dataset.task;
      const dstTaskId = el.dataset.task;
      const freshC    = checklists.find(x => x.id === c.id);
      if (!freshC?.groups) return;

      const groups = freshC.groups.map(g => {
        if (g.id !== groupId) return g;
        const tasks  = [...(g.tasks || [])];
        const srcIdx = tasks.findIndex(t => t.id === srcTaskId);
        const dstIdx = tasks.findIndex(t => t.id === dstTaskId);
        if (srcIdx < 0 || dstIdx < 0) return g;
        const [moved] = tasks.splice(srcIdx, 1);
        tasks.splice(dstIdx, 0, moved);
        return { ...g, tasks };
      });

      persistGroups(c.id, groups);
    });
  });

  // ── Drag to reorder groups (header handle only) ─────────────────────────
  let dragSrcGroup = null;

  area.querySelectorAll(".task-group").forEach(groupEl => {
    const header = groupEl.querySelector(".task-group-header");
    const handle = groupEl.querySelector(".group-drag-handle");
    if (!handle) return;

    // Only the handle triggers group drag
    handle.setAttribute("draggable", "true");

    handle.addEventListener("dragstart", e => {
      dragSrcGroup = groupEl;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "group"); // needed for Firefox
      setTimeout(() => groupEl.classList.add("group-dragging"), 0);
    });

    handle.addEventListener("dragend", () => {
      dragSrcGroup = null;
      area.querySelectorAll(".task-group").forEach(g => {
        g.classList.remove("drag-over-group");
        g.classList.remove("group-dragging");
      });
    });

    // The whole group is the drop target for other groups
    groupEl.addEventListener("dragover", e => {
      if (!dragSrcGroup || dragSrcGroup === groupEl) return;
      if (dragSrc) return; // task drag in progress, ignore
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      area.querySelectorAll(".task-group").forEach(g => g.classList.remove("drag-over-group"));
      groupEl.classList.add("drag-over-group");
    });

    groupEl.addEventListener("dragleave", e => {
      if (!groupEl.contains(e.relatedTarget)) groupEl.classList.remove("drag-over-group");
    });

    groupEl.addEventListener("drop", e => {
      if (!dragSrcGroup || dragSrcGroup === groupEl) return;
      if (dragSrc) return; // task drag in progress
      e.preventDefault();
      e.stopPropagation();
      groupEl.classList.remove("drag-over-group");

      const srcId  = dragSrcGroup.dataset.group;
      const dstId  = groupEl.dataset.group;
      const freshC = checklists.find(x => x.id === c.id);
      if (!freshC?.groups) return;

      const groups  = [...freshC.groups];
      const srcIdx  = groups.findIndex(g => g.id === srcId);
      const dstIdx  = groups.findIndex(g => g.id === dstId);
      if (srcIdx < 0 || dstIdx < 0) return;

      const [moved] = groups.splice(srcIdx, 1);
      groups.splice(dstIdx, 0, moved);
      persistGroups(c.id, groups);
      dragSrcGroup = null;
    });
  });
}

// ─── Task + group mutations ────────────────────────────────────────────────
async function doToggleTask(checklistId, groupId, taskId) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c?.groups) return;
  const groups    = c.groups.map(g => g.id !== groupId ? g : {
    ...g, tasks: g.tasks.map(t => t.id !== taskId ? t : { ...t, completed: !t.completed })
  });
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);
  await persistGroups(checklistId, groups, { doneCount });
}

async function doEditTask(checklistId, groupId, taskId, changes) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c?.groups) return;
  const groups = c.groups.map(g => g.id !== groupId ? g : {
    ...g, tasks: g.tasks.map(t => t.id !== taskId ? t : { ...t, ...changes })
  });
  await persistGroups(checklistId, groups);
}

async function doDeleteTask(checklistId, groupId, taskId) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c?.groups) return;
  const groups    = c.groups.map(g => g.id !== groupId ? g : {
    ...g, tasks: g.tasks.filter(t => t.id !== taskId)
  });
  const taskCount = groups.reduce((s,g) => s + g.tasks.length, 0);
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);
  await persistGroups(checklistId, groups, { taskCount, doneCount });
  showToast("Task deleted");
}

async function doAddTask(checklistId, groupId, text, currentGroups) {
  const newTask   = { id: `t_${Date.now()}`, text, completed: false, priority: "medium", date: null };
  const groups    = currentGroups.map(g => g.id !== groupId ? g : {
    ...g, tasks: [...(g.tasks || []), newTask]
  });
  const taskCount = groups.reduce((s,g) => s + g.tasks.length, 0);
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);
  await persistGroups(checklistId, groups, { taskCount, doneCount });
}

async function doUpdateGroupCollapsed(checklistId, groupId, collapsed) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c?.groups) return;
  const groups = c.groups.map(g => g.id !== groupId ? g : { ...g, collapsed });
  await persistGroups(checklistId, groups);
}

async function persistGroups(checklistId, groups, extra = {}) {
  if (isGuest) {
    const idx = checklists.findIndex(x => x.id === checklistId);
    if (idx >= 0) {
      checklists[idx] = { ...checklists[idx], groups, ...extra };
      saveGuestLists();
      renderSidebar();
      renderDetail(checklistId); // manually re-render for guest
    }
    return;
  }
  try {
    await updateDoc(doc(db, "checklists", checklistId), { groups, ...extra, updatedAt: serverTimestamp() });
  } catch(err) { console.error(err); showToast("Failed to save", "error"); }
}

// ─── Add Group modal ───────────────────────────────────────────────────────
function showAddGroupModal(checklistId, currentGroups) {
  const existing = document.getElementById("add-group-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "add-group-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">Add Group</div>
      <div class="modal-sub">Groups organise tasks within a checklist.</div>
      <div class="modal-field">
        <label class="modal-label">Group name</label>
        <input id="group-name-input" class="modal-input" placeholder="e.g. Design, Marketing, QA…"/>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="create-group-btn" style="flex:1">Add Group</button>
        <button class="btn btn-ghost" id="cancel-group-btn" style="flex:0;width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-group-btn").addEventListener("click", () => modal.remove());
  document.getElementById("group-name-input").focus();

  const create = async () => {
    const name = document.getElementById("group-name-input").value.trim();
    if (!name) return;
    modal.remove();
    const groups = [...currentGroups, { id: `g_${Date.now()}`, name, collapsed: false, tasks: [] }];
    await saveChecklistField(checklistId, { groups });
    showToast(`Group "${name}" added`);
  };

  document.getElementById("create-group-btn").addEventListener("click", create);
  document.getElementById("group-name-input").addEventListener("keydown", e => { if (e.key === "Enter") create(); });
}

// ─── Checklist actions ─────────────────────────────────────────────────────
function togglePin(id, current) {
  saveChecklistField(id, { pinned: !current })
    .then(() => showToast(!current ? "Pinned!" : "Unpinned"));
}

function archiveChecklist(id) {
  const c    = checklists.find(x => x.id === id);
  const next = !c.archived;
  saveChecklistField(id, { archived: next, archivedAt: next ? new Date().toISOString() : null })
    .then(() => { showToast(next ? "Archived" : "Restored"); if (next) setView("dashboard"); });
}

function restoreChecklist(id) {
  saveChecklistField(id, { archived: false, archivedAt: null })
    .then(() => showToast("Restored!"));
}

async function deleteChecklist(id) {
  if (!confirm("Delete this checklist? This cannot be undone.")) return;
  if (isGuest) {
    checklists = checklists.filter(x => x.id !== id);
    saveGuestLists();
    renderSidebar();
    setView("dashboard");
    showToast("Deleted");
    return;
  }
  try {
    await deleteDoc(doc(db, "checklists", id));
    showToast("Deleted");
    setView("dashboard");
  } catch(err) { showToast("Failed to delete", "error"); }
}

// ─── New Checklist modal ───────────────────────────────────────────────────
function showNewChecklistModal() {
  const COLORS = ["#7c6fff","#00d97e","#3d9fff","#ffb020","#ff4d6d","#ff6ab2","#00d4d4"];
  const existing = document.getElementById("new-checklist-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "new-checklist-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">✦ New Checklist</div>
      <div class="modal-sub">Give your checklist a name and colour.</div>
      <div class="modal-field">
        <label class="modal-label">Name</label>
        <input id="new-cl-name" class="modal-input" placeholder="e.g. Website Redesign"/>
      </div>
      <div class="modal-field">
        <label class="modal-label">Colour</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${COLORS.map((c,i) => `
            <div class="color-swatch" data-color="${c}"
                 style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;
                        border:2px solid ${i===0?"white":"transparent"};transition:all .15s"></div>`).join("")}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="create-cl-btn" style="flex:1">Create</button>
        <button class="btn btn-ghost" id="cancel-cl-btn" style="flex:0;width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-cl-btn").addEventListener("click", () => modal.remove());
  document.getElementById("new-cl-name").focus();

  let selectedColor = COLORS[0];
  modal.querySelectorAll(".color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      modal.querySelectorAll(".color-swatch").forEach(s => s.style.borderColor = "transparent");
      sw.style.borderColor = "white";
      selectedColor = sw.dataset.color;
    });
  });

  const create = async () => {
    const name = document.getElementById("new-cl-name").value.trim();
    if (!name) return;
    modal.remove();

    if (isGuest) {
      const newList = {
        id: "guest_" + Date.now(), ownerUid: "guest",
        name, color: selectedColor, icon: "",
        priority: "medium", pinned: false, archived: false,
        taskCount: 0, doneCount: 0, groups: [], collaborators: [], tags: [],
        createdAt: { toDate: () => new Date() }
      };
      checklists.unshift(newList);
      saveGuestLists();
      renderSidebar();
      showToast(`"${name}" created!`);
      setView("detail", newList.id);
      return;
    }

    try {
      const ref = await addDoc(collection(db, "checklists"), {
        ownerUid: currentUser.uid, name, color: selectedColor, icon: "",
        priority: "medium", pinned: false, archived: false,
        taskCount: 0, doneCount: 0, groups: [], collaborators: [], tags: [],
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      showToast(`"${name}" created!`);
      setView("detail", ref.id);
    } catch (err) {
      console.error(err);
      showToast("Failed to create checklist", "error");
    }
  };

  document.getElementById("create-cl-btn").addEventListener("click", create);
  document.getElementById("new-cl-name").addEventListener("keydown", e => { if (e.key === "Enter") create(); });
}
