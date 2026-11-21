// Servidor simulado: carga FermentadoresApp.gs con dobles de Apps Script en memoria
// y sirve index.html. Uso: node mock_server.js <puerto> [clave]
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const port = +process.argv[2] || 8765, CLAVE = process.argv[3] || '';

function makeSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    data,
    getLastRow: () => data.length,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues: v => { for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; } }
    }),
    appendRow: r => data.push(r.slice())
  };
}
const H_E = ['FM','Estado','Lote','Producto','Desde','Presión (psi)','Fecha presión','Temperatura (°C)','Fecha temperatura','Última purga de cono','Último movimiento','Confirmado','Notas'];
const H_M = ['Fecha y hora','FM','Acción','Lote','Producto','Presión (psi)','Temperatura (°C)','Nota','Registró','Anotado el','Id'];
const sheets = {
  Fermentadores: makeSheet([H_E,
    ['FM01','CON LOTE','L2632301','Tortuguero American IPA','2026-11-19','','','','','','2026-11-19','NO','heredado'],
    ['FM02','CON LOTE','L2630301','Rosa Brutal Brut IPA','2026-10-30','','',0,'2026-11-07','','2026-11-07','NO',''],
    ['FM03','VACIO','','','2026-11-11','','','','','','2026-11-11','NO',''],
    ['FM04','CON LOTE','L2629601','Hadouken Rice Lager','2026-10-23','','',0,'2026-11-07','','2026-11-07','NO',''],
    ['FM05','CON LOTE','L2628201','Soberanos Session IPA','2026-10-09','','','','','','2026-10-09','NO',''],
    ['FM06','CON LOTE','L2629501','Lalemana Helles','2026-10-22','','',0,'2026-11-07','','2026-11-07','NO','']]),
  Movimientos: makeSheet([H_M])
};
const pad = n => String(n).padStart(2, '0');
const ctx = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] || null }), flush: () => {} },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'CLAVE' && CLAVE) ? CLAVE : null }) },
  Utilities: { formatDate: d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
  console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'FermentadoresApp.gs'), 'utf8'), ctx);
module.exports = { ctx, sheets };

if (require.main === module) {
  http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/exec') {
      if (globalThis.__down) { res.destroy(); return; }
      const parameter = Object.fromEntries(u.searchParams);
      const out = ctx.doGet({ parameter });
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(out.text); return;
    }
    if (u.pathname === '/__down') { globalThis.__down = u.searchParams.get('v') === '1'; res.end('ok'); return; }
    if (u.pathname === '/__movs') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(sheets.Movimientos.data)); return; }
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/var API = '[^']*';/, `var API = 'http://localhost:${port}/exec';`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  }).listen(port, () => console.log('mock on ' + port));
}
