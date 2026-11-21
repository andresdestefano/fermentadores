// Prueba de la página contra el servidor simulado. Uso: node test/ui_test.js
// Escenarios: carga, lectura, rechazo forzable y "Guardar igual", cancelar con datos escritos,
// clave de planta, sin conexión con foto guardada, abrir lote y vaciar.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

function server(port, clave) {
  const p = spawn('node', [path.join(__dirname, 'mock_server.js'), String(port)].concat(clave ? [clave] : []), { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise(res => p.stdout.once('data', () => res(p)));
}
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) process.exitCode = 1; };

(async () => {
  const s = await server(8765);
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 400, height: 860 } });
  await pg.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://localhost:8765/');
  await pg.waitForSelector('text=L2630301');
  ok((await pg.locator('.card').count()) === 6, 'seis tarjetas');
  ok(await pg.locator('text=Sin confirmar').first().isVisible(), 'datos heredados marcados sin confirmar');

  // lectura FM02
  await pg.locator('section[aria-label=FM02] >> button:text-is("Lectura")').click();
  await pg.fill('#f-pres', '12,5'); await pg.fill('#f-temp', '0.5'); await pg.fill('#f-who', 'Prueba');
  ok((await pg.textContent('#f-save')) === 'Guardar lectura FM02', 'el botón dice el verbo y el FM');
  await pg.click('#f-save');
  await pg.waitForSelector('#sheet', { state: 'hidden' });
  ok((await pg.locator('section[aria-label=FM02] .val.p .num').textContent()).startsWith('12.5'), 'presión 12.5 en FM02');
  ok(!(await pg.locator('section[aria-label=FM02] .chip.warn').count()), 'FM02 deja de estar sin confirmar');

  // lectura en FM03 vacío: rechazo forzable
  await pg.locator('section[aria-label=FM03] >> button:text-is("Lectura")').click();
  await pg.fill('#f-temp', '18');
  await pg.click('#f-save');
  await pg.waitForSelector('#f-err:not([hidden])');
  ok((await pg.textContent('#f-err')).includes('figura vacío'), 'rechazo con motivo en rojo');
  ok(await pg.isVisible('#f-force'), 'aparece Guardar igual');
  await pg.click('#f-force');
  await pg.waitForSelector('#sheet', { state: 'hidden' });
  const movs = await (await pg.request.get('http://localhost:8765/__movs')).json();
  ok(movs.some(m => String(m[7]).includes('[LECTURA con FM03 figurando VACIO]')), 'excepción queda con nota entre corchetes');

  // cancelar con datos escritos pide confirmar y no guarda
  const antes = movs.length;
  await pg.locator('section[aria-label=FM04] >> button:text-is("Purga")').click();
  await pg.fill('#f-note', 'algo');
  await pg.click('#f-cancel');
  ok(await pg.isVisible('#sheet'), 'primer Cancelar no cierra con datos escritos');
  ok((await pg.textContent('#f-cancel')) === 'Descartar lo escrito', 'pide confirmar el descarte');
  await pg.click('#f-cancel');
  await pg.waitForSelector('#sheet', { state: 'hidden' });
  const movs2 = await (await pg.request.get('http://localhost:8765/__movs')).json();
  ok(movs2.length === antes, 'cancelar no guardó nada');

  // vaciar FM06 y abrir lote
  await pg.locator('section[aria-label=FM06] >> button:text-is("Vaciar")').click();
  await pg.click('#f-save'); await pg.waitForSelector('#sheet', { state: 'hidden' });
  ok(await pg.locator('section[aria-label=FM06] >> text=Vacío').isVisible(), 'FM06 queda vacío');
  await pg.locator('section[aria-label=FM06] >> button:text-is("Abrir lote")').click();
  await pg.fill('#f-lot', 'l2632501'); await pg.fill('#f-prod', 'Prueba IPA');
  await pg.click('#f-save'); await pg.waitForSelector('#sheet', { state: 'hidden' });
  ok(await pg.locator('section[aria-label=FM06] >> text=L2632501').isVisible(), 'FM06 con lote nuevo');

  // sin conexión: muestra la foto guardada con aviso
  await pg.request.get('http://localhost:8765/__down?v=1');
  await pg.click('#btn-refresh');
  await pg.waitForSelector('.banner.bad');
  ok((await pg.textContent('#banner')).includes('última foto guardada'), 'aviso de sin servidor con foto');
  ok(await pg.locator('text=L2632501').isVisible(), 'los datos siguen en pantalla');
  await pg.request.get('http://localhost:8765/__down?v=0');
  await pg.screenshot({ path: path.join(__dirname, 'captura_400.png'), fullPage: true });
  ok(!errs.length, 'sin errores de JavaScript ' + errs.join(' | '));
  s.kill();

  // clave de planta
  const s2 = await server(8766, 'abc123');
  const pg2 = await b.newPage({ viewport: { width: 400, height: 860 } });
  await pg2.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await pg2.goto('http://localhost:8766/');
  await pg2.waitForSelector('#grp-key:not([hidden])');
  ok(await pg2.isVisible('#f-key'), 'pide la clave de planta');
  await pg2.fill('#f-key', 'abc123'); await pg2.click('#f-save');
  await pg2.waitForSelector('text=L2630301');
  ok(true, 'con la clave carga los datos');
  s2.kill();
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
