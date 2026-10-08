# Initial GitHub publication

The intended repository is **T0rrag/UOC-Downloader**, private, with a `main` branch.
This package does not imply that the repository already exists or that an upload occurred.

Install Git and GitHub CLI on your computer. Authenticate in your own terminal:

```powershell
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
```

The `workflow` scope is needed for classic OAuth credentials when committing the
included `.github/workflows/tests.yml`. Do not paste a GitHub token into chat.
The GitHub account connected to ChatGPT is separate from your local CLI login.

Open PowerShell in the extracted `UOC-Downloader` source folder. Preview the upload:

```powershell
py -3 .\scripts\publish.py
```

This only validates the source manifest and prints the target; it makes no network
calls and initializes no Git repository. To create the private repository and upload:

```powershell
py -3 .\scripts\publish.py --execute
```

Use `python` instead of `py -3` on systems without the Windows Python launcher.
Python 3.10+ is required by the packaging/publication helpers, not by the extension.

The helper checks your authenticated account, verifies the source hashes, creates
an initial local commit containing only the manifest-listed files, invokes GitHub
CLI repository creation with `--private`, and compares the remote `main` SHA with
the local commit. It never force-pushes, replaces another repository, or changes
global Git author settings. It sets local author information using your GitHub
login and numeric-ID no-reply address.

Use a fresh extracted folder outside another Git repository. A failed create/push
can leave the local commit, and in some failure cases an empty remote repository.
Nothing is deleted automatically. Inspect the error rather than repeating commands
that assume no repository exists. The helper deliberately refuses existing Git
repositories; normal later development should use your usual Git workflow.

After intentionally reviewing/editing source, `python scripts/package.py` rebuilds
the source manifest and release ZIPs. Never add course PDFs, personal reports,
cookies, tokens, or real browser-auth state to the source tree.

## References

- GitHub CLI repository creation: https://cli.github.com/manual/gh_repo_create
- GitHub CLI browser login: https://cli.github.com/manual/gh_auth_login

The real remote creation/push is not tested in the offline development suite.
