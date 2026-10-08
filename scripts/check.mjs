import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, validateConfig } from '../extension/lib/core.js';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function walk(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory())
            files.push(...await walk(path));
        else if (/\.[cm]?js$/.test(entry.name))
            files.push(path);
    }
    return files.sort();
}
for (const directory of ['extension', 'tests', 'scripts']) {
    for (const path of await walk(join(root, directory))) {
        const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
        if (result.error || result.status !== 0)
            throw result.error || new Error(`Syntax check failed: ${path}`);
    }
}
const load = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const manifest = await load('extension/manifest.json');
const metadata = await load('package.json');
if (manifest.version !== APP_VERSION || metadata.version !== APP_VERSION)
    throw new Error('Application versions are out of sync.');
validateConfig(await load('extension/asignaturas.json'));
for (const path of [manifest.background.service_worker, ...Object.values(manifest.icons)]) {
    await readFile(join(root, 'extension', path));
}
console.log(`Syntax, manifest, configuration, assets and version ${APP_VERSION}: OK.`);
