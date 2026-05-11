# rockd
A checklist web app with templates
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
