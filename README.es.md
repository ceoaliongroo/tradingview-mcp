# TradingView MCP para Codex

TradingView MCP es un puente local entre Codex y TradingView Desktop. Usa MCP
por `stdio` y Chrome DevTools Protocol (CDP) en `localhost:9222` para leer y
controlar la aplicacion de TradingView que esta corriendo en tu maquina.

[Ver la version en ingles](./README.md) |
[Ver la arquitectura](./docs/arquitectura-codex.md)

> [!WARNING]
> Esta herramienta no esta afiliada con TradingView Inc. ni con ningun
> proveedor de IA. Trabaja solo con tu instancia local de TradingView Desktop.

> [!IMPORTANT]
> Necesitas una suscripcion valida de TradingView. Esta herramienta no salta
> paywalls, no rompe protecciones y no funciona sin la app de escritorio
> instalada y ejecutandose con CDP habilitado.

> [!NOTE]
> Todo el procesamiento ocurre localmente en tu equipo. La herramienta no
> envía datos de TradingView a un servidor propio.

## Que hace

- Leer el estado del chart
- Cambiar simbolos, timeframes, tipos de grafico y rangos visibles
- Leer OHLCV, valores de indicadores y contenido de dibujos Pine
- Crear, borrar y ajustar dibujos, alertas, watchlists y panes
- Trabajar con Pine Script: editar, compilar, analizar y guardar
- Usar replay, capturas de pantalla y streaming JSONL
- Ejecutar las mismas capacidades desde el comando `tv`

## Requisitos

- TradingView Desktop
- Node.js 18+
- Codex con soporte MCP
- Windows, macOS o Linux

## Instalacion rapida con Codex

### 1. Clona e instala

```bash
git clone https://github.com/ceoaliongroo/tradingview-mcp.git
cd tradingview-mcp
npm install
```

### 2. Abre TradingView con CDP

TradingView Desktop debe arrancar con `--remote-debugging-port=9222`.

**Mac**

```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows**

```bash
scripts\launch_tv_debug.bat
```

**Linux**

```bash
./scripts/launch_tv_debug_linux.sh
```

**Manual**

```bash
/ruta/a/TradingView --remote-debugging-port=9222
```

### 3. Registra el servidor MCP en Codex

Edita `~/.codex/config.toml` y agrega:

```toml
[mcp_servers.tradingview]
command = "node"
args = ["/ruta/absoluta/a/tradingview-mcp/src/server.js"]
```

Si ya tienes otros servidores MCP, agrega solo la seccion `tradingview`.

### 4. Reinicia Codex

Codex carga la configuracion al iniciar. Reinicia la app o la sesion para que
el servidor MCP aparezca.

### 5. Verifica la conexion

Pidele a Codex que ejecute `tv_health_check`.

La respuesta deberia confirmar que la conexion CDP esta activa y que Codex ve
el simbolo y el timeframe actuales.

## CLI

El mismo backend tambien se puede usar desde terminal con `tv`.

```bash
npm link
node src/cli/index.js --help
```

Ejemplos:

```bash
tv status
tv launch
tv state
tv symbol AAPL
tv quote
tv ohlcv --summary
tv pine analyze --file script.pine
tv replay start --date 2025-03-01
```

## Arquitectura resumida

```text
Codex <-> MCP server (stdio) <-> CDP (localhost:9222) <-> TradingView Desktop
```

Si quieres ver el detalle visual, abre
[docs/arquitectura-codex.md](./docs/arquitectura-codex.md).

## Documentacion util

- [README principal en ingles](./README.md)
- [Plan de migracion](./docs/plan-migracion-codex.md)
- [Arquitectura](./docs/arquitectura-codex.md)
- `AGENTS.md` - instrucciones que Codex carga automaticamente

## Desarrollo y pruebas

```bash
npm test:unit
```

Las pruebas E2E requieren TradingView Desktop ejecutandose con CDP.
