import { APP_NAME, APP_VERSION, safeSegment, sleep, safeLink, sanitizeMessage } from './core.js';
import { buildDocument } from './html.js';
import { selectedOutputs, skeletonDirectories } from './tree.js';
import { ZipWriter } from './zip.js';
import { FileReaderClient } from './files.js';
const safeError = error => sanitizeMessage(error?.message || error || 'Export failed.');
export async function saveBlob(blob, filename, { shouldStop = () => false, onStart = () => { } } = {}) {
    const url = URL.createObjectURL(blob);
    let id;
    try {
        if (shouldStop())
            throw new Error('Stopped by user.');
        id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
        onStart(id);
        const start = Date.now();
        while (true) {
            if (shouldStop()) {
                await chrome.downloads.cancel(id).catch(() => { });
                throw new Error('Stopped by user.');
            }
            const [entry] = await chrome.downloads.search({ id });
            if (!entry)
                throw new Error('The ZIP download disappeared from Chrome history.');
            if (entry.state === 'interrupted')
                throw new Error(`Chrome interrupted the download: ${entry.error || 'unknown reason'}.`);
            if (entry.danger && !['safe', 'accepted', 'deepScannedSafe', 'allowlistedByPolicy'].includes(entry.danger))
                throw new Error('Chrome flagged the archive. Review it in Chrome Downloads; its warning was not bypassed.');
            if (entry.state === 'complete')
                return id;
            if (Date.now() - start > 30 * 60 * 1000) {
                await chrome.downloads.cancel(id).catch(() => { });
                throw new Error('Chrome did not finish saving the ZIP within 30 minutes.');
            }
            await sleep(500);
        }
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
export class ZipDownloader {
    constructor(api, log = () => { }, onProgress = () => { }, reader = null) {
        this.api = api;
        this.log = log;
        this.onProgress = onProgress;
        this.reader = reader || new FileReaderClient(api, log);
        this.stopped = false;
        this.downloadId = null;
        this.result = null;
    }
    isStopped() { return this.stopped || this.api.stopped; }
    async stop() {
        this.stopped = true;
        await this.reader.stop();
        if (this.downloadId !== null)
            await chrome.downloads.cancel(this.downloadId).catch(() => { });
    }
    async build(items, options, context = {}) {
        const { root, courses, maxBytes, maxZipBytes, allowPartial = false } = options;
        if (context.scanIncomplete && !allowPartial)
            throw new Error('The Contenidos scan is incomplete. Scan again or explicitly enable “Allow partial ZIP”. No ZIP was saved.');
        const outputs = selectedOutputs(items.filter(item => courses.some(course => course.id === item.courseId)), root);
        const zip = new ZipWriter({ maxBytes: maxZipBytes, shouldStop: () => this.isStopped() });
        const startedAt = new Date().toISOString();
        const result = this.result = { mode: 'single-zip', startedAt, planned: outputs.length, results: [], archiveSaved: false, stopped: false };
        const grouped = new Map();
        for (const entry of outputs) {
            if (!grouped.has(entry.item.key))
                grouped.set(entry.item.key, []);
            grouped.get(entry.item.key).push(entry);
        }
        try {
            for (const directory of skeletonDirectories(courses, root))
                await zip.addDirectory(directory);
            for (const group of grouped.values()) {
                if (this.isStopped())
                    break;
                const item = group[0].item;
                item.status = 'Reading';
                this.onProgress(result.results.length, outputs.length, item, 'Reading attachment');
                try {
                    // Cheap metadata preflight avoids fetching a file that cannot possibly fit.
                    const estimate = ['file', 'externalFile'].includes(item.kind) ? Math.max(0, item.size || 0) * group.length : 0;
                    if (estimate + zip.offset + zip.directoryBytes + 22 > maxZipBytes)
                        throw new Error('ZIP size limit reached. Increase the ZIP limit or select fewer resources.');
                    const blob = ['file', 'externalFile'].includes(item.kind)
                        ? await this.reader.read(item, maxBytes, bytes => this.onProgress(result.results.length, outputs.length, item, 'Reading attachment', bytes))
                        : new Blob([buildDocument(item)], { type: 'text/html;charset=utf-8' });
                    if (blob.size > maxBytes)
                        throw new Error('Resource exceeds the per-file size limit.');
                    let checksum;
                    for (const entry of group) {
                        const parts = entry.path.split('/');
                        parts.pop();
                        for (let depth = 1; depth <= parts.length; depth++)
                            await zip.addDirectory(parts.slice(0, depth).join('/') + '/');
                        item.status = 'Packing';
                        this.onProgress(result.results.length, outputs.length, item, 'Adding to ZIP');
                        checksum = await zip.add(entry.path, blob, { checksum });
                        result.results.push({ key: item.key, path: entry.path, outcome: 'packed', bytes: blob.size });
                    }
                    item.status = 'In ZIP';
                    this.log(`Packed in memory: ${item.title} (${group.length} location${group.length > 1 ? 's' : ''}).`);
                }
                catch (error) {
                    const detail = safeError(error);
                    item.status = this.isStopped() ? 'Cancelled' : 'Failed';
                    for (const entry of group)
                        if (!result.results.some(row => row.path === entry.path)) {
                            result.results.push({ key: item.key, path: entry.path, outcome: this.isStopped() ? 'cancelled' : 'failed', detail });
                        }
                    this.log(`${item.title}: ${detail}`, 'warning');
                    if (error.status === 401 || /session expired|login page|lost the uoc tab/i.test(detail))
                        break;
                }
                this.onProgress(result.results.length, outputs.length, item, 'Building archive');
            }
            result.stopped = this.isStopped();
            result.remaining = outputs.length - result.results.length;
            result.failed = result.results.filter(row => ['failed', 'cancelled'].includes(row.outcome)).length;
            result.partial = !!context.scanIncomplete || result.failed > 0 || result.remaining > 0;
            result.finishedAt = new Date().toISOString();
            if (result.stopped)
                throw new Error('Stopped. No ZIP was saved; staged content was discarded.');
            if (result.partial && !allowPartial)
                throw new Error(`${result.failed} failed, ${result.remaining} not attempted. No ZIP was saved. Resolve the errors or explicitly enable “Allow partial ZIP” and retry.`);
            const reportDirectory = `${safeSegment(root, 50)}/_UOC_informes/`;
            await zip.addDirectory(reportDirectory);
            const { archiveSaved: _pendingSave, ...packagingResult } = result;
            const report = {
                application: APP_NAME, version: APP_VERSION, ...context,
                root: safeSegment(root, 50), courses: courses.map(course => ({ id: course.id, folder: course.folder, layout: course.layout })),
                archiveStatus: result.partial ? 'PARTIAL — see failed and unattempted entries' : 'All selected outputs included',
                export: packagingResult,
                reportStage: 'Archive contents prepared; Chrome save completion is tracked by the manager.',
                selection: outputs.map(entry => ({ path: entry.path, key: entry.item.key, source: safeLink(entry.item.source) })),
                archiveFormat: 'ZIP STORE (uncompressed), UTF-8 names, explicit empty directories',
                pageAvailability: items.filter(item => ['page', 'assignment', 'pageHTML', 'notice'].includes(item.kind)).map(item => ({ key: item.key, title: item.title, status: item.status, note: item.note || null, reason: item.disabledReason || null, source: safeLink(item.source), destinations: item.destinations, dates: item.displayDates || null })),
                notAvailable: items.filter(item => item.disabledReason).map(item => ({ key: item.key, title: item.title, status: item.status, reason: item.disabledReason, source: safeLink(item.source), destinations: item.destinations, dates: item.displayDates || null })),
                notes: ['Folder structure is built from scanned Contenidos modules. Forum modules are excluded.', 'Trabajo and Entrega are empty; no local work files were read.',
                    'Only selected resources are included. Publication notices are not downloaded as statements; their folders and reasons are retained in this report.',
                    'External tools are links only; HTML snapshot links still point online.', 'Signed download URLs, cookies and tokens are not included.'],
            };
            await zip.add(reportDirectory + 'download-report.json', new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
            if (result.partial)
                await zip.add(`${safeSegment(root, 50)}/INCOMPLETE_EXPORT.txt`, 'This ZIP is incomplete. Read _UOC_informes/download-report.json for errors and unattempted files.\n');
            result.filename = safeSegment(root, 50) + (result.partial ? '-partial' : '') + '.zip';
            const blob = zip.toBlob();
            result.archiveBytes = blob.size;
            result.entryCount = zip.entries.length;
            return { blob, result };
        }
        catch (error) {
            result.error = safeError(error);
            result.stopped = this.isStopped();
            throw error;
        }
        finally {
            zip.dispose();
        }
    }
    async run(items, options, context) {
        const { blob, result } = await this.build(items, options, context);
        this.onProgress(result.planned, result.planned, null, 'Saving ZIP');
        try {
            result.downloadId = await saveBlob(blob, result.filename, { shouldStop: () => this.isStopped(), onStart: id => { this.downloadId = id; } });
            result.archiveSaved = true;
            for (const item of items)
                if (item.status === 'In ZIP')
                    item.status = 'Saved in ZIP';
            return result;
        }
        catch (error) {
            result.error = safeError(error);
            result.stopped = this.isStopped();
            throw error;
        }
    }
}
export async function saveReport(report, root) {
    return saveBlob(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }), `${safeSegment(root, 50)}-report.json`);
}
