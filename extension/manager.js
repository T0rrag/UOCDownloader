import { APP_NAME, APP_VERSION, sanitizeMessage, ORIGIN, GENERAL, REVIEW, safeSegment, formatSize, safeLink, validateConfig } from './lib/core.js';
import { CanvasClient } from './lib/api.js';
import { Scanner } from './lib/scanner.js';
import { ZipDownloader, saveReport } from './lib/downloader.js';
import { buildTree, filterTree, descendants, selectionState, isSelected, setSelected, selectedOutputs, skeletonDirectories } from './lib/tree.js';
import { attachmentOrigins } from './lib/files.js';
const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className)
        element.className = className;
    if (text !== undefined)
        element.textContent = text;
    return element;
};
let config, client, downloader, plan = null, runResult = null, busy = false, overrides = {}, lastReport = null;
let currentTree = null, visibleTree = null, lastProgress = 0;
const collapsed = new Set(), lines = [], checks = [], rowStatuses = new Map();
function log(text, severity = 'info') {
    const cleaned = sanitizeMessage(text);
    lines.push(`${new Date().toLocaleTimeString()} ${severity === 'warning' ? 'WARN  ' : ''}${cleaned}`);
    if (lines.length > 500)
        lines.shift();
    $('log').textContent = lines.join('\n');
    $('log').scrollTop = $('log').scrollHeight;
}
function banner(text, kind = '') { $('banner').textContent = text; $('banner').className = `banner ${kind}`; }
function selectedCourses() { return config.courses.filter(course => $(`course-${course.id}`).checked); }
function treeCourses() { return plan?.courses || selectedCourses(); }
function settings() {
    return { root: $('root').value.trim(), selectedCourses: selectedCourses().map(course => course.id),
        maxMB: Number($('max-size').value), maxZipMB: Number($('zip-size').value), allowPartial: $('allow-partial').checked };
}
async function persistSettings() { if (config)
    await chrome.storage.local.set({ settings: settings() }); }
function checkedOptions() {
    const options = settings();
    if (!options.root || safeSegment(options.root, 50) !== options.root)
        throw new Error('Use a single semester folder name, not an absolute path or a name with slashes, colons or trailing dots.');
    for (const [label, value] of [['Per-file limit', options.maxMB], ['ZIP limit', options.maxZipMB]]) {
        if (!Number.isInteger(value) || value < 1 || value > 1024)
            throw new Error(`${label} must be a whole number from 1 to 1024 MB.`);
    }
    return { ...options, courses: treeCourses(), maxBytes: options.maxMB * 1024 ** 2, maxZipBytes: options.maxZipMB * 1024 ** 2 };
}
function rootName() { return $('root').value || config.semester_folder; }
function chosenOutputs() { return selectedOutputs(plan?.items || [], rootName()); }
function statusClass(item) {
    if (['In ZIP', 'Saved in ZIP'].includes(item.status))
        return 'status-badge success';
    if (['Failed', 'Cancelled', 'Not saved'].includes(item.status))
        return 'status-badge error';
    if (item.disabledReason || item.destinations.includes(REVIEW) && !item.override)
        return 'status-badge warning';
    return 'status-badge';
}
function updateControls() {
    for (const element of document.querySelectorAll('button, input, select'))
        element.disabled = busy;
    $('open-uoc').disabled = false;
    $('chrome-downloads').disabled = false;
    $('stop').disabled = !busy;
    $('download').disabled = busy || !plan || !selectedCourses().length;
    $('select-all').disabled = busy || !plan?.items.length;
    $('select-none').disabled = busy || !plan?.items.length;
    $('report').disabled = busy || (!plan && !lastReport);
    for (const row of checks) {
        if (row.node.type === 'file') {
            row.checkbox.checked = isSelected(row.node);
            row.checkbox.disabled = busy || !!row.node.item.disabledReason || row.node.item.displayOnly;
        }
        else {
            const state = selectionState(row.node);
            row.checkbox.checked = state.checked;
            row.checkbox.indeterminate = state.mixed;
            row.checkbox.disabled = busy || state.disabled;
            row.checkbox.setAttribute('aria-checked', state.mixed ? 'mixed' : String(state.checked));
            const unavailable = descendants(row.node).filter(entry => entry.item.disabledReason).length;
            row.counter.textContent = state.total ? `${state.count} / ${state.total}${unavailable ? ` · ${unavailable} unavailable` : ''}` : unavailable ? 'Not available' : 'empty';
        }
    }
    for (const select of document.querySelectorAll('select[data-key]')) {
        select.disabled = busy || !!plan?.items.find(item => item.key === select.dataset.key)?.disabledReason;
    }
    const chosen = chosenOutputs(), uniqueCount = new Set(chosen.map(entry => entry.item.key)).size;
    const bytes = chosen.reduce((total, entry) => total + (['file', 'externalFile'].includes(entry.item.kind) ? entry.item.size || 0 : 0), 0);
    $('selection-count').textContent = chosen.length ? `${uniqueCount} selected resources · ${chosen.length} files in ZIP` : 'No files selected · structure and availability report only';
    const folders = skeletonDirectories(treeCourses(), rootName()).length;
    $('archive-summary').textContent = `${folders} required folders${bytes ? ` · at least ${formatSize(bytes)}` : ''} · one ZIP${plan ? ' + included report' : ' · scan to add materials'}`;
    $('archive-name').textContent = safeSegment(rootName(), 50) + '.zip';
    const origins = attachmentOrigins(plan?.items || []);
    $('host-panel').hidden = !origins.length;
    $('host-list').textContent = origins.map(origin => new URL(origin).hostname).join('\n');
}
function icon(folder) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', folder ? 'folder-icon' : 'file-icon');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', folder ? 'M3 5h6l2 2h10v13H3z' : 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6');
    path.setAttribute('fill', folder ? 'currentColor' : 'none');
    path.setAttribute('fill-opacity', folder ? '.18' : '1');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
}
function renderPlan() {
    const scroll = $('tree-wrap').scrollTop;
    currentTree = buildTree(treeCourses(), plan?.items || [], rootName());
    visibleTree = filterTree(currentTree, $('filter').value);
    $('directory-tree').replaceChildren();
    checks.length = 0;
    rowStatuses.clear();
    $('resource-count').textContent = `${plan?.items.length || 0} resources`;
    $('empty').hidden = !!visibleTree;
    function renderNode(node, depth = 0) {
        const li = make('li', 'tree-node');
        li.dataset.path = node.path;
        const row = make('div', `tree-row ${node.type === 'folder' ? depth === 0 ? 'root-row' : depth === 1 ? 'course-row' : '' : 'file-row'}${node.item?.disabledReason ? ' disabled-row' : ''}`);
        const checkbox = make('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute('aria-label', node.type === 'folder' ? `Select files in ${node.path}` : `Include ${node.name} in ${node.destination}`);
        if (node.type === 'folder') {
            const toggle = make('button', 'tree-toggle');
            const open = $('filter').value.trim() || !collapsed.has(node.path);
            toggle.textContent = open ? '▾' : '▸';
            toggle.setAttribute('aria-expanded', String(!!open));
            toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${node.name}`);
            const children = make('ul', 'tree-children');
            children.hidden = !open;
            toggle.addEventListener('click', () => {
                if (collapsed.has(node.path))
                    collapsed.delete(node.path);
                else
                    collapsed.add(node.path);
                children.hidden = collapsed.has(node.path);
                toggle.textContent = children.hidden ? '▸' : '▾';
                toggle.setAttribute('aria-expanded', String(!children.hidden));
                toggle.setAttribute('aria-label', `${children.hidden ? 'Expand' : 'Collapse'} ${node.name}`);
            });
            const counter = make('span', 'folder-counter');
            checks.push({ node, checkbox, counter });
            checkbox.addEventListener('change', () => { descendants(node).forEach(entry => setSelected(entry, checkbox.checked)); updateControls(); });
            row.append(toggle, checkbox, icon(true), make('span', 'folder-name', node.name), counter);
            for (const child of node.children)
                children.append(renderNode(child, depth + 1));
            li.append(row, children);
        }
        else {
            const item = node.item;
            checks.push({ node, checkbox });
            checkbox.addEventListener('change', () => { setSelected(node, checkbox.checked); updateControls(); });
            const content = make('div', 'file-content'), href = safeLink(item.source);
            const title = make(href ? 'a' : 'span', 'file-title', node.name);
            if (href) {
                title.href = href;
                title.target = '_blank';
                title.rel = 'noopener noreferrer';
            }
            const meta = make('div', 'file-meta');
            meta.append(make('span', '', ['file', 'externalFile'].includes(item.kind) ? formatSize(item.size) : item.displayOnly ? 'Status only · not a ZIP file' : item.kind === 'link' ? 'Optional online bookmark' : 'Optional page text (HTML)'));
            const select = make('select', 'destination-select');
            select.dataset.key = item.key;
            select.setAttribute('aria-label', `Destination for ${item.title}`);
            const auto = make('option', '', `Auto: ${item.destinations.join(' + ')}`);
            auto.value = '';
            select.append(auto);
            for (const destination of item.allowedDestinations || [...item.activities, GENERAL, REVIEW]) {
                const option = make('option', '', destination);
                option.value = destination;
                select.append(option);
            }
            select.value = item.override || '';
            select.addEventListener('change', async () => {
                const wasSelected = chosenOutputs().some(entry => entry.item.key === item.key);
                item.override = select.value || null;
                item.selection = {};
                item.selected = wasSelected;
                if (item.override)
                    overrides[item.key] = item.override;
                else
                    delete overrides[item.key];
                await chrome.storage.local.set({ moduleDestinationOverridesV3: overrides });
                renderPlan();
            });
            meta.append(select);
            content.append(title, meta);
            if (item.disabledReason)
                content.append(make('div', 'file-reason', item.disabledReason));
            else if (item.note)
                content.append(make('div', 'file-note', item.note));
            if (item.displayDates?.startText || item.displayDates?.dueText)
                content.append(make('div', 'file-note', [item.displayDates.startText && `Inicio: ${item.displayDates.startText}`, item.displayDates.dueText && `Entrega: ${item.displayDates.dueText}`].filter(Boolean).join(' · ')));
            const status = make('span', statusClass(item), item.status || 'Ready');
            if (!rowStatuses.has(item.key))
                rowStatuses.set(item.key, []);
            rowStatuses.get(item.key).push(status);
            row.append(make('span', 'file-spacer'), checkbox, icon(false), content, status);
            li.append(row);
        }
        return li;
    }
    if (visibleTree)
        $('directory-tree').append(renderNode(visibleTree));
    $('tree-wrap').scrollTop = scroll;
    updateControls();
}
function updateStatus(done, total, item, stage, bytes) {
    if (bytes !== undefined && Date.now() - lastProgress < 120)
        return;
    lastProgress = Date.now();
    $('progress').max = Math.max(total, 1);
    $('progress').value = done;
    if (item)
        for (const label of rowStatuses.get(item.key) || []) {
            label.textContent = item.status;
            label.className = statusClass(item);
        }
    banner(`${stage}: ${done} / ${total} files${item ? ` · ${item.title}` : ''}${bytes !== undefined ? ` · ${formatSize(bytes)} read` : ''}. Keep both tabs open.`);
}
function reportObject() {
    if (!plan)
        return lastReport;
    const chosen = chosenOutputs();
    return { application: APP_NAME, version: APP_VERSION, mode: 'single-zip', structureSource: plan.structureSource, courses: plan.courses, scanIncomplete: plan.scanIncomplete, scannedAt: plan.scannedAt,
        exportedAt: new Date().toISOString(), root: safeSegment(rootName(), 50), courseStats: plan.stats, warnings: plan.warnings,
        resources: plan.items.map(item => ({ key: item.key, courseId: item.courseId, title: item.title, kind: item.kind,
            selectedOutputs: chosen.filter(entry => entry.item.key === item.key).map(entry => entry.path),
            disabledReason: item.disabledReason || null, dates: item.displayDates || null, moduleTitle: item.moduleTitle, destinations: item.destinations, source: safeLink(item.source), status: item.status })), downloadRun: runResult };
}
async function operation(callback) {
    if (busy)
        return;
    try {
        await navigator.locks.request('uoc-semester-operation', { ifAvailable: true }, async (lock) => {
            if (!lock)
                throw new Error('Another UOC Downloader tab is running. Stop it before starting another operation.');
            busy = true;
            updateControls();
            try {
                await callback();
            }
            finally {
                busy = false;
                updateControls();
            }
        });
    }
    catch (error) {
        log(error.message, 'warning');
        banner(error.message, 'error');
    }
}
async function connect() {
    client = new CanvasClient(log);
    $('session-state').textContent = 'Checking…';
    $('session-detail').textContent = 'Testing a read request through your open UOC tab.';
    try {
        await client.connect();
        $('session-state').textContent = 'Session connected';
        $('session-detail').textContent = 'Course-list access confirmed. File access is checked during ZIP preparation.';
        log('UOC session connected. No API token was requested.');
    }
    catch (error) {
        $('session-state').textContent = 'Connection failed';
        $('session-detail').textContent = 'Sign in to UOC and keep the tab open.';
        throw error;
    }
}
$('open-uoc').addEventListener('click', () => chrome.tabs.create({ url: ORIGIN }));
$('chrome-downloads').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://downloads/' }));
$('check').addEventListener('click', () => operation(async () => { await connect(); banner('Session check passed. Scan subjects to populate the folder tree.', 'success'); }));
$('scan').addEventListener('click', () => operation(async () => {
    const options = checkedOptions();
    if (!options.courses.length)
        throw new Error('Select at least one subject.');
    await persistSettings();
    await connect();
    plan = null;
    runResult = null;
    renderPlan();
    $('progress').value = 0;
    banner('Scanning selected subjects. No downloads are being saved.');
    plan = await new Scanner(client, options, log).scan(options.courses);
    for (const item of plan.items)
        if ((item.allowedDestinations || []).includes(overrides[item.key]))
            item.override = overrides[item.key];
    renderPlan();
    lastReport = reportObject();
    await chrome.storage.local.set({ lastReport });
    banner(`Scan finished: ${plan.courses.reduce((n, course) => n + course.layout.modules.length, 0)} Contenidos modules · ${plan.items.filter(item => item.status === 'Not available').length} not available · ${plan.warnings.length} warnings. Review the tree, then Download ZIP.`, plan.warnings.length ? 'warning' : 'success');
}));
$('download').addEventListener('click', () => operation(async () => {
    const options = checkedOptions();
    if (!plan || !options.courses.length)
        throw new Error('Scan at least one subject first.');
    await persistSettings();
    if (chosenOutputs().some(entry => entry.item.kind === 'file'))
        await connect();
    else
        client = new CanvasClient(log);
    for (const item of plan.items)
        if (!item.disabledReason && ['Saved in ZIP', 'Failed', 'Not saved', 'Cancelled'].includes(item.status))
            item.status = ['file', 'externalFile'].includes(item.kind) ? 'Ready' : item.kind === 'link' ? 'Online only' : 'Source page';
    downloader = new ZipDownloader(client, log, updateStatus);
    runResult = null;
    try {
        runResult = await downloader.run(plan.items, options, { scannedAt: plan.scannedAt, warnings: plan.warnings, courseStats: plan.stats, scanIncomplete: plan.scanIncomplete, scanErrors: plan.scanErrors, structureSource: plan.structureSource });
        banner(`${runResult.partial ? 'Partial ZIP saved' : 'ZIP saved'}: ${runResult.filename} · ${formatSize(runResult.archiveBytes)} · ${runResult.results.filter(row => row.outcome === 'packed').length} files + folder structure and report.`, runResult.partial ? 'warning' : 'success');
        log(`Saved one archive: ${runResult.filename}. No individual course files were saved outside the ZIP.`);
    }
    finally {
        runResult = downloader.result || runResult;
        if (!runResult?.archiveSaved)
            for (const item of plan.items)
                if (['In ZIP', 'Reading', 'Packing'].includes(item.status))
                    item.status = 'Not saved';
        renderPlan();
        lastReport = reportObject();
        await chrome.storage.local.set({ lastReport });
        downloader = null;
    }
}));
$('stop').addEventListener('click', async () => {
    $('stop').disabled = true;
    banner('Stopping. Unsaved ZIP content will be discarded.', 'warning');
    await Promise.allSettled([client?.stop(), downloader?.stop()]);
});
$('report').addEventListener('click', () => operation(async () => { checkedOptions(); await saveReport(reportObject(), rootName()); banner('Diagnostic report saved. Successful ZIPs also contain their own report.', 'success'); }));
$('allow-hosts').addEventListener('click', () => {
    const origins = attachmentOrigins(plan?.items || []);
    if (!origins.length || busy)
        return;
    // Keep permissions.request directly inside the user gesture, before any await.
    chrome.permissions.request({ origins }).then(granted => {
        banner(granted ? 'Attachment-host access granted. You can now retry Download ZIP.' : 'Permission was not granted. UOC-session reads remain available; some attachments may still fail.', granted ? 'success' : 'warning');
        log(granted ? 'Attachment-host access granted. Retry Download ZIP.' : 'Attachment-host access was not granted.', granted ? 'info' : 'warning');
    }).catch(error => { log(error.message, 'warning'); banner(sanitizeMessage(error.message), 'error'); });
});
$('filter').addEventListener('input', renderPlan);
$('select-all').addEventListener('click', () => { if (visibleTree)
    descendants(visibleTree).forEach(entry => setSelected(entry, true)); updateControls(); });
$('select-none').addEventListener('click', () => { if (visibleTree)
    descendants(visibleTree).forEach(entry => setSelected(entry, false)); updateControls(); });
$('expand-all').addEventListener('click', () => { collapsed.clear(); renderPlan(); });
$('collapse-all').addEventListener('click', () => {
    function close(node) { if (node.type === 'folder') {
        if (node !== currentTree)
            collapsed.add(node.path);
        node.children.forEach(close);
    } }
    if (currentTree)
        close(currentTree);
    renderPlan();
});
window.addEventListener('beforeunload', event => { if (busy) {
    event.preventDefault();
    event.returnValue = '';
} });
async function initialize() {
    $('app-version').textContent = `UOC / Canvas · version ${APP_VERSION}`;
    config = validateConfig(await (await fetch('asignaturas.json')).json());
    const stored = await chrome.storage.local.get(['settings', 'moduleDestinationOverridesV3', 'lastReport']);
    overrides = stored.moduleDestinationOverridesV3 || {};
    lastReport = stored.lastReport || null;
    const previous = stored.settings || {};
    $('root').value = previous.root || config.semester_folder;
    $('max-size').value = Math.min(1024, Math.max(1, previous.maxMB || 250));
    $('zip-size').value = Math.min(1024, Math.max(1, previous.maxZipMB || 512));
    $('allow-partial').checked = previous.allowPartial ?? false;
    for (const course of config.courses) {
        const label = make('label', 'course-label'), checkbox = make('input');
        checkbox.type = 'checkbox';
        checkbox.id = `course-${course.id}`;
        checkbox.checked = previous.selectedCourses ? previous.selectedCourses.includes(course.id) : true;
        const text = make('span');
        text.append(make('strong', '', course.folder), make('small', '', `Contenidos → dynamic folders · Course ${course.id}`));
        label.append(checkbox, text);
        $('courses').append(label);
        checkbox.addEventListener('change', async () => { plan = null; runResult = null; await persistSettings(); renderPlan(); banner('Subject selection changed. Scan again to populate the updated structure.'); });
    }
    for (const id of ['root', 'max-size', 'zip-size', 'allow-partial'])
        $(id).addEventListener('change', async () => {
            if (id === 'max-size') {
                plan = null;
                runResult = null;
                banner('Scan settings changed. Scan again before downloading.');
            }
            await persistSettings();
            renderPlan();
        });
    $('root').addEventListener('input', renderPlan);
    renderPlan();
    if (lastReport)
        log('A previous diagnostic report is available. Scan again to build a new ZIP selection.');
}
initialize().catch(error => { banner(`Initialization failed: ${error.message}`, 'error'); log(error.message, 'warning'); for (const button of document.querySelectorAll('button'))
    button.disabled = true; });
