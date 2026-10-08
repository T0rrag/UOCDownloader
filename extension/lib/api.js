import { ORIGIN, MAX_PAGES, MAX_RESOURCES, parseCanvasJSON, nextPage, sleep } from './core.js';
export class CanvasClient {
    constructor(log = () => { }) { this.tabId = null; this.stopped = false; this.log = log; }
    async connect() {
        this.stopped = false;
        const tabs = await chrome.tabs.query({ url: `${ORIGIN}/*` });
        tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
        if (!tabs.length)
            throw new Error('Open UOC and sign in in this Chrome profile, then try again. Keep that tab open.');
        let connected = false;
        for (const tab of tabs) {
            try {
                await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['bridge.js'] });
                const answer = await chrome.tabs.sendMessage(tab.id, { type: 'UOC_PING' }, { frameId: 0 });
                if (answer?.ok) {
                    this.tabId = tab.id;
                    connected = true;
                    break;
                }
            }
            catch { /* Try another UOC tab, never another origin. */ }
        }
        if (!connected)
            throw new Error('Could not connect to a UOC tab. Refresh UOC and allow this extension on aula.uoc.edu.');
        const result = await this.get('/api/v1/courses?per_page=1');
        if (!Array.isArray(result.data))
            throw new Error('Unexpected courses response. Session access has not been confirmed.');
        return this.tabId;
    }
    assertRunning() { if (this.stopped)
        throw new Error('Stopped by user.'); }
    async stop() {
        this.stopped = true;
        if (this.tabId !== null) {
            try {
                await chrome.tabs.sendMessage(this.tabId, { type: 'UOC_ABORT' }, { frameId: 0 });
            }
            catch { }
        }
    }
    async get(path) {
        this.assertRunning();
        const url = new URL(path, ORIGIN);
        if (url.origin !== ORIGIN || url.username || url.password)
            throw new Error('Blocked cross-origin API or pagination URL.');
        for (let attempt = 0; attempt < 3; attempt++) {
            this.assertRunning();
            let reply;
            try {
                reply = await chrome.tabs.sendMessage(this.tabId, { type: 'UOC_GET_JSON', url: url.href, requestId: crypto.randomUUID() }, { frameId: 0 });
            }
            catch {
                throw new Error('Lost the UOC tab connection. Keep UOC open; reconnect after signing in or refreshing.');
            }
            if (reply?.ok) {
                try {
                    return { data: parseCanvasJSON(reply.text), link: reply.link };
                }
                catch {
                    throw new Error('Canvas returned invalid JSON. The session may have expired.');
                }
            }
            if ([429, 500, 502, 503, 504].includes(reply?.status) && attempt < 2) {
                const seconds = Number(reply.retryAfter);
                const dateWait = (Date.parse(reply.retryAfter) - Date.now()) / 1000;
                const delay = Math.min(60, Math.max(1, Number.isFinite(seconds) && seconds > 0 ? seconds : Number.isFinite(dateWait) && dateWait > 0 ? dateWait : 2 ** (attempt + 1)));
                this.log(`Canvas HTTP ${reply.status}; retrying in ${Math.ceil(delay)} seconds.`, 'warning');
                // Small waits make Stop responsive even during rate limiting.
                for (let elapsed = 0; elapsed < delay * 1000; elapsed += 250) {
                    this.assertRunning();
                    await sleep(250);
                }
                continue;
            }
            const error = new Error(reply?.error || 'The UOC request failed.');
            error.status = reply?.status || 0;
            throw error;
        }
    }
    async html(path) {
        this.assertRunning();
        const url = new URL(path, ORIGIN);
        if (url.origin !== ORIGIN || url.username || url.password)
            throw new Error('Blocked cross-origin page request.');
        const reply = await chrome.tabs.sendMessage(this.tabId, { type: 'UOC_GET_HTML', url: url.href, requestId: crypto.randomUUID() }, { frameId: 0 });
        if (!reply?.ok)
            throw Object.assign(new Error(reply?.error || 'Could not read the visible Canvas page.'), { status: reply?.status || 0 });
        return { text: reply.text, url: reply.url };
    }
    async list(path) {
        const url = new URL(path, ORIGIN);
        if (!url.searchParams.has('per_page'))
            url.searchParams.set('per_page', '100');
        const seen = new Set();
        const result = [];
        let next = url.href;
        while (next) {
            this.assertRunning();
            if (seen.has(next))
                throw new Error('Canvas pagination loop detected; partial collection was not used.');
            if (seen.size >= MAX_PAGES)
                throw new Error(`Pagination exceeded ${MAX_PAGES} pages; narrow the course selection.`);
            seen.add(next);
            const response = await this.get(next);
            if (!Array.isArray(response.data))
                throw new Error('Expected a list from Canvas.');
            result.push(...response.data);
            if (result.length > MAX_RESOURCES)
                throw new Error(`API list exceeded ${MAX_RESOURCES} items; narrow the scan.`);
            next = nextPage(response.link);
            if (next)
                await sleep(100);
        }
        return result;
    }
}
