# PRD — Extensión VSCode "OpenCode Go Quota Monitor"

| Campo | Valor |
|---|---|
| Versión del documento | 1.0 |
| Fecha | 28 abril 2026 |
| Estado | Draft — listo para implementación |
| Owner | (a rellenar) |
| Target release MVP | v0.1.0 |

---

## 1. Resumen ejecutivo

Extensión de VSCode que muestra en tiempo real la cuota restante del plan **OpenCode Go**, junto con histórico de uso y predicción de agotamiento. La cuota se obtiene mediante una capa de fetch con dos backends intercambiables: scraping del dashboard de `console.opencode.ai` (funciona hoy) y la API oficial `/zen/go/v1/usage` cuando esté disponible. El plugin selecciona el backend automáticamente con fallback.

La interfaz visible es **un único item en la status bar** de VSCode. El histórico y la predicción se calculan en background y se exponen al hacer click sobre el item.

---

## 2. Contexto y motivación

### 2.1 Problema

Los usuarios del plan OpenCode Go ($10/mes) tienen tres ventanas de cuota: rolling, semanal y mensual. Hoy la única forma de consultarlas es entrar al dashboard web del workspace en `console.opencode.ai`. No hay endpoint público, no hay status bar widget, no hay alertas. El usuario descubre que ha agotado la cuota cuando el agente empieza a fallar.

### 2.2 Estado del arte

- **`slkiser/opencode-quota`** — Plugin para el TUI de OpenCode, no para VSCode. Funciona mediante scraping del dashboard (PR #41 mergeada en abril 2026). Sirve de referencia técnica.
- **`opgginc/opencode-bar`** — Menu bar de macOS, no integración VSCode.
- **API oficial** — La PR [`anomalyco/opencode#16513`](https://github.com/anomalyco/opencode/pull/16513) propone añadir el endpoint `/zen/go/v1/usage`. Abierta desde marzo 2026, aún sin mergear a fecha de este PRD.

### 2.3 Oportunidad

No existe ninguna extensión nativa de VSCode que muestre la cuota de OpenCode Go. Hueco claro y limitado en alcance, perfecto para un MVP enfocado.

---

## 3. Objetivos y métricas de éxito

### 3.1 Objetivos

1. Mostrar al usuario, sin que tenga que abrir el navegador, el estado de su cuota OpenCode Go.
2. Avisarle visualmente (color del status bar) cuando se acerca al límite.
3. Permitirle ver histórico y proyección de cuándo se le va a acabar la cuota al ritmo actual.

### 3.2 Métricas de éxito (post-launch)

- ≥ 80% de usuarios instalados mantienen la extensión activa una semana después.
- < 1% de fetches con error no recuperable (excluyendo cookie expirada).
- Coste medio de fetch < 500 ms p95.

### 3.3 No-objetivos (explícitos)

- Soportar otros proveedores (Copilot, OpenAI, Anthropic, Cursor…). Esto es solo OpenCode Go.
- Mostrar cuota por modelo individual. Solo cuota agregada del plan.
- Integrarse con el agente de OpenCode para *consumir* tokens. Solo lectura.
- Panel/sidebar dedicado, webview, gráficos visuales en UI. El histórico y la predicción se exponen como texto en un QuickPick al click.

---

## 4. Personas y casos de uso

### 4.1 Persona principal: el usuario heavy de OpenCode Go

Desarrollador que usa OpenCode Go a diario, con frecuencia se queda sin cuota a mitad de mes y quiere visibilidad continua sin abrir pestañas.

### 4.2 Casos de uso prioritarios

- **CU-1**: Echar un vistazo al status bar y ver "OC Go: 65% · resets 2d 4h" para saber si puede arrancar una sesión grande.
- **CU-2**: Hacer click en el item del status bar y ver las tres ventanas (rolling/weekly/monthly) y la predicción "agotarás la cuota mensual el 23 a las 14:00 a este ritmo".
- **CU-3**: Recibir un cambio de color cuando supera el 80% (amarillo) o el 95% (rojo) sin necesidad de mirar números.
- **CU-4**: Configurar las credenciales una vez y que la extensión funcione hasta que la cookie expire.

---

## 5. Requisitos funcionales

### 5.1 Configuración inicial

- **RF-1**: Comando `OpenCode Go: Configure credentials` accesible desde la paleta de comandos.
- **RF-2**: El comando pide `workspaceId` (texto plano, guardado en `vscode.workspace.getConfiguration`) y `authCookie` (guardada en `vscode.SecretStorage`, nunca en texto plano).
- **RF-3**: Al primer arranque sin credenciales, el status bar muestra "OC Go: setup" y al click lanza el comando de configuración.
- **RF-4**: Documentación in-extension sobre cómo obtener ambos valores desde DevTools del navegador en `console.opencode.ai`.

### 5.2 Obtención de cuota

- **RF-5**: Capa de fetch abstraída tras una interfaz `QuotaFetcher` con método `fetch(): Promise<QuotaSnapshot>`.
- **RF-6**: Implementación `ApiFetcher` que llama a `GET https://console.opencode.ai/zen/go/v1/usage` (o la URL final que publique Anomaly) con la auth cookie. Esta es la implementación preferida.
- **RF-7**: Implementación `ScrapingFetcher` que descarga el HTML del dashboard del workspace, localiza el bloque de hidratación de SolidJS SSR y extrae el objeto `monthlyUsage` (al menos `usagePercent` y `resetInSec`). Replicar la lógica de `src/lib/opencode-go.ts` del repo `slkiser/opencode-quota`.
- **RF-8**: Selector automático: al arranque y cada 24h, intentar `ApiFetcher`; si responde 404/501 caer a `ScrapingFetcher` y cachear esa decisión durante 24h.
- **RF-9**: Polling en background cada 5 minutos (configurable, mínimo 60s para evitar abuso).
- **RF-10**: Backoff exponencial ante errores (1m → 5m → 15m → 30m, tope 30m).

### 5.3 Visualización en status bar

- **RF-11**: Un único `StatusBarItem` con prioridad media-alta, alineado a la derecha.
- **RF-12**: Texto: `$(graph) OC Go: <pct>% · <reset>` donde:
  - `<pct>` = el peor porcentaje de las tres ventanas (la más constraining).
  - `<reset>` = tiempo formateado humano hasta el reset de esa ventana (`42m`, `4h 12m`, `2d 4h`).
- **RF-13**: Color del item según umbrales:
  - 0–79%: color por defecto.
  - 80–94%: `statusBarItem.warningBackground`.
  - 95–100%: `statusBarItem.errorBackground`.
- **RF-14**: Tooltip con desglose detallado (las tres ventanas + última actualización + fuente: API/scraping).
- **RF-15**: Estados especiales:
  - `setup`: sin credenciales.
  - `auth`: cookie expirada / 401.
  - `error`: fallo persistente, con icono `$(warning)`.
  - `loading` solo en el primer fetch tras arrancar.

### 5.4 Click → QuickPick de detalle

- **RF-16**: Click en el item del status bar abre un `QuickPick` con:
  - Una entrada por cada ventana (rolling/weekly/monthly): "Rolling: 65% · resets in 42m".
  - Entrada de predicción: "Estimated monthly exhaustion: Apr 23 at 14:00 (8 days)".
  - Entrada "View history (last 7 days)" → abre QuickPick con histórico.
  - Entrada "Open OpenCode dashboard" → abre URL en navegador.
  - Entrada "Force refresh" → fuerza fetch inmediato.
  - Entrada "Reconfigure credentials".

### 5.5 Histórico

- **RF-17**: Cada fetch exitoso se persiste como snapshot en `vscode.ExtensionContext.globalState` con la forma `{ timestamp, rolling, weekly, monthly, source }`.
- **RF-18**: Retención: últimos 30 días, máximo 10.000 snapshots. Limpieza al arrancar.
- **RF-19**: Comando `OpenCode Go: Export history` que vuelca el histórico a JSON.

### 5.6 Predicción de agotamiento

- **RF-20**: Calcular sobre la ventana mensual (la más relevante para "se me acaba el mes").
- **RF-21**: Algoritmo: regresión lineal sobre los snapshots de las últimas 24h. Si la pendiente es ≤ 0 (no se está consumiendo) → "no exhaustion projected". Si es > 0 → calcular cuándo `usage_percent` llegará a 100.
- **RF-22**: Mostrar la predicción solo si hay ≥ 6 snapshots en las últimas 24h, si no → "insufficient data".
- **RF-23**: La predicción no es una alerta, solo un texto informativo en el QuickPick.

---

## 6. Requisitos no funcionales

- **RNF-1 — Seguridad**: la auth cookie va exclusivamente en `SecretStorage`. Nunca en `settings.json`, nunca en logs, nunca en el output channel salvo modo debug explícito (y aun así enmascarada salvo últimos 4 chars).
- **RNF-2 — Privacidad**: no se envían datos a ningún servidor que no sea OpenCode. Sin telemetría en MVP. Si se añade, opt-in explícito.
- **RNF-3 — Rendimiento**: el ciclo de fetch + parse + render no debe exceder 1s p95. El histórico se carga lazy.
- **RNF-4 — Resiliencia**: ningún fallo de red, parser o credencial debe romper la extensión. El status bar siempre debe estar en uno de los estados definidos.
- **RNF-5 — Compatibilidad**: VSCode ≥ 1.85, Node ≥ 18 (engine de la extensión).
- **RNF-6 — Plataformas**: Windows, macOS, Linux. WSL2 funcional.
- **RNF-7 — Idiomas**: UI en inglés en MVP. i18n preparado vía `package.nls.json`.
- **RNF-8 — Activación**: `activationEvents: ["onStartupFinished"]`. No bloquear arranque.

---

## 7. Arquitectura técnica

### 7.1 Stack

- TypeScript ≥ 5.3
- VSCode Extension API
- `node-fetch` o `undici` para HTTP (preferible `undici` por estar built-in en Node 18+)
- `cheerio` para parsing HTML del dashboard (scraping)
- `vitest` para tests

### 7.2 Estructura de carpetas

```
opencode-go-quota/
├── src/
│   ├── extension.ts              # entry point, activate/deactivate
│   ├── statusBar.ts              # gestión del StatusBarItem
│   ├── commands/
│   │   ├── configure.ts
│   │   ├── refresh.ts
│   │   └── exportHistory.ts
│   ├── fetchers/
│   │   ├── QuotaFetcher.ts       # interfaz
│   │   ├── ApiFetcher.ts
│   │   ├── ScrapingFetcher.ts
│   │   └── FetcherSelector.ts    # estrategia con fallback
│   ├── storage/
│   │   ├── credentials.ts        # SecretStorage wrapper
│   │   └── history.ts            # globalState wrapper
│   ├── domain/
│   │   ├── QuotaSnapshot.ts      # tipos
│   │   ├── prediction.ts         # regresión lineal
│   │   └── format.ts             # tiempo humano, porcentajes
│   └── ui/
│       └── quickPick.ts
├── test/
├── package.json
├── tsconfig.json
└── README.md
```

### 7.3 Modelo de datos

```typescript
interface QuotaWindow {
  usagePercent: number;    // 0..100
  resetsInSeconds: number; // segundos hasta reset
}

interface QuotaSnapshot {
  timestamp: number;       // ms epoch
  rolling: QuotaWindow;
  weekly: QuotaWindow;
  monthly: QuotaWindow;
  source: 'api' | 'scraping';
}

interface QuotaFetcher {
  fetch(): Promise<QuotaSnapshot>;
  isAvailable(): Promise<boolean>;
}
```

### 7.4 Flujo de fetch

```
[Timer 5min] → FetcherSelector.fetch()
                    ↓
              ¿API disponible?
              /             \
          sí                 no
          ↓                   ↓
    ApiFetcher          ScrapingFetcher
          \                   /
           → QuotaSnapshot
                    ↓
            history.append()
                    ↓
            statusBar.update()
                    ↓
       prediction.recompute() (lazy on click)
```

### 7.5 Configuración expuesta (`package.json` / `contributes.configuration`)

| Clave | Tipo | Default | Descripción |
|---|---|---|---|
| `opencodeGoQuota.workspaceId` | string | `""` | Workspace ID del plan Go |
| `opencodeGoQuota.pollIntervalSeconds` | number | `300` | Intervalo de polling (mín 60) |
| `opencodeGoQuota.warningThreshold` | number | `80` | % a partir del cual el status bar va amarillo |
| `opencodeGoQuota.errorThreshold` | number | `95` | % a partir del cual el status bar va rojo |
| `opencodeGoQuota.fetcherStrategy` | enum | `auto` | `auto` \| `api-only` \| `scraping-only` |
| `opencodeGoQuota.debug` | boolean | `false` | Verbose logging en output channel |

La auth cookie **no** está en `configuration`. Vive en `SecretStorage`.

### 7.6 Comandos contribuidos

| Command id | Título | Visible en paleta |
|---|---|---|
| `opencodeGoQuota.configure` | OpenCode Go: Configure credentials | sí |
| `opencodeGoQuota.refresh` | OpenCode Go: Refresh quota | sí |
| `opencodeGoQuota.showDetails` | OpenCode Go: Show details | sí (también click en status bar) |
| `opencodeGoQuota.exportHistory` | OpenCode Go: Export history | sí |
| `opencodeGoQuota.openDashboard` | OpenCode Go: Open dashboard | sí |
| `opencodeGoQuota.clearCredentials` | OpenCode Go: Clear credentials | sí |

---

## 8. Casos límite y manejo de errores

| Escenario | Comportamiento |
|---|---|
| Cookie expirada (401/redirect a login) | Status bar → estado `auth`. Notificación con botón "Reconfigure". Polling pausado hasta que el usuario actúe. |
| Workspace ID inválido (404) | Status bar → estado `error`. Notificación una sola vez. |
| Sin red | Estado `error` silencioso. Reintentar en el próximo ciclo con backoff. |
| HTML del dashboard cambia (parser falla) | Estado `error`, log con muestra del HTML (sin cookies) si `debug=true`. Sugerir actualizar la extensión. |
| API oficial responde 200 pero schema cambia | Validar con un schema mínimo; si falla, caer a scraping y avisar. |
| Multi-window VSCode | Una sola instancia del fetcher por proceso de extensión, vía `globalState` lock con TTL. |
| Sleep / suspend del equipo | Al despertar, forzar fetch si han pasado >2× el intervalo de polling. |

---

## 9. Roadmap

### MVP (v0.1.0) — alcance fijo de este PRD

- Configuración de credenciales (workspaceId + authCookie en SecretStorage).
- `ScrapingFetcher` funcional contra `console.opencode.ai`.
- `ApiFetcher` implementado pero detrás de feature-flag hasta que la PR upstream se mergee.
- Selector con fallback automático.
- Status bar con estados, colores por umbral, click → QuickPick.
- Histórico en `globalState` con retención 30 días.
- Predicción por regresión lineal en QuickPick.
- Comandos: configure, refresh, showDetails, exportHistory, openDashboard, clearCredentials.

### v0.2 — post-MVP

- Notificaciones de umbral (opt-in).
- Soporte multi-workspace en una misma instancia.
- Telemetría opt-in (latencias, ratio API/scraping, no datos personales).

### v0.3 — explorar

- Mini-gráfico inline en el tooltip del status bar (sparkline ASCII).
- Integración con `OpenUsage` o ecosistema externo.
- Soporte de otros proveedores OpenCode (Zen pay-as-you-go) si hay demanda — abre el debate de si conviene fusionar con `opencode-quota` upstream en lugar de duplicar.

---

## 10. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| OpenCode cambia el HTML del dashboard y rompe el scraper | Alta | Alto | Tests de contrato del parser; versión del parser visible en logs; CI semanal que ejecuta el scraper contra fixture real. |
| OpenCode cambia el formato de la cookie de auth | Media | Medio | Detectar 401 y guiar al re-setup. |
| La PR de la API oficial no se mergea | Media | Bajo | El MVP no depende de ella; cuando se mergee es trivial habilitar `ApiFetcher`. |
| Anomaly considera el scraping uso indebido | Baja | Alto | Respetar ratelimits agresivos (mínimo 60s, default 300s); incluir User-Agent identificable; documentar el uso. Estar listos para retirarlo si se solicita. |
| Cookie filtrada por bug en logs | Baja | Crítico | Tests específicos que verifican que la cookie nunca aparece en strings logueados; máscara obligatoria. |

---

## 11. Definición de "hecho" para el MVP

- [ ] Extensión publicable en `.vsix`, instalable localmente.
- [ ] Status bar muestra un valor real obtenido por scraping en cuenta de prueba.
- [ ] Cookie almacenada en SecretStorage (verificable con `vscode --inspect-extensions`).
- [ ] Cookie expirada se maneja con estado `auth` y notificación.
- [ ] Histórico persiste entre reinicios de VSCode.
- [ ] Predicción aparece tras ≥ 6 snapshots en 24h.
- [ ] Tests unitarios del parser de scraping con fixtures HTML reales.
- [ ] Tests unitarios de la regresión lineal con datos sintéticos.
- [ ] README con screenshots y guía de obtención de credenciales.
- [ ] CHANGELOG inicial.
- [ ] Licencia (sugerida: MIT).
- [ ] Repo público en GitHub con CI básico (lint + test).

---

## 12. Referencias

- Issue API oficial: https://github.com/anomalyco/opencode/issues/16017
- PR API oficial: https://github.com/anomalyco/opencode/pull/16513
- Plugin de referencia: https://github.com/slkiser/opencode-quota
- PR scraping de referencia: https://github.com/slkiser/opencode-quota/pull/41
- Docs de OpenCode Go: https://opencode.ai/docs/go/
- VSCode Extension API: https://code.visualstudio.com/api
- VSCode SecretStorage: https://code.visualstudio.com/api/references/vscode-api#SecretStorage
