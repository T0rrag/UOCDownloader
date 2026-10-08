import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION, APP_NAME, ORIGIN, safeLink, sanitizeMessage, validateConfig } from '../extension/lib/core.js';
const config = () => ({ base_url: ORIGIN, semester_folder: '10º Sem', courses: [{ id: 1, folder: 'Compiladores', activities: ['PEC 1'] }] });
test('application identity matches both manifests', async () => {
    const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    assert.equal((await read('../package.json')).version, APP_VERSION);
    assert.equal((await read('../extension/manifest.json')).version, APP_VERSION);
    assert.equal((await read('../extension/manifest.json')).name, APP_NAME);
});
test('public diagnostic links strip fragments that might carry OAuth tokens', () => {
    assert.equal(safeLink('https://aula.uoc.edu/courses/1#access_token=PRIVATE'), 'https://aula.uoc.edu/courses/1');
});
test('diagnostic messages redact URLs, bearer tokens and common secrets', () => {
    assert.equal(sanitizeMessage('Failed https://example.org/?signature=SECRET Bearer PRIVATE api_key=HIDDEN'), 'Failed [URL omitted] Bearer [REDACTED] api_key=[REDACTED]');
});
test('ordinary diagnostic messages remain readable', () => assert.equal(sanitizeMessage('HTTP 403 — file locked.'), 'HTTP 403 — file locked.'));
test('valid configuration remains unchanged', () => { const value = config(); assert.equal(validateConfig(value), value); });
for (const semester of ['', '../work', 'C:\\UOC', 3, 'folder.']) {
    test(`rejects invalid semester name ${JSON.stringify(semester)}`, () => assert.throws(() => validateConfig({ ...config(), semester_folder: semester }), /semester folder/i));
}
for (const folder of ['', '../files', 'CON', 3, 'x/y', 'folder.']) {
    test(`rejects invalid course folder ${JSON.stringify(folder)}`, () => {
        const value = config();
        value.courses[0].folder = folder;
        assert.throws(() => validateConfig(value), /course folder/i);
    });
}
test('case-insensitive course folder collisions are rejected', () => {
    const value = config();
    value.courses.push({ ...value.courses[0], id: 2, folder: 'compiladores' });
    assert.throws(() => validateConfig(value), /unique.*Windows/);
});
