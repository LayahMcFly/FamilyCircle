# Design rules

These apply to every screen in Family Circle, including new modules.

1. **No default-looking form controls.** Every text box, text area, search box, number box, date box, dropdown (select), checkbox, radio button and file picker must be decorated to match the app's theme: rounded corners, the theme border, background and text colors, and a custom arrow on dropdowns, a custom tick on checkboxes. The shared rules live at the end of `styles.css`. Use them (plain `<input>`, `<select>`, `<textarea>`), and never ship a bare browser control. If a new kind of control is needed, add its styling there in the same change.
2. Use theme variables (`--surface`, `--border`, `--accent`, `--text`, `--muted`, `--radius`, `--radius-sm`), so every theme and dark mode keeps working.
3. Links that act like actions are buttons. Spacing: inputs, buttons and cards never touch.
4. No inline `style` attributes in markup (the page security rules block them). Use classes.

`tests/browser/input-style.spec.js` checks rule 1 on the main screens.
