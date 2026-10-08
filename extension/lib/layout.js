/* Contenidos is the source of truth. The configured activity list is never used
 * to invent modules. All values below are relative, validated ZIP directories.
 */
import { activityKeys, normalize, safeSegment, unique, ORIGIN } from './core.js';
export const MODULE_LAYOUT_VERSION = 3;
export const STANDARD_FOLDERS = ['0. Enunciado', '1. Trabajo', '2. Entrega'];
export const RESOURCE_ROOT = '0 - Recursos de Aprendizaje de la Asignatura';
export const isDiscussion = item => ['Discussion', 'DiscussionTopic'].includes(item?.type);
export const isResourceTitle = title => /\b(RECURSOS?|RESOURCES?|MATERIALES?|MATERIALS?|BIBLIOGRAFIA|LECTURAS?|RECURSOS D APRENENTATGE)\b/.test(normalize(title));
export const isStatementTitle = title => /\b(ENUNCIAD[OA]S?|ENUNCIATS?|STATEMENTS?|BRIEFS?|TASKS?)\b/.test(normalize(title));
export function labelForActivity(key) {
    const [kind, number] = key.split(':');
    return kind === 'PR' ? `PR${Number(number)}` : kind === 'RETO' ? `Reto ${Number(number)}` : `PEC ${Number(number)}`;
}
export function emptyLayout() { return { version: MODULE_LAYOUT_VERSION, scanned: false, modules: [], directories: [], destinations: [], excludedModules: [] }; }
export function safeRelativeDirectory(value) {
    if (typeof value !== 'string' || !value || value.startsWith('/') || value.endsWith('/'))
        throw new Error('Invalid relative directory.');
    const parts = value.split('/');
    if (parts.some(part => part === '.' || part === '..' || safeSegment(part, 140) !== part))
        throw new Error('Unsafe directory segment.');
    return parts.join('/');
}
export function assertMaterialDestination(value) {
    const path = safeRelativeDirectory(value);
    if (path.split('/').some(part => /^(?:0?1\.\s*Trabajo|0?2\.\s*Entrega)$/i.test(part)))
        throw new Error('Material cannot be written to Trabajo or Entrega.');
    return path;
}
export function lockReason(object) {
    if (!object || typeof object !== 'object')
        return '';
    const locked = object.locked_for_user || object.hidden_for_user || object.published === false || object.state === 'locked';
    if (!locked)
        return '';
    const explanation = typeof object.lock_explanation === 'string' ? object.lock_explanation.replace(/<[^>]*>/g, ' ').trim() : '';
    const unlock = object.unlock_at || object.lock_info?.unlock_at;
    return `${explanation || (object.published === false ? 'Not published for your account.' : 'Locked or hidden for your account.')}${unlock ? ` Opens: ${unlock}.` : ''}`;
}
export function moduleLayout(course, records) {
    const layout = { ...emptyLayout(), scanned: true };
    const folders = new Set();
    for (const { module, items, error } of records) {
        const visibleItems = items.filter(item => !isDiscussion(item));
        const onlyDiscussions = items.length > 0 && visibleItems.every(item => item.type === 'SubHeader');
        const forumName = /^(?:FOROS?|FORUMS?|FORUMS DE DISCUSSIO|DISCUSSION FORUMS?)$/.test(normalize(module.name).trim());
        if (onlyDiscussions || (forumName && !error)) {
            layout.excludedModules.push({ id: module.id, title: module.name, reason: 'Discussion/forum module' });
            continue;
        }
        let keys = activityKeys(module.name);
        const wholeCourseResources = isResourceTitle(module.name) && /\b(?:ASIGNATURA|ASSIGNATURA|COURSE)\b/.test(normalize(module.name));
        if (!keys.length && !wholeCourseResources)
            keys = unique(visibleItems.flatMap(item => activityKeys(item.title)));
        const activity = keys.length === 1 ? labelForActivity(keys[0]) : null;
        const general = !activity && isResourceTitle(module.name);
        let folder = general ? RESOURCE_ROOT : safeSegment(module.name || `Module ${module.id}`, 120);
        if (folders.has(folder.toLocaleLowerCase()))
            folder = safeSegment(`${folder} [module-${module.id}]`, 140);
        folders.add(folder.toLocaleLowerCase());
        const entry = { id: Number(module.id), title: String(module.name || folder), folder, activity,
            kind: activity ? 'activity' : general ? 'general' : 'other',
            position: module.position ?? layout.modules.length + 1,
            source: `${ORIGIN}/courses/${course.id}/modules#context_module_${module.id}`,
            lockedReason: lockReason(module), itemIds: items.map(item => item.id), scanError: error || null };
        entry.statementPath = activity ? `${folder}/${activity}/0. Enunciado` : folder;
        entry.resourcesPath = activity ? `${folder}/Recursos de aprendizaje de ${activity}` : folder;
        layout.modules.push(entry);
    }
    // General resources first. All other modules retain Canvas order, not alphabetical order.
    layout.modules.sort((a, b) => Number(b.kind === 'general') - Number(a.kind === 'general') || a.position - b.position);
    for (const module of layout.modules) {
        layout.directories.push(module.folder);
        if (module.activity) {
            layout.directories.push(`${module.folder}/${module.activity}`);
            for (const folder of STANDARD_FOLDERS)
                layout.directories.push(`${module.folder}/${module.activity}/${folder}`);
            layout.directories.push(module.resourcesPath);
            layout.destinations.push(module.statementPath, module.resourcesPath);
        }
        else
            layout.destinations.push(module.folder);
    }
    layout.directories = unique(layout.directories).map(safeRelativeDirectory);
    layout.destinations = unique(layout.destinations).map(assertMaterialDestination);
    return layout;
}
export function itemRoute(module, item, subheading = '') {
    if (!module.activity)
        return { destination: module.folder, role: 'resources' };
    // An explicit statement/resource label outranks a neighbouring subheading.
    const role = isResourceTitle(item.title) ? 'resources' : isStatementTitle(item.title) || item.type === 'Assignment' ? 'statement'
        : isResourceTitle(subheading) ? 'resources' : isStatementTitle(subheading) ? 'statement'
            : item.type === 'File' && /\b(PEC|PAC|PR|PRACTICA|RETO|REPTE)\s*\d/.test(normalize(item.title)) ? 'statement' : 'resources';
    return { destination: role === 'statement' ? module.statementPath : module.resourcesPath, role };
}
