#!/usr/bin/env python3
"""Real Chromium + bundled production source, synthetic Canvas/Chrome responses.
No real UOC session, installation, file-host permission, or actual course file
is used. ZIP bytes are independently checked with Python's zipfile module.
"""
import asyncio
import io
import json
import os
import re
import shutil
import zipfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
OUTPUT = ROOT / '.test-output'
OUTPUT.mkdir(exist_ok=True)
VERSION = json.loads((EXT / 'manifest.json').read_text(encoding='utf-8'))['version']
checks=[]
def check(value,label):
    if not value: raise AssertionError(label)
    checks.append(label); print('PASS:',label,flush=True)
def archive(value):
    z=zipfile.ZipFile(io.BytesIO(bytes(value['bytes']))); assert z.testzip() is None;return z
async def main():
    modules=['lib/core.js','lib/layout.js','lib/availability.js','lib/html.js','lib/api.js','lib/scanner.js','lib/tree.js','lib/zip.js','lib/files.js','lib/downloader.js','manager.js']
    bundle='\n'.join(re.sub(r'^import\b[\s\S]*?;\s*','',(EXT/path).read_text(encoding='utf-8'),flags=re.M).replace('export function ','function ').replace('export const ','const ').replace('export class ','class ').replace('export async function ','async function ') for path in modules)
    html=re.sub(r'<script[^>]*>.*?</script>','',(EXT/'manager.html').read_text(encoding='utf-8'),flags=re.S)
    html=re.sub(r'<link[^>]+>','',html)
    async with async_playwright() as pw:
        launch_options = {"headless": True}
        custom_browser = os.environ.get("CHROMIUM_PATH")
        if custom_browser:
            launch_options["executable_path"] = custom_browser
        elif not Path(pw.chromium.executable_path).exists():
            system_browser = shutil.which("chromium") or shutil.which("chromium-browser")
            if not system_browser:
                raise RuntimeError("Install the test browser: python -m playwright install chromium, or set CHROMIUM_PATH.")
            launch_options["executable_path"] = system_browser
        # Only root-owned offline containers need this; ordinary desktop tests do not.
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            launch_options["args"] = ["--no-sandbox"]
        browser = await pw.chromium.launch(**launch_options)
        page=await browser.new_page(viewport={'width':1560,'height':1100});page.set_default_timeout(10000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        config=json.loads((EXT/'asignaturas.json').read_text(encoding='utf-8'))
        await page.set_content(html)
        await page.add_style_tag(content=(EXT/'manager.css').read_text(encoding='utf-8'))
        await page.evaluate('(config)=>window.testConfig=config',config)
        await page.evaluate((ROOT/'tests/offline_chrome_mock.js').read_text(encoding='utf-8'))
        await page.evaluate(bundle)
        await page.wait_for_selector('#course-87938')
        async def wait_scan():
            await page.wait_for_function("document.querySelector('#banner').textContent.startsWith('Scan finished')")
        async def rescan():
            await page.click('#scan'); await wait_scan()
        check(await page.locator('.course-label').count()==5,'all five configured subjects remain available')
        check(await page.locator('.folder-name').count()==6,'before scan only semester and subjects exist; no invented PEC folders')
        check(await page.locator('#download').is_disabled(),'ZIP download disabled until scan')
        await page.click('#check');await page.wait_for_function("document.querySelector('#session-state').textContent==='Connection failed'")
        check('Open UOC' in await page.locator('#banner').inner_text(),'missing login tab produces a readable error')
        await page.evaluate('testFixture.tabOpen=true');await page.click('#check')
        await page.wait_for_function("document.querySelector('#session-state').textContent==='Session connected'")
        for cid in [87936,93199,93208,93214]:await page.uncheck(f'#course-{cid}')
        check(await page.locator('.folder-name').count()==2,'selecting one subject leaves only semester and subject before scan')
        await rescan()
        check(await page.locator('.folder-name').count()==27,'supplied Contenidos structure produces exactly 27 required folders')
        subject=page.locator('.course-row').locator('xpath=..')
        tops=await subject.locator(':scope > ul > li > .tree-row > .folder-name').all_text_contents()
        check(tops==['0 - Recursos de Aprendizaje de la Asignatura','PEC1 - Evaluación del Rendimiento','PEC2 - Procesadores Segmentados','Práctica1 (PR1) - Simulador Pipeline','Práctica2 (PR2) - Programación Paralela'],'full module titles and general-resources-first order match the request')
        check(not await page.get_by_text('Foro General',exact=True).count(),'forums do not enter the review tree')
        calls=await page.evaluate('testFixture.calls')
        check(any('/modules?page=2' in c['url'] for c in calls),'module pagination is followed')
        check(any('/modules/10/items?' in c['url'] and 'page=2' in c['url'] for c in calls),'module-item pagination is followed')
        check(not any(c['url'].split('?')[0].endswith(('/assignments','/files','/pages')) for c in calls),'no bulk assignments, file index or unrelated page index is used')
        check(not any('/files/999' in c['url'] for c in calls),'decorative page image is not treated as a downloadable statement')
        check(not any('/pages/enunciado-de-la-practica2-pr2' in c['url'] for c in calls),'locked module item is not fetched despite having a page slug')
        pec1=page.locator('.file-row').filter(has=page.get_by_text('Enunciado de la PEC1',exact=True))
        check(await pec1.locator('.status-badge').inner_text()=='Not available','the supplied PEC1 placeholder is visibly Not available')
        check(await pec1.locator('input[type=checkbox]').is_disabled(),'unpublished statement cannot be selected')
        check('Inicio: 05/10/26' in await pec1.inner_text() and 'Entrega: 25/10/26' in await pec1.inner_text(),'dates from the supplied page are shown without fabricating API dates')
        check('PEC1 - Evaluación del Rendimiento/PEC 1/0. Enunciado/' in await pec1.evaluate("el=>el.parentElement.dataset.path"),'PEC1 notice appears under the requested statement folder')
        default_count=await page.locator('.file-row input:checked').count()
        check(default_count==6,'only available linked files are preselected; optional HTML and bookmarks are unchecked')
        for row in await page.locator('.file-row').all():
            title=await row.locator('.file-title').inner_text()
            if '[page-' in title: check(not await row.locator('input').is_checked(),'source page is optional: '+title)
        linked=page.locator('select[data-key="87938:file:779"]')
        check(await linked.count()==2,'one shared PDF appears in both learning-resource destinations')
        for row in await linked.all():check('/Recursos de aprendizaje de PEC ' in await row.evaluate("el=>el.closest('li').dataset.path"),'shared resource never drifts into the statement folder')
        check('materials.example.edu' in await page.locator('#host-list').inner_text(),'direct downloadable material host is offered for explicit permission')
        await page.click('#allow-hosts');await page.wait_for_function('testFixture.hostAccess')
        check('https://materials.example.edu/*' in await page.evaluate('testFixture.requestedOrigins'),'file-host permission request is limited to detected hosts')
        # Capture the actual interface; selected fixture files are not real course content.
        await page.locator('#banner').evaluate("el=>el.textContent='SYNTHETIC TEST DATA · Your supplied module titles and PEC1 notice; other files are test fixtures.'")
        for folder in ['0 - Recursos de Aprendizaje de la Asignatura', 'PEC2 - Procesadores Segmentados', 'Práctica1 (PR1) - Simulador Pipeline', 'Práctica2 (PR2) - Programación Paralela']:
            await page.get_by_role('button',name='Collapse '+folder,exact=True).click()
        await page.locator('#tree-wrap').evaluate('el=>el.scrollTop=0')
        await page.screenshot(path=str(OUTPUT/'browser-preview.png'),full_page=True)
        await page.click('#expand-all')
        await page.click('#download')
        await page.wait_for_function("document.querySelector('#banner').textContent.startsWith('ZIP saved:')",timeout=20000)
        check(await page.evaluate('testFixture.downloadOptions.length')==1,'export initiates one Chrome download, not individual files')
        value=await page.evaluate("testFixture.files.get('10º Sem.zip')");z=archive(value);names=z.namelist()
        (OUTPUT/'synthetic-browser-export.zip').write_bytes(bytes(value['bytes']))
        check(value['mime']=='application/zip','saved output is a ZIP Blob')
        check(len([n for n in names if n.endswith('/1. Trabajo/')])==4 and len([n for n in names if n.endswith('/2. Entrega/')])==4,'all eight empty Trabajo/Entrega folders are explicit ZIP entries')
        check(not any('/1. Trabajo/' in n or '/2. Entrega/' in n for n in names if not n.endswith('/')),'no downloadable file is stored in Trabajo or Entrega')
        check(not any('/PEC 1/0. Enunciado/' in n for n in names if not n.endswith('/')),'PEC1 introductory placeholder is not saved as a false statement file')
        check(not any('Foros' in n for n in names),'ZIP does not contain forum folders')
        path='10º Sem/Arquitectura de Computadores/PEC2 - Procesadores Segmentados/PEC 2/0. Enunciado/enunciado_pec2 [file-777].pdf'
        check(z.read(path)==b'Synthetic fixture file 777; version 1.\n','available PEC2 file lands under its full module title with exact original bytes')
        check(any('/Práctica1 (PR1) - Simulador Pipeline/PR1/0. Enunciado/' in n and n.endswith('.zip') for n in names),'PR1 nested activity label and original ZIP attachment format are preserved')
        check(any('/Recursos de aprendizaje de PR1/PID_12345' in n and n.endswith('.pdf') for n in names),'direct material PDF is packed into PR1 learning resources')
        check(not any(n.endswith('.html') for n in names),'no optional HTML snapshot is silently included in default export')
        check(len([n for n in names if not n.endswith('/') and not n.endswith('download-report.json')])==6,'ZIP contains all six selected output locations')
        check(await page.evaluate('testFixture.openedFiles.filter(id=>id===779).length')==1,'shared file is fetched once then stored in two resource folders')
        report=json.loads(z.read('10º Sem/_UOC_informes/download-report.json'))
        check(report['version']==VERSION and report['structureSource']=='Canvas Contenidos / modules','report states v3 and its actual structure source')
        check(any(r['title']=='Enunciado de la PEC1' and r['status']=='Not available' for r in report['notAvailable']),'ZIP report records unavailable PEC1 and its reason')
        check('TEST_SECRET_NOT_FOR_REPORTS' not in json.dumps(report),'reports omit signed download query values')
        # Root selection, destination correction and search use the real review controller.
        await page.click('#select-none');check(await page.locator('.file-row input:checked').count()==0,'clear selection applies to visible materials')
        rootbox=page.locator('.root-row input');await rootbox.check()
        check(await pec1.locator('input').is_disabled() and not await pec1.locator('input').is_checked(),'select-all cannot include Not available notices')
        await rootbox.uncheck();await page.locator('select[data-key="87938:file:777"]').locator('xpath=..').locator('xpath=..').locator('xpath=..').locator('input').check()
        dest='PEC1 - Evaluación del Rendimiento/Recursos de aprendizaje de PEC 1'
        await page.locator('select[data-key="87938:file:777"]').select_option(dest)
        check(dest in await page.locator('select[data-key="87938:file:777"]').evaluate("el=>el.closest('li').dataset.path"),'manual destination correction updates the directory tree')
        await page.fill('#filter','Práctica1');check(await page.locator('.file-row').count()>0 and not await pec1.count(),'filter keeps only matching module branches');await page.fill('#filter','')
        await page.click('#collapse-all');check(not await page.locator('.file-row').first.is_visible(),'collapse preserves but hides nested modules');await page.click('#expand-all')
        # Rescan clears row selections; old v2 flat destinations do not leak into v3.
        await page.evaluate('testFixture.failFiles.add(777)')
        # The injected mock starts fresh on reload; use a rescan rather than a reload-specific fixture persistence.
        for cid in [87936,93199,93208,93214]:await page.uncheck(f'#course-{cid}')
        await rescan();await page.click('#allow-hosts');await page.evaluate('testFixture.failFiles.add(777)')
        before=await page.evaluate('testFixture.downloadOptions.length');await page.click('#download')
        await page.wait_for_function("document.querySelector('#banner').textContent.includes('No ZIP was saved')")
        check(await page.evaluate('testFixture.downloadOptions.length')==before,'failed selected file prevents a misleading complete ZIP')
        await page.check('#allow-partial');await page.click('#download')
        await page.wait_for_function("document.querySelector('#banner').textContent.startsWith('Partial ZIP saved:')")
        partial=archive(await page.evaluate("testFixture.files.get('10º Sem-partial.zip')"))
        check('10º Sem/INCOMPLETE_EXPORT.txt' in partial.namelist(),'explicitly allowed partial export includes warning marker')
        await page.uncheck('#allow-partial');await page.evaluate('testFixture.failFiles.clear();testFixture.moduleError=true');await rescan()
        check(await page.evaluate('testFixture.store.lastReport.scanIncomplete'),'module scan failure is retained as incomplete, not mistaken for unpublished coursework')
        await page.click('#download');await page.wait_for_function("document.querySelector('#banner').textContent.includes('scan is incomplete')")
        check(True,'incomplete Contenidos scan blocks complete ZIP export')
        await page.evaluate('testFixture.moduleError=false;testFixture.fallbackPage=true');await rescan()
        check(await page.evaluate("testFixture.calls.some(c=>c.type==='UOC_GET_HTML')"),'module Page without page_url can resolve through visible Canvas page content')
        check('DO NOT IMPORT NAVIGATION' not in await page.locator('#directory-tree').inner_text(),'visible-page fallback excludes global navigation')
        await page.evaluate('testFixture.publishedPEC1=true');await rescan()
        published=page.locator('.file-row').filter(has=page.get_by_text('enunciado_pec1_publicado [file-790].pdf',exact=True))
        check(await published.count()==1 and await published.locator('input').is_checked(),'rescan picks up a newly published statement without changing the module structure')
        check(await page.locator('.folder-name').count()==27,'publication change preserves all exact folder names')
        await page.evaluate('testFixture.authorized=false');await page.click('#check')
        await page.wait_for_function("document.querySelector('#session-state').textContent==='Connection failed'")
        check('Session expired' in await page.locator('#banner').inner_text(),'expired session is not bypassed')
        await page.evaluate('testFixture.authorized=true;testFixture.throttle=1');await page.click('#check')
        await page.wait_for_function("document.querySelector('#session-state').textContent==='Session connected'")
        check('HTTP 429' in await page.locator('#log').inner_text(),'rate limiting is retried with bounded waits')
        await page.set_viewport_size({'width':760,'height':1000})
        check(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'responsive UI has no page-wide overflow at 760px')
        check(not errors,f'no unhandled production JavaScript errors ({errors})')
        await browser.close()
    result={'checks_passed':len(checks),'checks':checks,'browser':'Chromium with bundled production source + DOM; synthetic data only','chrome_apis':'MOCKED','canvas_api':'MOCKED','live_uoc_access':False,'native_extension_installation':'Not tested','zip_validation':'Python zipfile.testzip; all CRCs valid'}
    (OUTPUT/'offline-browser-results.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result,indent=2),flush=True)
if __name__=='__main__':asyncio.run(main())
