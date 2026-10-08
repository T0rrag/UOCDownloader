# UOC Downloader — v3.0.1

A local Chrome extension that builds a semester ZIP from **Contenidos**, not from a fixed list of assignments or a bulk course-file inventory. It uses the UOC session already open in the same Chrome profile. It does not ask for an API token or read/export cookies.

## Install or update

1. Close the old downloader manager tab.
2. Extract this package. Copy the **entire contents of `UOC-Downloader/extension`**, including the `lib` folder, into the extension folder Chrome is already using. Replace old files.
3. Open `chrome://extensions/` and click **Reload** for UOC Downloader.
4. **Refresh your UOC classroom tab** so the old injected bridge is removed.
5. Reopen the extension. The header must say **version 3.0.1**.
6. Check your session, select Arquitectura de Computadores, and run **Scan selected subjects** again. Do not reuse the old review plan.

For a new installation, enable Developer mode at `chrome://extensions/`, choose **Load unpacked**, and select the **`extension` folder containing `manifest.json` directly inside it**. Do not select the outer package folder. No build step, Python, npm, or server is needed to use the extension.

The v2 flat-activity destination overrides are ignored. Semester-name and size preferences are retained when updating the existing installation. Unpacked copies installed from a different path may have a different Chrome extension ID and separate local preferences.

## Workflow

**Sign in to UOC → Check session → Select subjects → Scan → Review tree → Download ZIP**

Keep both the signed-in UOC tab and the downloader manager tab open while scanning and exporting. Files are read when you click Download ZIP. The ZIP is saved relative to Chrome's downloads directory. Opening/extracting the archive is a separate action.

### The actual retrieval path

1. Read the selected course's paginated **modules** list (`Contenidos`).
2. Read each module's paginated items with `include[]=content_details`.
3. Preserve the full module title, applying only filesystem-safe normalization and a length limit. Duplicate titles are disambiguated with the module ID.
4. Resolve Page items using `page_url` or the returned page API URL and request the **individual page body**. If neither is supplied, or if the API page has no body, a limited same-origin visible-page HTML fallback extracts a recognizable Canvas content region. It does not execute page scripts.
5. Follow linked Canvas files, linked pages/assignments, known module-item links, and direct downloadable HTTPS document/archive/media URLs. References inherit the **page's module and role**, not a guessed filename-based PEC.
6. Build the review tree from those discovered modules and destinations. Download only selected outputs into one ZIP.

The scanner does **not** enumerate every assignment, file or page in the course. It does not scrape the Dashboard navigation, grades, inbox or profiles. Forums/discussion items are excluded. External tools and non-downloadable external webpages are optional online bookmarks; their content is not recursively scraped.

## Folder structure

A module with one recognizable PEC/PAC, PR/Práctica, or Reto/Repte number receives an activity branch. General learning resources come first. Other non-activity modules retain their own titles, without inventing a PEC number. The five course identifiers are configured in `extension/asignaturas.json`; the legacy activity-label arrays in that file are not used to build the v3 tree.

For the Contenidos titles supplied for Arquitectura de Computadores, the generated structure is:

```text
10º Sem/
└── Arquitectura de Computadores/
    ├── 0 - Recursos de Aprendizaje de la Asignatura/
    ├── PEC1 - Evaluación del Rendimiento/
    │   ├── PEC 1/
    │   │   ├── 0. Enunciado/
    │   │   ├── 1. Trabajo/
    │   │   └── 2. Entrega/
    │   └── Recursos de aprendizaje de PEC 1/
    ├── PEC2 - Procesadores Segmentados/
    │   ├── PEC 2/
    │   │   ├── 0. Enunciado/
    │   │   ├── 1. Trabajo/
    │   │   └── 2. Entrega/
    │   └── Recursos de aprendizaje de PEC 2/
    ├── Práctica1 (PR1) - Simulador Pipeline/
    │   ├── PR1/
    │   │   ├── 0. Enunciado/
    │   │   ├── 1. Trabajo/
    │   │   └── 2. Entrega/
    │   └── Recursos de aprendizaje de PR1/
    └── Práctica2 (PR2) - Programación Paralela/
        ├── PR2/
        │   ├── 0. Enunciado/
        │   ├── 1. Trabajo/
        │   └── 2. Entrega/
        └── Recursos de aprendizaje de PR2/
```

These are **27 structural directory entries** for this single-subject example, including the semester and subject roots. The real scan determines the modules for each subject; the old “90 folders for five subjects” template is no longer the source of truth.

Empty Enunciado, Trabajo and Entrega folders are explicitly included in the ZIP. Materials are never routed to Trabajo or Entrega. The extension does not read existing local folders, so it does not merge your local work into the ZIP or remove old extracted folders.

## Availability is not page readability

| Review state | Meaning | Selected by default? |
|---|---|---|
| Ready | Linked Canvas file metadata is accessible and within the per-file limit. Bytes are checked again on export. | Yes |
| Ready to fetch | Direct file URL found in the page; access, MIME and size will be checked when exporting. | Yes |
| Source page | Optional HTML copy of a page that links to files. Files are listed separately. | No |
| Page text only | Optional HTML copy of content that has no detected downloadable attachment. | No |
| No download found | Statement-labelled page without a verified attachment or a clear publication notice. This is not automatically called unpublished. | No |
| Not available | Returned lock/publication state, a recognized future-publication notice with no available file, an empty page, or an inaccessible/over-limit linked file. The reason is shown. | No; status row is disabled |
| Online only | Optional bookmark for an external tool or non-downloadable webpage. Not an offline copy of that service. | No |
| Scan error / Not resolved | Retrieval or reference resolution needs attention; details are reported. | No |

The supplied PEC1 notice says the statement can be downloaded when the activity period starts. With no available attachment, v3 displays **Not available**, shows the supplied `Inicio: 05/10/26` and `Entrega: 25/10/26`, and creates **no HTML/PDF pretending to be the statement** in `0. Enunciado`. The empty folders still exist. Independent PEC1 learning resources can still be selected.

Dates parsed from text are preserved as displayed, not converted into invented API dates. Availability is not inferred solely from today's date. The wording detector is conservative and cannot recognize every possible publication message. Ambiguous pages are offered as optional text, not silently treated as assignment PDFs.

On a later rescan, newly available attachments are detected. An actual available attachment takes priority over stale “available later” prose, unless the platform still marks the item locked.

## Review and export

The tree can be searched, expanded/collapsed, and selected at file or folder level. Folder checkboxes select their materials; they do not remove the required empty directories. Each file has a destination dropdown limited to valid material folders in the discovered course layout. Shared files can appear in several destinations and be selected separately; the export reads their bytes once.

Available files are preselected. Source-page text and bookmarks are not. Choosing a parent checkbox explicitly selects all its selectable contents, including optional HTML/bookmark rows. “Not available” rows cannot be selected.

**Download ZIP** makes one Chrome download containing the selected outputs, the folder structure, and `_UOC_informes/download-report.json`. Files are stored without recompression. File IDs/stable identifiers are added to filenames to reduce collisions. Existing downloads are not silently overwritten, and repeated exports do not skip selected files merely because they were exported before.

Default caps: **250 MB per file**, **512 MB per ZIP**, configurable up to 1 GB. The caps include actual bytes; the archive cap also includes ZIP structures. Browser memory use can exceed the final archive size. Keep large selections modest.

The log message **Packed in memory** means the output is staged, not saved. Only **ZIP saved** confirms Chrome completed the archive download.

A failed selected file or an incomplete Contenidos scan blocks a complete ZIP by default. **Allow partial ZIP** explicitly permits a `-partial.zip` archive with an `INCOMPLETE_EXPORT.txt` marker. Known unpublished/unavailable content is excluded and reported, but is not treated as a failed selected-file download.

## Additional attachment hosts

Canvas files are read through the UOC tab when possible. Direct material links, or file-host fallbacks, may require **Allow attachment hosts** after scanning. Only the displayed origins are requested. Direct external-host reads omit credentials; a separate external-site login, restricted LTI resource, or DRM-protected viewer may therefore remain inaccessible. A failed response is not replaced with a fake PDF or an HTML login page.

The extension requests no cookie-reading permission. It makes allowlisted same-origin GET requests and optional HTTPS attachment reads. It does not collect passwords, export cookies, submit activities, change grades, or mark assignments complete. Only preferences, destination overrides and a sanitized diagnostic report are stored locally. Source-page bodies and direct download URLs stay in memory, not extension storage.

## Limits and diagnostics

This is not a complete offline mirror of UOC. Arbitrary external landing pages are not crawled, interactive tools are not executed, decorative images are not interpreted as statement attachments, and a script-rendered page without a recognizable HTML content region may require further handling. Selected source-page snapshots preserve online links rather than rewriting all links for offline use.

Use **Export report** after a scan or failed export. It records module titles, destinations, original safe links, availability and error reasons. Do not send cookies, passwords or API tokens when reporting an issue.

**Live UOC retrieval and native extension installation were not verified in this environment.** The included tests use synthetic Canvas/Chrome responses; the supplied module titles and PEC1 publication notice are regression fixtures. See `TESTING.md` for the exact checks and limitations. Screenshots and fixture archives are not real downloaded course materials.

## Developer files

- `extension/lib/layout.js`: dynamic module folders and statement/resource routing.
- `extension/lib/availability.js`: publication notices, displayed dates and page availability states.
- `extension/lib/scanner.js`: Contenidos-only discovery and linked-content graph.
- `extension/lib/html.js`: content reference extraction, safe optional snapshots, visible-page fallback.
- `extension/bridge.js`: same-origin read-only session bridge and bounded binary chunks.
- `extension/lib/tree.js`, `manager.js`: directory review and selection.
- `extension/lib/files.js`, `downloader.js`, `zip.js`: selected file reads and one-ZIP export.

Run unit checks with `npm test` (Node 22 used for verification). Browser tests require Python 3.10+, Playwright and Chromium. These dependencies are only for development/testing, not for installing the extension.

```text
npm run check
npm test
python -m unittest discover -s tests -p '*_test.py'
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python tests/offline_browser_smoke.py
python scripts/package.py
```

No npm packages need to be installed: unit/syntax checks use Node's standard library.
The smoke test selects a Playwright-installed Chromium or a system Chromium;
`CHROMIUM_PATH` can explicitly select a test executable. It writes generated
screenshots, archives and results under ignored `.test-output/` only. The GitHub
Actions workflow runs the same offline checks; it does not log into UOC.

The source archive has an `extension/` subfolder. The install-only archive has
`manifest.json` directly at its extraction root. Release ZIPs are generated in
ignored `dist/` and contain no local downloads, authentication files or test output.

For the initial private `T0rrag/UOC-Downloader` upload, see
[publication instructions](docs/PUBLISHING.md). No repository creation is implied
by the presence of this package. See also [access/automation diagnostics](docs/ACCESS_AND_AUTOMATION.md)
and [privacy safeguards](SECURITY.md).

## Primary documentation consulted

- Canvas modules and module-item fields: https://developerdocs.instructure.com/services/canvas/resources/modules
- Canvas individual page bodies: https://developerdocs.instructure.com/services/canvas/resources/pages
- Chrome extension network requests: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Chrome unpacked installation/reloading: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world

Unofficial personal utility, not affiliated with UOC or Instructure. Use only content your account is authorized to access.
