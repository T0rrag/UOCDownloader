export const APP_NAME = 'UOC Downloader';
export const APP_VERSION = '3.0.1';
export const ORIGIN = 'https://aula.uoc.edu';
export const GENERAL = '00. Materiales generales';
export const REVIEW = '00. Por revisar';
export const MAX_PAGES = 500;
export const MAX_RESOURCES = 5000;
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const unique = values => [...new Set(values.filter(Boolean))];
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[_‐‑–—.-]/g, ' ');
export function safeSegment(value, limit = 100) {
    let text = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
    if (!text || /^\.+$/.test(text))
        text = 'untitled';
    if (/^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(text))
        text = '_' + text;
    return Array.from(text).slice(0, limit).join('').replace(/[. ]+$/g, '') || 'untitled';
}
export function activityKeys(text) {
    const value = normalize(text);
    const keys = [];
    const re = /\b(PEC|PAC|PR|PRACTICA|PRACTICE|RETO|REPTE|CHALLENGE)\s*(?:N\s*[º°O]?\s*)?0*(\d{1,3})(?!\d)/g;
    for (const match of value.matchAll(re)) {
        const type = ['PEC', 'PAC'].includes(match[1]) ? 'PEC' : ['PR', 'PRACTICA', 'PRACTICE'].includes(match[1]) ? 'PR' : 'RETO';
        keys.push(`${type}:${Number(match[2])}`);
    }
    return unique(keys);
}
export function classify(title, activities, contexts = [], fallback = GENERAL) {
    const labels = new Map(activities.flatMap(label => activityKeys(label).map(key => [key, label])));
    const resolve = value => {
        const keys = activityKeys(value);
        return keys.length ? (keys.length === 1 && labels.has(keys[0]) ? labels.get(keys[0]) : REVIEW) : null;
    };
    const explicit = resolve(title);
    const secondary = unique(contexts.map(value => activities.includes(value) || value === REVIEW || value === GENERAL ? value : resolve(value)).filter(value => value && value !== GENERAL));
    if (explicit) {
        if (explicit === REVIEW || secondary.some(value => value !== explicit))
            return [REVIEW];
        return [explicit];
    }
    return secondary.length ? (secondary.includes(REVIEW) ? [REVIEW] : secondary) : [fallback];
}
export function resourceFilename(item) {
    if (item.displayOnly)
        return safeSegment(item.title, 100);
    if (!['file', 'externalFile'].includes(item.kind))
        return `${safeSegment(item.title, 72)} [${item.kind}-${safeSegment(item.id, 18)}-${hashText(item.id)}].html`;
    const name = String(item.title ?? 'file').normalize('NFC').replace(/[. ]+$/g, '');
    const match = name.match(/^(.*?)(\.[A-Za-z0-9]{1,12})$/s);
    const stem = match ? match[1] : name;
    return `${safeSegment(stem, 76)} [${item.kind === 'externalFile' ? 'resource' : 'file'}-${item.id}]${match ? match[2] : ''}`;
}
export function resourcePaths(item, root) {
    const destinations = item.override ? [item.override] : item.destinations;
    return unique(destinations).map(destination => {
        if (!(item.allowedDestinations || [...item.activities, GENERAL, REVIEW]).includes(destination))
            throw new Error('Invalid destination.');
        const parts = [safeSegment(root, 50), safeSegment(item.courseFolder, 100)];
        if (Array.isArray(item.allowedDestinations)) {
            if (!item.allowedDestinations.includes(destination) || destination.split('/').some(segment => safeSegment(segment, 140) !== segment || ['.', '..'].includes(segment) || /^(?:0?1\.\s*Trabajo|0?2\.\s*Entrega)$/i.test(segment)))
                throw new Error('Invalid material destination.');
            parts.push(...destination.split('/'));
        }
        else {
            parts.push(destination);
            if (item.activities.includes(destination))
                parts.push('00. Enunciado');
        }
        parts.push(resourceFilename(item));
        return parts.join('/');
    });
}
export function parseCanvasJSON(raw) {
    // Canvas session responses may carry a JSON-hijacking guard. Never eval it.
    return JSON.parse(String(raw).replace(/^\uFEFF/, '').replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, '').replace(/^\s*\)\]\}',?\s*\n/, ''));
}
export function nextPage(link) {
    for (const match of String(link ?? '').matchAll(/<([^>]+)>\s*;[^,]*?\brel\s*=\s*["']?([^"';,\s]+)["']?/g)) {
        if (match[2] === 'next')
            return match[1];
    }
    return null;
}
export function publicURL(raw, base = ORIGIN) {
    if (typeof raw !== 'string' || !raw.trim())
        return null;
    try {
        const url = new URL(raw, base);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            return null;
        const host = url.hostname.toLowerCase();
        if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') || host.includes(':'))
            return null;
        if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))
            return null;
        return url;
    }
    catch {
        return null;
    }
}
export function safeLink(raw, base = ORIGIN) {
    const url = publicURL(raw, base);
    if (!url)
        return null;
    for (const key of [...url.searchParams.keys()]) {
        if (/(?:token|verifier|signature|credential|authorization|secret|password|^sig$|^auth$|^key$|^x-amz-|^x-goog-)/i.test(key))
            url.searchParams.delete(key);
    }
    // Fragments can contain bearer tokens from OAuth redirects.
    url.hash = '';
    return url.href;
}
export function validateDownloadURL(raw) {
    const url = publicURL(raw);
    if (!url || url.protocol !== 'https:')
        throw new Error('Download rejected: expected a public HTTPS URL.');
    return url.href;
}
export function hashText(text) {
    let hash = 2166136261;
    for (const char of String(text)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
export function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0)
        return 'Unknown size';
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 ** 2)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
/** Validate the bundled course configuration before constructing paths. */
export function validateConfig(config) {
    if (config?.base_url !== ORIGIN || !Array.isArray(config.courses) || !config.courses.length) {
        throw new Error('Invalid asignaturas.json. Only the configured UOC origin is supported.');
    }
    if (typeof config.semester_folder !== 'string' || !config.semester_folder || safeSegment(config.semester_folder, 50) !== config.semester_folder) {
        throw new Error('The semester folder must be a safe, non-empty folder name.');
    }
    const ids = new Set();
    const folders = new Set();
    for (const course of config.courses) {
        if (!Number.isSafeInteger(course.id) || course.id <= 0 || ids.has(course.id)) {
            throw new Error('Course IDs must be unique positive integers.');
        }
        ids.add(course.id);
        if (typeof course.folder !== 'string' || !course.folder || safeSegment(course.folder, 100) !== course.folder) {
            throw new Error('Each course folder must be a safe, non-empty folder name.');
        }
        const folderKey = course.folder.toLowerCase();
        if (folders.has(folderKey))
            throw new Error('Course folder names must be unique, including on Windows.');
        folders.add(folderKey);
        if (!Array.isArray(course.activities) || !course.activities.length || course.activities.some(label => typeof label !== 'string' || safeSegment(label) !== label)) {
            throw new Error('Invalid legacy activity labels. Module titles remain the source of the folder structure.');
        }
    }
    return config;
}
/** Redact network URLs and common authorization values from local diagnostics. */
export function sanitizeMessage(message) {
    return String(message ?? '')
        .replace(/https?:\/\/[^\s<>"']+/g, '[URL omitted]')
        .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
        .replace(/\b(access_token|refresh_token|api_key|client_secret|password)\s*[:=]\s*[^\s,;&"']+/gi, '$1=[REDACTED]');
}
