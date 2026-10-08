import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleLayout, emptyLayout, itemRoute, lockReason, assertMaterialDestination } from '../extension/lib/layout.js';
import { skeletonDirectories, buildTree, descendants, selectedOutputs } from '../extension/lib/tree.js';
import { resourcePaths } from '../extension/lib/core.js';
const course = { id: 87938, folder: 'Arquitectura de Computadores', activities: ['OLD LABEL THAT MUST NOT BE USED'] };
const names = ['PEC1 - Evaluación del Rendimiento', 'PEC2 - Procesadores Segmentados', 'Práctica1 (PR1) - Simulador Pipeline', 'Práctica2 (PR2) - Programación Paralela', 'Recursos de Aprendizaje de la Asignatura', 'Foros'];
const records = names.map((name, i) => ({ module: { id: i + 1, name, position: i + 1 }, items: i === 5 ? [{ id: 20, type: 'Discussion', title: 'Foro General' }] : [{ id: i + 1, type: 'Page', title: i === 4 ? 'Recursos (Módulos didácticos y Videos)' : 'Enunciado' }] }));
function dynamic() { return { ...course, layout: moduleLayout(course, records) }; }
test('v3 does not invent activity directories before a Contenidos scan', () => {
    assert.deepEqual(skeletonDirectories([{ ...course, layout: emptyLayout() }], '10º Sem'), ['10º Sem/', '10º Sem/Arquitectura de Computadores/']);
});
test('exact supplied module names build the requested 27-directory skeleton', () => {
    const c = dynamic();
    const dirs = skeletonDirectories([c], '10º Sem');
    assert.equal(dirs.length, 27);
    assert.deepEqual(c.layout.modules.map(m => m.folder), ['0 - Recursos de Aprendizaje de la Asignatura', ...names.slice(0, 4)]);
    assert.ok(dirs.includes('10º Sem/Arquitectura de Computadores/PEC1 - Evaluación del Rendimiento/PEC 1/0. Enunciado/'));
    assert.ok(dirs.includes('10º Sem/Arquitectura de Computadores/Práctica1 (PR1) - Simulador Pipeline/PR1/1. Trabajo/'));
    assert.ok(dirs.includes('10º Sem/Arquitectura de Computadores/Práctica2 (PR2) - Programación Paralela/Recursos de aprendizaje de PR2/'));
    assert.equal(dirs.filter(x => x.endsWith('/2. Entrega/')).length, 4);
});
test('Foros is excluded and the exclusion is recorded', () => { const layout = dynamic().layout; assert.equal(layout.modules.length, 5); assert.equal(layout.excludedModules[0].title, 'Foros'); });
test('statement and learning-resource pages resolve to separate sibling branches', () => {
    const m = dynamic().layout.modules.find(m => m.id === 1);
    assert.equal(itemRoute(m, { type: 'Page', title: 'Enunciado de la PEC1' }).destination, 'PEC1 - Evaluación del Rendimiento/PEC 1/0. Enunciado');
    assert.equal(itemRoute(m, { type: 'Page', title: 'Recursos de aprendizaje de la PEC1' }).destination, 'PEC1 - Evaluación del Rendimiento/Recursos de aprendizaje de PEC 1');
});
test('explicit statement label outranks a previous resources subheading', () => {
    const m = dynamic().layout.modules.find(m => m.id === 1);
    assert.equal(itemRoute(m, { type: 'Page', title: 'Enunciado de la PEC1' }, 'Recursos').role, 'statement');
});
test('general resources go directly into the prefixed general folder', () => {
    const m = dynamic().layout.modules[0];
    assert.deepEqual(itemRoute(m, { type: 'Page', title: 'Recursos' }), { destination: '0 - Recursos de Aprendizaje de la Asignatura', role: 'resources' });
});
test('unknown non-activity module keeps its own title without inventing a PEC', () => {
    const layout = moduleLayout(course, [{ module: { id: 99, name: 'Introducción', position: 1 }, items: [] }]);
    assert.deepEqual(layout.directories, ['Introducción']);
    assert.equal(layout.modules[0].activity, null);
});
test('Reto and Catalan Pràctica activity labels are detected dynamically', () => {
    const layout = moduleLayout(course, [{ module: { id: 1, name: 'Repte 5 - Organització', position: 1 }, items: [] }, { module: { id: 2, name: 'Pràctica 3', position: 2 }, items: [] }]);
    assert.deepEqual(layout.modules.map(m => m.activity), ['Reto 5', 'PR3']);
});
test('duplicate module titles are disambiguated by stable module ID', () => {
    const layout = moduleLayout(course, [{ module: { id: 1, name: 'PEC1', position: 1 }, items: [] }, { module: { id: 2, name: 'PEC1', position: 2 }, items: [] }]);
    assert.deepEqual(layout.modules.map(m => m.folder), ['PEC1', 'PEC1 [module-2]']);
    assert.equal(new Set(layout.directories).size, layout.directories.length);
});
for (const path of ['../secret', 'PEC1//test', 'PEC1/1. Trabajo', 'PEC1/2. Entrega', 'PEC1/01. Trabajo', '/absolute', 'C:\\Windows'])
    test('v3 rejects material destination ' + path, () => assert.throws(() => assertMaterialDestination(path)));
test('resource paths use full module hierarchy rather than a flat PEC label', () => {
    const c = dynamic(), destination = c.layout.modules.find(m => m.id === 1).statementPath;
    const item = { key: 'file', kind: 'file', id: 7, title: 'enunciado.pdf', courseId: c.id, courseFolder: c.folder, activities: [], allowedDestinations: c.layout.destinations, destinations: [destination] };
    assert.equal(resourcePaths(item, '10º Sem')[0], `10º Sem/Arquitectura de Computadores/${destination}/enunciado [file-7].pdf`);
});
test('a publication notice remains visible in the tree but cannot enter selected ZIP outputs', () => {
    const c = dynamic(), destination = c.layout.modules.find(m => m.id === 1).statementPath;
    const item = { key: 'notice', kind: 'page', id: 'enunciado', title: 'Enunciado de la PEC1', courseId: c.id, courseFolder: c.folder, activities: [], allowedDestinations: c.layout.destinations, destinations: [destination], status: 'Not available', selected: true, displayOnly: true, disabledReason: 'Published later' };
    assert.equal(descendants(buildTree([c], [item], '10º Sem')).length, 1);
    assert.equal(selectedOutputs([item], '10º Sem').length, 0);
    assert.equal(resourcePaths(item, '10º Sem')[0].split('/').at(-1), 'Enunciado de la PEC1');
});
test('lock handling reports returned unlock date but never guesses from time alone', () => {
    assert.equal(lockReason({ unlock_at: '2099-01-01' }), '');
    assert.match(lockReason({ locked_for_user: true, unlock_at: '2026-10-05' }), /2026-10-05/);
});
test('general course-resource module is not turned into a PEC based on a linked item title', () => {
    const layout = moduleLayout(course, [{ module: { id: 1, name: 'Recursos de Aprendizaje de la Asignatura' }, items: [{ type: 'Page', title: 'Recursos de PEC1' }] }]);
    assert.equal(layout.modules[0].kind, 'general');
    assert.equal(layout.modules[0].activity, null);
});
