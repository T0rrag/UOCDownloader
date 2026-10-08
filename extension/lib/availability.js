/* A readable Canvas page is not evidence that its assignment PDF is published.
 * This deliberately distinguishes a publication notice from an inline task.
 */
import { normalize } from './core.js';
export function pendingPublication(text) {
    const value = normalize(text).replace(/['’]/g, ' ').replace(/\s+/g, ' ');
    const patterns = [
        /(?:ENUNCIAD[OA]|ENUNCIAT|STATEMENT|BRIEF).{0,220}(?:CUANDO\s+(?:COMIENCE|EMPIECE|SE\s+ABRA)|QUAN\s+(?:COMENCI|S INICII)|WHEN\s+(?:THE\s+)?(?:PERIOD|ACTIVITY|ASSIGNMENT)\s+(?:STARTS|OPENS))/,
        /(?:DESCARGAR|DESCARGA|DESCARREGAR|DOWNLOAD).{0,180}(?:CUANDO\s+(?:COMIENCE|EMPIECE)|QUAN\s+COMENCI|WHEN.{0,40}(?:STARTS|OPENS))/,
        /(?:ENUNCIAD[OA]|ENUNCIAT|STATEMENT|BRIEF).{0,150}(?:(?:NO|NOT|ENCARA NO|AUN NO|TODAVIA NO).{0,30}(?:DISPONIBLE|AVAILABLE|PUBLICAD[OA])|(?:ESTARA|SERA|WILL BE|ES PUBLICARA).{0,35}(?:DISPONIBLE|AVAILABLE|PUBLICAD[OA]))/,
        /(?:PROXIMAMENTE|PROXIMAMENT|COMING SOON|PENDIENTE DE PUBLICACION|PENDENT DE PUBLICACIO)/,
    ];
    return patterns.some(pattern => pattern.test(value));
}
export function hasInlineTask(text) {
    const value = normalize(text);
    // Conservative signal. Ambiguous text is offered as optional page text, not a ready attachment.
    return value.length > 120 && /\b(?:EJERCICIO|EJERCICI|EXERCISE|PREGUNTA|QUESTION|PROBLEMA)\s*\d+\b/.test(value);
}
export function pageDates(text) {
    const start = String(text).match(/(?:Inicio|Inici|Start)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{2,4})/i);
    const due = String(text).match(/(?:Entrega|Lliurament|Due)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{2,4})/i);
    return { startText: start?.[1] || null, dueText: due?.[1] || null };
}
export function pageAvailability({ text = '', role, availableFiles = 0, linkedFiles = 0, blocked = '', failed = false }) {
    if (blocked)
        return { status: 'Not available', reason: blocked, selected: false, displayOnly: true };
    if (failed)
        return { status: 'Scan error', reason: 'Could not finish reading the linked content. Review the scan report.', selected: false, displayOnly: true };
    if (availableFiles)
        return { status: 'Source page', reason: '', selected: false, displayOnly: false };
    if (pendingPublication(text))
        return { status: 'Not available', reason: 'The page says the downloadable content will be published later. No available attachment was found.', selected: false, displayOnly: true };
    if (linkedFiles)
        return { status: 'Not available', reason: 'Linked files were found, but none is currently available within the selected limits.', selected: false, displayOnly: true };
    if (!String(text).trim())
        return { status: 'Not available', reason: 'The page contains no readable content or downloadable attachment.', selected: false, displayOnly: true };
    if (role === 'statement' && !hasInlineTask(text))
        return { status: 'No download found', reason: '', note: 'No downloadable statement was found. This is optional page text, not a verified assignment file.', selected: false, displayOnly: false };
    return { status: 'Page text only', reason: '', note: 'Optional HTML copy of the page text; no downloadable attachment was found.', selected: false, displayOnly: false };
}
