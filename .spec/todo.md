# SideChat — Gap Analysis & TODO (mar18 spec)

Spec reference: `.spec/requirement-mar18.md`

## ✅ Completed

- [x] Context menu: `contexts: ["selection"]` + capture `selectionText` (`background.js`)
- [x] Chip tooltip: full selected text shown on hover (`sidepanel.js`)
- [x] Remove model dropdown from main side panel UI (`sidepanel.html`, `sidepanel.js`)
- [x] Markdown rendering in context preview (`sidepanel.js` `renderContextPreview()`)
- [x] Inline settings panel — gear icon opens settings inside the side panel (`sidepanel/settings.js`, `sidepanel.html`)

## 🔲 Future / Deferred

- [ ] **marked + highlight.js integration** — Replace custom `renderMarkdown()` with `marked` + `highlight.js` for tables, better code highlighting, and strikethrough. Requires downloading and bundling the libraries locally (no build step means no npm/CDN). Deferred until the no-build constraint is relaxed or the libraries are added as local files.
  - `utils/markdown.js` would wrap the configured `marked` instance
  - `sidepanel.html` and `sidepanel/settings.js` would `<script src="../utils/markdown.js">`
  - DOMPurify (or equivalent allowlist sanitizer) needed for XSS safety

## Notes

- The `options/` page remains as a fallback and is still listed in `manifest.json` as `options_ui`. It is no longer the primary settings entry point.
- Context preview messages now render via the same `renderMarkdown()` used for side-chat messages.
