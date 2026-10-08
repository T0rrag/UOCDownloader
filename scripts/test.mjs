import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Expand the test list in Node, not in a shell: works in PowerShell and Bash.
const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(new URL('../tests/', import.meta.url))
    .filter(name => name.endsWith('.test.js'))
    .sort()
    .map(name => `tests/${name}`);
if (!files.length)
    throw new Error('No unit tests found.');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error)
    throw result.error;
process.exitCode = result.status ?? 1;
