// ─── rockd / app.js ────────────────────────────────────────────────────────
// Main app entry point. Called by index.html after auth confirms a signed-in
// user. This file will grow to include dashboard, checklist, and archive views.
// ───────────────────────────────────────────────────────────────────────────

import { db } from "./firebase.js";
import { logout } from "./auth.js";
import {
  collection, query, where, orderBy,
  onSnapshot, doc, updateDoc, deleteDoc,
  addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null;
let unsubscribe  = null;   // Firestore listener cleanup

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
  currentView = view;
  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.view === view);
  });
  const titles = { dashboard: "Dashboard", templates: "Templates", archive: "Archive", detail: "" };
  document.getElementById("topbar-title").textContent  = titles[view] || "";
  document.getElementById("mobile-title").textContent  = titles[view] || "Rockd";

  if (view === "dashboard")  renderDashboard();
  if (view === "templates")  renderTemplates();
  if (view === "archive")    renderArchive();
  if (view === "detail")     renderDetail(checklistId);
}

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => setView(item.dataset.view));
});

document.getElementById("btn-new").addEventListener("click", () => {
  showNewChecklistModal();
});

// ─── Init ─────────────────────────────────────────────────────────────────
export function initApp(user) {
  currentUser = user;
  listenChecklists();
  setView("dashboard");
}

// ─── Firestore: listen to user's checklists ────────────────────────────────
let checklists = [];

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
    // Re-render current view with fresh data
    if (currentView === "dashboard") renderDashboard();
    if (currentView === "archive")   renderArchive();
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────
function renderSidebar() {
  const active = checklists.filter(c => !c.archived);
  const pinned = active.filter(c => c.pinned);
  const rest   = active.filter(c => !c.pinned);

  const pinnedEl = document.getElementById("sidebar-pinned");
  const activeEl = document.getElementById("sidebar-active");

  pinnedEl.innerHTML = pinned.length
    ? pinned.map(c => sidebarItem(c, true)).join("")
    : `<div style="padding:4px 20px;font-size:11px;color:var(--text3)">No pinned lists</div>`;

  activeEl.innerHTML = rest.map(c => sidebarItem(c, false)).join("");

  // Click handlers
  document.querySelectorAll(".sidebar-list-item").forEach(el => {
    el.addEventListener("click", () => setView("detail", el.dataset.id));
  });
}

function sidebarItem(c, pinned) {
  const done  = (c.taskCount && c.doneCount) ? c.doneCount : 0;
  const total = c.taskCount || 0;
  return `<div class="sidebar-list-item" data-id="${c.id}">
    <div class="sidebar-dot" style="background:${c.color || "var(--accent)"}"></div>
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.icon || ""} ${c.name}</span>
    ${pinned ? '<span class="sidebar-pin">📌</span>' : ""}
  </div>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────
function renderDashboard() {
  const active    = checklists.filter(c => !c.archived);
  const total     = active.reduce((s, c) => s + (c.taskCount || 0), 0);
  const done      = active.reduce((s, c) => s + (c.doneCount  || 0), 0);
  const overdue   = active.filter(c => c.hasOverdue).length;
  const pct       = total ? Math.round(done / total * 100) : 0;

  const pinned = active.filter(c => c.pinned);
  const rest   = active.filter(c => !c.pinned).slice(0, 12);

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
      <div class="section-header">
        <div class="section-title">📌 Pinned</div>
      </div>
      <div class="checklist-grid" style="margin-bottom:24px">
        ${pinned.map(checklistCard).join("")}
      </div>` : ""}

    <div class="section-header">
      <div class="section-title">My Lists</div>
    </div>
    ${rest.length
      ? `<div class="checklist-grid">${rest.map(checklistCard).join("")}</div>`
      : `<div class="empty-state">
           <div class="empty-state-icon">✦</div>
           <div class="empty-state-title">No checklists yet</div>
           <div class="empty-state-sub">Click "New Checklist" to get started,<br>or pick a template to hit the ground running.</div>
         </div>`}
  `;

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
    <div class="section-header">
      <div class="section-title">Archive</div>
    </div>
    ${archived.length
      ? `<div class="checklist-grid">${archived.map(c => `
          <div class="checklist-card archived" data-id="${c.id}"
               style="--card-accent:${c.color || "var(--accent)"}">
            <div class="checklist-card-title">${c.icon || ""} ${c.name}</div>
            <div class="checklist-card-meta">${c.taskCount || 0} tasks</div>
            <div class="checklist-card-footer">
              <span class="archive-badge">archived</span>
              <div style="display:flex;gap:6px">
                <button class="btn btn-ghost btn-sm" onclick="restoreChecklist('${c.id}')">Restore</button>
                <button class="btn btn-danger btn-sm" onclick="deleteChecklist('${c.id}')">Delete</button>
              </div>
            </div>
          </div>`).join("")}</div>`
      : `<div class="empty-state">
           <div class="empty-state-icon">📦</div>
           <div class="empty-state-title">Archive is empty</div>
           <div class="empty-state-sub">Completed lists you archive will appear here.</div>
         </div>`}
  `;
}

// ─── Templates ────────────────────────────────────────────────────────────
const TEMPLATES = [
  { id:"web-launch",    name:"Website Launch",    cat:"Design",   icon:"🚀", color:"#7c6fff",
    groups:[
      { name:"Design",    tasks:["Finalise wireframes","Design system review","Mobile responsiveness","Accessibility audit"] },
      { name:"Technical", tasks:["CI/CD pipeline","SSL certificate","Performance (Core Web Vitals)","Analytics integration"] },
      { name:"Marketing", tasks:["SEO meta tags","OG images","Landing page copy","Social media assets"] },
      { name:"QA",        tasks:["Functional testing","Form testing","Load testing","Final sign-off"] }
    ]},
  { id:"client-onboard", name:"Client Onboarding", cat:"Freelance", icon:"🤝", color:"#00d97e",
    groups:[
      { name:"Admin",     tasks:["Send welcome email","Contract & signature","Invoice for deposit","Kickoff call"] },
      { name:"Discovery", tasks:["Brand questionnaire","Gather assets & logins","Define scope","Set milestones"] },
      { name:"Setup",     tasks:["Shared drive folder","Slack channel","Project tool access","Brief team"] }
    ]},
  { id:"travel-packing", name:"Travel Packing",    cat:"Personal", icon:"✈️", color:"#3d9fff",
    groups:[
      { name:"Documents", tasks:["Passport","Itinerary & hotel","Travel insurance","Visa if required"] },
      { name:"Clothing",  tasks:["T-shirts","Pants / shorts","Underwear & socks","Jacket / rain layer"] },
      { name:"Essentials",tasks:["Phone charger","Power bank","Medications","Cash & cards"] }
    ]},
  { id:"content-publish", name:"Content Publishing", cat:"Work", icon:"📝", color:"#ffb020",
    groups:[
      { name:"Content",   tasks:["Copy review & proofreading","SEO optimisation","Header image","Meta description"] },
      { name:"Technical", tasks:["Schedule publish date","Canonical URL","Sitemap","Mobile render check"] },
      { name:"Promotion", tasks:["Social media post","Email newsletter","Cross-post","Notify mentioned brands"] }
    ]},
  { id:"invoice-followup", name:"Invoice Follow-up", cat:"Freelance", icon:"💰", color:"#ff6ab2",
    groups:[
      { name:"Prepare",   tasks:["Verify invoice details","Check payment terms","Document deliverables"] },
      { name:"Outreach",  tasks:["Send reminder email","Follow-up call","Escalate if needed"] },
      { name:"Resolution",tasks:["Confirm payment","Send receipt","Update books"] }
    ]},
  { id:"team-handoff", name:"Team Handoff", cat:"Work", icon:"🔄", color:"#00d4d4",
    groups:[
      { name:"Documentation", tasks:["Project overview doc","Active tasks & status","Credentials & access","Key decisions"] },
      { name:"Transition",    tasks:["Handoff meeting","Walk through files","Introduce stakeholders","Transfer ownership"] }
    ]},
  { id:"product-launch", name:"Product Launch",   cat:"Design",   icon:"🎯", color:"#ff4d6d",
    groups:[
      { name:"Pre-launch", tasks:["Landing page live","Beta tester feedback","Press kit ready","Launch email drafted"] },
      { name:"Launch",     tasks:["Publish product","Post to socials","Submit to directories","Email list notify"] },
      { name:"Post-launch",tasks:["Monitor analytics","Respond to feedback","Fix critical bugs","Plan next iteration"] }
    ]},
  { id:"weekly-review", name:"Weekly Review",   cat:"Personal",  icon:"📅", color:"#a78bfa",
    groups:[
      { name:"Review",    tasks:["What did I complete?","What slipped?","Energy level this week"] },
      { name:"Plan",      tasks:["Top 3 goals next week","Any blockers to address","Schedule key tasks"] }
    ]},
];

function renderTemplates() {
  const cats = ["All", ...new Set(TEMPLATES.map(t => t.cat))];
  document.getElementById("content").innerHTML = `
    <div class="tabs" id="template-tabs">
      ${cats.map((c, i) => `<div class="tab${i===0?" active":""}" data-cat="${c}">${c}</div>`).join("")}
    </div>
    <div class="template-grid" id="template-grid">
      ${TEMPLATES.map(templateCard).join("")}
    </div>`;

  document.querySelectorAll("#template-tabs .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#template-tabs .tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const cat = tab.dataset.cat;
      const filtered = cat === "All" ? TEMPLATES : TEMPLATES.filter(t => t.cat === cat);
      document.getElementById("template-grid").innerHTML = filtered.map(templateCard).join("");
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

// ─── Create checklist from template ───────────────────────────────────────
async function createFromTemplate(tpl) {
  try {
    const ref = await addDoc(collection(db, "checklists"), {
      ownerUid:     currentUser.uid,
      name:         tpl.name,
      icon:         tpl.icon,
      color:        tpl.color,
      priority:     "medium",
      pinned:       false,
      archived:     false,
      taskCount:    tpl.groups.reduce((s,g) => s+g.tasks.length, 0),
      doneCount:    0,
      collaborators:[],
      tags:         [],
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp()
    });
    // Store groups as a JSON field for now (subcollections added in next build phase)
    await updateDoc(ref, {
      groups: tpl.groups.map((g, gi) => ({
        id: "g" + gi,
        name: g.name,
        collapsed: false,
        tasks: g.tasks.map((t, ti) => ({
          id: "t" + gi + ti,
          text: t,
          completed: false,
          priority: "medium",
          date: null
        }))
      }))
    });
    showToast(`"${tpl.name}" created!`);
    setView("detail", ref.id);
  } catch (err) {
    console.error(err);
    showToast("Failed to create checklist", "error");
  }
}

// ─── Detail view (placeholder — full build in next phase) ─────────────────
function renderDetail(id) {
  const c = checklists.find(x => x.id === id);
  if (!c) { setView("dashboard"); return; }
  document.getElementById("topbar-title").textContent = c.name;
  document.getElementById("content").innerHTML = `
    <div class="detail-header">
      <div class="detail-title-wrap">
        <div class="detail-title">${c.icon || ""} ${c.name}</div>
        <div class="detail-meta">${c.taskCount || 0} tasks · created ${c.createdAt?.toDate?.()?.toLocaleDateString("en-MY",{month:"short",day:"numeric",year:"numeric"}) || "just now"}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="togglePin('${c.id}',${c.pinned})">${c.pinned ? "📌 Unpin" : "📌 Pin"}</button>
        <button class="btn btn-ghost btn-sm" onclick="archiveChecklist('${c.id}')">${c.archived ? "Unarchive" : "Archive"}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteChecklist('${c.id}')">Delete</button>
      </div>
    </div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-header">
        <span class="progress-bar-label">Progress</span>
        <span class="progress-bar-pct">${c.taskCount ? Math.round((c.doneCount||0)/c.taskCount*100) : 0}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width:${c.taskCount ? Math.round((c.doneCount||0)/c.taskCount*100) : 0}%"></div>
      </div>
    </div>
    <div id="task-area">
      ${(c.groups || []).map(group => `
        <div class="task-group">
          <div class="task-group-header">
            <span class="task-group-title">${group.name}</span>
            <span class="task-group-count">${group.tasks.length}</span>
          </div>
          ${(group.tasks || []).map(task => `
            <div class="task-item${task.completed?" completed":""}">
              <div class="task-checkbox${task.completed?" checked":""}"
                   onclick="toggleTask('${c.id}','${group.id}','${task.id}')">
                ${task.completed ? `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,6 4.5,9 10.5,3"/></svg>` : ""}
              </div>
              <div class="task-content">
                <div class="task-text">${task.text}</div>
                <div class="task-meta-row">
                  <span class="priority-badge p-${task.priority}">${task.priority}</span>
                  ${task.date ? `<span class="task-date">${task.date}</span>` : ""}
                </div>
              </div>
            </div>`).join("")}
        </div>`).join("")}
    </div>`;
}

// ─── Checklist actions (exposed to inline onclick) ─────────────────────────
window.togglePin = async (id, current) => {
  await updateDoc(doc(db, "checklists", id), { pinned: !current });
  showToast(!current ? "Pinned!" : "Unpinned");
};

window.archiveChecklist = async (id) => {
  const c = checklists.find(x => x.id === id);
  const next = !c.archived;
  await updateDoc(doc(db, "checklists", id), {
    archived: next, archivedAt: next ? serverTimestamp() : null
  });
  showToast(next ? "Archived" : "Restored");
  if (next) setView("dashboard");
};

window.restoreChecklist = async (id) => {
  await updateDoc(doc(db, "checklists", id), { archived: false, archivedAt: null });
  showToast("Restored!");
};

window.deleteChecklist = async (id) => {
  if (!confirm("Delete this checklist? This cannot be undone.")) return;
  await deleteDoc(doc(db, "checklists", id));
  showToast("Deleted");
  setView("dashboard");
};

window.toggleTask = async (checklistId, groupId, taskId) => {
  const c = checklists.find(x => x.id === checklistId);
  if (!c || !c.groups) return;
  const groups = c.groups.map(g => {
    if (g.id !== groupId) return g;
    return { ...g, tasks: g.tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t) };
  });
  const doneCount = groups.reduce((s,g) => s + g.tasks.filter(t => t.completed).length, 0);
  await updateDoc(doc(db, "checklists", checklistId), { groups, doneCount, updatedAt: serverTimestamp() });
};

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
        <input id="new-cl-name" class="modal-input" placeholder="e.g. Website Redesign" autofocus/>
      </div>
      <div class="modal-field">
        <label class="modal-label">Colour</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${COLORS.map((c,i) => `
            <div class="color-swatch${i===0?" selected":""}" data-color="${c}"
                 style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${i===0?"white":"transparent"};transition:all .15s"
                 onclick="selectColor(this,'${c}')"></div>`).join("")}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="create-cl-btn" style="flex:1">Create</button>
        <button class="btn btn-ghost" onclick="document.getElementById('new-checklist-modal').remove()" style="flex:0;width:auto;padding:10px 16px">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  document.getElementById("new-cl-name").focus();

  let selectedColor = COLORS[0];
  window.selectColor = (el, color) => {
    document.querySelectorAll(".color-swatch").forEach(s => { s.style.borderColor = "transparent"; });
    el.style.borderColor = "white";
    selectedColor = color;
  };

  document.getElementById("create-cl-btn").addEventListener("click", async () => {
    const name = document.getElementById("new-cl-name").value.trim();
    if (!name) return;
    modal.remove();
    try {
      const ref = await addDoc(collection(db, "checklists"), {
        ownerUid: currentUser.uid,
        name, color: selectedColor, icon: "",
        priority: "medium", pinned: false, archived: false,
        taskCount: 0, doneCount: 0,
        groups: [], collaborators: [], tags: [],
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      showToast(`"${name}" created!`);
      setView("detail", ref.id);
    } catch (err) {
      showToast("Failed to create checklist", "error");
    }
  });

  document.getElementById("new-cl-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("create-cl-btn").click();
  });
}
