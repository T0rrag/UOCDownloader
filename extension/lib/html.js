import { ORIGIN, safeLink } from './core.js';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function parse(raw) { const template = document.createElement('template'); template.innerHTML = String(raw || ''); return template.content; }
export function extractRefs(raw, courseId) {
    const root = parse(raw);
    const files = new Set();
    const pages = new Set();
    const links = new Set();
    for (const node of root.querySelectorAll('[href], [src], [data-api-endpoint]')) {
        for (const attr of ['href', 'src', 'data-api-endpoint']) {
            const value = node.getAttribute(attr);
            if (!value || value.startsWith('#'))
                continue;
            let url;
            try {
                url = new URL(value, `${ORIGIN}/courses/${courseId}/`);
            }
            catch {
                continue;
            }
            const courseMatch = url.pathname.match(/\/(?:api\/v1\/)?courses\/(\d+)\//);
            if (url.origin === ORIGIN && (!courseMatch || Number(courseMatch[1]) === Number(courseId))) {
                const file = url.pathname.match(/^\/(?:api\/v1\/)?(?:courses\/\d+\/)?files\/(\d+)(?:\/|$)/);
                if (file) {
                    files.add(Number(file[1]));
                    continue;
                }
                // Canvas also uses /courses/<id>/files?preview=<id> in course links.
                if (/^\/courses\/\d+\/files\/?$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('preview') || '')) {
                    files.add(Number(url.searchParams.get('preview')));
                    continue;
                }
                const page = url.pathname.match(/^\/(?:api\/v1\/)?courses\/\d+\/pages\/([^/]+)$/);
                if (page) {
                    try {
                        pages.add(decodeURIComponent(page[1]));
                    }
                    catch { }
                    continue;
                }
            }
            if (attr === 'href') {
                const link = safeLink(value, `${ORIGIN}/courses/${courseId}/`);
                if (link)
                    links.add(link);
            }
        }
    }
    return { files: [...files], pages: [...pages], links: [...links] };
}
export function sanitizeHTML(raw, courseId) {
    const allowed = new Set(['P', 'BR', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUP', 'SUB', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'A', 'DIV', 'SPAN', 'DETAILS', 'SUMMARY']);
    const drop = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'TEMPLATE']);
    const root = parse(raw);
    function clean(node) {
        if (node.nodeType === Node.TEXT_NODE)
            return escapeHTML(node.textContent);
        if (node.nodeType !== Node.ELEMENT_NODE)
            return '';
        const tag = node.tagName;
        if (drop.has(tag))
            return '';
        if (['IMG', 'IFRAME', 'VIDEO', 'AUDIO'].includes(tag)) {
            const link = safeLink(node.getAttribute('src') || '', `${ORIGIN}/courses/${courseId}/`);
            const title = node.getAttribute('alt') || node.getAttribute('title') || 'Embedded resource — open online';
            return link ? `<p class="resource"><a href="${escapeHTML(link)}" rel="noreferrer noopener">${escapeHTML(title)}</a></p>` : '';
        }
        const children = [...node.childNodes].map(clean).join('');
        if (!allowed.has(tag))
            return children;
        let attrs = '';
        if (tag === 'A') {
            const href = safeLink(node.getAttribute('href') || '', `${ORIGIN}/courses/${courseId}/`);
            if (!href)
                return children;
            attrs = ` href="${escapeHTML(href)}" rel="noreferrer noopener"`;
        }
        if (['TH', 'TD'].includes(tag))
            for (const attr of ['colspan', 'rowspan']) {
                const number = Number(node.getAttribute(attr));
                if (number > 0 && number <= 50)
                    attrs += ` ${attr}="${number}"`;
            }
        const lower = tag.toLowerCase();
        return ['BR', 'HR'].includes(tag) ? `<${lower}>` : `<${lower}${attrs}>${children}</${lower}>`;
    }
    return [...root.childNodes].map(clean).join('');
}
export function buildDocument(item) {
    const title = escapeHTML(item.title);
    const source = safeLink(item.source);
    const body = item.rawHTML ? sanitizeHTML(item.rawHTML, item.courseId) : '<p>No description was returned by Canvas. Open the original resource for full context.</p>';
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${title}</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#182337;max-width:950px;margin:48px auto;padding:0 24px}header{border-bottom:2px solid #253c65;padding-bottom:20px;margin-bottom:28px}.meta,.notice{color:#576477;font-size:14px}.notice{background:#f0f3f7;padding:12px 16px}a{color:#0750a5}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{border:1px solid #ccd2dc;padding:8px}pre{white-space:pre-wrap}h1{line-height:1.2}.resource{border-left:3px solid #9aadc9;padding-left:12px}</style></head><body><header><p class="meta">${escapeHTML(item.courseFolder)} · ${escapeHTML(item.kind)} ${escapeHTML(item.id)}</p><h1>${title}</h1>${item.dueAt ? `<p><strong>Due date returned by Canvas:</strong> ${escapeHTML(item.dueAt)} (ISO 8601)</p>` : ''}${item.updatedAt ? `<p class="meta">Last updated in Canvas: ${escapeHTML(item.updatedAt)}</p>` : ''}${source ? `<a href="${escapeHTML(source)}" rel="noreferrer noopener">Open original in UOC</a>` : ''}</header><p class="notice">Personal offline text snapshot. Images, scripts and embedded tools are not executed or embedded. Follow the original links for interactive content and check UOC for changes. Selected linked files are included as separate entries in the ZIP; links in this snapshot still point to their online originals.</p><main>${body}</main></body></html>`;
}
// Only content links/embedded documents are candidates. Decorative <img> icons
// must not make an unpublished statement appear available.
export function referenceFromURL(raw, courseId, title = '', base = `${ORIGIN}/courses/${courseId}/`) {
    let url;
    try {
        url = new URL(raw, base);
    }
    catch {
        return null;
    }
    if (!safeLink(url.href) || url.protocol !== 'https:')
        return null;
    const source = safeLink(url.href);
    const sameCourse = !url.pathname.match(/^\/(?:api\/v1\/)?courses\/(\d+)\//) || Number(url.pathname.match(/^\/(?:api\/v1\/)?courses\/(\d+)\//)[1]) === Number(courseId);
    if (url.origin === ORIGIN && sameCourse) {
        const file = url.pathname.match(/^\/(?:api\/v1\/)?(?:courses\/\d+\/)?files\/(\d+)(?:\/|$)/);
        if (file)
            return { kind: 'file', id: Number(file[1]), title, source };
        if (/^\/courses\/\d+\/files\/?$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('preview') || ''))
            return { kind: 'file', id: Number(url.searchParams.get('preview')), title, source };
        const page = url.pathname.match(/^\/(?:api\/v1\/)?courses\/\d+\/pages\/([^/]+)\/?$/);
        if (page) {
            try {
                return { kind: 'page', id: decodeURIComponent(page[1]), title, source };
            }
            catch {
                return null;
            }
        }
        const moduleItem = url.pathname.match(/^\/courses\/\d+\/modules\/items\/(\d+)\/?$/);
        if (moduleItem)
            return { kind: 'moduleItem', id: Number(moduleItem[1]), title, source };
        const assignment = url.pathname.match(/^\/(?:api\/v1\/)?courses\/\d+\/assignments\/(\d+)\/?$/);
        if (assignment)
            return { kind: 'assignment', id: Number(assignment[1]), title, source };
        // Never traverse course navigation, discussion, grade, profile, or submission routes.
        if (/^\/(?:api\/v1\/)?(?:courses|users|profile|accounts|conversations|calendar)(?:\/|$)/.test(url.pathname))
            return null;
    }
    let filename = '';
    try {
        filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '');
    }
    catch { }
    const named = url.searchParams.get('filename') || url.searchParams.get('file') || filename;
    const downloadable = /\.(?:pdf|docx?|odt|rtf|txt|md|epub|xlsx?|ods|csv|tsv|pptx?|odp|zip|7z|rar|tar|gz|bz2|xz|c|h|cpp|java|py|ipynb|sql|json|xml|mp[34]|m4a|wav|webm|png|jpe?g|gif|svg)$/i;
    if (downloadable.test(named))
        return { kind: 'externalFile', id: null, title: downloadable.test(filename) ? filename : named, linkTitle: title, source, downloadURL: url.href };
    return { kind: 'link', id: null, title: title || filename || url.hostname, source };
}
export function inspectContent(raw, courseId) {
    const root = parse(raw);
    root.querySelectorAll('script,style,noscript,form,nav,header,footer').forEach(node => node.remove());
    const refs = new Map();
    for (const node of root.querySelectorAll('a[href],a[data-api-endpoint],iframe[src],object[data],embed[src],audio[src],video[src],source[src]')) {
        const title = (node.textContent || node.getAttribute('title') || node.getAttribute('aria-label') || '').trim();
        const attrs = node.tagName === 'A' ? ['data-api-endpoint', 'href'] : ['src', 'data'];
        for (const attr of attrs) {
            const value = node.getAttribute(attr);
            if (!value || value.startsWith('#'))
                continue;
            const ref = referenceFromURL(value, courseId, title);
            if (!ref)
                continue;
            const key = `${ref.kind}:${ref.id || ref.source}`;
            if (!refs.has(key))
                refs.set(key, ref);
            // A Canvas API endpoint describes the same attachment as its viewer link.
            if (attr === 'data-api-endpoint' && ['file', 'page', 'assignment'].includes(ref.kind))
                break;
        }
    }
    // Add spaces between block elements so dates and publication messages remain readable.
    for (const node of root.querySelectorAll('p,div,br,li,tr,h1,h2,h3,h4,td,th'))
        node.append(document.createTextNode(' '));
    return { refs: [...refs.values()], text: root.textContent.replace(/\s+/g, ' ').trim() };
}
// Fallback for Canvas pages whose JSON has no body (for example a block-editor
// wrapper). Extract only the wiki content, never the sidebar or page navigation.
export function visiblePageBody(raw) {
    const root = parse(raw);
    const node = root.querySelector('#wiki_page_show .show-content, .wiki-page .show-content, #wiki_page_show .user_content, .show-content.user_content');
    if (!node)
        throw new Error('The visible page response did not contain a recognizable Canvas content region.');
    return node.innerHTML;
}
