import { ORIGIN, MAX_RESOURCES, sanitizeMessage, unique, safeLink, hashText, validateDownloadURL } from './core.js';
import { inspectContent, referenceFromURL, visiblePageBody, escapeHTML } from './html.js';
import { moduleLayout, itemRoute, lockReason, isDiscussion, emptyLayout } from './layout.js';
import { pageAvailability, pageDates } from './availability.js';
const positiveID = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const cleanError = value => sanitizeMessage(value?.message || value || 'Request failed.');
const ordered = values => [...values].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
export class Scanner {
    constructor(client, options, log = () => { }) {
        this.api = client;
        this.options = options;
        this.log = log;
        this.warnings = [];
        this.items = [];
        this.stats = [];
        this.courses = [];
        this.scanErrors = [];
    }
    warn(course, scope, error, incomplete = true) {
        this.api.assertRunning();
        if (error?.status === 401)
            throw error;
        const text = `${course.folder} — ${scope}: ${cleanError(error)}`;
        this.warnings.push(text);
        if (incomplete)
            this.scanErrors.push(text);
        this.log(text, 'warning');
    }
    async scan(courses) {
        for (const configured of courses) {
            this.api.assertRunning();
            const course = { ...configured, layout: emptyLayout() };
            this.courses.push(course);
            this.log(`Reading Contenidos for ${course.folder}…`);
            try {
                await this.scanCourse(course);
            }
            catch (error) {
                this.warn(course, 'Contenidos scan incomplete', error);
                course.scanError = cleanError(error);
            }
            if (this.items.length > MAX_RESOURCES)
                throw new Error(`Plan exceeded ${MAX_RESOURCES} resources. Scan fewer courses.`);
        }
        return { items: this.items, courses: this.courses, warnings: this.warnings, scanErrors: this.scanErrors,
            scanIncomplete: this.scanErrors.length > 0, stats: this.stats, scannedAt: new Date().toISOString(), structureSource: 'Canvas Contenidos / modules' };
    }
    async scanCourse(course) {
        const base = `/api/v1/courses/${course.id}`;
        const { data: info } = await this.api.get(base);
        if (!info || Number(info.id) !== course.id)
            throw new Error('Unexpected course response.');
        // No bulk assignment, file, or page index. Only content reachable from Contenidos.
        const modules = ordered(await this.api.list(`${base}/modules`));
        const records = [];
        for (const module of modules) {
            this.api.assertRunning();
            const id = positiveID(module.id);
            if (!id)
                throw new Error('Module without a valid ID.');
            try {
                records.push({ module, items: ordered(await this.api.list(`${base}/modules/${id}/items?include[]=content_details`)) });
            }
            catch (error) {
                this.warn(course, `module ${module.name || id} items`, error, !lockReason(module));
                records.push({ module, items: [], error: cleanError(error) });
            }
        }
        course.layout = moduleLayout(course, records);
        if (!modules.length)
            this.log(`${course.folder}: Contenidos returned no modules; no activity folders were invented.`, 'warning');
        const moduleById = new Map(course.layout.modules.map(module => [module.id, module]));
        const moduleItems = new Map();
        for (const record of records)
            for (const item of record.items)
                moduleItems.set(Number(item.id), { item, module: moduleById.get(Number(record.module.id)) });
        const resources = new Map(), queue = [], scheduled = new Set(), cache = new Map();
        const taskKey = task => `${course.id}:${task.kind}:${task.id}${['page', 'assignment', 'pageHTML', 'notice'].includes(task.kind) ? ':' + hashText(task.destination) : ''}`;
        const add = (task, extra = {}) => {
            const key = taskKey(task);
            let resource = resources.get(key);
            if (!resource) {
                resource = { key, kind: task.kind, id: task.id, title: String(task.title || `${task.kind} ${task.id}`),
                    courseId: course.id, courseFolder: course.folder, activities: [], allowedDestinations: course.layout.destinations,
                    destinations: [], override: null, selected: true, disabledReason: '', displayOnly: false,
                    source: safeLink(task.source) || `${ORIGIN}/courses/${course.id}/modules`,
                    status: 'Ready', size: null, updatedAt: null, children: new Set(), role: task.role,
                    moduleId: task.moduleId, moduleTitle: moduleById.get(task.moduleId)?.title || '', ...extra };
                resources.set(key, resource);
            }
            if (!resource.destinations.includes(task.destination))
                resource.destinations.push(task.destination);
            return resource;
        };
        const enqueue = (ref, context, parent = null) => {
            if (!ref || !context.destination)
                return;
            if (ref.kind === 'moduleItem') {
                const known = moduleItems.get(Number(ref.id));
                if (!known || !known.module) {
                    const task = { ...context, kind: 'notice', id: `module-item-${ref.id}`, title: ref.title || `Linked module item ${ref.id}`, source: ref.source };
                    add(task, { selected: false, displayOnly: true, status: 'Not resolved', disabledReason: 'This module-item link was not listed in accessible Contenidos. Open it in UOC.' });
                    return;
                }
                const target = referenceForItem(known.item);
                if (!target)
                    return;
                return enqueue({ ...target, blocked: lockReason(known.module) || known.module.lockedReason || lockReason(known.item) || lockReason(known.item.content_details) }, context, parent);
            }
            const task = { ...context, ...ref, depth: context.depth || 0 };
            if (task.kind === 'externalFile')
                task.id = hashText(task.downloadURL);
            if (task.kind === 'link')
                task.id = hashText(task.source);
            if (task.depth > 12) {
                this.warn(course, task.title, new Error('Nested content exceeded 12 levels.'));
                return;
            }
            const key = taskKey(task);
            if (parent)
                resources.get(parent)?.children.add(key);
            const visit = `${key}|${task.destination}`;
            if (scheduled.has(visit))
                return;
            if (scheduled.size >= MAX_RESOURCES)
                throw new Error('Too many linked resources.');
            scheduled.add(visit);
            queue.push(task);
        };
        const referenceForItem = item => {
            if (isDiscussion(item) || item.type === 'SubHeader')
                return null;
            const source = item.html_url || `${ORIGIN}/courses/${course.id}/modules/items/${item.id}`;
            if (item.type === 'Page') {
                const parsed = referenceFromURL(item.url || source, course.id, item.title);
                const slug = item.page_url || (parsed?.kind === 'page' ? parsed.id : null);
                return slug ? { kind: 'page', id: String(slug), title: item.title, source }
                    : { kind: 'pageHTML', id: Number(item.id), title: item.title, source };
            }
            if (['File', 'Assignment'].includes(item.type) && positiveID(item.content_id))
                return { kind: item.type.toLowerCase(), id: Number(item.content_id), title: item.title, source };
            if (item.type === 'ExternalUrl')
                return referenceFromURL(item.external_url || source, course.id, item.title);
            if (['ExternalTool', 'Quiz'].includes(item.type))
                return { kind: 'link', id: null, title: item.title, source, toolType: item.type };
            return null;
        };
        for (const record of records) {
            const module = moduleById.get(Number(record.module.id));
            if (!module)
                continue;
            if (module.lockedReason || record.error) {
                const unavailable = !!module.lockedReason;
                add({ kind: 'notice', id: `module-${module.id}`, title: module.title, moduleId: module.id,
                    destination: module.statementPath, role: module.activity ? 'statement' : 'resources', source: module.source }, { selected: false, displayOnly: true, disabledReason: module.lockedReason || record.error, status: unavailable ? 'Not available' : 'Scan error' });
                continue;
            }
            let heading = '';
            for (const item of record.items) {
                if (item.type === 'SubHeader') {
                    heading = item.title || '';
                    continue;
                }
                const ref = referenceForItem(item);
                if (!ref)
                    continue;
                enqueue({ ...ref, blocked: lockReason(item) || lockReason(item.content_details) }, { ...itemRoute(module, item, heading), moduleId: module.id, depth: 0 });
            }
        }
        const get = async (path) => {
            if (!cache.has(path))
                cache.set(path, await this.api.get(path));
            return cache.get(path);
        };
        let pageCount = 0;
        for (let index = 0; index < queue.length; index++) {
            this.api.assertRunning();
            const task = queue[index];
            const resource = add(task);
            if (task.blocked) {
                Object.assign(resource, { disabledReason: task.blocked, selected: false, displayOnly: true, status: 'Not available' });
                continue;
            }
            try {
                if (['page', 'assignment', 'pageHTML'].includes(task.kind)) {
                    if (++pageCount > 400)
                        throw new Error('The course exceeded the 400-page safety limit.');
                    let data;
                    if (task.kind === 'pageHTML') {
                        const response = await this.api.html(task.source);
                        data = { title: task.title, body: visiblePageBody(response.text) };
                    }
                    else {
                        if (task.kind === 'page' && (!task.id || /[/?#\\]/.test(task.id)))
                            throw new Error('Invalid page slug.');
                        data = (await get(`${base}/${task.kind === 'page' ? 'pages' : 'assignments'}/${encodeURIComponent(task.id)}`)).data;
                    }
                    if (!data || typeof data !== 'object' || Array.isArray(data))
                        throw new Error('Unexpected content-page response.');
                    resource.title = data.title || data.name || resource.title;
                    resource.updatedAt = data.updated_at || null;
                    resource.dueAt = data.due_at || null;
                    const blocked = lockReason(data);
                    if (blocked) {
                        Object.assign(resource, { disabledReason: blocked, selected: false, displayOnly: true, status: 'Not available' });
                        continue;
                    }
                    let raw = task.kind === 'assignment' ? data.description : data.body;
                    if (task.kind !== 'assignment' && (raw == null || (!raw && data.editor === 'block_editor')))
                        raw = visiblePageBody((await this.api.html(task.source)).text);
                    resource.rawHTML = String(raw || '');
                    const inspected = inspectContent(resource.rawHTML, course.id);
                    resource.text = inspected.text;
                    resource.displayDates = pageDates(inspected.text);
                    resource.pagePending = true;
                    for (const ref of inspected.refs)
                        enqueue(ref, { destination: task.destination, role: task.role, moduleId: task.moduleId, depth: task.depth + 1 }, resource.key);
                    if (task.kind === 'assignment' && positiveID(data.annotatable_attachment_id))
                        enqueue({ kind: 'file', id: Number(data.annotatable_attachment_id) }, task, resource.key);
                }
                else if (task.kind === 'file') {
                    const file = (await get(`${base}/files/${task.id}`)).data;
                    if (!file || positiveID(file.id) !== Number(task.id))
                        throw new Error('Unexpected file metadata.');
                    resource.title = file.display_name || file.filename || task.title || `file-${task.id}`;
                    resource.size = typeof file.size === 'number' ? file.size : null;
                    resource.updatedAt = file.updated_at || file.modified_at || null;
                    resource.mime = file['content-type'] || file.content_type || '';
                    resource.source = `${ORIGIN}/courses/${course.id}/files/${task.id}`;
                    if (file.url) {
                        try {
                            resource.downloadOrigin = new URL(validateDownloadURL(file.url)).origin;
                        }
                        catch { }
                    }
                    const reason = lockReason(file) || (Number(file.size) > this.options.maxBytes ? 'Exceeds the selected per-file size limit.' : '');
                    if (reason)
                        Object.assign(resource, { disabledReason: reason, selected: false, status: 'Not available' });
                }
                else if (task.kind === 'externalFile') {
                    resource.downloadURL = validateDownloadURL(task.downloadURL); // In memory only; never stored in reports/preferences.
                    resource.downloadOrigin = new URL(resource.downloadURL).origin;
                    resource.source = safeLink(resource.downloadURL);
                    resource.status = 'Ready to fetch';
                    resource.note = 'Direct file link. Access and file size are checked when building the ZIP.';
                }
                else if (task.kind === 'link') {
                    resource.selected = false;
                    resource.status = 'Online only';
                    resource.rawHTML = `<p>This is an online reference, not a downloaded copy of the resource.</p><p><a href="${escapeHTML(resource.source)}">Open resource in UOC or the original site</a></p>`;
                    resource.note = 'Optional HTML bookmark. External tools are not launched or scraped.';
                }
            }
            catch (error) {
                const unavailable = [403, 404].includes(error.status);
                this.warn(course, task.title || `${task.kind} ${task.id}`, error, !unavailable);
                Object.assign(resource, { disabledReason: cleanError(error), selected: false, displayOnly: task.kind !== 'file', status: unavailable ? 'Not available' : 'Scan error', scanError: !unavailable });
            }
        }
        // Availability follows the reference graph, not page readability. A shared
        // file is considered independently in every module destination; cycles stop.
        const reachable = (key, seen = new Set()) => {
            if (seen.has(key))
                return [];
            seen.add(key);
            const resource = resources.get(key);
            if (!resource)
                return [];
            if (['file', 'externalFile'].includes(resource.kind))
                return [resource];
            if (resource.disabledReason)
                return [];
            return [...resource.children].flatMap(child => reachable(child, seen));
        };
        for (const resource of resources.values()) {
            if (resource.pagePending && !resource.disabledReason) {
                const files = reachable(resource.key);
                const availability = pageAvailability({ text: resource.text, role: resource.role,
                    availableFiles: files.filter(file => !file.disabledReason).length, linkedFiles: files.length,
                    failed: [...resource.children].some(key => resources.get(key)?.scanError) });
                resource.status = availability.status;
                resource.selected = availability.selected;
                resource.displayOnly = availability.displayOnly;
                resource.disabledReason = availability.reason;
                resource.note = availability.note || (files.length ? 'Optional source-page HTML. Downloadable files are listed separately below.' : '');
                resource.linkedFileCount = files.length;
                // The readable landing page URL remains available even for publication notices.
            }
        }
        for (const resource of resources.values()) {
            delete resource.text;
            delete resource.pagePending;
            delete resource.children;
        }
        const courseItems = [...resources.values()];
        this.items.push(...courseItems);
        this.stats.push({ courseId: course.id, folder: course.folder, modules: course.layout.modules.length,
            excludedModules: course.layout.excludedModules,
            files: courseItems.filter(item => ['file', 'externalFile'].includes(item.kind)).length,
            pages: courseItems.filter(item => ['page', 'assignment', 'pageHTML'].includes(item.kind)).length,
            unavailable: courseItems.filter(item => item.status === 'Not available').length });
        this.log(`${course.folder}: ${course.layout.modules.length} content modules; ${courseItems.length} resources; ${courseItems.filter(item => item.status === 'Not available').length} not available.`);
    }
}
