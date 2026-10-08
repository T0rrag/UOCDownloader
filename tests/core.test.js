import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeSegment, activityKeys, classify, resourceFilename, resourcePaths, parseCanvasJSON, nextPage, safeLink, validateDownloadURL, hashText, formatSize, validateConfig, GENERAL, REVIEW, ORIGIN } from '../extension/lib/core.js';
import { CanvasClient } from '../extension/lib/api.js';
const activities = ['PEC 1', 'PEC 2', 'PR1', 'PR2'];
for (const [input, expected] of [['PEC 1 — enunciado', ['PEC 1']], ['PAC_02', ['PEC 2']], ['Pràctica 1', ['PR1']], ['PR2 entrega', ['PR2']], ['pec-01.pdf', ['PEC 1']], ['PEC nº 2', ['PEC 2']], ['PR 10', [REVIEW]], ['PEC 1 y PEC 2', [REVIEW]], ['Material de apoyo', [GENERAL]]]) {
    test(`classification: ${input}`, () => assert.deepEqual(classify(input, activities), expected));
}
for (const input of ['Repte 01', 'Reto1', 'Challenge 1'])
    test(`Reto aliases: ${input}`, () => assert.deepEqual(classify(input, ['Reto 1']), ['Reto 1']));
test('preserves multi-activity references', () => assert.deepEqual(classify('tabla.xlsx', activities, ['PEC 1', 'PEC 2']), ['PEC 1', 'PEC 2']));
test('conflicting title and context go to review', () => assert.deepEqual(classify('PEC 1', activities, ['PEC 2']), [REVIEW]));
test('unknown assignment fallback is review', () => assert.deepEqual(classify('Actividad final', activities, [], REVIEW), [REVIEW]));
test('no match inside unrelated words', () => assert.deepEqual(activityKeys('expresiones 1 pruebas 2'), []));
for (const name of ['CON', 'con.txt', 'NUL', 'AUX.pdf', 'COM1.txt', 'LPT9', 'COM¹'])
    test(`reserved Windows name: ${name}`, () => assert.match(safeSegment(name), /^_/));
test('Spanish Unicode preserved', () => assert.equal(safeSegment('10º Sem — Diseño e información'), '10º Sem — Diseño e información'));
test('path controls sanitized', () => assert.equal(safeSegment('../x\\y:?.txt'), '.._x_y__.txt'));
test('empty and traversal segments neutralized', () => { assert.equal(safeSegment('..'), 'untitled'); assert.equal(safeSegment(''), 'untitled'); });
test('trailing spaces and dots removed', () => assert.equal(safeSegment('file.  '), 'file'));
test('file extension preserved after truncation', () => { const s = resourceFilename({ kind: 'file', id: 777, title: 'A'.repeat(300) + '.pdf' }); assert.ok(s.endsWith('[file-777].pdf')); assert.ok(s.length < 110); });
const item = { kind: 'file', id: 1, title: 'enunciado.pdf', courseFolder: '75.578 - Arquitectura de computadores', activities, destinations: ['PR1'] };
test('exact PR1 folder without added spaces', () => assert.equal(resourcePaths(item, '10º Sem')[0], '10º Sem/75.578 - Arquitectura de computadores/PR1/00. Enunciado/enunciado [file-1].pdf'));
test('general destination has no Enunciado child', () => assert.ok(!resourcePaths({ ...item, destinations: [GENERAL] }, '10º Sem')[0].includes('00. Enunciado')));
test('multiple destinations produce two paths', () => assert.equal(resourcePaths({ ...item, destinations: ['PEC 1', 'PEC 2'] }, '10º Sem').length, 2));
test('override replaces auto destinations', () => assert.ok(resourcePaths({ ...item, override: 'PEC 2' }, '10º Sem')[0].includes('/PEC 2/')));
test('cannot target Trabajo or Entrega', () => assert.throws(() => resourcePaths({ ...item, override: '01. Trabajo' }, '10º Sem')));
test('standard JSON', () => assert.deepEqual(parseCanvasJSON('[{"id":1}]'), [{ id: 1 }]));
test('Canvas anti-hijacking prefix', () => assert.deepEqual(parseCanvasJSON('while(1);[{"id":1}]'), [{ id: 1 }]));
test('BOM and whitespace prefix', () => assert.deepEqual(parseCanvasJSON('\uFEFF while ( 1 ) ; []'), []));
test('invalid JSON rejected without eval', () => assert.throws(() => parseCanvasJSON('alert(1)')));
test('opaque pagination URL preserved', () => { const url = ORIGIN + '/api/v1/courses/1/files?opaque=a%2Bb&page=2'; assert.equal(nextPage(`<${ORIGIN}/api/v1/courses/1/files>; rel="current", <${url}>; rel="next"`), url); });
test('pagination without next terminates', () => assert.equal(nextPage('<https://aula.uoc.edu/api/v1/courses>; rel="last"'), null));
for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///C:/secret', 'http://localhost/file', 'https://127.0.0.1/file', 'https://10.2.3.4/file', 'https://192.168.1.1/file', 'https://172.16.0.1/file', 'https://[::1]/file', 'https://u:p@aula.uoc.edu/file', ''])
    test(`unsafe link rejected: ${url}`, () => assert.equal(safeLink(url), null));
test('removes signed parameters from persisted links', () => assert.equal(safeLink('/files/1?verifier=secret&download=1&X-Amz-Signature=abc&access_token=secret'), ORIGIN + '/files/1?download=1'));
test('HTTPS metadata URL permits public CDN', () => assert.equal(validateDownloadURL('https://cdn.example.edu/file.pdf?signature=secret'), 'https://cdn.example.edu/file.pdf?signature=secret'));
test('no insecure downloads', () => assert.throws(() => validateDownloadURL('http://example.edu/file.pdf')));
test('hash stable and content sensitive', () => { assert.equal(hashText('abc'), hashText('abc')); assert.notEqual(hashText('abc'), hashText('abcd')); });
test('unknown size not shown as zero', () => assert.equal(formatSize(null), 'Unknown size'));
test('config contains five courses and 21 activities', async () => { const config = validateConfig(JSON.parse(await readFile(new URL('../extension/asignaturas.json', import.meta.url), 'utf8'))); assert.equal(config.courses.length, 5); assert.equal(config.courses.reduce((n, c) => n + c.activities.length, 0), 21); });
test('wrong config origin rejected', () => assert.throws(() => validateConfig({ base_url: 'https://evil.example', courses: [] })));
test('list follows all pages', async () => { const c = new CanvasClient(); let n = 0; c.get = async () => ++n === 1 ? { data: [{ id: 1 }], link: `<${ORIGIN}/api/v1/courses?page=2>; rel="next"` } : { data: [{ id: 2 }], link: '' }; assert.deepEqual(await c.list('/api/v1/courses'), [{ id: 1 }, { id: 2 }]); });
test('pagination loops rejected', async () => { const c = new CanvasClient(); c.get = async () => ({ data: [], link: `<${ORIGIN}/api/v1/courses?page=2>; rel="next"` }); await assert.rejects(() => c.list('/api/v1/courses'), /loop/); });
test('non-array list rejected', async () => { const c = new CanvasClient(); c.get = async () => ({ data: { login: 'required' }, link: '' }); await assert.rejects(() => c.list('/api/v1/courses'), /list/); });
test('cross-origin API request rejected before chrome call', async () => { const c = new CanvasClient(); await assert.rejects(() => c.get('https://evil.example/api/v1/courses'), /cross-origin/); });
test('stop prevents another API request', async () => { const c = new CanvasClient(); c.stopped = true; await assert.rejects(() => c.list('/api/v1/courses'), /Stopped/); });
test('manifest uses minimal permissions and no cookie access', async () => { const m = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')); assert.equal(m.manifest_version, 3); assert.deepEqual(m.permissions, ['scripting', 'downloads', 'storage']); assert.deepEqual(m.host_permissions, [ORIGIN + '/*']); assert.ok(!m.externally_connectable); });
test('long page identifiers with identical prefixes cannot collide after filename truncation', () => {
    const a = { kind: 'page', id: 'a'.repeat(80) + 'one', title: 'Same title' }, b = { ...a, id: 'a'.repeat(80) + 'two' };
    assert.notEqual(resourceFilename(a), resourceFilename(b));
});
