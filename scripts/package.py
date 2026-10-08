#!/usr/bin/env python3
"""Build source/install ZIPs from an explicit source allowlist, never local exports."""
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOP_FILES = (
    '.gitignore', '.gitattributes', '.editorconfig', 'README.md', 'CHANGELOG.md',
    'TESTING.md', 'SECURITY.md', 'package.json', 'requirements-dev.txt',
)
DIRECTORIES = {
    'extension': {'.js', '.json', '.html', '.css', '.png'},
    'tests': {'.js', '.py'},
    'scripts': {'.mjs', '.py'},
    'docs': {'.md'},
    '.github': {'.yml'},
}


def source_files(root=ROOT):
    files = [root / name for name in TOP_FILES]
    for folder, suffixes in DIRECTORIES.items():
        for path in (root / folder).rglob('*'):
            if path.is_symlink():
                raise ValueError(f'Symlinks are not packaged: {path}')
            if path.is_file() and path.suffix in suffixes and '__pycache__' not in path.parts:
                files.append(path)
    for path in files:
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or unsafe source file: {path}')
    return sorted(files)


def main():
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    files = source_files()
    manifest = {
        'version': version,
        'purpose': 'Initial source-upload allowlist, not downloaded coursework.',
        'files': [
            {'path': path.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in files
        ],
    }
    manifest_path = ROOT / 'SOURCE_MANIFEST.json'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    source = output / f'UOC-Downloader-{version}-source.zip'
    with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in [*files, manifest_path]:
            archive.write(path, 'UOC-Downloader/' + path.relative_to(ROOT).as_posix())
    extension = output / f'UOC-Downloader-{version}-extension.zip'
    with zipfile.ZipFile(extension, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            if path.is_relative_to(ROOT / 'extension'):
                # manifest.json sits at the extraction root to avoid the earlier install mistake.
                archive.write(path, path.relative_to(ROOT / 'extension').as_posix())
    for path in (source, extension):
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('Invalid generated ZIP.')
        print(f'{path.name}  SHA256 {hashlib.sha256(path.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
