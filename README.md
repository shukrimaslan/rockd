# rockd
A checklist web app with templates
<br>260511 - Alpha 0.01
Bug fixes:

Theme persists — saves to localStorage, applied on page load before anything renders
Priority colours — Low=green, Medium=blue, High=amber, Critical=red on both the dropdown and its border
No duplicate titles — Archive and Detail pages no longer have a redundant heading inside content, topbar handles it
Checklist title editable — click the title in the detail view to rename it inline
Icon editable — click the emoji icon to open a picker
Group title editable — click any group name to rename inline
Groups collapsible — click the group header to collapse/expand, state is saved
Progress bar not sticky — removed any fixed/sticky positioning
Mobile nav cleaned up — single Sign Out button, back arrow (←) appears on detail view replacing the logo, single title only

New features:

Guest mode — "Try as Guest" on login screen, uses localStorage only, no Firestore required
Save as template — button on every checklist detail view saves it as a custom template
Import template — in Templates tab, manual (text format with # groups) or paste raw JSON
Custom templates — stored in localStorage, deletable, filterable under "Custom" tab
