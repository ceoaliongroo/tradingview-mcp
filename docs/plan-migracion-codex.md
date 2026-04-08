# Plan de migracion a Codex

> Estado: ejecutado en este workspace. La configuracion MCP de Codex ya incluye
> `tradingview` y la documentacion principal ya fue migrada.

## Objetivo

Migrar la documentacion y la experiencia de uso de este servidor MCP de una
narrativa centrada en Claude Code a una orientada a Codex, sin cambiar el
comportamiento funcional del servidor salvo los mensajes y textos que hoy siguen
nombrando a Anthropic o a Claude.

## Hallazgos principales

- El runtime ya es compatible con MCP estandar: `src/server.js` expone el
  servidor por `stdio` y la logica real vive en `src/core/`.
- No existe un acoplamiento fuerte a Claude Code dentro del codigo de negocio.
  El acoplamiento principal esta en la documentacion, en mensajes de consola y
  en un archivo de instrucciones pensado para Claude.
- El README actual usa rutas y ejemplos de Claude Code (`~/.claude/.mcp.json`)
  y ademas apunta a un repositorio distinto (`tradesdontlie`) que no coincide
  con el remoto real de este checkout (`ceoaliongroo`).
- El inventario documental tambien tiene conteos desactualizados: el servidor
  expone 78 herramientas MCP, y el CLI expone 28 comandos de primer nivel.

## Cambios necesarios

1. Crear `AGENTS.md` como archivo de instrucciones para Codex.
2. Actualizar `README.md` para:
   - reemplazar Claude Code por Codex;
   - documentar `~/.codex/config.toml`;
   - corregir el origen del repositorio;
   - enlazar la version en espanol;
   - resumir la arquitectura actual.
3. Crear `README.es.md` como version en espanol para entender la instalacion y
   el flujo general sin leer la documentacion tecnica completa.
4. Crear `docs/arquitectura-codex.md` con un diagrama Mermaid y un resumen de
   componentes.
5. Crear `docs/plan-migracion-codex.md` con el plan de trabajo en espanol.
6. Actualizar `SETUP_GUIDE.md` para que tambien describa la configuracion para
   Codex.
7. Limpiar referencias sueltas a Claude, Claude Code y Anthropic en:
   - `CONTRIBUTING.md`
   - `RESEARCH.md`
   - `SECURITY.md`
   - mensajes de runtime en `src/server.js`, `src/core/stream.js` y
     `src/cli/router.js`
8. Ajustar comentarios aislados que aun hablan de "cloud" de forma ambigua en
   contextos que ya no aportan claridad.

## Orden sugerido de implementacion

1. Crear la documentacion nueva (`AGENTS.md`, `docs/*`, `README.es.md`).
2. Reescribir `README.md` y `SETUP_GUIDE.md` para Codex.
3. Normalizar referencias de marca y repo en los archivos secundarios.
4. Ajustar los mensajes de consola en el runtime.
5. Verificar con una revision de enlaces, busqueda de referencias antiguas y,
   si se instala dependencias, una pasada de pruebas unitarias.

## Archivos que no necesitan cambios funcionales

- `src/connection.js`
- `src/core/chart.js`
- `src/core/data.js`
- `src/core/pine.js`
- `src/core/replay.js` salvo un comentario de claridad
- `package.json`

## Riesgos

- La integracion depende de APIs internas de TradingView Desktop que pueden
  cambiar sin aviso.
- La configuracion de Codex puede variar por version del cliente; por eso la
  documentacion debe usar el formato real del entorno (`~/.codex/config.toml`)
  y no asumir configuraciones de otros agentes.
- Algunas herramientas hacen llamadas a endpoints publicos de TradingView
  (por ejemplo para Pine o busqueda de simbolos), asi que la documentacion debe
  distinguir entre control local por CDP y uso de servicios publicos del
  ecosistema de TradingView.

## Resultado esperado

- Codex puede cargar instrucciones del proyecto desde `AGENTS.md`.
- El README principal explica como instalar el servidor en Codex.
- Existe una version en espanol del README.
- La arquitectura queda documentada en espanol con un diagrama Mermaid.
