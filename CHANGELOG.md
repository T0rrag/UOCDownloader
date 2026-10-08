# Changelog

## 3.0.1 — Repository cleanup

- Normalize JavaScript formatting and keep runtime dependencies at zero.
- Centralize application name/version; add a manifest/configuration/syntax check.
- Reject unsafe semester names and case-insensitive subject-folder collisions.
- Centralize diagnostic text redaction; remove fragments from persisted safe links.
- Rename export log entries to `Packed in memory` and log host-permission results.
- Keep Contenidos discovery, availability handling, folder layout and ZIP behavior.
- Make offline browser tests portable; isolate generated output in `.test-output/`.
- Add source-only packaging, initial private-repository publishing helper, and offline CI.
- Document access limitations, authenticated-browser automation, and institutional API requests.
- Add regression tests; no live/headless scraping feature was introduced.

## 3.0.0 — Contenidos and publication availability

- Replace the production bulk assignment/file/page inventory scan with paginated module and module-item discovery.
- Preserve full module titles and derive activity folders dynamically; do not generate the old static 90-folder tree.
- Separate activity statements from sibling learning-resource folders; general resources come first; forums are excluded.
- Add disabled publication-status rows and conservative inline-text/attachment distinctions. Include no false statement file for the supplied PEC1 notice.
- Follow nested Canvas page/file/module-item references and direct document/archive/media URLs; keep role/destination context and stop cycles.
- Keep availability independent between an activity statement and its learning resources.
- Add a restricted visible-page content fallback when page_url/body is absent.
- Preserve one ZIP with explicit empty 0. Enunciado / 1. Trabajo / 2. Entrega folders, selection review, safe non-overwriting filenames and reports.
- Include detailed availability and incomplete-scan diagnostics; require explicit partial export when a scan is incomplete.
- Ignore the old v2 flat destination override namespace.
- Add stable suffixes to optional page-snapshot names to prevent truncated-identifier collisions.
- Regression checks use the user's module titles and PEC1 wording, with synthetic attachment data.

---

## Earlier releases (historical behavior only)


## 2.0.0

- Replaced separate attachment downloads with one locally assembled ZIP.
- Replaced the resource table with an expandable directory tree.
- Added branch checkboxes, mixed-selection states, per-location file checkboxes, search and expand/collapse controls.
- Added explicit empty Enunciado, Trabajo and Entrega directory entries for every configured activity in selected subjects.
- Kept the five subjects, 21 activity names and destination overrides.
- Removed historical skip behavior: each new ZIP includes all selected outputs.
- Added chunked binary reads through the UOC session and optional per-host file-reader fallback.
- Added ZIP size limits, UTF-8 paths, CRC validation, atomic-by-default export and explicitly marked partial ZIPs.
- Included a diagnostic report inside each ZIP; no separate structural template is needed.
- Added independent ZIP validation and expanded offline browser/controller tests.
