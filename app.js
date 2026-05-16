// ─── rockd / app.js ────────────────────────────────────────────────────────

import { db } from "./firebase.js";
import {
  collection, query, where, orderBy,
  onSnapshot, doc, updateDoc, deleteDoc,
  addDoc, serverTimestamp, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser     = null;
let unsubscribe     = null;
let currentDetailId = null;
let checklists      = [];
let isGuest         = false;

// ─── Theme — applied on load from localStorage, then overridden by applyPrefs on login ──
let isDark = localStorage.getItem("rockd-theme") !== "light";
function applyTheme() {
  document.body.classList.toggle("light", !isDark);
  const knob = document.getElementById("theme-knob");
  if (knob) knob.style.left = isDark ? "2px" : "18px";
  localStorage.setItem("rockd-theme", isDark ? "dark" : "light");
}
applyTheme(); // fast initial paint from localStorage

document.getElementById("theme-toggle").addEventListener("click", () => {
  isDark = !isDark;
  applyTheme();
  // If logged in, persist to Firestore via savePrefs
  if (currentUser && !isGuest) savePrefs({ theme: isDark ? "dark" : "light" });
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

  // Smooth page transition
  const content = document.getElementById("content");
  if (content) {
    content.style.opacity = "0";
    content.style.transform = "translateY(6px)";
  }
  requestAnimationFrame(() => {
    if (view === "dashboard") renderDashboard();
    if (view === "templates") renderTemplates();
    if (view === "archive")   renderArchive();
    if (view === "settings")  renderSettings();
    if (view === "detail")    renderDetail(checklistId);
    requestAnimationFrame(() => {
      if (content) {
        content.style.transition = "opacity .18s ease, transform .18s ease";
        content.style.opacity    = "1";
        content.style.transform  = "translateY(0)";
        setTimeout(() => { content.style.transition = ""; }, 200);
      }
    });
  });

  // Mobile bottom nav active state
  document.querySelectorAll(".mobile-nav-item").forEach(n =>
    n.classList.toggle("active", n.dataset.view === view));

  // Show/hide mobile New button (only on dashboard/detail)
  const newMobile = document.getElementById("btn-new-mobile");
  if (newMobile) newMobile.style.display = (view === "dashboard") ? "flex" : "none";
}

// Mobile back button
document.getElementById("btn-mobile-back").addEventListener("click", () => setView("dashboard"));

// Desktop sidebar nav
document.querySelectorAll(".nav-item").forEach(item =>
  item.addEventListener("click", () => setView(item.dataset.view)));

// Mobile bottom nav
document.querySelectorAll(".mobile-nav-item").forEach(item =>
  item.addEventListener("click", () => setView(item.dataset.view)));

// FAB button (mobile center)
const fab = document.getElementById("btn-new-fab");
if (fab) fab.addEventListener("click", showNewChecklistModal);

// Mobile top new button
const newMobileBtn = document.getElementById("btn-new-mobile");
if (newMobileBtn) newMobileBtn.addEventListener("click", showNewChecklistModal);

document.getElementById("btn-new").addEventListener("click", showNewChecklistModal);

// ─── Init ─────────────────────────────────────────────────────────────────
export async function initApp(user) {
  currentUser = user;
  isGuest     = !user;

  if (isGuest) {
    checklists = JSON.parse(localStorage.getItem("rockd-guest-lists") || "[]");
    // Load guest prefs from localStorage
    const saved = JSON.parse(localStorage.getItem("rockd-guest-prefs") || "{}");
    userPrefs = { ...DEFAULT_PREFS, ...saved };
    applyPrefs();
    renderSidebar();
    setView("dashboard");
    showToast("Guest mode — lists won't be saved after closing");
    return;
  }

  // Load user prefs FIRST before rendering anything
  await loadUserPrefs(user);
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

  requestAnimationFrame(upgradeEmptyStates);
}

function checklistCard(c) {
  const total = c.taskCount || 0;
  const done  = c.doneCount  || 0;
  const pct   = total ? Math.round(done / total * 100) : 0;
  return `
    <div class="checklist-card${c.pinned ? " pinned" : ""}${pct === 100 ? " complete" : ""}" data-id="${c.id}"
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

  requestAnimationFrame(upgradeEmptyStates);
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

// ─── Category helpers ─────────────────────────────────────────────────────
function getCustomCategories() {
  return JSON.parse(localStorage.getItem("rockd-custom-cats") || "[]");
}
function saveCustomCategories(cats) {
  localStorage.setItem("rockd-custom-cats", JSON.stringify(cats));
}
function getAllCategories() {
  const builtin = [...new Set(BUILTIN_TEMPLATES.map(t => t.cat))];
  const custom  = getCustomCategories();
  // merge, dedupe, keep order
  return [...new Set([...builtin, ...custom])];
}

function renderTemplates() {
  const custom   = getCustomTemplates();
  const allTpls  = [...BUILTIN_TEMPLATES, ...custom];
  const allCats  = getAllCategories();
  const tabs     = ["All", ...allCats, "Custom"];
  const customCatSet = new Set(getCustomCategories());

  document.getElementById("content").innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div class="tabs" id="template-tabs" style="margin-bottom:0;flex-wrap:wrap">
        ${tabs.map((c, i) => `
          <div class="tab${i===0?" active":""}" data-cat="${c}" style="display:flex;align-items:center;gap:4px">
            ${c}${c==="Custom"?` (${custom.length})`:""}
            ${customCatSet.has(c) ? `<span class="cat-edit-btn" data-cat="${c}" title="Edit category" style="font-size:10px;opacity:.5;cursor:pointer;padding:0 2px">✎</span><span class="cat-delete-btn" data-cat="${c}" title="Delete category" style="font-size:10px;opacity:.5;cursor:pointer;padding:0 2px">✕</span>` : ""}
          </div>`).join("")}
        <button class="btn btn-ghost btn-sm" id="btn-add-cat" style="width:auto;padding:4px 10px;font-size:11px">＋ Category</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="btn-marketplace" style="width:auto;gap:5px">🌐 Marketplace</button>
        <button class="btn btn-ghost btn-sm" id="btn-import-template" style="width:auto">＋ Import</button>
      </div>
    </div>
    <div class="template-grid" id="template-grid">${allTpls.map(t => templateCard(t, custom.some(c=>c.id===t.id))).join("")}</div>`;

  // Tab filter
  document.querySelectorAll("#template-tabs .tab").forEach(tab => {
    tab.addEventListener("click", e => {
      if (e.target.classList.contains("cat-edit-btn") ||
          e.target.classList.contains("cat-delete-btn")) return;
      document.querySelectorAll("#template-tabs .tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const cat = tab.dataset.cat;
      let filtered;
      if      (cat === "All")    filtered = allTpls;
      else if (cat === "Custom") filtered = custom;
      else filtered = allTpls.filter(t => t.cat === cat);
      document.getElementById("template-grid").innerHTML = filtered.map(t => templateCard(t, custom.some(c=>c.id===t.id))).join("");
      bindTemplateUse();
    });
  });

  // Edit category name
  document.querySelectorAll(".cat-edit-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      showEditCategoryModal(btn.dataset.cat);
    });
  });

  // Delete category
  document.querySelectorAll(".cat-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      if (!confirm(`Delete category "${cat}"? Templates in this category won't be deleted.`)) return;
      const cats = getCustomCategories().filter(c => c !== cat);
      saveCustomCategories(cats);
      renderTemplates();
      showToast(`Category "${cat}" deleted`);
    });
  });

  // Add new category
  document.getElementById("btn-add-cat").addEventListener("click", showAddCategoryModal);
  document.getElementById("btn-import-template").addEventListener("click", showImportTemplateModal);
  document.getElementById("btn-marketplace").addEventListener("click", renderMarketplace);
  bindTemplateUse();
}

function showAddCategoryModal() {
  const existing = document.getElementById("cat-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "cat-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-title">Add Category</div>
      <div class="modal-sub">Create a new category to organise your templates.</div>
      <div class="modal-field">
        <label class="modal-label">Category name</label>
        <input id="cat-name-input" class="modal-input" placeholder="e.g. Marketing, Personal, Client Work"/>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="save-cat-btn" style="flex:1">Add Category</button>
        <button class="btn btn-ghost" id="cancel-cat-btn" style="flex:0;width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-cat-btn").addEventListener("click", () => modal.remove());
  document.getElementById("cat-name-input").focus();

  const save = () => {
    const name = document.getElementById("cat-name-input").value.trim();
    if (!name) return;
    const cats = getCustomCategories();
    if (cats.includes(name) || [...new Set(BUILTIN_TEMPLATES.map(t=>t.cat))].includes(name)) {
      document.getElementById("cat-name-input").style.borderColor = "var(--red)";
      return;
    }
    cats.push(name);
    saveCustomCategories(cats);
    modal.remove();
    renderTemplates();
    showToast(`Category "${name}" added`);
  };
  document.getElementById("save-cat-btn").addEventListener("click", save);
  document.getElementById("cat-name-input").addEventListener("keydown", e => { if (e.key === "Enter") save(); });
}

function showEditCategoryModal(oldName) {
  const existing = document.getElementById("cat-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "cat-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-title">Rename Category</div>
      <div class="modal-sub">Rename "${oldName}" — all templates in this category will update.</div>
      <div class="modal-field">
        <label class="modal-label">New name</label>
        <input id="cat-name-input" class="modal-input" value="${oldName}"/>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="save-cat-btn" style="flex:1">Rename</button>
        <button class="btn btn-ghost" id="cancel-cat-btn" style="flex:0;width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-cat-btn").addEventListener("click", () => modal.remove());
  const inp = document.getElementById("cat-name-input");
  inp.focus(); inp.select();

  const save = () => {
    const newName = inp.value.trim();
    if (!newName || newName === oldName) { modal.remove(); return; }
    // Rename in custom categories list
    const cats = getCustomCategories().map(c => c === oldName ? newName : c);
    saveCustomCategories(cats);
    // Rename in all custom templates that use this category
    const templates = getCustomTemplates().map(t => t.cat === oldName ? { ...t, cat: newName } : t);
    localStorage.setItem("rockd-custom-templates", JSON.stringify(templates));
    modal.remove();
    renderTemplates();
    showToast(`Renamed to "${newName}"`);
  };
  document.getElementById("save-cat-btn").addEventListener("click", save);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
}

function templateCard(tpl, isCustom = false) {
  const count = tpl.groups.reduce((s,g) => s+g.tasks.length, 0);
  return `<div class="template-card" data-id="${tpl.id}">
    <div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:6px">
      <div class="template-icon" style="margin-bottom:0">${tpl.icon}</div>
      ${isCustom ? `
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm publish-custom-tpl" data-id="${tpl.id}" title="Publish to marketplace" style="width:auto;padding:3px 8px;font-size:10px">🌐</button>
          <button class="btn btn-ghost btn-sm edit-custom-tpl" data-id="${tpl.id}" style="width:auto;padding:3px 8px;font-size:10px">✎</button>
          <button class="btn btn-danger btn-sm delete-custom-tpl" data-id="${tpl.id}" style="width:auto;padding:3px 8px;font-size:10px">✕</button>
        </div>` : ""}
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
  document.querySelectorAll(".edit-custom-tpl").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      showEditTemplateModal(btn.dataset.id);
    });
  });
  document.querySelectorAll(".publish-custom-tpl").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      publishToMarketplace(btn.dataset.id);
    });
  });
}

function showEditTemplateModal(tplId) {
  const tpl = getCustomTemplates().find(t => t.id === tplId);
  if (!tpl) return;
  const allCats = getAllCategories();

  const existing = document.getElementById("edit-tpl-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "edit-tpl-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-title">Edit Template</div>
      <div class="modal-field">
        <label class="modal-label">Name</label>
        <input id="etpl-name" class="modal-input" value="${tpl.name}"/>
      </div>
      <div class="modal-field" style="display:flex;gap:8px">
        <div style="flex:1">
          <label class="modal-label">Icon</label>
          <input id="etpl-icon" class="modal-input" value="${tpl.icon}" maxlength="2"/>
        </div>
        <div style="flex:2">
          <label class="modal-label">Category</label>
          <select id="etpl-cat" class="modal-input">
            ${allCats.map(c => `<option value="${c}" ${tpl.cat===c?"selected":""}>${c}</option>`).join("")}
            <option value="__new__">＋ New category…</option>
          </select>
        </div>
      </div>
      <div id="etpl-newcat-wrap" style="display:none" class="modal-field">
        <label class="modal-label">New category name</label>
        <input id="etpl-newcat" class="modal-input" placeholder="e.g. Marketing"/>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="save-etpl-btn" style="flex:1">Save changes</button>
        <button class="btn btn-ghost" id="cancel-etpl-btn" style="flex:0;width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-etpl-btn").addEventListener("click", () => modal.remove());

  document.getElementById("etpl-cat").addEventListener("change", e => {
    document.getElementById("etpl-newcat-wrap").style.display =
      e.target.value === "__new__" ? "block" : "none";
  });

  document.getElementById("save-etpl-btn").addEventListener("click", () => {
    const name    = document.getElementById("etpl-name").value.trim();
    const icon    = document.getElementById("etpl-icon").value.trim() || tpl.icon;
    let   cat     = document.getElementById("etpl-cat").value;
    if (cat === "__new__") {
      cat = document.getElementById("etpl-newcat").value.trim();
      if (!cat) return;
      const cats = getCustomCategories();
      if (!cats.includes(cat)) { cats.push(cat); saveCustomCategories(cats); }
    }
    if (!name) return;
    saveCustomTemplate({ ...tpl, name, icon, cat });
    modal.remove();
    renderTemplates();
    showToast("Template updated");
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
        <div class="progress-bar-fill${pct === 100 ? " complete" : ""}" id="progress-fill" style="width:${pct}%"></div>
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
  requestAnimationFrame(upgradeEmptyStates);
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
        <span class="group-drag-handle" title="Drag to reorder group">⠿</span>
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
          <input class="add-task-input" placeholder="Add a task…" data-group="${group.id}"/>
          <button class="add-task-btn" data-group="${group.id}" title="Add task">＋</button>
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
    <div class="task-item${task.completed ? " completed" : ""}" data-task="${task.id}" data-group="${groupId}">
      <div class="drag-handle" draggable="true" title="Drag to reorder">⠿</div>
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

  // Add task on Enter or tap ＋ button
  area.querySelectorAll(".add-task-input").forEach(inp => {
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter" && inp.value.trim()) {
        doAddTask(c.id, inp.dataset.group, inp.value.trim(), c.groups || []);
        inp.value = "";
      }
    });
  });

  area.querySelectorAll(".add-task-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const inp = area.querySelector(`.add-task-input[data-group="${btn.dataset.group}"]`);
      if (inp && inp.value.trim()) {
        doAddTask(c.id, btn.dataset.group, inp.value.trim(), c.groups || []);
        inp.value = "";
        inp.focus();
      } else if (inp) {
        inp.focus();
      }
    });
  });

  // ── Drag to reorder tasks (same group only) ────────────────────────────
  let dragSrc     = null;  // currently dragged task element
  let dragGroupId = null;  // group the drag started in

  // Drag starts on the handle element itself (draggable="true" is on .drag-handle)
  area.querySelectorAll(".drag-handle").forEach(handle => {
    const taskEl = handle.closest(".task-item");

    handle.addEventListener("dragstart", e => {
      dragSrc     = taskEl;
      dragGroupId = taskEl.dataset.group;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "task"); // needed for Firefox
      setTimeout(() => taskEl.classList.add("dragging"), 0);
    });

    handle.addEventListener("dragend", () => {
      dragSrc     = null;
      dragGroupId = null;
      area.querySelectorAll(".task-item").forEach(t => {
        t.classList.remove("drag-over");
        t.classList.remove("dragging");
      });
    });
  });

  // Drop targets are the task-items within the same group
  area.querySelectorAll(".task-item").forEach(el => {
    el.addEventListener("dragover", e => {
      if (!dragSrc || el === dragSrc) return;
      if (el.dataset.group !== dragGroupId) return; // same group only
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      area.querySelectorAll(".task-item").forEach(t => t.classList.remove("drag-over"));
      el.classList.add("drag-over");
    });

    el.addEventListener("dragleave", e => {
      if (!el.contains(e.relatedTarget)) el.classList.remove("drag-over");
    });

    el.addEventListener("drop", e => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drag-over");
      if (!dragSrc || dragSrc === el) return;
      if (el.dataset.group !== dragGroupId) return;

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
  const taskCount = groups.reduce((s,g) => s + g.tasks.length, 0);
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);

  // 🎉 Confetti when all tasks completed
  const wasComplete = c.taskCount > 0 && c.doneCount === c.taskCount;
  const nowComplete = taskCount > 0 && doneCount === taskCount;
  if (nowComplete && !wasComplete) {
    setTimeout(() => launchConfetti(), 300);
    showToast("🎉 All done! Checklist complete!");
  }

  await persistGroups(checklistId, groups, { doneCount, taskCount });
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

// ─── AI Generator Engine ──────────────────────────────────────────────────
// Smart keyword matching — no API required, instant, works offline.
// Each entry maps a topic to a suggested template structure.

const AI_KNOWLEDGE_BASE = [

  // ── Design & Development ─────────────────────────────────────────────
  { keywords: ["website", "web", "site", "landing page", "homepage", "redesign", "frontend", "ui", "ux"],
    icon: "🌐", color: "#7c6fff", cat: "Design",
    name: "Website Project",
    groups: [
      { name: "Design",    tasks: ["Wireframes & layout", "Design system / style guide", "Mobile responsive design", "Accessibility review"] },
      { name: "Build",     tasks: ["Set up project repo", "Frontend development", "CMS or backend integration", "Performance optimisation"] },
      { name: "Content",   tasks: ["Copywriting", "Image & asset sourcing", "SEO meta tags", "OG images"] },
      { name: "Launch",    tasks: ["Cross-browser testing", "Mobile testing", "DNS & hosting setup", "Go-live checklist"] }
    ]},

  { keywords: ["app", "mobile", "ios", "android", "flutter", "react native", "product", "saas", "feature"],
    icon: "📱", color: "#3d9fff", cat: "Design",
    name: "Product Launch",
    groups: [
      { name: "Pre-launch",  tasks: ["Define MVP scope", "User research & testing", "Beta invites sent", "Press kit ready"] },
      { name: "Launch",      tasks: ["Publish to stores / go live", "Announce on social media", "Email list notification", "Submit to directories & Product Hunt"] },
      { name: "Post-launch", tasks: ["Monitor crash reports & analytics", "Respond to user feedback", "Fix critical bugs", "Plan next iteration"] }
    ]},

  { keywords: ["brand", "branding", "logo", "identity", "visual", "rebrand"],
    icon: "🎨", color: "#ff6ab2", cat: "Design",
    name: "Brand Identity Project",
    groups: [
      { name: "Discovery",  tasks: ["Brand questionnaire", "Competitor analysis", "Moodboard", "Define brand values"] },
      { name: "Design",     tasks: ["Logo concepts (3 directions)", "Colour palette", "Typography system", "Brand collateral"] },
      { name: "Handoff",    tasks: ["Brand guidelines document", "Asset export (SVG, PNG, PDF)", "Final presentation", "Client sign-off"] }
    ]},

  // ── Client & Freelance ───────────────────────────────────────────────
  { keywords: ["client", "onboard", "onboarding", "kickoff", "new client", "brief"],
    icon: "🤝", color: "#00d97e", cat: "Freelance",
    name: "Client Onboarding",
    groups: [
      { name: "Admin",      tasks: ["Send welcome email", "Contract & NDA signed", "Invoice for deposit", "Schedule kickoff call"] },
      { name: "Discovery",  tasks: ["Brand questionnaire sent", "Gather assets & credentials", "Define project scope", "Set milestones & deadlines"] },
      { name: "Setup",      tasks: ["Create shared project folder", "Set up communication channel", "Add to project management tool", "Brief team if applicable"] }
    ]},

  { keywords: ["invoice", "payment", "billing", "overdue", "follow up", "chase", "money", "quote", "proposal"],
    icon: "💰", color: "#ffb020", cat: "Freelance",
    name: "Invoice & Payment",
    groups: [
      { name: "Prepare",    tasks: ["Verify deliverables are complete", "Check invoice details & amount", "Review payment terms"] },
      { name: "Send",       tasks: ["Send invoice via email", "Attach supporting documents", "Log in accounting system"] },
      { name: "Follow-up",  tasks: ["7-day payment reminder", "14-day follow-up call", "30-day final notice", "Escalate if unresolved"] }
    ]},

  { keywords: ["freelance", "project", "deliverable", "handoff", "handover", "hand off"],
    icon: "🔄", color: "#00d4d4", cat: "Freelance",
    name: "Project Handoff",
    groups: [
      { name: "Documentation", tasks: ["Write project overview doc", "Document all active tasks", "List credentials & access", "Note key decisions made"] },
      { name: "Files",         tasks: ["Organise final files", "Export all assets", "Upload to shared drive", "Remove personal accounts"] },
      { name: "Transition",    tasks: ["Schedule handoff meeting", "Walk through codebase / files", "Introduce to key contacts", "Confirm receipt & sign-off"] }
    ]},

  // ── Marketing & Content ──────────────────────────────────────────────
  { keywords: ["content", "blog", "article", "post", "publish", "write", "newsletter", "copywriting", "editorial"],
    icon: "📝", color: "#ffb020", cat: "Work",
    name: "Content Publishing",
    groups: [
      { name: "Write",      tasks: ["Research & outline", "First draft", "Editing & proofreading", "SEO keyword integration"] },
      { name: "Publish",    tasks: ["Header image created", "Meta description written", "Schedule or publish", "Canonical URL set"] },
      { name: "Promote",    tasks: ["Share on social media", "Send to email list", "Cross-post to Medium/LinkedIn", "Notify any mentioned brands"] }
    ]},

  { keywords: ["social media", "instagram", "tiktok", "twitter", "linkedin", "campaign", "marketing", "ads", "paid"],
    icon: "📣", color: "#ff4d6d", cat: "Work",
    name: "Marketing Campaign",
    groups: [
      { name: "Strategy",   tasks: ["Define campaign goal & KPIs", "Target audience research", "Budget allocation", "Platform selection"] },
      { name: "Creative",   tasks: ["Creative brief", "Copy & visuals production", "Internal review & approval", "Prepare ad sets"] },
      { name: "Launch",     tasks: ["Schedule posts / go live", "Set up tracking & UTMs", "Monitor performance daily", "Optimise based on data"] }
    ]},

  { keywords: ["event", "conference", "meetup", "webinar", "workshop", "seminar", "launch event", "party"],
    icon: "🎉", color: "#a78bfa", cat: "Work",
    name: "Event Planning",
    groups: [
      { name: "Planning",   tasks: ["Define event goal & audience", "Set date, time & format", "Book venue or platform", "Set budget"] },
      { name: "Logistics",  tasks: ["Send invitations", "Prepare agenda & run sheet", "AV & tech setup", "Catering or F&B if applicable"] },
      { name: "Post-event", tasks: ["Send thank you emails", "Share recordings or slides", "Gather feedback", "Document lessons learned"] }
    ]},

  // ── Personal & Life ──────────────────────────────────────────────────
  { keywords: ["travel", "trip", "holiday", "vacation", "fly", "flight", "packing", "pack", "luggage"],
    icon: "✈️", color: "#3d9fff", cat: "Personal",
    name: "Travel Packing",
    groups: [
      { name: "Documents",  tasks: ["Passport valid & accessible", "Visa arranged if needed", "Travel insurance", "Hotel & flight confirmations printed/saved"] },
      { name: "Clothing",   tasks: ["T-shirts", "Pants / shorts", "Underwear & socks", "Jacket or rain layer", "Smart outfit if needed"] },
      { name: "Essentials", tasks: ["Phone charger & adapter", "Power bank", "Medications", "Cash & cards", "Toiletries & sunscreen"] }
    ]},

  { keywords: ["move", "moving", "house", "apartment", "relocation", "new home", "flat"],
    icon: "🏠", color: "#00d97e", cat: "Personal",
    name: "Moving House",
    groups: [
      { name: "Before",     tasks: ["Notify landlord / end lease", "Book removalist", "Start packing non-essentials", "Update address with bank, post, etc."] },
      { name: "Moving day", tasks: ["Pack remaining items", "Clean old place", "Check all rooms & cupboards", "Hand over keys"] },
      { name: "After",      tasks: ["Unpack essentials first", "Set up internet & utilities", "Register new address", "Explore the neighbourhood"] }
    ]},

  { keywords: ["wedding", "engagement", "propose", "ceremony", "reception", "marriage", "bride", "groom"],
    icon: "💍", color: "#ff6ab2", cat: "Personal",
    name: "Wedding Planning",
    groups: [
      { name: "Early planning", tasks: ["Set overall budget", "Agree on guest list size", "Book venue", "Choose date & lock in key vendors"] },
      { name: "Details",        tasks: ["Send invitations", "Plan menu", "Order wedding cake", "Arrange flowers & decor", "Music & entertainment"] },
      { name: "Week before",    tasks: ["Final venue walkthrough", "Confirm all vendors", "Prepare payments & tips", "Pack for honeymoon"] }
    ]},

  { keywords: ["baby", "pregnancy", "newborn", "nursery", "maternity", "parental leave", "birth"],
    icon: "🍼", color: "#ffb020", cat: "Personal",
    name: "Baby Preparation",
    groups: [
      { name: "Nursery",    tasks: ["Set up cot & bedding", "Baby monitor installed", "Storage & wardrobe organised", "Baby-proof the room"] },
      { name: "Essentials", tasks: ["Nappies & wipes stocked", "Feeding supplies ready", "First aid kit", "Car seat installed & checked"] },
      { name: "Admin",      tasks: ["Maternity/paternity leave arranged", "Paediatrician selected", "Birth plan written", "Hospital bag packed"] }
    ]},

  { keywords: ["health", "fitness", "gym", "workout", "diet", "nutrition", "weight", "exercise", "run", "marathon"],
    icon: "💪", color: "#00d97e", cat: "Personal",
    name: "Fitness Goal",
    groups: [
      { name: "Plan",       tasks: ["Define specific goal & timeline", "Book gym or classes", "Create weekly schedule", "Plan meals & nutrition"] },
      { name: "Weekly",     tasks: ["Monday workout", "Wednesday workout", "Friday workout", "Weekly weigh-in or check-in"] },
      { name: "Track",      tasks: ["Log workouts", "Take progress photos", "Review & adjust plan", "Celebrate milestones"] }
    ]},

  // ── Work & Teams ─────────────────────────────────────────────────────
  { keywords: ["sprint", "agile", "scrum", "standup", "backlog", "kanban", "jira", "ticket", "story"],
    icon: "🏃", color: "#7c6fff", cat: "Work",
    name: "Sprint Planning",
    groups: [
      { name: "Planning",   tasks: ["Review & groom backlog", "Agree sprint goal", "Assign tickets to team", "Estimate story points"] },
      { name: "Sprint",     tasks: ["Daily standups", "Unblock team issues", "Mid-sprint review", "Update ticket statuses"] },
      { name: "Wrap-up",    tasks: ["Sprint demo / review", "Retrospective", "Update documentation", "Prep next sprint backlog"] }
    ]},

  { keywords: ["hire", "hiring", "recruit", "recruitment", "interview", "job", "candidate", "onboard employee"],
    icon: "👥", color: "#3d9fff", cat: "Work",
    name: "Hiring Pipeline",
    groups: [
      { name: "Sourcing",   tasks: ["Write & post job description", "Share on LinkedIn & job boards", "Screen incoming applications", "Shortlist candidates"] },
      { name: "Interviews", tasks: ["Schedule first round interviews", "Prepare interview questions", "Conduct technical assessment", "Reference checks"] },
      { name: "Offer",      tasks: ["Prepare offer letter", "Negotiate & confirm", "Initiate onboarding process", "Set up accounts & access"] }
    ]},

  { keywords: ["weekly review", "review", "retrospective", "reflect", "reflection", "planning", "goals", "week"],
    icon: "📅", color: "#a78bfa", cat: "Personal",
    name: "Weekly Review",
    groups: [
      { name: "Review",     tasks: ["What did I complete this week?", "What didn't get done and why?", "Energy & focus level review", "Wins worth celebrating"] },
      { name: "Plan",       tasks: ["Top 3 goals for next week", "Any blockers to address early", "Schedule key tasks in calendar", "Anything to delegate or drop?"] }
    ]},

  { keywords: ["research", "study", "thesis", "dissertation", "paper", "academic", "assignment", "university"],
    icon: "🎓", color: "#00d4d4", cat: "Work",
    name: "Research Project",
    groups: [
      { name: "Setup",      tasks: ["Define research question", "Literature review", "Methodology decided", "Ethics approval if needed"] },
      { name: "Research",   tasks: ["Data collection", "Interviews or surveys", "Data analysis", "Find supporting evidence"] },
      { name: "Write-up",   tasks: ["Draft introduction", "Draft main body", "Draft conclusion", "Proofread & format citations"] }
    ]},

  // ── Catch-all / generic ──────────────────────────────────────────────
  { keywords: ["plan", "planning", "prepare", "preparation", "organise", "organize", "manage", "checklist"],
    icon: "📋", color: "#7c6fff", cat: "Work",
    name: "Project Plan",
    groups: [
      { name: "Define",     tasks: ["Set clear goal & success criteria", "Identify stakeholders", "Scope & constraints", "Timeline & milestones"] },
      { name: "Execute",    tasks: ["Kick off work", "Track progress weekly", "Manage blockers", "Communicate updates"] },
      { name: "Close",      tasks: ["Final review", "Document outcomes", "Share learnings", "Celebrate completion"] }
    ]}
];

// ─── Scoring engine ────────────────────────────────────────────────────────
function scoreMatch(input, entry) {
  const words = input.toLowerCase().split(/\s+/);
  let score = 0;
  for (const kw of entry.keywords) {
    const kwWords = kw.split(' ');
    // Exact phrase match scores higher
    if (input.toLowerCase().includes(kw)) {
      score += kwWords.length > 1 ? 10 : 5;
    } else {
      // Partial word match
      for (const w of words) {
        if (kw.includes(w) || w.includes(kw.split(' ')[0])) score += 1;
      }
    }
  }
  return score;
}

function generateFromPrompt(input) {
  if (!input.trim()) return null;

  // Score all entries
  const scored = AI_KNOWLEDGE_BASE.map(entry => ({
    entry,
    score: scoreMatch(input, entry)
  })).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  const best = scored[0].entry;

  // Derive a smart name from the input
  // Capitalise each word, strip filler words
  const fillers = new Set(["a","an","the","to","for","on","in","at","of","and","or","my","our","some","plan","make","create","build","start","set","up","me","i","want","need","help"]);
  const nameParts = input.trim().split(/\s+/)
    .filter(w => !fillers.has(w.toLowerCase()))
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const smartName = nameParts.length
    ? nameParts.join(" ")
    : best.name;

  return {
    name:   smartName || best.name,
    icon:   best.icon,
    color:  best.color,
    groups: best.groups.map((g, gi) => ({
      id:        `g${gi}_${Date.now()}`,
      name:      g.name,
      collapsed: false,
      tasks:     g.tasks.map((t, ti) => ({
        id:        `t${gi}_${ti}_${Date.now()}`,
        text:      t,
        completed: false,
        priority:  "medium",
        date:      null
      }))
    }))
  };
}

// ─── Prompt suggestions ────────────────────────────────────────────────────
const PROMPT_SUGGESTIONS = [
  "Plan a client website project",
  "Prepare for a product launch",
  "Organise a team handoff",
  "Pack for a holiday trip",
  "Set up a weekly review routine",
  "Manage a social media campaign",
  "Hire a new team member",
  "Prepare for a baby",
  "Plan a wedding",
  "Track a fitness goal"
];

// ─── New Checklist modal — unified design ─────────────────────────────────
function showNewChecklistModal() {
  const COLORS = ["#7c6fff","#00d97e","#3d9fff","#ffb020","#ff4d6d","#ff6ab2","#00d4d4"];
  const existing = document.getElementById("new-checklist-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "new-checklist-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal" style="max-width:520px">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div class="modal-title" style="margin-bottom:0">✦ New Checklist</div>
        <button class="btn btn-ghost btn-icon" id="cancel-cl-btn" style="width:30px;height:30px;flex-shrink:0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Name field — always visible -->
      <div class="modal-field">
        <label class="modal-label">Name</label>
        <input id="new-cl-name" class="modal-input" placeholder="e.g. Website Redesign"/>
      </div>

      <!-- AI prompt section — collapsible feel via toggle -->
      <div class="ncl-ai-section" id="ncl-ai-section">
        <button class="ncl-ai-toggle" id="ncl-ai-toggle">
          <span class="ncl-ai-toggle-icon">✦</span>
          <span id="ncl-ai-toggle-label">Generate with AI</span>
          <svg class="ncl-chevron" id="ncl-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        <div id="ncl-ai-body" style="display:none;margin-top:10px">
          <textarea id="ai-prompt" class="modal-input" rows="2"
            placeholder="Describe what you want to achieve…"
            style="resize:none;line-height:1.6;margin-bottom:8px"></textarea>

          <!-- Suggestion chips -->
          <div class="prompt-suggestions" style="margin-top:0;margin-bottom:12px">
            ${PROMPT_SUGGESTIONS.slice(0,5).map(s =>
              `<button class="prompt-chip" data-prompt="${s}">${s}</button>`
            ).join("")}
          </div>

          <button class="btn btn-ghost btn-sm" id="ai-generate-btn" style="width:100%;justify-content:center;gap:6px;border-color:var(--accent);color:var(--accent)">
            ✦ Generate structure
          </button>

          <!-- Preview — shown after generation -->
          <div id="ai-preview" style="display:none;margin-top:14px;border:1px solid var(--border2);border-radius:var(--radius-sm);overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg3);border-bottom:1px solid var(--border)">
              <div style="display:flex;align-items:center;gap:8px">
                <span id="preview-icon" style="font-size:1.38rem">📋</span>
                <div>
                  <div id="preview-name-label" style="font-size:0.92rem;font-weight:700;color:var(--text)"></div>
                  <div id="preview-meta" style="font-size:0.77rem;color:var(--text3);font-family:var(--mono)"></div>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm" id="ai-regenerate-btn" style="width:auto;padding:4px 10px;font-size:0.77rem">↻ Retry</button>
            </div>
            <div id="preview-groups" style="padding:10px 12px;max-height:180px;overflow-y:auto;background:var(--bg2)"></div>
          </div>

          <!-- No match -->
          <div id="ai-no-match" style="display:none;text-align:center;padding:16px 0;font-size:0.92rem;color:var(--text3)">
            🤔 No match — try different words, or just fill in the name above.
          </div>
        </div>
      </div>

      <!-- Colour -->
      <div class="modal-field" style="margin-top:14px">
        <label class="modal-label">Colour</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap" id="color-swatches-row">
          ${COLORS.map((c,i) => `
            <div class="color-swatch" data-color="${c}"
                 style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;
                        border:2px solid ${i===0?"white":"transparent"};transition:all .15s"></div>`).join("")}
        </div>
      </div>

      <!-- Create button -->
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-primary" id="create-cl-btn" style="flex:1">Create</button>
      </div>

    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("cancel-cl-btn").addEventListener("click", () => modal.remove());
  if (window.innerWidth > 768) setTimeout(() => document.getElementById("new-cl-name")?.focus(), 50);

  // ── Colour picker ──────────────────────────────────────────────────────
  let selectedColor    = COLORS[0];
  let generatedGroups  = [];

  modal.querySelectorAll(".color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      modal.querySelectorAll(".color-swatch").forEach(s => s.style.borderColor = "transparent");
      sw.style.borderColor = "white";
      selectedColor = sw.dataset.color;
    });
  });

  // ── AI toggle ─────────────────────────────────────────────────────────
  let aiOpen = false;
  document.getElementById("ncl-ai-toggle").addEventListener("click", () => {
    aiOpen = !aiOpen;
    document.getElementById("ncl-ai-body").style.display   = aiOpen ? "block" : "none";
    document.getElementById("ncl-chevron").style.transform = aiOpen ? "rotate(180deg)" : "";
    document.getElementById("ncl-ai-toggle-label").textContent = aiOpen ? "Generate with AI" : "Generate with AI";
    if (aiOpen && window.innerWidth > 768) setTimeout(() => document.getElementById("ai-prompt")?.focus(), 50);
  });

  // ── Suggestion chips ───────────────────────────────────────────────────
  modal.querySelectorAll(".prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("ai-prompt").value = chip.dataset.prompt;
      runGenerate();
    });
  });

  // ── Generate ───────────────────────────────────────────────────────────
  let generatedData = null;

  const runGenerate = () => {
    const prompt = document.getElementById("ai-prompt").value.trim();
    if (!prompt) return;

    const btn = document.getElementById("ai-generate-btn");
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px"></div>Generating…';

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = "✦ Generate structure";

      generatedData = generateFromPrompt(prompt);

      if (!generatedData) {
        document.getElementById("ai-preview").style.display  = "none";
        document.getElementById("ai-no-match").style.display = "block";
        return;
      }

      document.getElementById("ai-no-match").style.display  = "none";
      document.getElementById("ai-preview").style.display   = "block";

      // Auto-fill name if empty
      const nameInput = document.getElementById("new-cl-name");
      if (!nameInput.value.trim()) nameInput.value = generatedData.name;

      // Auto-select the generated colour
      selectedColor = generatedData.color;
      modal.querySelectorAll(".color-swatch").forEach(s => {
        s.style.borderColor = s.dataset.color === selectedColor ? "white" : "transparent";
      });

      // Preview header
      document.getElementById("preview-icon").textContent       = generatedData.icon;
      document.getElementById("preview-name-label").textContent = generatedData.name;
      const total = generatedData.groups.reduce((s,g) => s + g.tasks.length, 0);
      document.getElementById("preview-meta").textContent =
        `${generatedData.groups.length} groups · ${total} tasks generated`;

      // Preview groups
      document.getElementById("preview-groups").innerHTML = generatedData.groups.map(g => `
        <div style="margin-bottom:10px">
          <div style="font-size:0.77rem;font-weight:700;color:var(--text3);text-transform:uppercase;
                      letter-spacing:0.8px;font-family:var(--mono);margin-bottom:4px">${g.name}</div>
          ${g.tasks.map(t => `
            <div style="display:flex;align-items:center;gap:7px;padding:2px 0;font-size:0.85rem;color:var(--text2)">
              <div style="width:12px;height:12px;border-radius:3px;border:1.5px solid var(--border3);flex-shrink:0"></div>
              ${t.text}
            </div>`).join("")}
        </div>`).join("");

    }, 500);
  };

  document.getElementById("ai-generate-btn").addEventListener("click", runGenerate);
  document.getElementById("ai-prompt").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runGenerate();
  });

  // Retry
  document.getElementById("ai-regenerate-btn")?.addEventListener("click", () => {
    document.getElementById("ai-preview").style.display  = "none";
    document.getElementById("ai-no-match").style.display = "none";
    generatedData = null;
    document.getElementById("new-cl-name").value = "";
    document.getElementById("ai-prompt").focus();
  });

  // ── Create ─────────────────────────────────────────────────────────────
  const doCreate = async () => {
    const name = document.getElementById("new-cl-name").value.trim();
    if (!name) {
      document.getElementById("new-cl-name").style.borderColor = "var(--red)";
      document.getElementById("new-cl-name").focus();
      return;
    }
    document.getElementById("new-cl-name").style.borderColor = "";
    modal.remove();
    const groups = generatedData ? generatedData.groups : [];
    const icon   = generatedData ? generatedData.icon   : "";
    await doCreateChecklist({ name, color: selectedColor, icon, groups });
  };

  document.getElementById("create-cl-btn").addEventListener("click", doCreate);
  document.getElementById("new-cl-name").addEventListener("keydown", e => {
    if (e.key === "Enter") doCreate();
  });
}

// ─── Shared create helper ──────────────────────────────────────────────────
async function doCreateChecklist({ name, color, icon, groups }) {
  const taskCount = groups.reduce((s, g) => s + g.tasks.length, 0);

  if (isGuest) {
    const newList = {
      id: "guest_" + Date.now(), ownerUid: "guest",
      name, color, icon: icon || "",
      priority: "medium", pinned: false, archived: false,
      taskCount, doneCount: 0, groups,
      collaborators: [], tags: [],
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
      ownerUid: currentUser.uid, name, color, icon: icon || "",
      priority: "medium", pinned: false, archived: false,
      taskCount, doneCount: 0, groups,
      collaborators: [], tags: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    showToast(`"${name}" created!`);
    setView("detail", ref.id);
  } catch (err) {
    console.error(err);
    showToast("Failed to create checklist", "error");
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────


const DEFAULT_PREFS = {
  theme:       "dark",
  fontSize:    "normal",
  accentColor: "#7c6fff",
  displayName: "",
  avatarUrl:   ""
};

let userPrefs = { ...DEFAULT_PREFS };

// Load prefs on init — called after initApp
export async function loadUserPrefs(user) {
  if (!user) return; // guest — use localStorage
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      userPrefs = { ...DEFAULT_PREFS, ...snap.data() };
      applyPrefs();
    }
  } catch(e) { console.warn("Could not load prefs", e); }
}

function applyPrefs() {
  // Accent colour — set on :root so it overrides both dark AND light theme values
  const root = document.documentElement;
  root.style.setProperty("--accent",      userPrefs.accentColor);
  root.style.setProperty("--accent2",     shadeColor(userPrefs.accentColor, -20));
  root.style.setProperty("--accent-glow", hexToRgba(userPrefs.accentColor, 0.15));

  // Font size — set a root px size, then all CSS uses rem so everything scales
  const rootSizes = { small: "11px", normal: "13px", large: "15px" };
  root.style.fontSize = rootSizes[userPrefs.fontSize] || "13px";
  // Store as attribute for CSS selectors if needed
  root.setAttribute("data-font-size", userPrefs.fontSize || "normal");

  // Theme — sync isDark var and apply
  if (userPrefs.theme) {
    isDark = userPrefs.theme !== "light";
    document.body.classList.toggle("light", !isDark);
    const knob = document.getElementById("theme-knob");
    if (knob) knob.style.left = isDark ? "2px" : "18px";
    localStorage.setItem("rockd-theme", userPrefs.theme);
  }
}

async function savePrefs(changes) {
  userPrefs = { ...userPrefs, ...changes };
  applyPrefs();
  if (isGuest) {
    localStorage.setItem("rockd-guest-prefs", JSON.stringify(userPrefs));
    return;
  }
  try {
    await setDoc(doc(db, "users", currentUser.uid), userPrefs, { merge: true });
  } catch(e) { console.error("Failed to save prefs", e); showToast("Failed to save settings", "error"); }
}

// Colour helpers
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function shadeColor(hex, pct) {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * pct);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const B = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return `#${((1<<24)+(R<<16)+(G<<8)+B).toString(16).slice(1)}`;
}

function renderSettings() {
  const ACCENT_PRESETS = [
    "#7c6fff","#5a3fff","#ff4d6d","#ff6ab2","#ffb020",
    "#00d97e","#3d9fff","#00d4d4","#a78bfa","#f97316"
  ];
  const FONT_SIZES = [
    { id: "small",  label: "Small",  desc: "Compact, more on screen" },
    { id: "normal", label: "Normal", desc: "Default size" },
    { id: "large",  label: "Large",  desc: "Easier to read" }
  ];

  document.getElementById("content").innerHTML = `
    <div style="max-width:560px;margin:0 auto">

      <!-- Profile -->
      <div class="settings-section">
        <div class="settings-section-title">Profile</div>
        <div class="settings-card">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
            <div class="avatar" id="settings-avatar" style="width:52px;height:52px;font-size:18px">
              ${currentUser?.photoURL
                ? `<img src="${currentUser.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
                : (userPrefs.displayName || currentUser?.displayName || "?")[0].toUpperCase()}
            </div>
            <div>
              <div style="font-size:15px;font-weight:700">${userPrefs.displayName || currentUser?.displayName || "Guest"}</div>
              <div style="font-size:12px;color:var(--text3)">${currentUser?.email || "Guest mode"}</div>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Display name</label>
            <input id="pref-name" class="modal-input" value="${userPrefs.displayName || currentUser?.displayName || ""}" placeholder="Your name"/>
          </div>
          <button class="btn btn-primary btn-sm" id="save-profile-btn" style="width:auto">Save profile</button>
        </div>
      </div>

      <!-- Appearance -->
      <div class="settings-section">
        <div class="settings-section-title">Appearance</div>
        <div class="settings-card">

          <div class="settings-row">
            <div>
              <div class="settings-label">Theme</div>
              <div class="settings-desc">Light or dark interface</div>
            </div>
            <button class="theme-btn" id="settings-theme-toggle" title="Toggle theme" style="width:44px;height:24px">
              <div class="theme-btn-knob" id="settings-theme-knob" style="left:${isDark?"2px":"22px"};width:18px;height:18px;top:2px"></div>
            </button>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-label" style="margin-bottom:10px">Font size</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${FONT_SIZES.map(f => `
              <button class="font-size-btn${userPrefs.fontSize===f.id?" active":""}" data-size="${f.id}">
                <span style="font-size:${f.id==="small"?"11px":f.id==="large"?"16px":"13px"};font-weight:600">Aa</span>
                <span style="font-size:10px;color:var(--text3);margin-top:2px">${f.label}</span>
              </button>`).join("")}
          </div>

          <div class="settings-divider"></div>

          <div class="settings-label" style="margin-bottom:10px">Accent colour</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap" id="accent-swatches">
            ${ACCENT_PRESETS.map(c => `
              <div class="accent-swatch${userPrefs.accentColor===c?" selected":""}" data-color="${c}"
                   style="background:${c};width:28px;height:28px;border-radius:50%;cursor:pointer;
                          border:2px solid ${userPrefs.accentColor===c?"white":"transparent"};
                          transition:all .15s;box-shadow:${userPrefs.accentColor===c?"0 0 0 2px "+c:"none"}">
              </div>`).join("")}
            <div style="position:relative">
              <input type="color" id="accent-custom" value="${userPrefs.accentColor}"
                     style="width:28px;height:28px;border-radius:50%;cursor:pointer;border:2px solid var(--border2);padding:0;background:none"/>
            </div>
          </div>

        </div>
      </div>

      ${!isGuest ? `
      <!-- Danger zone -->
      <div class="settings-section">
        <div class="settings-section-title" style="color:var(--red)">Danger zone</div>
        <div class="settings-card" style="border-color:rgba(255,77,109,.2)">
          <div class="settings-row">
            <div>
              <div class="settings-label">Sign out</div>
              <div class="settings-desc">Sign out from this device</div>
            </div>
            <button class="btn btn-ghost btn-sm" id="settings-signout" style="width:auto">Sign out</button>
          </div>
        </div>
      </div>` : `
      <!-- Guest banner -->
      <div class="settings-card" style="border-color:rgba(255,176,32,.3);background:rgba(255,176,32,.06);text-align:center;padding:20px">
        <div style="font-size:18px;margin-bottom:8px">👀</div>
        <div style="font-size:13px;font-weight:700;margin-bottom:4px">You're in Guest mode</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Settings won't sync across devices. Create an account to save everything.</div>
        <a href="." class="btn btn-primary btn-sm" style="width:auto;display:inline-flex">Create account</a>
      </div>`}

    </div>`;

  // Profile save
  document.getElementById("save-profile-btn")?.addEventListener("click", async () => {
    const name = document.getElementById("pref-name").value.trim();
    if (!name) return;
    await savePrefs({ displayName: name });
    document.getElementById("sidebar-name").textContent = name;
    showToast("Profile updated");
  });

  // Theme toggle in settings
  document.getElementById("settings-theme-toggle")?.addEventListener("click", () => {
    isDark = !isDark;
    applyTheme();
    const knob = document.getElementById("settings-theme-knob");
    if (knob) knob.style.left = isDark ? "2px" : "22px";
    savePrefs({ theme: isDark ? "dark" : "light" });
  });

  // Font size
  document.querySelectorAll(".font-size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".font-size-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      savePrefs({ fontSize: btn.dataset.size });
      showToast(`Font size: ${btn.dataset.size}`);
    });
  });

  // Accent swatches
  document.querySelectorAll(".accent-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      document.querySelectorAll(".accent-swatch").forEach(s => {
        s.style.borderColor = "transparent";
        s.style.boxShadow   = "none";
        s.classList.remove("selected");
      });
      sw.style.borderColor = "white";
      sw.style.boxShadow   = `0 0 0 2px ${sw.dataset.color}`;
      sw.classList.add("selected");
      savePrefs({ accentColor: sw.dataset.color });
    });
  });

  // Custom colour picker
  document.getElementById("accent-custom")?.addEventListener("input", e => {
    document.querySelectorAll(".accent-swatch").forEach(s => {
      s.style.borderColor = "transparent"; s.style.boxShadow = "none";
    });
    savePrefs({ accentColor: e.target.value });
  });

  // Sign out
  document.getElementById("settings-signout")?.addEventListener("click", async () => {
    const { logout: lo } = await import("./auth.js");
    await lo();
    document.getElementById("auth-screen").style.display = "flex";
    document.getElementById("app").style.display = "none";
  });
}

// ─── Confetti ──────────────────────────────────────────────────────────────
// Pure canvas confetti — no library, no CDN dependency
function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.id = "confetti-canvas";
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);

  const ctx    = canvas.getContext("2d");
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const COLORS  = ["#7c6fff","#00d97e","#ffb020","#ff4d6d","#3d9fff","#ff6ab2","#ffffff","#a78bfa"];
  const SHAPES  = ["rect", "circle", "ribbon"];
  const TOTAL   = 140;
  const GRAVITY = 0.35;
  const DRAG    = 0.97;

  const particles = Array.from({ length: TOTAL }, () => ({
    x:    Math.random() * canvas.width,
    y:    Math.random() * canvas.height * -0.6 - 20,
    vx:   (Math.random() - 0.5) * 7,
    vy:   Math.random() * -6 - 3,
    rot:  Math.random() * 360,
    rotV: (Math.random() - 0.5) * 8,
    w:    Math.random() * 10 + 5,
    h:    Math.random() * 6 + 3,
    color:  COLORS[Math.floor(Math.random() * COLORS.length)],
    shape:  SHAPES[Math.floor(Math.random() * SHAPES.length)],
    alpha:  1,
    decay:  Math.random() * 0.012 + 0.008
  }));

  let frame;
  const DURATION = 3200;
  const start    = performance.now();

  function draw(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
      p.vy  += GRAVITY;
      p.vx  *= DRAG;
      p.vy  *= DRAG;
      p.x   += p.vx;
      p.y   += p.vy;
      p.rot += p.rotV;

      // Fade out in last 800ms
      if (elapsed > DURATION - 800) p.alpha = Math.max(0, p.alpha - p.decay * 2);

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;

      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === "ribbon") {
        ctx.fillRect(-p.w / 2, -p.h / 4, p.w, p.h / 2);
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    });

    if (elapsed < DURATION) {
      frame = requestAnimationFrame(draw);
    } else {
      cancelAnimationFrame(frame);
      canvas.remove();
    }
  }

  frame = requestAnimationFrame(draw);
  // Cleanup safety
  setTimeout(() => { cancelAnimationFrame(frame); canvas.remove(); }, DURATION + 200);
}

// ─── Offline banner ────────────────────────────────────────────────────────
(function initOfflineBanner() {
  const banner = document.createElement("div");
  banner.id = "offline-banner";
  banner.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
    You're offline — changes will sync when you reconnect`;
  banner.style.cssText = `
    display:none; position:fixed; top:0; left:0; right:0; z-index:1000;
    background:#1a1520; border-bottom:1px solid rgba(255,176,32,.3);
    color:#ffb020; font-size:0.85rem; font-family:var(--mono);
    padding:9px 20px; text-align:center;
    align-items:center; justify-content:center; gap:8px;
    transition:transform .3s ease;`;

  document.body.appendChild(banner);

  function setOnline(online) {
    if (online) {
      banner.style.display = "none";
      // Push main content back down
      const app = document.getElementById("app");
      if (app) app.style.marginTop = "";
    } else {
      banner.style.display = "flex";
      const app = document.getElementById("app");
      if (app) app.style.marginTop = "40px";
    }
  }

  window.addEventListener("online",  () => {
    setOnline(true);
    showToast("Back online — syncing…");
  });
  window.addEventListener("offline", () => setOnline(false));
  // Set initial state
  if (!navigator.onLine) setOnline(false);
})();

// ─── Empty state illustrations ─────────────────────────────────────────────
// SVG illustrations injected into empty states for each view

const EMPTY_STATES = {
  dashboard: {
    svg: `<svg width="120" height="100" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="20" width="45" height="55" rx="6" fill="var(--bg3)" stroke="var(--border2)" stroke-width="1.5"/>
      <rect x="65" y="20" width="45" height="55" rx="6" fill="var(--bg3)" stroke="var(--border2)" stroke-width="1.5"/>
      <rect x="18" y="30" width="28" height="3" rx="1.5" fill="var(--border3)"/>
      <rect x="18" y="38" width="20" height="2" rx="1" fill="var(--border2)"/>
      <rect x="18" y="44" width="24" height="2" rx="1" fill="var(--border2)"/>
      <rect x="18" y="57" width="29" height="3" rx="1.5" fill="var(--accent)" opacity=".3"/>
      <rect x="73" y="30" width="28" height="3" rx="1.5" fill="var(--border3)"/>
      <rect x="73" y="38" width="20" height="2" rx="1" fill="var(--border2)"/>
      <rect x="73" y="44" width="24" height="2" rx="1" fill="var(--border2)"/>
      <rect x="73" y="57" width="29" height="3" rx="1.5" fill="var(--green)" opacity=".3"/>
      <!-- Plus button -->
      <circle cx="60" cy="85" r="12" fill="var(--accent)" opacity=".15"/>
      <line x1="60" y1="79" x2="60" y2="91" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
      <line x1="54" y1="85" x2="66" y2="85" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    title: "No checklists yet",
    sub:   "Click <strong>✦ New Checklist</strong> to get started, or pick a template to hit the ground running."
  },

  archive: {
    svg: `<svg width="100" height="90" viewBox="0 0 100 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="32" width="70" height="48" rx="5" fill="var(--bg3)" stroke="var(--border2)" stroke-width="1.5"/>
      <rect x="10" y="22" width="80" height="14" rx="4" fill="var(--bg3)" stroke="var(--border2)" stroke-width="1.5"/>
      <rect x="38" y="26" width="24" height="6" rx="3" fill="var(--border3)"/>
      <line x1="30" y1="50" x2="70" y2="50" stroke="var(--border2)" stroke-width="1.5" stroke-dasharray="4 3"/>
      <line x1="30" y1="60" x2="70" y2="60" stroke="var(--border2)" stroke-width="1.5" stroke-dasharray="4 3"/>
      <line x1="30" y1="70" x2="55" y2="70" stroke="var(--border2)" stroke-width="1.5" stroke-dasharray="4 3"/>
    </svg>`,
    title: "Archive is empty",
    sub:   "Checklists you archive will appear here — out of sight but never deleted."
  },

  detail_empty: {
    svg: `<svg width="100" height="90" viewBox="0 0 100 90" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="15" width="60" height="65" rx="6" fill="var(--bg3)" stroke="var(--border2)" stroke-width="1.5"/>
      <rect x="30" y="27" width="15" height="3" rx="1.5" fill="var(--accent)" opacity=".5"/>
      <rect x="30" y="35" width="38" height="2" rx="1" fill="var(--border2)"/>
      <rect x="30" y="41" width="30" height="2" rx="1" fill="var(--border2)"/>
      <rect x="30" y="53" width="15" height="3" rx="1.5" fill="var(--green)" opacity=".5"/>
      <rect x="30" y="61" width="38" height="2" rx="1" fill="var(--border2)"/>
      <!-- Dashed add row -->
      <rect x="28" y="72" width="44" height="5" rx="2.5" fill="none" stroke="var(--border3)" stroke-width="1" stroke-dasharray="3 2"/>
    </svg>`,
    title: "No tasks yet",
    sub:   'Click <strong>＋ Add Group</strong> below to create your first group, then add tasks inside it.'
  }
};

// Patch renderDashboard, renderArchive, and renderDetail empty states
// Called after initial render — swaps plain text empty states with illustrated ones
function upgradeEmptyStates() {
  const content = document.getElementById("content");
  if (!content) return;

  content.querySelectorAll(".empty-state").forEach(el => {
    const icon  = el.querySelector(".empty-state-icon");
    const title = el.querySelector(".empty-state-title")?.textContent?.trim();

    let key = null;
    if (title === "No checklists yet")  key = "dashboard";
    if (title === "Archive is empty")   key = "archive";
    if (title === "No tasks yet")       key = "detail_empty";

    if (!key || !EMPTY_STATES[key]) return;

    const es = EMPTY_STATES[key];
    el.innerHTML = `
      <div class="empty-state-svg">${es.svg}</div>
      <div class="empty-state-title">${es.title}</div>
      <div class="empty-state-sub">${es.sub}</div>`;
  });
}

// upgradeEmptyStates() is called directly inside each render function below

// ─── Template Marketplace ──────────────────────────────────────────────────
// Community templates stored in Firestore under /community_templates
// Publishing: copies a local template to Firestore with isPublic:true
// Browsing: reads all public templates, sorted by usageCount desc

import {
  collection as fsCollection,
  getDocs, query as fsQuery,
  orderBy as fsOrderBy, limit as fsLimit,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const COMMUNITY_COL = "community_templates";

// ── Publish a local template to the marketplace ────────────────────────────
async function publishToMarketplace(tplId) {
  const tpl = getCustomTemplates().find(t => t.id === tplId);
  if (!tpl) return;

  if (isGuest) { showToast("Sign in to publish templates", "error"); return; }

  const existing = document.getElementById("publish-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "publish-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-title">Publish to Marketplace</div>
      <div class="modal-sub">Share <strong>${tpl.name}</strong> with the Rockd community.</div>

      <div class="modal-field">
        <label class="modal-label">Display name</label>
        <input id="pub-name" class="modal-input" value="${tpl.name}"/>
      </div>
      <div class="modal-field">
        <label class="modal-label">Description <span style="color:var(--text3)">(optional)</span></label>
        <textarea id="pub-desc" class="modal-input" rows="2" placeholder="What is this template good for?" style="resize:none"></textarea>
      </div>
      <div class="modal-field">
        <label class="modal-label">Category</label>
        <input id="pub-cat" class="modal-input" value="${tpl.cat || "Work"}"/>
      </div>

      <div style="padding:10px 12px;background:var(--bg3);border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:16px">
        <div style="font-size:0.85rem;color:var(--text3);line-height:1.6">
          Publishing makes this template visible to all Rockd users. Your display name will be shown as the author.
          You can remove it from the marketplace at any time.
        </div>
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" id="pub-confirm-btn" style="flex:1">🌐 Publish</button>
        <button class="btn btn-ghost" id="pub-cancel-btn" style="width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("pub-cancel-btn").addEventListener("click", () => modal.remove());

  document.getElementById("pub-confirm-btn").addEventListener("click", async () => {
    const name = document.getElementById("pub-name").value.trim();
    const desc = document.getElementById("pub-desc").value.trim();
    const cat  = document.getElementById("pub-cat").value.trim() || tpl.cat;
    if (!name) return;

    const btn = document.getElementById("pub-confirm-btn");
    btn.disabled = true;
    btn.textContent = "Publishing…";

    try {
      await setDoc(doc(db, COMMUNITY_COL, `${currentUser.uid}_${tpl.id}`), {
        name, desc, cat,
        icon:        tpl.icon  || "📋",
        color:       tpl.color || "#7c6fff",
        groups:      tpl.groups,
        authorUid:   currentUser.uid,
        authorName:  userPrefs.displayName || currentUser.displayName || "Anonymous",
        usageCount:  0,
        publishedAt: serverTimestamp()
      });
      modal.remove();
      showToast(`"${name}" published to marketplace! 🌐`);
    } catch(err) {
      console.error(err);
      showToast("Failed to publish", "error");
      btn.disabled = false;
      btn.textContent = "🌐 Publish";
    }
  });
}

// ── Browse marketplace ─────────────────────────────────────────────────────
async function renderMarketplace() {
  const content = document.getElementById("content");
  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost btn-sm" id="btn-market-back" style="width:auto;gap:6px;padding:6px 12px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Templates
        </button>
        <div>
          <div style="font-size:1.08rem;font-weight:700">🌐 Marketplace</div>
          <div style="font-size:0.77rem;color:var(--text3);margin-top:1px">Community-shared templates</div>
        </div>
      </div>
      <input id="market-search" class="modal-input" placeholder="Search templates…"
             style="width:180px;padding:7px 12px;font-size:0.85rem"/>
    </div>
    <div id="market-grid" class="template-grid">
      <div class="loading-dots"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div>
    </div>`;

  // Wire back button after full innerHTML is set
  document.getElementById("btn-market-back").addEventListener("click", () => setView("templates"));

  let allMarket = [];
  try {
    const q    = fsQuery(fsCollection(db, COMMUNITY_COL), fsOrderBy("usageCount","desc"), fsLimit(60));
    const snap = await getDocs(q);
    allMarket  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(err) {
    console.error("Marketplace load failed:", err);
    document.getElementById("market-grid").innerHTML =
      `<div class="empty-state" style="grid-column:1/-1">
         <div class="empty-state-icon">😕</div>
         <div class="empty-state-title">Couldn't load marketplace</div>
         <div class="empty-state-sub">Check your connection and try again.</div>
       </div>`;
    return;
  }

  const renderGrid = (items) => {
    if (!items.length) {
      document.getElementById("market-grid").innerHTML =
        `<div class="empty-state" style="grid-column:1/-1">
           <div class="empty-state-icon">🌐</div>
           <div class="empty-state-title">No templates yet</div>
           <div class="empty-state-sub">Be the first to publish one from your Templates page.</div>
         </div>`;
      return;
    }
    document.getElementById("market-grid").innerHTML = items.map(t => `
      <div class="template-card market-card" data-id="${t.id}">
        <div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:1.54rem">${t.icon || "📋"}</div>
          <span style="font-size:0.69rem;font-family:var(--mono);color:var(--text3);background:var(--bg4);
                       padding:2px 7px;border-radius:20px;border:1px solid var(--border)">
            ${t.usageCount || 0} uses
          </span>
        </div>
        <div class="template-name">${t.name}</div>
        <div class="template-cat" style="margin-bottom:4px">${t.cat} · ${(t.groups||[]).reduce((s,g)=>s+(g.tasks||[]).length,0)} tasks</div>
        ${t.desc ? `<div style="font-size:0.77rem;color:var(--text3);line-height:1.5;margin-bottom:8px">${t.desc}</div>` : ""}
        <div style="font-size:0.69rem;color:var(--text3);font-family:var(--mono);margin-bottom:10px">by ${t.authorName || "Anonymous"}</div>
        <button class="btn btn-primary btn-sm use-market-tpl" data-id="${t.id}" style="width:100%;justify-content:center">
          Use template
        </button>
      </div>`).join("");

    document.querySelectorAll(".use-market-tpl").forEach(btn => {
      btn.addEventListener("click", async () => {
        const tpl = allMarket.find(t => t.id === btn.dataset.id);
        if (!tpl) return;
        // Increment usage count
        try {
          await updateDoc(doc(db, COMMUNITY_COL, tpl.id), { usageCount: increment(1) });
        } catch(e) { /* silent — don't block create */ }
        // Auto-add category if new
        if (tpl.cat) {
          const existing = [...new Set(BUILTIN_TEMPLATES.map(t => t.cat)), ...getCustomCategories()];
          if (!existing.includes(tpl.cat)) {
            const cats = getCustomCategories();
            cats.push(tpl.cat);
            saveCustomCategories(cats);
          }
        }
        await createFromTemplate(tpl);
      });
    });
  };

  renderGrid(allMarket);

  // Live search filter
  document.getElementById("market-search").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    renderGrid(q ? allMarket.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.cat.toLowerCase().includes(q)  ||
      (t.desc||"").toLowerCase().includes(q)
    ) : allMarket);
  });
}

