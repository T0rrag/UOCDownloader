import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { ZipWriter, crc32 } from '../extension/lib/zip.js';
import { skeletonDirectories } from '../extension/lib/tree.js';
const encoder = new TextEncoder();
function entries(buffer) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer), decoder = new TextDecoder(), result = [];
    let at = 0;
    while (view.getUint32(at, true) === 0x04034b50) {
        const size = view.getUint32(at + 18, true), nameSize = view.getUint16(at + 26, true), extra = view.getUint16(at + 28, true);
        const start = at + 30 + nameSize + extra;
        result.push({ name: decoder.decode(bytes.slice(at + 30, at + 30 + nameSize)), crc: view.getUint32(at + 14, true),
            flags: view.getUint16(at + 6, true), method: view.getUint16(at + 8, true), bytes: bytes.slice(start, start + size) });
        at = start + size;
    }
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const end = bytes.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054b50);
    assert.equal(view.getUint16(end + 8, true), result.length);
    assert.equal(view.getUint32(end + 16, true), at);
    return result;
}
test('CRC-32 matches the standard test vector and supports incremental chunks', () => {
    assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);
    assert.equal(crc32(encoder.encode('56789'), crc32(encoder.encode('1234'))), 0xcbf43926);
});
test('ZIP round trip preserves UTF-8 names, binary bytes and empty directories', async () => {
    const zip = new ZipWriter();
    const content = Uint8Array.from([0, 255, 12, 128, 194, 169]);
    await zip.addDirectory('10º Sem/Información/01. Trabajo/');
    await zip.add('10º Sem/Información/enunciado.pdf', content);
    const parsed = entries(await zip.toBlob().arrayBuffer());
    assert.equal(parsed[0].name, '10º Sem/Información/01. Trabajo/');
    assert.equal(parsed[0].bytes.length, 0);
    assert.equal(parsed[1].flags & 0x800, 0x800);
    assert.equal(parsed[1].method, 0);
    assert.deepEqual(parsed[1].bytes, content);
    assert.equal(parsed[1].crc, crc32(content));
});
for (const path of ['../secret', '/absolute', 'A/../secret', 'C:/absolute', 'A\\B', 'A//B', 'A/./B']) {
    test('ZIP writer rejects unsafe path ' + path, async () => { const zip = new ZipWriter(); await assert.rejects(() => zip.add(path, 'x'), /Unsafe/); });
}
test('duplicate directories are idempotent, duplicate files fail', async () => {
    const zip = new ZipWriter();
    await zip.addDirectory('A/');
    await zip.addDirectory('A/');
    await zip.add('A/file.txt', 'first');
    await assert.rejects(() => zip.add('A/file.txt', 'second'), /Duplicate/);
    assert.equal(zip.entries.length, 2);
});
test('total ZIP size limit includes central directory and headers', async () => {
    const zip = new ZipWriter({ maxBytes: 120 });
    await assert.rejects(() => zip.add('test.txt', new Uint8Array(100)), /size limit/);
    assert.equal(zip.entries.length, 0);
});
test('Stop interrupts packing before emitting archive bytes', async () => {
    let stop = false;
    const zip = new ZipWriter({ shouldStop: () => stop });
    await zip.addDirectory('A/');
    stop = true;
    await assert.rejects(() => zip.add('A/test.txt', 'hello'), /Stopped/);
    assert.throws(() => zip.toBlob(), /Stopped/);
});
test('large binary uses bounded hashing and exact CRC', async () => {
    const content = Uint8Array.from({ length: 750000 }, (_, index) => index % 251);
    const zip = new ZipWriter();
    await zip.add('large.bin', content);
    const [entry] = entries(await zip.toBlob().arrayBuffer());
    assert.deepEqual(entry.bytes, content);
    assert.equal(entry.crc, crc32(content));
});
test('legacy 90 semester folders exported as explicit entries for extraction', async () => {
    const config = JSON.parse(await readFile(new URL('../extension/asignaturas.json', import.meta.url), 'utf8'));
    config.courses = config.courses.map(({ layout, ...course }) => course);
    const zip = new ZipWriter();
    for (const directory of skeletonDirectories(config.courses, config.semester_folder))
        await zip.addDirectory(directory);
    await zip.add('10º Sem/SYNTHETIC_TEST.txt', 'Synthetic test only. No UOC account or materials were accessed.\n');
    const blob = zip.toBlob(), parsed = entries(await blob.arrayBuffer());
    assert.equal(parsed.length, 91);
    assert.equal(parsed.filter(entry => entry.name.endsWith('/02. Entrega/')).length, 21);
    const dir = new URL('./artifacts/', import.meta.url);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL('synthetic-structure.zip', dir), new Uint8Array(await blob.arrayBuffer()));
});
