# Missing materials: diagnose access, not just automation

## Three different situations

1. **Accessible by normal navigation but missed by the scanner.** This is a
   retrieval gap. Examples include an external authenticated viewer or a link
   inserted by JavaScript after a click. Record the original module/page, what the
   normal browser displays, and the extension's sanitized error. Do not submit
   cookies, authorization headers, or live authentication-state files.
2. **Accessible file but missing extension host permission.** Approve the specific
   hosts shown by `Allow attachment hosts`, then retry export. UOC login and Chrome
   extension host permission are separate requirements. `Packed in memory` does
   not mean a ZIP has been saved. Complete export blocks on a selected-file failure
   unless partial export is explicitly enabled.
3. **Unpublished, locked, or not yet attached.** Preserve the module folders and
   report the returned status, reason, and any displayed dates. A future-publication
   notice is not a downloadable assignment PDF. A later rescan can discover files
   after release; the browser cannot retrieve bytes that have not been uploaded.

A link-only file and an unpublished file are not equivalent. Canvas can permit a
student to access a published file by an existing link even when the Files tab or
file listing is hidden. Do not infer a lock solely from a missing navigation item.
Do not guess undisclosed file identifiers or attempt alternate roles to bypass a
server-side denial.

## What an authenticated headless browser adds

A tool such as Playwright can open pages, wait for dynamically generated elements,
follow authorized navigation, and observe normal downloads. It can be useful for
resources accessible in the UI but not represented as simple links in the initial
page body. It does not grant a student access to teacher-only/unpublished content,
and an AI agent is not required for a known sequence of deterministic pages.

A future adapter should be local, manually started, read-only, and limited to
resources reachable through normal authorized navigation. Handle sign-in/MFA
interactively, do not put credentials or cookies in source control, and respect
external-resource restrictions. This release does **not** implement that adapter.
The existing Playwright script tests synthetic data only; it is not a live UOC
scraper and must not be presented as one.

## API access and institutional contact

Canvas developer keys identify OAuth applications. User-authorized access tokens
retain the permissions of that user, constrained further by any configured scopes.
For an institutional integration, ask UOC support to route the proposal to the
Canvas administrator and request only the read scopes needed for modules, pages,
and accessible attachments. Do not place a client secret in a browser extension.
For unpublished assignment material or a release schedule, ask the teaching team.
No UOC API policy or approval for this project has been verified.

UOC's 2026–2027 student guide places the student support service in the Campus
Virtual's top menu next to the profile, with a question-submission form.

## Primary references

- Canvas file visibility/availability: https://community.instructure.com/en/kb/articles/662851-how-do-i-restrict-files-and-folders
- Canvas file fields: https://developerdocs.instructure.com/services/canvas/resources/files
- Canvas developer keys: https://canvas.instructure.com/doc/api/file.developer_keys.html
- Playwright authenticated state: https://playwright.dev/docs/auth
- UOC Campus Virtual guide: https://www.uoc.edu/estudiant/portal/guia/es/serveis/campus_virtual/
