import { GENERAL, REVIEW, safeSegment, resourcePaths } from './core.js';
import { safeRelativeDirectory } from './layout.js';
export const ACTIVITY_FOLDERS = ['00. Enunciado', '01. Trabajo', '02. Entrega'];
export function destinations(item) { return item.override ? [item.override] : item.destinations; }
export function outputEntries(items, root) {
    return items.flatMap(item => resourcePaths(item, root).map((path, index) => ({
        type: 'file', path, name: path.split('/').at(-1), item,
        destination: destinations(item)[index],
    })));
}
export function isSelected(entry) {
    return !entry.item.displayOnly && !entry.item.disabledReason && (entry.item.selection?.[entry.destination] ?? entry.item.selected !== false);
}
export function setSelected(entry, selected) {
    if (entry.item.disabledReason || entry.item.displayOnly)
        return;
    entry.item.selection ??= {};
    entry.item.selection[entry.destination] = !!selected;
}
export function selectedOutputs(items, root) { return outputEntries(items, root).filter(isSelected); }
export function skeletonDirectories(courses, root) {
    const base = safeSegment(root, 50), directories = [base + '/'];
    for (const course of courses) {
        const prefix = `${base}/${safeSegment(course.folder, 100)}/`;
        directories.push(prefix);
        if (course.layout?.version === 3) {
            for (const relative of course.layout.directories)
                directories.push(prefix + safeRelativeDirectory(relative) + '/');
            continue;
        }
        for (const activity of course.activities) {
            directories.push(prefix + activity + '/');
            for (const folder of ACTIVITY_FOLDERS)
                directories.push(prefix + activity + '/' + folder + '/');
        }
    }
    return directories;
}
export function buildTree(courses, items, root) {
    const name = safeSegment(root, 50);
    const tree = { type: 'folder', path: name, name, children: [] };
    const folders = new Map([[name, tree]]);
    const ensure = path => {
        path = path.replace(/\/$/, '');
        if (folders.has(path))
            return folders.get(path);
        const parts = path.split('/');
        const label = parts.pop();
        const parent = ensure(parts.join('/'));
        const node = { type: 'folder', path, name: label, children: [] };
        parent.children.push(node);
        folders.set(path, node);
        return node;
    };
    for (const directory of skeletonDirectories(courses, root))
        ensure(directory);
    const included = new Set(courses.map(course => course.id));
    for (const entry of outputEntries(items.filter(item => included.has(item.courseId)), root)) {
        ensure(entry.path.slice(0, entry.path.lastIndexOf('/'))).children.push(entry);
    }
    // Canvas module order is preserved; general resources are placed first by layout.js.
    for (const node of folders.values()) {
        const files = node.children.filter(child => child.type === 'file').sort((a, b) => a.name.localeCompare(b.name));
        node.children = [...node.children.filter(child => child.type === 'folder'), ...files];
    }
    return tree;
}
export function descendants(node) { return node.type === 'file' ? [node] : node.children.flatMap(descendants); }
export function selectionState(node) {
    const enabled = descendants(node).filter(entry => !entry.item.disabledReason && !entry.item.displayOnly);
    const count = enabled.filter(isSelected).length;
    return { total: enabled.length, count, checked: enabled.length > 0 && count === enabled.length,
        mixed: count > 0 && count < enabled.length, disabled: enabled.length === 0 };
}
export function filterTree(node, query) {
    const q = String(query).trim().toLocaleLowerCase();
    if (!q)
        return node;
    const haystack = node.type === 'file' ? `${node.path} ${node.item.title} ${node.item.kind}` : node.path;
    if (haystack.toLocaleLowerCase().includes(q))
        return node;
    if (node.type === 'file')
        return null;
    const children = node.children.map(child => filterTree(child, q)).filter(Boolean);
    return children.length ? { ...node, children } : null;
}
