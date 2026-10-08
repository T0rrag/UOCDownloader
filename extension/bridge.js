/* Injected in an ISOLATED world. Does not read document.cookie, tokens or page globals.
 * Only messages from our own extension may request allowlisted, same-origin GETs.
 */
(() => {
    if (globalThis.__uocSemesterBridgeV3)
        return;
    globalThis.__uocSemesterBridgeV3 = true;
    const origin = 'https://aula.uoc.edu';
    const controllers = new Map();
    const allowed = /^\/api\/v1\/(?:courses(?:\/\d+(?:\/(?:assignments(?:\/\d+)?|files(?:\/\d+)?|pages(?:\/[A-Za-z0-9%_.~-]+)?|modules(?:\/\d+\/items)?))?)?|files\/\d+)$/;
    const streams = new Map();
    const closeStream = id => {
        const stream = streams.get(id);
        if (!stream)
            return;
        clearTimeout(stream.timer);
        stream.controller.abort();
        stream.reader.cancel().catch(() => { });
        streams.delete(id);
        controllers.delete(id);
    };
    const touch = (id, stream) => {
        clearTimeout(stream.timer);
        stream.timer = setTimeout(() => closeStream(id), 60000);
    };
    const extensionPrefix = chrome.runtime.getURL('');
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionPrefix) || !message || location.origin !== origin)
            return false;
        if (message.type === 'UOC_PING') {
            respond({ ok: true });
            return false;
        }
        if (message.type === 'UOC_ABORT') {
            for (const controller of controllers.values())
                controller.abort();
            for (const id of streams.keys())
                closeStream(id);
            respond({ ok: true });
            return false;
        }
        if (message.type === 'UOC_FILE_CLOSE') {
            closeStream(message.requestId);
            respond({ ok: true });
            return false;
        }
        if (message.type === 'UOC_FILE_OPEN' || message.type === 'UOC_FILE_READ') {
            (async () => {
                try {
                    if (message.type === 'UOC_FILE_OPEN') {
                        const { courseId, fileId, maxBytes, requestId } = message;
                        if (![courseId, fileId, maxBytes].every(x => Number.isSafeInteger(x) && x > 0) || maxBytes > 1024 ** 3 ||
                            typeof requestId !== 'string' || requestId.length > 100 || streams.has(requestId) || streams.size >= 2)
                            throw new Error('Invalid file request or too many active streams.');
                        const controller = new AbortController();
                        controllers.set(requestId, controller);
                        const timer = setTimeout(() => controller.abort(), 30000);
                        let response;
                        try {
                            // Session cookies are sent to UOC only. Cross-origin redirects still require CORS.
                            response = await fetch(`${origin}/courses/${courseId}/files/${fileId}/download?download_frd=1`, {
                                method: 'GET', credentials: 'same-origin', mode: 'cors', redirect: 'follow', cache: 'no-store', signal: controller.signal,
                            });
                        }
                        finally {
                            clearTimeout(timer);
                        }
                        if (!response.ok) {
                            controller.abort();
                            controllers.delete(requestId);
                            respond({ ok: false, status: response.status, error: `File returned HTTP ${response.status}.` });
                            return;
                        }
                        const mime = response.headers.get('Content-Type') || '';
                        if ((!message.expectedHTML && /(?:text\/html|application\/xhtml)/i.test(mime)) || /\/(?:login|signin|saml|sso)(?:\/|$)/i.test(new URL(response.url).pathname)) {
                            controller.abort();
                            throw new Error('Received a login page or HTML instead of the expected file.');
                        }
                        if (!response.body || Number(response.headers.get('Content-Length')) > maxBytes) {
                            controller.abort();
                            throw new Error('File has no readable body or exceeds the size limit.');
                        }
                        const stream = { controller, reader: response.body.getReader(), pending: null, bytes: 0, maxBytes, reading: false };
                        streams.set(requestId, stream);
                        touch(requestId, stream);
                        respond({ ok: true, mime });
                        return;
                    }
                    const stream = streams.get(message.requestId);
                    if (!stream || stream.reading)
                        throw new Error('File stream expired or a read is already in progress.');
                    stream.reading = true;
                    touch(message.requestId, stream);
                    let bytes = stream.pending;
                    if (!bytes) {
                        const result = await stream.reader.read();
                        if (result.done) {
                            closeStream(message.requestId);
                            respond({ ok: true, done: true });
                            return;
                        }
                        bytes = result.value;
                        stream.bytes += bytes.byteLength;
                        if (stream.bytes > stream.maxBytes)
                            throw new Error('File exceeds the selected size limit.');
                    }
                    const chunk = bytes.subarray(0, 256 * 1024);
                    stream.pending = bytes.length > chunk.length ? bytes.subarray(chunk.length) : null;
                    let binary = '';
                    for (let index = 0; index < chunk.length; index += 8192)
                        binary += String.fromCharCode(...chunk.subarray(index, index + 8192));
                    stream.reading = false;
                    touch(message.requestId, stream);
                    // Chrome messages are JSON, so bounded base64 chunks are used, not ArrayBuffers.
                    respond({ ok: true, done: false, base64: btoa(binary) });
                }
                catch (error) {
                    closeStream(message.requestId);
                    controllers.get(message.requestId)?.abort();
                    controllers.delete(message.requestId);
                    respond({ ok: false, status: 0, error: error.name === 'AbortError' ? 'File request cancelled or timed out.' : String(error.message || 'Unable to read the file.') });
                }
            })();
            return true;
        }
        if (!['UOC_GET_JSON', 'UOC_GET_HTML'].includes(message.type))
            return false;
        const htmlRequest = message.type === 'UOC_GET_HTML';
        (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            controllers.set(message.requestId, controller);
            try {
                const url = new URL(message.url, origin);
                if (url.origin !== origin || url.username || url.password || !(htmlRequest ? /^\/courses\/\d+\/(?:modules\/items\/\d+|pages\/[A-Za-z0-9%_.~-]+)\/?$/.test(url.pathname) : allowed.test(url.pathname)) || /%2f|%5c|%00/i.test(url.pathname))
                    throw new Error('Blocked: endpoint is outside the read-only allowlist.');
                for (const key of url.searchParams.keys())
                    if (/token|password|secret|_method|authorization/i.test(key))
                        throw new Error('Blocked: credentials and method overrides are not accepted.');
                const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', mode: 'same-origin', redirect: 'follow', cache: 'no-store', headers: { 'Accept': htmlRequest ? 'text/html' : 'application/json' }, signal: controller.signal });
                const contentType = response.headers.get('Content-Type') || '';
                if (!response.ok) {
                    respond({ ok: false, status: response.status, retryAfter: response.headers.get('Retry-After'), error: response.status === 401 ? 'Session expired or not authorized. Sign in to UOC again.' : `Canvas returned HTTP ${response.status}.` });
                    return;
                }
                if (new URL(response.url).origin !== origin || !(htmlRequest ? /text\/html/i.test(contentType) : /json/i.test(contentType)))
                    throw new Error('UOC returned a login page or non-JSON response. Sign in again; this endpoint may not support session access.');
                if (Number(response.headers.get('Content-Length')) > 20 * 1024 ** 2)
                    throw new Error('API response exceeds the 20 MB safety limit.');
                const text = await response.text();
                if (text.length > 20 * 1024 ** 2)
                    throw new Error('API response exceeds the 20 MB safety limit.');
                respond({ ok: true, text, url: response.url, link: response.headers.get('Link') || '' });
            }
            catch (error) {
                respond({ ok: false, status: 0, error: error.name === 'AbortError' ? 'Request cancelled or timed out after 30 seconds.' : String(error.message || 'Network request failed.') });
            }
            finally {
                clearTimeout(timer);
                controllers.delete(message.requestId);
            }
        })();
        return true;
    });
})();
