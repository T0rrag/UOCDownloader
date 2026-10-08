import test from 'node:test';
import assert from 'node:assert/strict';
import { FileReaderClient, attachmentOrigins } from '../extension/lib/files.js';
const item = () => ({ id: 777, key: 'f', kind: 'file', courseId: 87938, title: 'test.bin' });
const metadata = { id: 777, size: 6, filename: 'test.bin', url: 'https://downloads.example.edu/test.bin?verifier=secret', 'content-type': 'application/octet-stream' };
function setup({ blocked = false, granted = false, status = 0, body = Uint8Array.from([0, 255, 1, 128, 2, 0]), mime = 'application/octet-stream', locked = false } = {}) {
    const messages = [], calls = [];
    let consumed = false;
    globalThis.chrome = { tabs: { sendMessage: async (_tab, message) => {
                messages.push(message);
                if (message.type === 'UOC_FILE_OPEN')
                    return blocked ? { ok: false, status, error: status ? `File returned HTTP ${status}` : 'CORS' } : { ok: true, mime };
                if (message.type === 'UOC_FILE_READ') {
                    if (consumed)
                        return { ok: true, done: true };
                    consumed = true;
                    return { ok: true, done: false, base64: Buffer.from(body).toString('base64') };
                }
                return { ok: true };
            } }, permissions: { contains: async () => granted } };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        const response = new Response(body, { headers: { 'Content-Type': mime } });
        Object.defineProperty(response, 'url', { value: url });
        return response;
    };
    const api = { tabId: 3, stopped: false, get: async () => ({ data: { ...metadata, locked_for_user: locked } }), stop: async () => { api.stopped = true; } };
    return { reader: new FileReaderClient(api), api, messages, calls, restore: () => { globalThis.fetch = originalFetch; } };
}
test('file reader round-trips binary session chunks without direct network access', async () => {
    const x = setup();
    try {
        const blob = await x.reader.read(item(), 1000);
        assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), Uint8Array.from([0, 255, 1, 128, 2, 0]));
        assert.equal(x.calls.length, 0);
        assert.equal(x.messages.at(-1).type, 'UOC_FILE_CLOSE');
    }
    finally {
        x.restore();
    }
});
test('optional file hosts are deduplicated and cannot be insecure or local', () => {
    assert.deepEqual(attachmentOrigins([{ ...item(), downloadOrigin: 'https://downloads.example.edu' }, { ...item(), downloadOrigin: 'https://downloads.example.edu' }, { ...item(), downloadOrigin: 'https://aula.uoc.edu' }, { ...item(), downloadOrigin: 'http://evil.example' }, { ...item(), downloadOrigin: 'https://127.0.0.1' }]), ['https://downloads.example.edu/*']);
});
test('CORS fallback requires explicit host permission before direct fetch', async () => {
    const x = setup({ blocked: true });
    try {
        await assert.rejects(() => x.reader.read(item(), 1000), /Allow attachment hosts/);
        assert.equal(x.calls.length, 0);
    }
    finally {
        x.restore();
    }
});
test('approved external file-host fetch omits cookies, auth headers and referrer', async () => {
    const x = setup({ blocked: true, granted: true });
    try {
        await x.reader.read(item(), 1000);
        assert.equal(x.calls.length, 1);
        assert.equal(x.calls[0].options.credentials, 'omit');
        assert.equal(x.calls[0].options.method, 'GET');
        assert.equal(x.calls[0].options.referrerPolicy, 'no-referrer');
        assert.equal(x.calls[0].options.headers, undefined);
    }
    finally {
        x.restore();
    }
});
test('403 file read does not retry through an external host', async () => {
    const x = setup({ blocked: true, granted: true, status: 403 });
    try {
        await assert.rejects(() => x.reader.read(item(), 1000), /403/);
        assert.equal(x.calls.length, 0);
    }
    finally {
        x.restore();
    }
});
test('locked file metadata is checked before binary reads', async () => {
    const x = setup({ locked: true });
    try {
        await assert.rejects(() => x.reader.read(item(), 1000), /locked/);
        assert.equal(x.messages.length, 0);
    }
    finally {
        x.restore();
    }
});
test('runtime session stream limit rejects oversized decoded data', async () => {
    const x = setup({ body: new Uint8Array(100) });
    try {
        await assert.rejects(() => x.reader.read(item(), 10), /limit/);
        assert.equal(x.calls.length, 0);
    }
    finally {
        x.restore();
    }
});
test('fallback fetch rejects HTML masquerading as a binary file', async () => {
    const x = setup({ blocked: true, granted: true, mime: 'text/html', body: '<html>Log in</html>' });
    try {
        await assert.rejects(() => x.reader.read(item(), 1000), /HTML|login/);
    }
    finally {
        x.restore();
    }
});
test('direct material links are fetched without a Canvas file ID or metadata lookup', async () => {
    const x = setup({ granted: true });
    let lookups = 0;
    x.api.get = async () => { lookups++; throw new Error('must not call Canvas metadata for an external file'); };
    try {
        const external = { ...item(), kind: 'externalFile', id: 'hashed', downloadURL: 'https://downloads.example.edu/resource.pdf', title: 'resource.pdf' };
        const blob = await x.reader.read(external, 1000);
        assert.equal(blob.size, 6);
        assert.equal(lookups, 0);
        assert.equal(x.calls[0].options.credentials, 'omit');
    }
    finally {
        x.restore();
    }
});
