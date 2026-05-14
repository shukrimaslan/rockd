# rockd
A checklist web app with templates
https://shukrimaslan.github.io/rockd/

Phase 4 completion - New icon, Viewport zoom disabled, PWA, Mobile bottom nav & Settings page

Phase 3 completion — turns out due dates and drag-to-reorder were already fully built in the last app.js rewrite, they just weren't getting the CSS styles they needed:
<br>Due date — click the calendar icon on any task to pick a date. Shows "Today", "Tomorrow", or the date. Red if overdue, amber if today/tomorrow
<br>Drag tasks — grab the ⠿ handle that appears on hover and drag to reorder within or across groups
<br>Drag groups — grab the group header area to reorder groups within the checklist
<br>Drag styles — blue highlight on drop target, dashed border on group drop zone

<br>260511 - Alpha 0.01

<br><b>Bug fixes:</b>
<br>Theme persists — saves to localStorage, applied on page load before anything renders
<br>Priority colours — Low=green, Medium=blue, High=amber, Critical=red on both the dropdown and its border
<br>No duplicate titles — Archive and Detail pages no longer have a redundant heading inside content, topbar handles it
<br>Checklist title editable — click the title in the detail view to rename it inline
<br>Icon editable — click the emoji icon to open a picker
<br>Group title editable — click any group name to rename inline
<br>Groups collapsible — click the group header to collapse/expand, state is saved
<br>Progress bar not sticky — removed any fixed/sticky positioning
<br>Mobile nav cleaned up — single Sign Out button, back arrow (←) appears on detail view replacing the logo, single title only

<br><b>New features:</b>
<br>Guest mode — "Try as Guest" on login screen, uses localStorage only, no Firestore required
<br>Save as template — button on every checklist detail view saves it as a custom template
<br>Import template — in Templates tab, manual (text format with # groups) or paste raw JSON
<br>Custom templates — stored in localStorage, deletable, filterable under "Custom" tab
