"""Offline tests for initial publication safeguards. Git/GitHub calls are mocked."""
import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'publish.py'
SPEC = importlib.util.spec_from_file_location('uoc_publish', SCRIPT)
PUBLISH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PUBLISH)


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.body = b'# Synthetic source\n'
        (self.root / 'README.md').write_bytes(self.body)
        self.entries = [{'path': 'README.md', 'sha256': hashlib.sha256(self.body).hexdigest()}]
        self.save_manifest()

    def tearDown(self):
        self.directory.cleanup()

    def save_manifest(self):
        (self.root / 'SOURCE_MANIFEST.json').write_text(json.dumps({'files': self.entries}), encoding='utf-8')

    def test_only_manifest_listed_source_is_staged(self):
        (self.root / '.env').write_text('SYNTHETIC_SECRET', encoding='utf-8')
        self.assertEqual(PUBLISH.checked_sources(self.root), ['README.md', 'SOURCE_MANIFEST.json'])

    def test_changed_source_is_rejected(self):
        (self.root / 'README.md').write_text('Changed', encoding='utf-8')
        with self.assertRaises(ValueError):
            PUBLISH.checked_sources(self.root)

    def test_traversal_is_rejected(self):
        self.entries[0]['path'] = '../README.md'
        self.save_manifest()
        with self.assertRaises(ValueError):
            PUBLISH.checked_sources(self.root)

    def test_windows_style_separator_is_rejected(self):
        self.entries[0]['path'] = 'folder\\README.md'
        self.save_manifest()
        with self.assertRaises(ValueError):
            PUBLISH.checked_sources(self.root)

    def test_duplicate_paths_are_rejected(self):
        self.entries *= 2
        self.save_manifest()
        with self.assertRaises(ValueError):
            PUBLISH.checked_sources(self.root)

    def test_dry_run_never_invokes_git_or_github(self):
        with patch.object(PUBLISH, 'run') as call, contextlib.redirect_stdout(io.StringIO()):
            PUBLISH.publish(self.root, execute=False)
        call.assert_not_called()
        self.assertFalse((self.root / '.git').exists())

    def test_existing_local_repository_is_not_modified(self):
        (self.root / '.git').mkdir()
        with patch.object(PUBLISH.shutil, 'which', return_value='mock'), patch.object(PUBLISH, 'run') as call, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                PUBLISH.publish(self.root, execute=True)
        call.assert_not_called()

    def test_wrong_account_never_starts_git_writes(self):
        with patch.object(PUBLISH.shutil, 'which', return_value='mock'), patch.object(PUBLISH, 'run', return_value=json.dumps({'login': 'other-user', 'id': 7})) as call, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                PUBLISH.publish(self.root, execute=True)
        self.assertEqual(len(call.call_args_list), 1)
        self.assertEqual(call.call_args_list[0].args[0], ['gh', 'api', 'user'])

    def test_successful_plan_is_private_and_verifies_remote_commit(self):
        calls = []
        def mock_run(command, **kwargs):
            calls.append(command)
            if command[:3] == ['gh', 'api', 'user']:
                return json.dumps({'login': 'T0rrag', 'id': 123})
            if command[:3] == ['gh', 'repo', 'view']:
                return json.dumps({'nameWithOwner': 'T0rrag/UOC-Downloader', 'isPrivate': True, 'url': 'https://github.com/T0rrag/UOC-Downloader'})
            if command[:2] == ['git', 'rev-parse']:
                return 'a' * 40
            if command[:2] == ['git', 'ls-remote']:
                return 'a' * 40 + '\trefs/heads/main'
            return ''
        with patch.object(PUBLISH.shutil, 'which', return_value='mock'), patch.object(PUBLISH, 'run', side_effect=mock_run), contextlib.redirect_stdout(io.StringIO()):
            PUBLISH.publish(self.root, execute=True)
        creation = next(command for command in calls if command[:3] == ['gh', 'repo', 'create'])
        self.assertIn('--private', creation)
        self.assertIn('--push', creation)
        self.assertFalse(any('--force' in command or '--global' in command for command in calls))
        self.assertEqual(next(command for command in calls if command[:2] == ['git', 'add']), ['git', 'add', '--', 'README.md', 'SOURCE_MANIFEST.json'])
        self.assertEqual(calls[-1], ['git', 'ls-remote', 'origin', 'refs/heads/main'])


if __name__ == '__main__':
    unittest.main()
