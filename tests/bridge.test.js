import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../extension/bridge.js', import.meta.url), 'utf8');
const origin = 'https://aula.uoc.edu';
function setup({ status = 200, mime = 'application/json', body = 'while(1);[]' } = {}) {
    let listener;
    const calls = [];
    const context = vm.createContext({ URL, btoa, AbortController, setTimeout, clearTimeout, location: { origin }, chrome: { runtime: { id: 'unit-test-id', getURL: path => 'chrome-extension://unit-test-id/' + path, onMessage: { addListener: fn => listener = fn } } }, fetch: async (url, options) => { calls.push({ url, options }); const response = new Response(body, { status, headers: { 'Content-Type': mime, 'Link': '<https://aula.uoc.edu/api/v1/courses?page=2>; rel="next"' } }); Object.defineProperty(response, 'url', { value: url }); return response; } });
    vm.runInContext(source, context);
    const send = (message, sender = { id: 'unit-test-id', url: 'chrome-extension://unit-test-id/manager.html' }) => new Promise(resolve => { const asyncResponse = listener(message, sender, resolve); if (!asyncResponse && !['UOC_PING', 'UOC_ABORT'].includes(message.type))
        resolve(undefined); });
    return { calls, send, listener, context };
}
test('bridge makes only same-origin GET with browser credentials', async () => { const x = setup(); const reply = await x.send({ type: 'UOC_GET_JSON', requestId: '1', url: origin + '/api/v1/courses/87938/assignments' }); assert.equal(reply.ok, true); assert.equal(x.calls[0].options.method, 'GET'); assert.equal(x.calls[0].options.credentials, 'same-origin'); assert.equal(x.calls[0].options.mode, 'same-origin'); assert.deepEqual(Object.keys(x.calls[0].options.headers), ['Accept']); assert.ok(reply.link.includes('rel="next"')); });
for (const path of ['/api/v1/courses/87938/assignments/1/submissions', '/api/v1/users/self/profile', '/api/v1/accounts/1', '/api/v1/courses/1/assignments/1?access_token=x', '/api/v1/courses?_method=DELETE', '/api/v1/courses/1/pages/a%2Fb', 'https://evil.example/api/v1/courses'])
    test('bridge rejects ' + path, async () => { const x = setup(); const r = await x.send({ type: 'UOC_GET_JSON', requestId: '2', url: path }); assert.equal(r.ok, false); assert.equal(x.calls.length, 0); });
test('bridge refuses messages from a web page', async () => { const x = setup(); const r = await x.send({ type: 'UOC_GET_JSON', requestId: '3', url: '/api/v1/courses' }, { id: 'unit-test-id', url: origin + '/' }); assert.equal(r, undefined); assert.equal(x.calls.length, 0); });
test('bridge refuses another extension', async () => { const x = setup(); const r = await x.send({ type: 'UOC_GET_JSON', requestId: '4', url: '/api/v1/courses' }, { id: 'another-extension', url: 'chrome-extension://another-extension/' }); assert.equal(r, undefined); assert.equal(x.calls.length, 0); });
test('bridge returns HTTP 401 without exposing a response body', async () => { const x = setup({ status: 401, body: 'private server detail' }); const r = await x.send({ type: 'UOC_GET_JSON', requestId: '5', url: '/api/v1/courses' }); assert.equal(r.status, 401); assert.match(r.error, /Session/); assert.ok(!JSON.stringify(r).includes('private server detail')); });
test('bridge rejects an HTML login page', async () => { const x = setup({ mime: 'text/html', body: '<html>Login</html>' }); const r = await x.send({ type: 'UOC_GET_JSON', requestId: '6', url: '/api/v1/courses' }); assert.equal(r.ok, false); assert.match(r.error, /non-JSON/); });
test('bridge accepts file metadata endpoint', async () => { const x = setup(); const r = await x.send({ type: 'UOC_GET_JSON', requestId: '7', url: '/api/v1/courses/87938/files/123' }); assert.equal(r.ok, true); });
test('bridge injection is idempotent', () => { const x = setup(); const first = x.listener; vm.runInContext(source, x.context); assert.equal(x.listener, first); });
test('binary bridge preserves bytes in bounded chunks', async () => {
    const body = Uint8Array.from({ length: 750000 }, (_, index) => index % 251);
    const x = setup({ mime: 'application/octet-stream', body });
    const opened = await x.send({ type: 'UOC_FILE_OPEN', courseId: 87938, fileId: 777, requestId: 'binary', maxBytes: 1000000 });
    assert.equal(opened.ok, true);
    const parts = [];
    while (true) {
        const r = await x.send({ type: 'UOC_FILE_READ', requestId: 'binary' });
        assert.equal(r.ok, true, r.error);
        if (r.done)
            break;
        const part = Buffer.from(r.base64, 'base64');
        assert.ok(part.length <= 256 * 1024);
        parts.push(part);
    }
    assert.deepEqual(new Uint8Array(Buffer.concat(parts)), body);
    assert.equal(x.calls[0].options.credentials, 'same-origin');
    assert.equal(x.calls[0].options.method, 'GET');
});
test('binary bridge rejects login HTML before transmitting content', async () => {
    const x = setup({ mime: 'text/html', body: '<html>login</html>' });
    const r = await x.send({ type: 'UOC_FILE_OPEN', courseId: 87938, fileId: 777, requestId: 'html', maxBytes: 100000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /HTML|login/);
});
test('binary bridge enforces limits while reading, not just metadata', async () => {
    const x = setup({ mime: 'application/octet-stream', body: new Uint8Array(500) });
    await x.send({ type: 'UOC_FILE_OPEN', courseId: 87938, fileId: 777, requestId: 'limit', maxBytes: 100 });
    const r = await x.send({ type: 'UOC_FILE_READ', requestId: 'limit' });
    assert.equal(r.ok, false);
    assert.match(r.error, /limit/);
});
test('binary bridge rejects arbitrary URL and path injection through IDs', async () => {
    const x = setup();
    const r = await x.send({ type: 'UOC_FILE_OPEN', courseId: '../users', fileId: 777, requestId: 'bad', maxBytes: 100 });
    assert.equal(r.ok, false);
    assert.equal(x.calls.length, 0);
});
test('binary bridge refuses binary reads from a page sender', async () => {
    const x = setup();
    const r = await x.send({ type: 'UOC_FILE_OPEN', courseId: 87938, fileId: 777, requestId: 'bad', maxBytes: 100 }, { id: 'unit-test-id', url: origin + '/' });
    assert.equal(r, undefined);
    assert.equal(x.calls.length, 0);
});
test('visible-page fallback allows only same-origin Canvas page GETs', async () => {
    const x = setup({ mime: 'text/html', body: '<div class="show-content user_content">Enunciado</div>' });
    const r = await x.send({ type: 'UOC_GET_HTML', requestId: 'html-page', url: '/courses/87938/pages/enunciado-de-la-pec1?module_item_id=3181955' });
    assert.equal(r.ok, true);
    assert.equal(x.calls[0].options.method, 'GET');
    assert.equal(x.calls[0].options.credentials, 'same-origin');
    assert.equal(x.calls[0].options.headers.Accept, 'text/html');
});
for (const url of ['/profile/settings', '/courses/87938/grades', '/courses/87938/assignments/1/submissions', 'https://evil.example/courses/87938/pages/test', '/courses/87938/pages/x?_method=DELETE'])
    test('visible-page fallback blocks ' + url, async () => {
        const x = setup({ mime: 'text/html' });
        const r = await x.send({ type: 'UOC_GET_HTML', requestId: 'bad-html', url });
        assert.equal(r.ok, false);
        assert.equal(x.calls.length, 0);
    });
