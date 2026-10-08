import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTree, skeletonDirectories, descendants, selectionState, filterTree, selectedOutputs, setSelected } from '../extension/lib/tree.js';
const config = JSON.parse(await readFile(new URL('../extension/asignaturas.json', import.meta.url), 'utf8'));
// Legacy path helpers remain covered; production v3 uses dynamic module layouts.
config.courses = config.courses.map(({ layout, ...course }) => course);
const course = config.courses[0];
const item = { key: '87938:file:777', kind: 'file', id: 777, courseId: course.id, courseFolder: course.folder, activities: course.activities,
    title: 'enunciado.pdf', destinations: ['PEC 1', 'PEC 2'], selected: true };
const root = '10º Sem';
test('legacy complete semester skeleton has precisely 90 directory entries', () => {
    const directories = skeletonDirectories(config.courses, root);
    assert.equal(directories.length, 90);
    assert.equal(new Set(directories).size, 90);
    assert.equal(directories.filter(path => path.endsWith('/00. Enunciado/')).length, 21);
    assert.equal(directories.filter(path => path.endsWith('/01. Trabajo/')).length, 21);
    assert.equal(directories.filter(path => path.endsWith('/02. Entrega/')).length, 21);
});
test('legacy empty tree is visible before scanning and preserves configured ordering', () => {
    const tree = buildTree(config.courses, [], root);
    assert.equal(tree.children.length, 5);
    assert.deepEqual(tree.children[0].children.map(node => node.name), ['PEC 1', 'PEC 2', 'PR1', 'PR2']);
    assert.deepEqual(tree.children[3].children.map(node => node.name), ['PEC 1', 'PR 1', 'PEC 2', 'PR 2', 'PEC 3']);
});
test('one subject skeleton keeps all activities even with zero file selections', () => {
    assert.equal(skeletonDirectories([course], root).length, 18);
    assert.equal(descendants(buildTree([course], [{ ...item, selected: false }], root)).length, 2);
});
test('shared attachment destinations are independently selectable', () => {
    const resource = structuredClone(item), tree = buildTree([course], [resource], root), entries = descendants(tree);
    assert.equal(entries.length, 2);
    setSelected(entries[0], false);
    assert.equal(selectedOutputs([resource], root).length, 1);
    assert.equal(selectedOutputs([resource], root)[0].destination, 'PEC 2');
    assert.equal(selectionState(tree).mixed, true);
    setSelected(entries[1], false);
    assert.equal(selectionState(tree).count, 0);
});
test('parent checkbox ignores unavailable items', () => {
    const tree = buildTree([course], [{ ...item, destinations: ['PEC 1'] }, { ...item, id: 778, key: 'locked', disabledReason: 'Locked' }], root);
    assert.deepEqual(selectionState(tree), { total: 1, count: 1, checked: true, mixed: false, disabled: false });
});
test('tree filter retains parent folders for file matches', () => {
    const filtered = filterTree(buildTree([course], [item], root), 'enunciado.pdf');
    assert.equal(descendants(filtered).length, 2);
    const match = filterTree(buildTree([course], [item], root), 'file-777');
    assert.equal(match.name, root);
    assert.equal(descendants(match).length, 2);
});
test('filtering by activity keeps that complete branch', () => {
    const filtered = filterTree(buildTree([course], [item], root), 'PEC 2');
    assert.equal(filtered.children[0].children.length, 1);
    assert.equal(filtered.children[0].children[0].children.length, 3);
    assert.equal(descendants(filtered).length, 1);
});
test('override moves resource and removes previous file locations', () => {
    const tree = buildTree([course], [{ ...item, override: 'PR1' }], root);
    assert.equal(descendants(tree).length, 1);
    assert.match(descendants(tree)[0].path, /\/PR1\/00\. Enunciado\//);
});
test('resources from excluded courses do not enter the tree', () => {
    assert.equal(descendants(buildTree([config.courses[1]], [item], root)).length, 0);
});
test('root rename changes paths without losing per-destination selection', () => {
    const resource = structuredClone(item);
    setSelected(descendants(buildTree([course], [resource], root))[0], false);
    const output = selectedOutputs([resource], 'Semester');
    assert.equal(output.length, 1);
    assert.ok(output[0].path.startsWith('Semester/'));
});
