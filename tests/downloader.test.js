import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipDownloader } from '../extension/lib/downloader.js';
const course = { id: 87938, folder: '75.578 - Arquitectura de computadores', activities: ['PEC 1', 'PEC 2', 'PR1', 'PR2'] };
const resource = () => ({ key: 'file:777', id: 777, kind: 'file', title: 'brief.pdf', courseId: course.id, courseFolder: course.folder,
    activities: course.activities, destinations: ['PEC 1'], selected: true, size: 3, source: 'https://aula.uoc.edu/files/777?verifier=SECRET' });
const options = { root: '10º Sem', courses: [course], maxBytes: 1024 ** 2, maxZipBytes: 4 * 1024 ** 2 };
function setup(reader = { read: async () => new Blob(['PDF']), stop: async () => { } }) {
    const calls = [], blobs = new Map();
    let next = 1;
    globalThis.chrome = { downloads: { download: async (params) => { calls.push(params); blobs.set(next, await (await fetch(params.url)).blob()); return next++; },
            search: async ({ id }) => [{ id, state: 'complete', danger: 'safe' }], cancel: async () => { } } };
    return { downloader: new ZipDownloader({ stopped: false }, () => { }, () => { }, reader), calls, blobs };
}
test('one export calls Chrome downloads exactly once and saves a ZIP blob', async () => {
    const { downloader, calls, blobs } = setup();
    const result = await downloader.run([resource()], options);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filename, '10º Sem.zip');
    assert.equal(calls[0].conflictAction, 'uniquify');
    assert.equal(result.archiveSaved, true);
    assert.equal(blobs.get(1).type, 'application/zip');
    assert.equal(result.results[0].outcome, 'packed');
    assert.equal(result.planned, 1);
});
test('repeated exports contain all selected resources; no historical skip', async () => {
    let reads = 0;
    const reader = { read: async () => { reads++; return new Blob(['PDF']); }, stop: async () => { } };
    const first = setup(reader);
    await first.downloader.run([resource()], options);
    const second = setup(reader);
    await second.downloader.run([resource()], options);
    assert.equal(reads, 2);
    assert.equal(second.calls.length, 1);
});
test('shared file is read once and copied into both selected activity destinations', async () => {
    let reads = 0;
    const { downloader } = setup({ read: async () => { reads++; return new Blob(['PDF']); }, stop: async () => { } });
    const { result } = await downloader.build([{ ...resource(), destinations: ['PEC 1', 'PEC 2'] }], options);
    assert.equal(reads, 1);
    assert.equal(result.results.length, 2);
});
test('unchecked destinations are not packed', async () => {
    const { downloader } = setup();
    const { result } = await downloader.build([{ ...resource(), destinations: ['PEC 1', 'PEC 2'], selection: { 'PEC 1': false } }], options);
    assert.equal(result.planned, 1);
    assert.match(result.results[0].path, /PEC 2/);
});
test('failed file prevents archive download by default', async () => {
    const { downloader, calls } = setup({ read: async () => { throw new Error('File inaccessible'); }, stop: async () => { } });
    await assert.rejects(() => downloader.run([resource()], options), /No ZIP was saved/);
    assert.equal(calls.length, 0);
    assert.equal(downloader.result.results[0].outcome, 'failed');
});
test('explicit partial option saves one visibly marked archive', async () => {
    const { downloader, calls } = setup({ read: async () => { throw new Error('File inaccessible'); }, stop: async () => { } });
    const result = await downloader.run([resource()], { ...options, allowPartial: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filename, '10º Sem-partial.zip');
    assert.equal(result.partial, true);
});
test('folder-only export works and does not fetch any attachments', async () => {
    let reads = 0;
    const { downloader, calls } = setup({ read: async () => { reads++; }, stop: async () => { } });
    const result = await downloader.run([], options);
    assert.equal(reads, 0);
    assert.equal(calls.length, 1);
    assert.equal(result.planned, 0);
    assert.equal(result.entryCount, 20); // 18 skeleton dirs + reports dir + report
});
test('Stop discards unsaved content even when partial archives are allowed', async () => {
    const { downloader, calls } = setup();
    downloader.stopped = true;
    await assert.rejects(() => downloader.run([resource()], { ...options, allowPartial: true }), /Stopped/);
    assert.equal(calls.length, 0);
});
test('per-file runtime limit blocks oversized content despite smaller metadata', async () => {
    const { downloader, calls } = setup({ read: async () => new Blob([new Uint8Array(2000)]), stop: async () => { } });
    await assert.rejects(() => downloader.run([resource()], { ...options, maxBytes: 100 }), /No ZIP was saved/);
    assert.match(downloader.result.results[0].detail, /size limit/);
    assert.equal(calls.length, 0);
});
test('archive includes no copied signed query values or authorization data', async () => {
    const { downloader } = setup();
    const { blob } = await downloader.build([resource()], options);
    assert.ok(!(await blob.text()).includes('verifier=SECRET'));
});
test('total ZIP cap is enforced before reading a known-oversized attachment', async () => {
    let reads = 0;
    const { downloader, calls } = setup({ read: async () => { reads++; return new Blob(['a']); }, stop: async () => { } });
    await assert.rejects(() => downloader.run([{ ...resource(), size: 50000 }], { ...options, maxZipBytes: 20000 }), /No ZIP was saved/);
    assert.equal(reads, 0);
    assert.equal(calls.length, 0);
});
test('an incomplete Contenidos scan prevents a misleading complete ZIP', async () => {
    const { downloader, calls } = setup();
    await assert.rejects(() => downloader.run([], options, { scanIncomplete: true }), /scan is incomplete/);
    assert.equal(calls.length, 0);
});
test('an explicitly allowed incomplete scan is marked partial even when every selected file succeeds', async () => {
    const { downloader, calls } = setup();
    const result = await downloader.run([resource()], { ...options, allowPartial: true }, { scanIncomplete: true });
    assert.equal(result.partial, true);
    assert.equal(calls[0].filename, '10º Sem-partial.zip');
});
