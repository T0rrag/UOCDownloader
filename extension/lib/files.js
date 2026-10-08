import { ORIGIN, validateDownloadURL, formatSize } from './core.js';
export function attachmentOrigins(items) {
    const origins = new Set();
    for (const item of items)
        if (['file', 'externalFile'].includes(item.kind) && !item.disabledReason && item.downloadOrigin && item.downloadOrigin !== ORIGIN) {
            try {
                origins.add(new URL(validateDownloadURL(item.downloadOrigin)).origin + '/*');
            }
            catch { }
        }
    return [...origins].sort();
}
const expectedHTML = file => /(?:text\/html|application\/xhtml)/i.test(file['content-type'] || file.content_type || '') || /\.html?$/i.test(file.display_name || file.filename || '');
const readableError = reply => Object.assign(new Error(reply?.error || 'Unable to read the attachment.'), { status: reply?.status || 0 });
export class FileReaderClient {
    constructor(api, log = () => { }) { this.api = api; this.log = log; this.controller = null; this.stopped = false; }
    async stop() { this.stopped = true; this.controller?.abort(); await this.api.stop?.(); }
    assertRunning() { if (this.stopped || this.api.stopped)
        throw new Error('Stopped by user.'); }
    async throughTab(item, file, maxBytes, onProgress) {
        const requestId = crypto.randomUUID();
        const send = message => chrome.tabs.sendMessage(this.api.tabId, { ...message, requestId }, { frameId: 0 });
        try {
            const opened = await send({ type: 'UOC_FILE_OPEN', courseId: item.courseId, fileId: Number(item.id), maxBytes, expectedHTML: expectedHTML(file) });
            if (!opened?.ok)
                throw readableError(opened);
            const parts = [];
            let total = 0;
            while (true) {
                this.assertRunning();
                const reply = await send({ type: 'UOC_FILE_READ' });
                if (!reply?.ok)
                    throw readableError(reply);
                if (reply.done)
                    break;
                if (typeof reply.base64 !== 'string' || reply.base64.length > 400000)
                    throw new Error('Invalid file-stream chunk.');
                const binary = atob(reply.base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
                total += bytes.byteLength;
                if (total > maxBytes)
                    throw new Error(`File exceeded the ${formatSize(maxBytes)} limit.`);
                parts.push(bytes);
                onProgress?.(total);
            }
            return new Blob(parts, { type: opened.mime || 'application/octet-stream' });
        }
        finally {
            await send({ type: 'UOC_FILE_CLOSE' }).catch(() => { });
        }
    }
    async direct(file, item, maxBytes, onProgress) {
        const url = validateDownloadURL(file.url || `${ORIGIN}/courses/${item.courseId}/files/${item.id}/download?download_frd=1`);
        const origin = new URL(url).origin;
        if (origin !== ORIGIN && !await chrome.permissions.contains({ origins: [origin + '/*'] })) {
            item.downloadOrigin = origin;
            throw new Error(`Chrome needs permission to read attachments from ${new URL(url).hostname}. Click “Allow attachment hosts”, then retry Download ZIP.`);
        }
        this.assertRunning();
        const controller = this.controller = new AbortController();
        let timer;
        const touch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), 60000); };
        touch();
        let reader;
        try {
            const response = await fetch(url, { method: 'GET', credentials: origin === ORIGIN ? 'include' : 'omit',
                redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
            if (!response.ok)
                throw Object.assign(new Error(`Attachment returned HTTP ${response.status}.`), { status: response.status });
            validateDownloadURL(response.url);
            const mime = response.headers.get('Content-Type') || '';
            if ((!expectedHTML(file) && /(?:text\/html|application\/xhtml)/i.test(mime)) || /\/(?:login|signin|saml|sso)(?:\/|$)/i.test(new URL(response.url).pathname))
                throw new Error('Received HTML or a login page instead of the expected attachment.');
            if (Number(response.headers.get('Content-Length')) > maxBytes || !response.body)
                throw new Error('File exceeds the selected limit or has no readable body.');
            reader = response.body.getReader();
            const parts = [];
            let total = 0;
            while (true) {
                this.assertRunning();
                touch();
                const { value, done } = await reader.read();
                if (done)
                    break;
                total += value.byteLength;
                if (total > maxBytes)
                    throw new Error(`File exceeded the ${formatSize(maxBytes)} limit.`);
                parts.push(value);
                onProgress?.(total);
            }
            return new Blob(parts, { type: mime || 'application/octet-stream' });
        }
        catch (error) {
            if (error.name === 'AbortError')
                throw new Error(this.stopped ? 'Stopped by user.' : 'Attachment stalled for 60 seconds; retry the export.');
            if (error instanceof TypeError)
                throw new Error('Chrome could not read an attachment, possibly due to a redirect, missing host permission or CORS. Allow the listed attachment hosts and retry; see the report.');
            throw error;
        }
        finally {
            clearTimeout(timer);
            controller.abort();
            await reader?.cancel().catch(() => { });
            this.controller = null;
        }
    }
    async read(item, maxBytes, onProgress) {
        this.assertRunning();
        if (item.kind === 'externalFile') {
            return this.direct({ url: item.downloadURL, filename: item.title, 'content-type': item.mime || '' }, item, maxBytes, onProgress);
        }
        const file = (await this.api.get(`/api/v1/courses/${item.courseId}/files/${item.id}`)).data;
        if (!file || Number(file.id) !== Number(item.id))
            throw new Error('Unexpected file metadata.');
        if (file.locked_for_user || file.hidden_for_user)
            throw new Error('The file is now locked or hidden for your account.');
        if (Number(file.size) > maxBytes)
            throw new Error('The file exceeds the selected size limit.');
        if (file.url) {
            try {
                item.downloadOrigin = new URL(validateDownloadURL(file.url)).origin;
            }
            catch { }
        }
        try {
            return await this.throughTab(item, file, maxBytes, onProgress);
        }
        catch (error) {
            this.assertRunning();
            if ([401, 403, 404].includes(error.status) || /size limit|exceeded|login page/i.test(error.message))
                throw error;
            this.log(`Trying the attachment host for ${item.title}.`);
            return this.direct(file, item, maxBytes, onProgress);
        }
    }
}
