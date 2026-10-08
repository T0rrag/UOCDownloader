/* Synthetic fixtures based on the user's supplied Contenidos titles.
 * Tests only: never packaged inside the installed extension directory. */
(() => {
    const BASE = 'https://aula.uoc.edu', COURSE = 87938, base = `/api/v1/courses/${COURSE}`;
    const f = window.testFixture = { authorized: true, tabOpen: false, html: false, throttle: 0, slow: false, version: 1,
        store: {}, calls: [], downloadOptions: [], downloads: new Map(), files: new Map(), nextId: 1, blobId: 1, blobs: new Map(), streams: new Map(), openedFiles: [], failFiles: new Set(), blockedBridge: false, hostAccess: false, requestedOrigins: [], slowFile: false, moduleError: false, allModulesError: false, fallbackPage: false, publishedPEC1: false };
    const titles = ['PEC1 - Evaluación del Rendimiento', 'PEC2 - Procesadores Segmentados', 'Práctica1 (PR1) - Simulador Pipeline', 'Práctica2 (PR2) - Programación Paralela', 'Recursos de Aprendizaje de la Asignatura', 'Foros'];
    const moduleIds = [10, 11, 12, 13, 14, 15];
    const slugs = ['enunciado-de-la-pec1', 'recursos-de-aprendizaje-de-la-pec1', 'enunciado-de-la-pec2', 'recursos-de-aprendizaje-de-la-pec2', 'enunciado-de-la-practica1-pr1', 'recursos-de-aprendizaje-de-la-practica1-pr1', 'enunciado-de-la-practica2-pr2', 'recursos-de-aprendizaje-de-la-practica2-pr2', 'recursos-modulos'];
    const ids = [3181955, 3181958, 3181960, 3181963, 3181965, 3181968, 3181970, 3181973, 3181975];
    const pageTitles = ['Enunciado de la PEC1', 'Recursos de aprendizaje de la PEC1', 'Enunciado de la PEC2', 'Recursos de aprendizaje de la PEC2', 'Enunciado de la Práctica1 (PR1)', 'Recursos de aprendizaje de la Práctica1 (PR1)', 'Enunciado de la Práctica2 (PR2)', 'Recursos de aprendizaje de la Práctica2 (PR2)', 'Recursos (Módulos didácticos y Videos)'];
    f.fixtureContent = { titles, slugs, ids, pageTitles };
    const bodyFor = id => `Synthetic fixture file ${id}; version ${id === 777 ? f.version : 1}.\n`;
    const names = { 777: 'enunciado_pec2.pdf', 779: 'rendimiento.pdf', 780: 'pipeline_starter.zip', 781: 'video_demasiado_grande.mp4', 789: 'modulos_didacticos.pdf', 790: 'enunciado_pec1_publicado.pdf' };
    function file(id) { return { id, filename: names[id] || `file_${id}.txt`, display_name: names[id] || `file_${id}.txt`, size: id === 781 ? 300 * 1024 ** 2 : bodyFor(id).length, updated_at: '2026-09-29T08:00:00Z', 'content-type': 'application/octet-stream', url: `https://downloads.example.edu/${id}?verifier=TEST_SECRET_NOT_FOR_REPORTS` }; }
    const pageItem = index => ({ id: ids[index], type: 'Page', page_url: slugs[index], title: pageTitles[index], position: index + 1, html_url: `${BASE}/courses/${COURSE}/modules/items/${ids[index]}`,
        ...(index === 6 ? { content_details: { locked_for_user: true, unlock_at: '2026-12-01T00:00:00Z' } } : {}) });
    const futureText = '<p>Actividad evaluable</p><p>Individual</p><p>Inicio <strong>05/10/26</strong></p><p>Entrega <strong>25/10/26</strong></p><p>En esta primera PAC1 evaluaremos el rendimiento del procesador intentando analizar diferentes aspectos.</p><ol><li>Analizar la mejora de un diseño del procesador.</li><li>Saber calcular el rendimiento del procesador.</li></ol><p>El enunciado de la PEC1 lo podréis descargar desde este espacio cuando comience el plazo.</p><img src="/courses/87938/files/999/download" alt="decorative activity icon">';
    function pageBody(index) {
        return [
            futureText + (f.publishedPEC1 ? '<a href="/courses/87938/files/790/download">Enunciado disponible</a>' : ''),
            '<p>Recursos de aprendizaje de la PEC1.</p><a href="/courses/87938/files/779/download">Rendimiento del procesador</a>',
            '<p>Descargad el enunciado de la PEC2.</p><a data-api-endpoint="/api/v1/courses/87938/files/777" href="/courses/87938/files/777/download?verifier=TEST_SECRET_NOT_FOR_REPORTS">Enunciado PDF</a>',
            '<p>Recursos PEC2</p><a href="/courses/87938/pages/shared-reading">Material compartido</a>',
            '<p>Enunciado de la Práctica1. Descargad la plantilla.</p><a href="/courses/87938/files/780/download">Código inicial</a>',
            '<p>Manual del simulador</p><a href="https://materials.example.edu/PID_12345.pdf?signature=TEST_SECRET_NOT_FOR_REPORTS">Manual del pipeline</a>',
            '<p>This body must never be requested because content_details says it is locked.</p>',
            '<p>Próximamente.</p>',
            '<p>Módulos y vídeos de la asignatura.</p><a href="/courses/87938/files/789/download">Módulos didácticos</a><a href="/courses/87938/files/781/download">Vídeo de gran tamaño</a><iframe src="https://tools.example.edu/launch" title="Online videos"></iframe>',
        ][index];
    }
    if (!crypto.randomUUID)
        crypto.randomUUID = () => `test-${Date.now()}-${Math.random()}`;
    if (!navigator.locks)
        Object.defineProperty(navigator, 'locks', { value: { request: async (name, _options, fn) => fn({ name }) } });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
        if (input === 'asignaturas.json')
            return new Response(JSON.stringify(window.testConfig), { headers: { 'Content-Type': 'application/json' } });
        if (f.blobs.has(input))
            return new Response(f.blobs.get(input));
        if (typeof input === 'string' && /^https:\/\/(?:downloads|materials)\.example\.edu\//.test(input) && f.hostAccess) {
            const r = new Response(`Synthetic external material.\n`, { headers: { 'Content-Type': 'application/pdf' } });
            Object.defineProperty(r, 'url', { value: input });
            return r;
        }
        if (typeof input === 'string' && /^https:\/\//.test(input))
            throw new Error('Offline fixture rejected unexpected external network access.');
        return originalFetch(input, options);
    };
    URL.createObjectURL = blob => { const url = `blob:offline-fixture/${f.blobId++}`; f.blobs.set(url, blob); return url; };
    URL.revokeObjectURL = url => f.blobs.delete(url);
    async function sendMessage(_tab, message) {
        if (message.type === 'UOC_PING')
            return { ok: true };
        if (message.type === 'UOC_ABORT') {
            f.streams.clear();
            return { ok: true };
        }
        if (message.type === 'UOC_FILE_CLOSE') {
            f.streams.delete(message.requestId);
            return { ok: true };
        }
        if (message.type === 'UOC_FILE_OPEN') {
            if (!f.authorized)
                return { ok: false, status: 401, error: 'Session expired' };
            if (f.failFiles.has(message.fileId))
                return { ok: false, status: 403, error: 'Fixture attachment unavailable' };
            if (f.blockedBridge)
                return { ok: false, status: 0, error: 'Fixture CORS failure' };
            f.openedFiles.push(message.fileId);
            f.streams.set(message.requestId, { id: message.fileId, read: false, maxBytes: message.maxBytes });
            return { ok: true, mime: 'application/octet-stream' };
        }
        if (message.type === 'UOC_FILE_READ') {
            if (f.slowFile)
                await new Promise(resolve => setTimeout(resolve, 1200));
            const s = f.streams.get(message.requestId);
            if (!s)
                return { ok: false, error: 'Fixture stream cancelled' };
            if (s.read)
                return { ok: true, done: true };
            s.read = true;
            return { ok: true, done: false, base64: btoa(bodyFor(s.id)) };
        }
        const url = new URL(message.url);
        const path = url.pathname;
        const page = url.searchParams.get('page') || '1';
        f.calls.push({ url: message.url, type: message.type });
        if (!f.authorized)
            return { ok: false, status: 401, error: 'Session expired or not authorized. Sign in to UOC again.' };
        if (f.html)
            return { ok: false, status: 0, error: 'UOC returned a login page or non-JSON response.' };
        if (f.throttle && path === '/api/v1/courses') {
            f.throttle--;
            return { ok: false, status: 429, retryAfter: '1', error: 'Rate limited' };
        }
        if (message.type === 'UOC_GET_HTML')
            return { ok: true, url: message.url, text: '<nav>DO NOT IMPORT NAVIGATION</nav><div id="wiki_page_show"><div class="show-content user_content"><p>Content extracted from the visible Canvas page.</p><a href="/courses/87938/files/780">Starter archive</a></div></div>' };
        let body, link = '';
        if (path === '/api/v1/courses')
            body = [{ id: COURSE }];
        else if (path === base)
            body = { id: COURSE, name: '75.578 - Arquitectura de computadores - Aula 1' };
        else if (path === base + '/modules') {
            if (f.allModulesError)
                return { ok: false, status: 403, error: 'Contenidos could not be listed' };
            if (f.slow)
                await new Promise(r => setTimeout(r, 1500));
            if (page === '1') {
                body = moduleIds.slice(0, 3).map((id, i) => ({ id, name: titles[i], position: i + 1 }));
                link = `<${BASE}${path}?page=2>; rel="next"`;
            }
            else
                body = moduleIds.slice(3).map((id, i) => ({ id, name: titles[i + 3], position: i + 4 }));
        }
        else if (path === base + '/modules/10/items') {
            if (page === '1') {
                body = [pageItem(0)];
                link = `<${BASE}${path}?include%5B%5D=content_details&page=2>; rel="next"`;
            }
            else
                body = [pageItem(1)];
        }
        else if (path === base + '/modules/11/items')
            body = [pageItem(2), pageItem(3)];
        else if (path === base + '/modules/12/items') {
            const item = pageItem(4);
            if (f.fallbackPage)
                delete item.page_url;
            else {
                item.url = `${BASE}${base}/pages/${item.page_url}`;
                delete item.page_url;
            }
            body = [item, pageItem(5)];
        }
        else if (path === base + '/modules/13/items') {
            if (f.moduleError)
                return { ok: false, status: 403, error: 'Module items unavailable to the fixture' };
            body = [pageItem(6), pageItem(7)];
        }
        else if (path === base + '/modules/14/items')
            body = [pageItem(8)];
        else if (path === base + '/modules/15/items')
            body = [{ id: 3181976, type: 'Discussion', title: 'Foro Presentaciones' }, { id: 3181977, type: 'Discussion', title: 'Foro General' }];
        else if (path.startsWith(base + '/pages/')) {
            const slug = decodeURIComponent(path.slice((base + '/pages/').length));
            const i = slugs.indexOf(slug);
            if (i >= 0)
                body = { url: slug, title: pageTitles[i], body: pageBody(i), updated_at: '2026-09-29T08:00:00Z' };
            else if (slug === 'shared-reading')
                body = { url: slug, title: 'Material compartido', body: '<a href="/courses/87938/files/779">Manual común</a><a href="/courses/87938/pages/recursos-de-aprendizaje-de-la-pec2">Back reference (cycle)</a>' };
        }
        else if (path.startsWith(base + '/files/'))
            body = file(Number(path.split('/').pop()));
        if (body === undefined)
            return { ok: false, status: 404, error: 'Unexpected fixture endpoint; bulk pages/files/assignments must not be scanned' };
        return { ok: true, text: 'while(1);' + JSON.stringify(body), link };
    }
    window.chrome = { runtime: { id: 'offline-test', getURL: path => 'chrome-extension://offline-test/' + path },
        tabs: { query: async () => f.tabOpen ? [{ id: 200, active: true, url: BASE + '/', lastAccessed: 1 }] : [], sendMessage, create: async () => { f.tabOpen = true; return { id: 200 }; } },
        scripting: { executeScript: async () => [] },
        storage: { local: { get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in f.store).map(k => [k, structuredClone(f.store[k])])), set: async (values) => Object.assign(f.store, structuredClone(values)) } },
        permissions: { contains: async () => f.hostAccess, request: async ({ origins }) => { f.requestedOrigins.push(...origins); f.hostAccess = true; return true; } },
        downloads: { download: async (options) => {
                f.downloadOptions.push(options);
                if (options.conflictAction !== 'uniquify' || options.headers || !f.blobs.has(options.url))
                    throw new Error('Unsafe or non-ZIP download');
                const blob = f.blobs.get(options.url), bytes = [...new Uint8Array(await blob.arrayBuffer())];
                let path = options.filename, n = 1;
                while (f.files.has(path)) {
                    const dot = options.filename.lastIndexOf('.');
                    path = options.filename.slice(0, dot) + ` (${n++})` + options.filename.slice(dot);
                }
                f.files.set(path, { bytes, mime: blob.type });
                const id = f.nextId++;
                f.downloads.set(id, { id, filename: 'C:/Downloads/' + path, state: 'complete', danger: 'safe' });
                return id;
            }, search: async ({ id }) => f.downloads.has(id) ? [f.downloads.get(id)] : [], cancel: async (id) => { const item = f.downloads.get(id); if (item && item.state !== 'complete')
                item.state = 'interrupted'; } },
    };
})();
