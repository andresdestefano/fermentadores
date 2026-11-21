# Fermentadores Hammurabier

App de planta para ver, por fermentador (FM01 a FM06), el lote, la última presión y temperatura y la última purga de cono, y para registrar lecturas, purgas, apertura de lote y vaciado.

- `index.html`: la página (GitHub Pages). Habla por `fetch` con la web app de Apps Script (`API`, arriba del script).
- `FermentadoresApp.gs`: el servidor (Apps Script ligado a la hoja `Bitacora_Fermentadores_2026`, pestañas `Fermentadores` y `Movimientos`). La validación vive aquí.
- `test/`: servidor simulado y pruebas de la página en Chromium sin pantalla (`node test/ui_test.js`).

Método tomado de la app de barriles (sin compartir datos con ella). Guía y estado: `SISTEMA DE INOCUIDAD 2026/05 - Trazabilidad/App Fermentadores/`.
