// ─── rockd / app.js ────────────────────────────────────────────────────────

import { db } from "./firebase.js";
import {
  collection, query, where, orderBy,
  onSnapshot, doc, updateDoc, deleteDoc,
  addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser     = null;
let unsubscribe     = null;
let currentDetailId = null;   // tracks which checklist detail is open
let checklists      = [];

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

// ─── Theme toggle ─────────────────────────────────────────────────────────
let isDark = true;
document.getElementById("theme-toggle").addEventListener("click", () => {
  isDark = !isDark;
  document.body.classList.toggle("light", !isDark);
  document.getElementById("theme-knob").style.left = isDark ? "2px" : "18px";
});

// ─── Navigation ───────────────────────────────────────────────────────────
let currentView = "dashboard";

function setView(view, checklistId = null) {
  currentView     = view;
  currentDetailId = checklistId;
  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.view === view);
  });
  const titles = { dashboard: "Dashboard", templates: "Templates", archive: "Archive", detail: "" };
  document.getElementById("topbar-title").textContent = titles[view] || "";
  document.getElementById("mobile-title").textContent = titles[view] || "Rockd";

  if (view === "dashboard") renderDashboard();
  if (view === "templates") renderTemplates();
  if (view === "archive")   renderArchive();
  if (view === "detail")    renderDetail(checklistId);
}

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => setView(item.dataset.view));
});
document.getElementById("btn-new").addEventListener("click", showNewChecklistModal);

// ─── Init ─────────────────────────────────────────────────────────────────
export function initApp(user) {
  currentUser = user;
  listenChecklists();
  setView("dashboard");
}

// ─── Firestore: real-time listener ────────────────────────────────────────
function listenChecklists() {
  if (unsubscribe) unsubscribe();
  const q = query(
    collection(db, "checklists"),
    where("ownerUid", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );
  unsubscribe = onSnapshot(q, (snap) => {
    checklists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSidebar();
    if (currentView === "dashboard") renderDashboard();
    if (currentView === "archive")   renderArchive();
    // Re-render detail in place so task changes reflect immediately
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

  document.querySelectorAll(".sidebar-list-item").forEach(el => {
    el.addEventListener("click", () => setView("detail", el.dataset.id));
  });
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
  const overdue = active.filter(c => c.hasOverdue).length;
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
        <div class="stat-label">Overdue</div>
        <div class="stat-value" style="color:${overdue ? "var(--red)" : "var(--green)"}">${overdue}</div>
        <div class="stat-sub">${overdue ? "lists with overdue tasks" : "all caught up"}</div>
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

  document.querySelectorAll(".checklist-card").forEach(el => {
    el.addEventListener("click", () => setView("detail", el.dataset.id));
  });
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
  document.getElementById("content").innerHTML = `
    <div class="section-header"><div class="section-title">Archive</div></div>
    ${archived.length
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
         </div>`}`;

  document.querySelectorAll(".restore-btn").forEach(btn =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); restoreChecklist(btn.dataset.id); }));
  document.querySelectorAll(".delete-btn").forEach(btn =>
    btn.addEventListener("click", (e) => { e.stopPropagation(); deleteChecklist(btn.dataset.id); }));
}

// ─── Templates ────────────────────────────────────────────────────────────
const TEMPLATES = [
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
      { name:"Content",   tasks:["Copy review & proofreading","SEO optimisation","Header image","Meta description"] },
      { name:"Technical", tasks:["Schedule publish date","Canonical URL","Sitemap","Mobile render check"] },
      { name:"Promotion", tasks:["Social media post","Email newsletter","Cross-post","Notify mentioned brands"] }]},
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
      { name:"Post-launch",tasks:["Monitor analytics","Respond to feedback","Fix critical bugs","Plan next iteration"] }]},
  { id:"weekly-review",   name:"Weekly Review",      cat:"Personal", icon:"📅", color:"#a78bfa",
    groups:[
      { name:"Review",    tasks:["What did I complete?","What slipped?","Energy level this week"] },
      { name:"Plan",      tasks:["Top 3 goals next week","Any blockers to address","Schedule key tasks"] }]},
];

function renderTemplates() {
  const cats = ["All", ...new Set(TEMPLATES.map(t => t.cat))];
  document.getElementById("content").innerHTML = `
    <div class="tabs" id="template-tabs">
      ${cats.map((c, i) => `<div class="tab${i===0?" active":""}" data-cat="${c}">${c}</div>`).join("")}
    </div>
    <div class="template-grid" id="template-grid">${TEMPLATES.map(templateCard).join("")}</div>`;

  document.querySelectorAll("#template-tabs .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#template-tabs .tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const cat = tab.dataset.cat;
      document.getElementById("template-grid").innerHTML =
        (cat === "All" ? TEMPLATES : TEMPLATES.filter(t => t.cat === cat)).map(templateCard).join("");
      bindTemplateUse();
    });
  });
  bindTemplateUse();
}

function templateCard(tpl) {
  const count = tpl.groups.reduce((s,g) => s+g.tasks.length, 0);
  return `<div class="template-card" data-id="${tpl.id}">
    <div class="template-icon">${tpl.icon}</div>
    <div class="template-name">${tpl.name}</div>
    <div class="template-cat">${tpl.cat} · ${count} tasks</div>
    <div style="margin-top:10px">
      <button class="btn btn-primary btn-sm use-template" data-id="${tpl.id}" style="width:100%;justify-content:center">Use template</button>
    </div>
  </div>`;
}

function bindTemplateUse() {
  document.querySelectorAll(".use-template").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tpl = TEMPLATES.find(t => t.id === btn.dataset.id);
      if (tpl) createFromTemplate(tpl);
    });
  });
}

async function createFromTemplate(tpl) {
  try {
    const groups = tpl.groups.map((g, gi) => ({
      id: `g${gi}_${Date.now()}`,
      name: g.name,
      collapsed: false,
      tasks: g.tasks.map((t, ti) => ({
        id: `t${gi}_${ti}_${Date.now()}`,
        text: t, completed: false, priority: "medium", date: null
      }))
    }));
    const ref = await addDoc(collection(db, "checklists"), {
      ownerUid: currentUser.uid, name: tpl.name, icon: tpl.icon, color: tpl.color,
      priority: "medium", pinned: false, archived: false,
      taskCount: groups.reduce((s,g) => s+g.tasks.length, 0), doneCount: 0,
      groups, collaborators: [], tags: [],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    showToast(`"${tpl.name}" created!`);
    setView("detail", ref.id);
  } catch (err) {
    console.error("createFromTemplate error:", err);
    showToast("Failed to create from template", "error");
  }
}

// ─── Detail view ──────────────────────────────────────────────────────────
function renderDetail(id) {
  const c = checklists.find(x => x.id === id);
  if (!c) { setView("dashboard"); return; }

  document.getElementById("topbar-title").textContent = `${c.icon || ""} ${c.name}`;
  document.getElementById("mobile-title").textContent  = c.name;

  const total  = c.taskCount || 0;
  const done   = c.doneCount  || 0;
  const pct    = total ? Math.round(done / total * 100) : 0;
  const groups = c.groups || [];

  document.getElementById("content").innerHTML = `
    <div class="detail-header">
      <div class="detail-title-wrap">
        <div class="detail-title">${c.icon || ""} ${c.name}</div>
        <div class="detail-meta">${total} tasks · created ${c.createdAt?.toDate?.()?.toLocaleDateString("en-MY",{month:"short",day:"numeric",year:"numeric"}) || "just now"}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="detail-pin">${c.pinned ? "📌 Unpin" : "📌 Pin"}</button>
        <button class="btn btn-ghost btn-sm" id="detail-archive">${c.archived ? "Unarchive" : "Archive"}</button>
        <button class="btn btn-danger btn-sm" id="detail-delete">Delete</button>
      </div>
    </div>

    <div class="progress-bar-wrap">
      <div class="progress-bar-header">
        <span class="progress-bar-label">Progress</span>
        <span class="progress-bar-pct">${pct}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
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

  // Header buttons — proper event listeners, no inline onclick
  document.getElementById("detail-pin").addEventListener("click",     () => togglePin(c.id, c.pinned));
  document.getElementById("detail-archive").addEventListener("click", () => archiveChecklist(c.id));
  document.getElementById("detail-delete").addEventListener("click",  () => deleteChecklist(c.id));
  document.getElementById("btn-add-group").addEventListener("click",  () => showAddGroupModal(c.id, c.groups || []));

  bindTaskEvents(c);
}

// ─── Group and task HTML ───────────────────────────────────────────────────
function renderGroup(checklistId, group) {
  const remaining = (group.tasks || []).filter(t => !t.completed).length;
  return `
    <div class="task-group" data-group="${group.id}">
      <div class="task-group-header">
        <span class="task-group-title">${group.name}</span>
        <span class="task-group-count">${remaining} left</span>
      </div>
      <div class="task-list">
        ${(group.tasks || []).map(task => renderTask(checklistId, group.id, task)).join("")}
      </div>
      <div class="add-task-row" data-group="${group.id}">
        <span style="color:var(--text3);font-size:13px">＋</span>
        <input class="add-task-input" placeholder="Add a task… (press Enter)" data-group="${group.id}"/>
      </div>
    </div>`;
}

function renderTask(checklistId, groupId, task) {
  return `
    <div class="task-item${task.completed ? " completed" : ""}" data-task="${task.id}" data-group="${groupId}">
      <div class="task-checkbox${task.completed ? " checked" : ""}" data-toggle data-task="${task.id}" data-group="${groupId}">
        ${task.completed ? `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,6 4.5,9 10.5,3"/></svg>` : ""}
      </div>
      <div class="task-content" style="flex:1;min-width:0">
        <div class="task-text" data-editable data-task="${task.id}" data-group="${groupId}">${task.text}</div>
        <div class="task-meta-row">
          <select class="priority-select" data-task="${task.id}" data-group="${groupId}"
                  style="font-size:10px;background:var(--bg3);border:1px solid var(--border2);border-radius:20px;padding:2px 6px;color:var(--text2);cursor:pointer;font-family:var(--mono)">
            <option value="low"      ${task.priority==="low"      ?"selected":""}>Low</option>
            <option value="medium"   ${task.priority==="medium"   ?"selected":""}>Medium</option>
            <option value="high"     ${task.priority==="high"     ?"selected":""}>High</option>
            <option value="critical" ${task.priority==="critical" ?"selected":""}>Critical</option>
          </select>
        </div>
      </div>
      <div class="task-actions">
        <div class="task-action-btn del" data-delete data-task="${task.id}" data-group="${groupId}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </div>
      </div>
    </div>`;
}

// ─── Bind task events ──────────────────────────────────────────────────────
function bindTaskEvents(c) {
  const area = document.getElementById("content");

  // Tick / untick
  area.querySelectorAll("[data-toggle]").forEach(el => {
    el.addEventListener("click", () => doToggleTask(c.id, el.dataset.group, el.dataset.task));
  });

  // Click text to edit inline
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

  // Priority dropdown
  area.querySelectorAll(".priority-select").forEach(sel => {
    sel.addEventListener("change", () =>
      doEditTask(c.id, sel.dataset.group, sel.dataset.task, { priority: sel.value })
    );
  });

  // Delete task
  area.querySelectorAll("[data-delete]").forEach(el => {
    el.addEventListener("click", () => doDeleteTask(c.id, el.dataset.group, el.dataset.task));
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
}

// ─── Task mutations ────────────────────────────────────────────────────────
async function doToggleTask(checklistId, groupId, taskId) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c?.groups) return;
  const groups    = c.groups.map(g => g.id !== groupId ? g : {
    ...g, tasks: g.tasks.map(t => t.id !== taskId ? t : { ...t, completed: !t.completed })
  });
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);
  try {
    await updateDoc(doc(db, "checklists", checklistId), { groups, doneCount, updatedAt: serverTimestamp() });
  } catch(err) { console.error(err); showToast("Failed to update task", "error"); }
}

async function doEditTask(checklistId, groupId, taskId, changes) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c?.groups) return;
  const groups = c.groups.map(g => g.id !== groupId ? g : {
    ...g, tasks: g.tasks.map(t => t.id !== taskId ? t : { ...t, ...changes })
  });
  try {
    await updateDoc(doc(db, "checklists", checklistId), { groups, updatedAt: serverTimestamp() });
  } catch(err) { console.error(err); showToast("Failed to save", "error"); }
}

async function doDeleteTask(checklistId, groupId, taskId) {
  const c = checklists.find(x => x.id === checklistId);
  if (!c?.groups) return;
  const groups    = c.groups.map(g => g.id !== groupId ? g : {
    ...g, tasks: g.tasks.filter(t => t.id !== taskId)
  });
  const taskCount = groups.reduce((s,g) => s + g.tasks.length, 0);
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);
  try {
    await updateDoc(doc(db, "checklists", checklistId), { groups, taskCount, doneCount, updatedAt: serverTimestamp() });
    showToast("Task deleted");
  } catch(err) { console.error(err); showToast("Failed to delete task", "error"); }
}

async function doAddTask(checklistId, groupId, text, currentGroups) {
  const newTask = { id: `t_${Date.now()}`, text, completed: false, priority: "medium", date: null };
  const groups    = currentGroups.map(g => g.id !== groupId ? g : {
    ...g, tasks: [...(g.tasks || []), newTask]
  });
  const taskCount = groups.reduce((s,g) => s + g.tasks.length, 0);
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);
  try {
    await updateDoc(doc(db, "checklists", checklistId), { groups, taskCount, doneCount, updatedAt: serverTimestamp() });
  } catch(err) { console.error(err); showToast("Failed to add task", "error"); }
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
    try {
      await updateDoc(doc(db, "checklists", checklistId), { groups, updatedAt: serverTimestamp() });
      showToast(`Group "${name}" added`);
    } catch(err) { console.error(err); showToast("Failed to add group", "error"); }
  };

  document.getElementById("create-group-btn").addEventListener("click", create);
  document.getElementById("group-name-input").addEventListener("keydown", e => { if (e.key === "Enter") create(); });
}

// ─── Checklist actions ─────────────────────────────────────────────────────
function togglePin(id, current) {
  updateDoc(doc(db, "checklists", id), { pinned: !current })
    .then(() => showToast(!current ? "Pinned!" : "Unpinned"))
    .catch(() => showToast("Failed to update", "error"));
}

function archiveChecklist(id) {
  const c    = checklists.find(x => x.id === id);
  const next = !c.archived;
  updateDoc(doc(db, "checklists", id), { archived: next, archivedAt: next ? serverTimestamp() : null })
    .then(() => { showToast(next ? "Archived" : "Restored"); if (next) setView("dashboard"); })
    .catch(() => showToast("Failed to archive", "error"));
}

function restoreChecklist(id) {
  updateDoc(doc(db, "checklists", id), { archived: false, archivedAt: null })
    .then(() => showToast("Restored!"))
    .catch(() => showToast("Failed to restore", "error"));
}

function deleteChecklist(id) {
  if (!confirm("Delete this checklist? This cannot be undone.")) return;
  deleteDoc(doc(db, "checklists", id))
    .then(() => { showToast("Deleted"); setView("dashboard"); })
    .catch(() => showToast("Failed to delete", "error"));
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
      console.error("createChecklist error:", err);
      showToast("Failed to create checklist", "error");
    }
  };

  document.getElementById("create-cl-btn").addEventListener("click", create);
  document.getElementById("new-cl-name").addEventListener("keydown", e => { if (e.key === "Enter") create(); });
}
