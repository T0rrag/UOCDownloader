#!/usr/bin/env python3
"""Initial private GitHub upload. No execution unless --execute is provided.
Requires Git + GitHub CLI authenticated locally. Never accepts tokens as arguments.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
OWNER = 'T0rrag'
REPOSITORY = f'{OWNER}/UOC-Downloader'


def checked_sources(root):
    """Only package-verified source paths can enter the initial commit."""
    manifest_path = root / 'SOURCE_MANIFEST.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    paths = []
    for entry in manifest['files']:
        path = PurePosixPath(entry['path'])
        if path.is_absolute() or '..' in path.parts or '\\' in str(path) or not path.parts:
            raise ValueError('Unsafe source path in the manifest.')
        local = root.joinpath(*path.parts)
        if not local.resolve().is_relative_to(root.resolve()) or local.is_symlink():
            raise ValueError(f'Unsafe source file: {path}')
        if not local.is_file() or hashlib.sha256(local.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError(f'Source changed or missing: {path}. Rebuild with python scripts/package.py after reviewing edits.')
        paths.append(path.as_posix())
    if not paths or len(paths) != len(set(paths)):
        raise ValueError('The source manifest is empty or contains duplicate paths.')
    return sorted(paths) + ['SOURCE_MANIFEST.json']


def run(command, *, capture=False, cwd=ROOT):
    result = subprocess.run(command, cwd=cwd, text=True, encoding='utf-8',
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None, check=False)
    if result.returncode:
        # Do not echo subprocess output that could contain authentication data.
        raise RuntimeError(f'{command[0]} {command[1]} failed (exit {result.returncode}). No force-push or overwrite was attempted.')
    return result.stdout.strip() if capture else ''


def publish(root=ROOT, execute=False):
    paths = checked_sources(root)
    print(f'Target: {REPOSITORY} (PRIVATE), branch main; {len(paths)} source files.')
    if not execute:
        print('Dry run only: no commands, commits, repositories or uploads were created.')
        print('Execute after local GitHub login: python scripts/publish.py --execute')
        return
    for executable in ('git', 'gh'):
        if not shutil.which(executable):
            raise RuntimeError(f'Install {executable} before publishing.')
    if any((folder / '.git').exists() for folder in [root, *root.parents]):
        raise RuntimeError('Use a fresh extracted source folder outside any existing Git repository. Existing Git history will not be modified.')
    profile = json.loads(run(['gh', 'api', 'user'], capture=True, cwd=root))
    if profile.get('login', '').lower() != OWNER.lower():
        raise RuntimeError(f'Authenticate GitHub CLI as {OWNER} before publishing. The connected ChatGPT account is separate.')
    user_id = profile.get('id')
    if not isinstance(user_id, int) or isinstance(user_id, bool) or user_id <= 0:
        raise RuntimeError('Unexpected GitHub profile response.')
    print('Creating the initial source-only commit. No global Git settings are changed.')
    run(['git', 'init', '-b', 'main'], cwd=root)
    run(['git', 'config', 'user.name', profile['login']], cwd=root)
    run(['git', 'config', 'user.email', f"{user_id}+{profile['login']}@users.noreply.github.com"], cwd=root)
    run(['git', 'add', '--', *paths], cwd=root)
    run(['git', 'commit', '-m', 'Initial UOC Downloader source: module folders and single ZIP export'], cwd=root)
    # gh refuses to create a repository that already exists; this never force-pushes.
    run(['gh', 'repo', 'create', REPOSITORY, '--private', '--description',
         'Read-only Chrome extension for organizing accessible UOC Canvas materials into one semester ZIP.',
         '--source', str(root), '--remote', 'origin', '--push'], cwd=root)
    actual = json.loads(run(['gh', 'repo', 'view', REPOSITORY, '--json', 'nameWithOwner,isPrivate,url'], capture=True, cwd=root))
    if actual.get('nameWithOwner', '').lower() != REPOSITORY.lower() or not actual.get('isPrivate'):
        raise RuntimeError('Repository metadata did not confirm the expected private destination.')
    local_sha = run(['git', 'rev-parse', 'HEAD'], capture=True, cwd=root)
    remote = run(['git', 'ls-remote', 'origin', 'refs/heads/main'], capture=True, cwd=root)
    if not remote or remote.split()[0] != local_sha:
        raise RuntimeError('The remote main commit could not be verified.')
    print(f"Uploaded and verified: {actual['url']}\nCommit: {local_sha}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true', help='Create the private repository and push the verified source.')
    args = parser.parse_args()
    try:
        publish(execute=args.execute)
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f'Publication not completed: {error}', file=sys.stderr)
        print('A failed creation/push may leave a local commit or an empty remote repository. Inspect before retrying; nothing is deleted automatically.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
