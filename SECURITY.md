# Security and privacy

This is an unofficial personal tool. Use only material your account is authorized
to access. An HTTP success response is not permission to redistribute coursework.

## Access model

The extension reuses a signed-in UOC tab for allowlisted same-origin GET requests.
It does not read passwords, request the cookies API, export cookies, submit
assignments, or update course content. Canvas lock and visibility checks remain in
place. Optional HTTPS attachment-host permissions are requested through a user
click for the hosts listed in the interface. Direct external reads omit credentials.

Unpublished files and release dates are not bypassed. An API access token or an
OAuth developer key does not expand the authorizing user's course permissions.
See the official Canvas developer-key and file documentation referenced below.

## Local data

The browser holds file bytes and page bodies in memory during export. Local
extension storage contains preferences, destination overrides, and the last
sanitized diagnostic report. That report can still contain subject names, course
identifiers, filenames, dates, and module titles: review it before sharing.
Source-page snapshots keep online references; they are not a complete offline mirror.

Diagnostic links remove sensitive query keys and URL fragments. Log/error text
redacts network URLs, common authorization fields and bearer values. Redaction is
not a guarantee against every possible secret representation. Never put real
credentials or unreviewed browser/network dumps in issues or source files.

## Repository boundary

`.gitignore` excludes common credential files, local reports, browser-auth state,
downloaded ZIPs, and generated test output. The packaging script uses an explicit
source allowlist. The initial uploader additionally verifies file hashes. These are
accidental-disclosure safeguards, not a full security audit or credential scanner.

All bundled test API responses and file bytes are synthetic. Do not replace them
with live session data. Playwright authentication files can allow impersonation and
must never be committed, including to private repositories.

Report a suspected credential exposure privately to the repository owner, without
posting the credential itself. This package does not configure a security-reporting
endpoint or claim an independent security audit.

## Primary references

- Canvas file fields and user locks: https://developerdocs.instructure.com/services/canvas/resources/files
- Canvas developer keys and scopes: https://canvas.instructure.com/doc/api/file.developer_keys.html
- Chrome extension network requests: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Playwright authentication-state warnings: https://playwright.dev/docs/auth
