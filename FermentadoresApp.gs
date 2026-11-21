/**
 * FermentadoresApp.gs — servidor de la app de fermentadores de Hammurabier (V1).
 *
 * Web app de Apps Script, ligada a la hoja Bitacora_Fermentadores_2026
 * (SISTEMA DE INOCUIDAD 2026 / 05 - Trazabilidad). Ejecuta como el dueño.
 *
 * API: GET /exec?api=<funcion>&datos=<json>  →  JSON
 *   estado                              → { ok, estado: [fila por FM], servidor }
 *   lectura {fm, fecha, presion, temperatura, usuario, nota, id, forzar}
 *   purga   {fm, fecha, usuario, nota, id, forzar}
 *   lote    {fm, fecha, lote, producto, usuario, nota, id, forzar}
 *   vaciar  {fm, fecha, usuario, nota, id, forzar}
 *   historial {fm, n}                   → últimos n movimientos del FM
 * Toda escritura devuelve { ok, estado } o { ok:false, motivo, forzable }.
 *
 * Clave de planta: si la propiedad de script CLAVE existe, cada llamada debe
 * traer &clave=<CLAVE>; si no, responde { ok:false, clave:true }.
 *
 * Reglas: la validación vive aquí; cada paso es una fila en Movimientos;
 * las excepciones exigen forzar y dejan nota entre corchetes; escrituras
 * bajo LockService; un id repetido se rechaza (reintentar es seguro).
 */

var VERSION = 'V1';
var HOJA_ESTADO = 'Fermentadores';
var HOJA_MOVS = 'Movimientos';
var FMS = ['FM01', 'FM02', 'FM03', 'FM04', 'FM05', 'FM06'];
var ZONA = 'America/Costa_Rica';

// Columnas de Fermentadores (1 = A)
var E = { FM: 1, ESTADO: 2, LOTE: 3, PRODUCTO: 4, DESDE: 5, PRESION: 6, F_PRESION: 7,
          TEMP: 8, F_TEMP: 9, PURGA: 10, ULT_MOV: 11, CONFIRMADO: 12, NOTAS: 13 };
var E_COLS = 13;
// Columnas de Movimientos
var M = { FECHA: 1, FM: 2, ACCION: 3, LOTE: 4, PRODUCTO: 5, PRESION: 6, TEMP: 7,
          NOTA: 8, USUARIO: 9, ANOTADO: 10, ID: 11 };
var M_COLS = 11;

var CON_LOTE = 'CON LOTE';
var VACIO = 'VACIO';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var api = String(p.api || 'estado');
  var datos = {};
  try { if (p.datos) datos = JSON.parse(p.datos); }
  catch (err) { return json_({ ok: false, motivo: 'Datos mal formados.' }); }
  var clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
  if (clave && String(p.clave || '') !== clave) return json_({ ok: false, clave: true, motivo: 'Clave de planta incorrecta.' });
  try {
    switch (api) {
      case 'estado':    return json_({ ok: true, estado: leerEstado_(), servidor: VERSION });
      case 'historial': return json_({ ok: true, movimientos: historial_(datos) });
      case 'lectura':   return json_(escribir_(datos, lectura_));
      case 'purga':     return json_(escribir_(datos, purga_));
      case 'lote':      return json_(escribir_(datos, lote_));
      case 'vaciar':    return json_(escribir_(datos, vaciar_));
      default:          return json_({ ok: false, motivo: 'Función desconocida: ' + api });
    }
  } catch (err) {
    return json_({ ok: false, motivo: 'Error del servidor: ' + (err && err.message ? err.message : err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- lectura de la hoja ----------

function hoja_(nombre) {
  var h = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!h) throw new Error('Falta la pestaña ' + nombre);
  return h;
}

function texto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM-dd HH:mm');
  return v === null || v === undefined ? '' : String(v);
}

function leerEstado_() {
  var h = hoja_(HOJA_ESTADO);
  var n = Math.max(h.getLastRow() - 1, 0);
  var vals = n ? h.getRange(2, 1, n, E_COLS).getValues() : [];
  var porFm = {};
  vals.forEach(function (r, i) { porFm[texto_(r[0])] = { fila: i + 2, r: r }; });
  return FMS.map(function (fm) {
    var o = porFm[fm];
    var r = o ? o.r : [];
    var num = function (v) { return v === '' || v === null || v === undefined ? null : Number(v); };
    return {
      fm: fm,
      estado: texto_(r[E.ESTADO - 1]) || VACIO,
      lote: texto_(r[E.LOTE - 1]),
      producto: texto_(r[E.PRODUCTO - 1]),
      desde: texto_(r[E.DESDE - 1]),
      presion: num(r[E.PRESION - 1]),
      fechaPresion: texto_(r[E.F_PRESION - 1]),
      temperatura: num(r[E.TEMP - 1]),
      fechaTemperatura: texto_(r[E.F_TEMP - 1]),
      purga: texto_(r[E.PURGA - 1]),
      ultimoMovimiento: texto_(r[E.ULT_MOV - 1]),
      confirmado: texto_(r[E.CONFIRMADO - 1]) === 'SI',
      notas: texto_(r[E.NOTAS - 1]),
      _fila: o ? o.fila : 0
    };
  });
}

function historial_(d) {
  var fm = String(d.fm || '');
  if (FMS.indexOf(fm) < 0) return [];
  var n = Math.min(Math.max(Number(d.n) || 20, 1), 200);
  var h = hoja_(HOJA_MOVS);
  var total = h.getLastRow() - 1;
  if (total < 1) return [];
  var desde = Math.max(2, h.getLastRow() - 1999);
  var vals = h.getRange(desde, 1, h.getLastRow() - desde + 1, M_COLS).getValues();
  var out = [];
  for (var i = vals.length - 1; i >= 0 && out.length < n; i--) {
    var r = vals[i];
    if (texto_(r[M.FM - 1]) !== fm) continue;
    out.push({ fecha: texto_(r[M.FECHA - 1]), accion: texto_(r[M.ACCION - 1]), lote: texto_(r[M.LOTE - 1]),
               presion: r[M.PRESION - 1] === '' ? null : Number(r[M.PRESION - 1]),
               temperatura: r[M.TEMP - 1] === '' ? null : Number(r[M.TEMP - 1]),
               nota: texto_(r[M.NOTA - 1]), usuario: texto_(r[M.USUARIO - 1]) });
  }
  return out;
}

// ---------- validaciones comunes ----------

function fecha_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return { texto: m[0] };
}

function ahora_() { return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd HH:mm'); }

function numero_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : NaN;
}

function rechazo_(motivo, forzable) { return { ok: false, motivo: motivo, forzable: !!forzable }; }

/** Comprobaciones comunes, bloqueo, escritura y estado nuevo en una sola llamada. */
function escribir_(d, accion) {
  var fm = String(d.fm || '');
  if (FMS.indexOf(fm) < 0) return rechazo_('Fermentador desconocido: ' + fm);
  var f = fecha_(d.fecha);
  if (!f) return rechazo_('La fecha debe ir como AAAA-MM-DD HH:MM.');
  if (f.texto > ahora_() && minutos_(ahora_(), f.texto) > 10) return rechazo_('La fecha y hora está en el futuro.');
  var usuario = String(d.usuario || '').trim();
  if (!usuario) return rechazo_('Falta quién registra.');
  var id = String(d.id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return rechazo_('Falta el identificador del movimiento.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return rechazo_('La hoja está ocupada. Intenta de nuevo en unos segundos.');
  try {
    if (idUsado_(id)) return { ok: true, repetido: true, estado: leerEstado_() };
    var estado = leerEstado_();
    var actual = estado.filter(function (x) { return x.fm === fm; })[0];
    if (!actual._fila) return rechazo_('La pestaña Fermentadores no tiene la fila de ' + fm + '.');
    var res = accion(d, actual, estado, f.texto, usuario);
    if (!res.ok) return res;
    var mov = res.mov; // [fecha, fm, accion, lote, producto, presion, temp, nota]
    hoja_(HOJA_MOVS).appendRow(mov.concat([usuario, ahora_(), id]));
    var fila = hoja_(HOJA_ESTADO).getRange(actual._fila, 1, 1, E_COLS);
    var r = fila.getValues()[0];
    res.cambios(r);
    if (f.texto >= texto_(r[E.ULT_MOV - 1])) r[E.ULT_MOV - 1] = f.texto;
    r[E.CONFIRMADO - 1] = 'SI';
    fila.setValues([r]);
    SpreadsheetApp.flush();
    return { ok: true, estado: leerEstado_() };
  } finally {
    lock.releaseLock();
  }
}

function minutos_(a, b) {
  var p = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s); return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime(); };
  return (p(b) - p(a)) / 60000;
}

function idUsado_(id) {
  var h = hoja_(HOJA_MOVS);
  var ult = h.getLastRow();
  if (ult < 2) return false;
  var desde = Math.max(2, ult - 999);
  var ids = h.getRange(desde, M.ID, ult - desde + 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) return true;
  return false;
}

function nota_(d, extra) {
  var n = String(d.nota || '').trim();
  return extra ? (extra + (n ? ' ' + n : '')) : n;
}

// ---------- acciones ----------

function lectura_(d, act, estado, fecha, usuario) {
  var p = numero_(d.presion), t = numero_(d.temperatura);
  if (isNaN(p) || isNaN(t)) return rechazo_('Presión y temperatura deben ser números.');
  if (p === null && t === null) return rechazo_('Anota la presión, la temperatura o las dos.');
  if (p !== null && (p < 0 || p > 60)) return rechazo_('Presión fuera de 0 a 60 psi: ' + p + '.');
  if (t !== null && (t < -10 || t > 40)) return rechazo_('Temperatura fuera de −10 a 40 °C: ' + t + '.');
  var extra = '';
  if (act.estado !== CON_LOTE) {
    if (!d.forzar) return rechazo_(act.fm + ' figura vacío. ¿Guardar la lectura igual?', true);
    extra = '[LECTURA con ' + act.fm + ' figurando VACIO]';
  }
  if (act.desde && fecha < act.desde && act.estado === CON_LOTE) {
    if (!d.forzar) return rechazo_('La fecha es anterior al inicio del lote (' + act.desde + '). ¿Guardar igual?', true);
    extra = (extra ? extra + ' ' : '') + '[LECTURA anterior al lote]';
  }
  return {
    ok: true,
    mov: [fecha, act.fm, 'LECTURA', act.lote, act.producto, p === null ? '' : p, t === null ? '' : t, nota_(d, extra)],
    cambios: function (r) {
      if (p !== null && fecha >= texto_(r[E.F_PRESION - 1])) { r[E.PRESION - 1] = p; r[E.F_PRESION - 1] = fecha; }
      if (t !== null && fecha >= texto_(r[E.F_TEMP - 1])) { r[E.TEMP - 1] = t; r[E.F_TEMP - 1] = fecha; }
    }
  };
}

function purga_(d, act, estado, fecha) {
  var extra = '';
  if (act.estado !== CON_LOTE) {
    if (!d.forzar) return rechazo_(act.fm + ' figura vacío. ¿Registrar la purga igual?', true);
    extra = '[PURGA con ' + act.fm + ' figurando VACIO]';
  }
  return {
    ok: true,
    mov: [fecha, act.fm, 'PURGA DE CONO', act.lote, act.producto, '', '', nota_(d, extra)],
    cambios: function (r) { if (fecha >= texto_(r[E.PURGA - 1])) r[E.PURGA - 1] = fecha; }
  };
}

function lote_(d, act, estado, fecha) {
  var lote = String(d.lote || '').trim().toUpperCase();
  var prod = String(d.producto || '').trim();
  if (!/^L\d{7}$/.test(lote)) return rechazo_('El lote va como L + 7 dígitos, por ejemplo L2632301.');
  if (!prod) return rechazo_('Falta el producto.');
  var extras = [];
  if (act.estado === CON_LOTE) {
    if (act.lote === lote) return rechazo_(act.fm + ' ya tiene el lote ' + lote + '.');
    if (!d.forzar) return rechazo_(act.fm + ' todavía tiene el lote ' + act.lote + '. ¿Reemplazarlo sin registrar el vaciado?', true);
    extras.push('[LOTE sobre ' + act.lote + ' sin vaciado]');
  }
  var otro = estado.filter(function (x) { return x.fm !== act.fm && x.estado === CON_LOTE && x.lote === lote; })[0];
  if (otro) {
    if (!d.forzar) return rechazo_('El lote ' + lote + ' ya está en ' + otro.fm + '. ¿Abrirlo también en ' + act.fm + '?', true);
    extras.push('[LOTE ' + lote + ' también en ' + otro.fm + ']');
  }
  return {
    ok: true,
    mov: [fecha, act.fm, 'LOTE', lote, prod, '', '', nota_(d, extras.join(' '))],
    cambios: function (r) {
      r[E.ESTADO - 1] = CON_LOTE; r[E.LOTE - 1] = lote; r[E.PRODUCTO - 1] = prod; r[E.DESDE - 1] = fecha;
      r[E.PRESION - 1] = ''; r[E.F_PRESION - 1] = ''; r[E.TEMP - 1] = ''; r[E.F_TEMP - 1] = ''; r[E.PURGA - 1] = '';
    }
  };
}

function vaciar_(d, act, estado, fecha) {
  if (act.estado !== CON_LOTE) return rechazo_(act.fm + ' ya figura vacío.');
  return {
    ok: true,
    mov: [fecha, act.fm, 'VACIADO', act.lote, act.producto, '', '', nota_(d, '')],
    cambios: function (r) {
      r[E.ESTADO - 1] = VACIO; r[E.LOTE - 1] = ''; r[E.PRODUCTO - 1] = ''; r[E.DESDE - 1] = fecha;
      r[E.PRESION - 1] = ''; r[E.F_PRESION - 1] = ''; r[E.TEMP - 1] = ''; r[E.F_TEMP - 1] = ''; r[E.PURGA - 1] = '';
    }
  };
}
