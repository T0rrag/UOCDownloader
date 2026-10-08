# Verification — 3.0.1

Validation performed on 29 September 2026 against this source package.

| Check | Result | Boundary |
|---|---|---|
| `npm run check` | Passed | Syntax, manifest assets, course config, version consistency |
| `npm test` | 187 passed; 0 failed | Node unit tests and mocked Canvas/Chrome bridge tests |
| `python tests/offline_browser_smoke.py` | 62 checks passed | Real Chromium DOM/controller, synthetic Canvas data and mocked Chrome APIs |
| `python -m unittest discover -s tests -p '*_test.py'` | 9 passed | Initial-publishing safeguards; Git and GitHub subprocess calls mocked |
| Python compilation | Passed | Packaging, publication and browser-test helper syntax |
| ZIP validation | Passed | Python `zipfile.testzip()`, original synthetic bytes, empty directories |
| Actual GitHub repository creation/push | **Not performed** | No authenticated write/creation capability was available in this session |
| GitHub Actions execution | **Not performed** | Workflow is included but has not run on a remote repository |
| Native Chrome extension installation | **Not tested here** | Offline DOM tests do not install an actual extension |
| Live UOC scan/download with the user's account | **Not tested here** | User supplied logs are not replaced by a simulated test claim |

## Coverage retained

The 170 pre-existing Node tests still pass; 17 cleanup regression checks were added.
The browser checks exercise the actual production manager/controller code loaded
in Chromium, with synthetic API responses and Chrome API mocks. They preserve the
module-title folder layout from the user's example and independently inspect ZIP
bytes, checksums, explicit empty directories and resource destinations.

Covered scenarios include session expiry, bounded retries, pagination loops,
blocked cross-origin API calls, unexpected login HTML, file-size limits,
attachment-host permission prompts, read-only bridge routes, partial-export
consent, no automatic overwriting, shared-file reuse, nested page references,
availability notices and newly published attachments after rescanning.

The PEC1 publication notice and module titles supplied in the conversation are
regression inputs. Other materials and attachments are synthetic. No course PDFs,
real browser cookies or downloaded coursework are bundled in the source archive.

## Cleanup checks

The new checks verify common secret-value redaction, removal of potentially
sensitive URL fragments from diagnostic links, Windows-safe semester/course names,
case-insensitive subject-folder collisions, and consistent application versions.
Publication tests confirm source-hash validation, manifest-only staging, refusal
to touch existing Git repositories, correct account checks, explicit private
creation, no force-push/global Git settings, and remote-commit comparison. Those
GitHub calls are simulated, not evidence that a real upload occurred.

## Reproduce locally

Node 22+ is used for unit/syntax checks; no npm dependencies are required.
Python 3.10+ is used for the optional development/publishing helpers.

```text
npm run check
npm test
python -m unittest discover -s tests -p '*_test.py'
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python tests/offline_browser_smoke.py
python scripts/package.py
python scripts/publish.py
```

The last command is a dry run: it validates the release source manifest and prints
its destination without making any Git/GitHub calls. Actual publication requires
`--execute` and your locally authenticated GitHub CLI account; see
[publication instructions](docs/PUBLISHING.md).

The smoke harness prefers a Playwright-installed browser. Set `CHROMIUM_PATH` to
use another Chromium executable, or let it find a system Chromium when the managed
browser is absent. The root-container sandbox flag is not added on ordinary desktop
runs. The harness strips ES-module import/export declarations for its offline
bundle; it does not verify Chrome's native extension loader or its module loader.

Generated test data lives under `.test-output/` and release archives under `dist/`.
Both are ignored by Git and excluded by source packaging. The install-only ZIP
contains `manifest.json` directly at the extraction root; the source ZIP includes
an `extension/` folder. No credentials are needed by the offline tests.

## Remaining validation

Load the extension in Chrome, refresh an authenticated UOC tab, and compare a
small live course scan with normal navigation. Independently check permission
grants and actual attachment downloads, especially third-party resource viewers.
A real browser-authenticated scraping adapter is not implemented in this cleanup.
