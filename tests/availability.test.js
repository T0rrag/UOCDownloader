import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingPublication, pageAvailability, pageDates } from '../extension/lib/availability.js';
const text = 'Actividad evaluable Individual Inicio 05/10/26 Entrega 25/10/26 En esta primera PAC1 evaluaremos el rendimiento del procesador. El enunciado de la PEC1 lo podréis descargar desde este espacio cuando comience el plazo.';
test('exact supplied PEC1 wording is identified as a publication placeholder', () => assert.equal(pendingPublication(text), true));
test('readable introduction does not become a downloadable statement', () => {
    const result = pageAvailability({ text, role: 'statement' });
    assert.equal(result.status, 'Not available');
    assert.equal(result.selected, false);
    assert.equal(result.displayOnly, true);
});
test('start and submission dates from the supplied text are retained as text', () => assert.deepEqual(pageDates(text), { startText: '05/10/26', dueText: '25/10/26' }));
test('an actually available attachment wins over stale future-publication prose', () => assert.equal(pageAvailability({ text, role: 'statement', availableFiles: 1, linkedFiles: 1 }).status, 'Source page'));
test('locked metadata always wins over apparently available content', () => assert.equal(pageAvailability({ text, role: 'statement', availableFiles: 1, blocked: 'Locked' }).status, 'Not available'));
test('a locked or oversized linked file is not considered a downloadable statement', () => assert.equal(pageAvailability({ text: 'Download', role: 'statement', linkedFiles: 1, availableFiles: 0 }).status, 'Not available'));
test('an ambiguous statement page is labelled no download found, not unpublished', () => {
    const result = pageAvailability({ text: 'Objectives and instructions for the course.', role: 'statement' });
    assert.equal(result.status, 'No download found');
    assert.equal(result.selected, false);
    assert.equal(result.displayOnly, false);
});
test('genuine inline exercises are optional page text, not a claimed PDF attachment', () => {
    const result = pageAvailability({ text: 'Ejercicio 1. Calcule el rendimiento del procesador y explique cada uno de los pasos utilizados para demostrar el resultado obtenido. Indique los supuestos.', role: 'statement' });
    assert.equal(result.status, 'Page text only');
    assert.equal(result.selected, false);
});
test('learning-resource pages without direct downloads are optional text', () => assert.equal(pageAvailability({ text: 'Read the online learning materials.', role: 'resources' }).status, 'Page text only'));
test('empty page is not available', () => assert.equal(pageAvailability({ text: '', role: 'resources' }).status, 'Not available'));
test('scan errors are not mislabeled as scheduled publication', () => assert.equal(pageAvailability({ text, role: 'statement', failed: true }).status, 'Scan error'));
for (const phrase of ['Próximamente', 'El enunciado todavía no está disponible.', 'L’enunciat es publicarà pròximament.', 'The statement will be available later.'])
    test('publication phrase: ' + phrase, () => assert.equal(pendingPublication(phrase), true));
