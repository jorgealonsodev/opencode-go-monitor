export type Locale = 'en' | 'es';

export interface Translations {
  // Status bar
  statusBarTooltip: (label: string, pct: string) => string;
  statusBarText: (label: string, pct: string, reset: string) => string;
  statusBarRolling: string;
  statusBarWeekly: string;
  statusBarMonthly: string;
  statusBarReset: (time: string) => string;
  statusBarSource: (source: string) => string;
  statusBarUpdated: (time: string) => string;
  
  // States
  stateSetup: string;
  stateLoading: string;
  stateAuthExpired: string;
  stateError: string;
  
  // Commands
  cmdConfigureTitle: string;
  cmdRefreshTitle: string;
  cmdShowDetailsTitle: string;
  cmdExportHistoryTitle: string;
  cmdOpenDashboardTitle: string;
  cmdClearCredentialsTitle: string;
  cmdSelectDisplayWindowTitle: string;
  
  // Messages
  msgCredentialsSaved: (workspaceId: string) => string;
  msgCredentialsRequired: string;
  msgFailedToSave: (error: string) => string;
  msgQuotaRefreshed: (pct: number) => string;
  msgFailedToRefresh: (error: string) => string;
  msgNoDataAvailable: string;
  msgRefreshNow: string;
  msgConfigureCredentials: string;
  msgWindowChanged: (label: string) => string;
  msgHistoryExported: (path: string) => string;
  msgFailedToExport: (error: string) => string;
  msgCredentialsCleared: string;
  
  // Configure prompts
  promptWorkspaceId: string;
  promptWorkspaceIdPlaceholder: string;
  promptAuthCookie: string;
  promptAuthCookiePlaceholder: string;
  
  // Display window picker
  pickDisplayWindowPlaceholder: string;
  pickRollingLabel: string;
  pickRollingDesc: string;
  pickWeeklyLabel: string;
  pickWeeklyDesc: string;
  pickMonthlyLabel: string;
  pickMonthlyDesc: string;
  pickCurrent: string;
  
  // Details quickpick
  detailsTitle: string;
  detailsRolling: string;
  detailsWeekly: string;
  detailsMonthly: string;
  detailsPrediction: (time: string) => string;
  detailsNoPrediction: string;
  detailsHistoryCount: (count: number) => string;
  detailsReconfigure: string;
  detailsLogout: string;
  
  // Errors
  errCredentialsNotFound: string;
  errParseFailed: string;
  errNetworkFailed: string;
}

const en: Translations = {
  // Status bar
  statusBarTooltip: (label, pct) => `**OpenCode Go - ${label} Usage: ${pct}**`,
  statusBarText: (label, pct, reset) => `OC Go ${label}: ${pct} · ${reset}`,
  statusBarRolling: 'Rolling',
  statusBarWeekly: 'Weekly',
  statusBarMonthly: 'Monthly',
  statusBarReset: (time) => `resets in ${time}`,
  statusBarSource: (source) => `Source: ${source === 'api' ? 'API' : 'Web'}`,
  statusBarUpdated: (time) => `Updated: ${time}`,
  
  // States
  stateSetup: 'OC Go: setup',
  stateLoading: 'OC Go: loading...',
  stateAuthExpired: 'OC Go: auth expired',
  stateError: 'OC Go: error',
  
  // Commands
  cmdConfigureTitle: 'OpenCode Go: Configure Credentials',
  cmdRefreshTitle: 'OpenCode Go: Refresh Quota',
  cmdShowDetailsTitle: 'OpenCode Go: Show Details',
  cmdExportHistoryTitle: 'OpenCode Go: Export History',
  cmdOpenDashboardTitle: 'OpenCode Go: Open Dashboard',
  cmdClearCredentialsTitle: 'OpenCode Go: Clear Credentials',
  cmdSelectDisplayWindowTitle: 'OpenCode Go: Select Display Window',
  
  // Messages
  msgCredentialsSaved: (workspaceId) => `OpenCode Go credentials saved for workspace ${workspaceId}.`,
  msgCredentialsRequired: 'Both workspace ID and auth cookie are required.',
  msgFailedToSave: (error) => `Failed to save credentials: ${error}`,
  msgQuotaRefreshed: (pct) => `Quota refreshed. Usage: ${pct}%.`,
  msgFailedToRefresh: (error) => `Failed to refresh quota: ${error}`,
  msgNoDataAvailable: 'No quota data available. Try refreshing manually.',
  msgRefreshNow: 'Refresh Now',
  msgConfigureCredentials: 'Configure Credentials',
  msgWindowChanged: (label) => `Display window changed to: ${label}`,
  msgHistoryExported: (path) => `History exported to: ${path}`,
  msgFailedToExport: (error) => `Failed to export history: ${error}`,
  msgCredentialsCleared: 'OpenCode Go credentials cleared.',
  
  // Configure prompts
  promptWorkspaceId: 'Enter your OpenCode workspace ID (found in your dashboard URL after /workspace/)',
  promptWorkspaceIdPlaceholder: 'e.g., workspace-abc123',
  promptAuthCookie: 'Enter your OpenCode auth cookie (open browser DevTools → Application → Cookies → console.opencode.ai → copy the value)',
  promptAuthCookiePlaceholder: 'Paste your auth cookie here',
  
  // Display window picker
  pickDisplayWindowPlaceholder: 'Select the quota window to display in the status bar',
  pickRollingLabel: 'Rolling Usage',
  pickRollingDesc: 'Resets every ~5 hours',
  pickWeeklyLabel: 'Weekly Usage',
  pickWeeklyDesc: 'Resets every ~7 days',
  pickMonthlyLabel: 'Monthly Usage',
  pickMonthlyDesc: 'Resets every ~30 days',
  pickCurrent: '✓ Current',
  
  // Details quickpick
  detailsTitle: 'OpenCode Go Quota Details',
  detailsRolling: 'Rolling',
  detailsWeekly: 'Weekly',
  detailsMonthly: 'Monthly',
  detailsPrediction: (time) => `Predicted exhaustion: ${time}`,
  detailsNoPrediction: 'Not enough data for prediction',
  detailsHistoryCount: (count) => `${count} snapshots in history`,
  detailsReconfigure: 'Reconfigure credentials',
  detailsLogout: 'Logout (Clear credentials)',
  
  // Errors
  errCredentialsNotFound: 'Credentials not found',
  errParseFailed: 'Failed to parse response',
  errNetworkFailed: 'Network request failed',
};

const es: Translations = {
  // Status bar
  statusBarTooltip: (label, pct) => `**OpenCode Go - Uso ${label}: ${pct}**`,
  statusBarText: (label, pct, reset) => `OC Go ${label}: ${pct} · ${reset}`,
  statusBarRolling: 'Continuo',
  statusBarWeekly: 'Semanal',
  statusBarMonthly: 'Mensual',
  statusBarReset: (time) => `reset en ${time}`,
  statusBarSource: (source) => `Fuente: ${source === 'api' ? 'API' : 'Web'}`,
  statusBarUpdated: (time) => `Actualizado: ${time}`,
  
  // States
  stateSetup: 'OC Go: configurar',
  stateLoading: 'OC Go: cargando...',
  stateAuthExpired: 'OC Go: auth expirada',
  stateError: 'OC Go: error',
  
  // Commands
  cmdConfigureTitle: 'OpenCode Go: Configurar Credenciales',
  cmdRefreshTitle: 'OpenCode Go: Actualizar Quota',
  cmdShowDetailsTitle: 'OpenCode Go: Mostrar Detalles',
  cmdExportHistoryTitle: 'OpenCode Go: Exportar Historial',
  cmdOpenDashboardTitle: 'OpenCode Go: Abrir Dashboard',
  cmdClearCredentialsTitle: 'OpenCode Go: Limpiar Credenciales',
  cmdSelectDisplayWindowTitle: 'OpenCode Go: Seleccionar Ventana',
  
  // Messages
  msgCredentialsSaved: (workspaceId) => `Credenciales de OpenCode Go guardadas para el workspace ${workspaceId}.`,
  msgCredentialsRequired: 'Se requieren tanto el workspace ID como la auth cookie.',
  msgFailedToSave: (error) => `Error al guardar credenciales: ${error}`,
  msgQuotaRefreshed: (pct) => `Quota actualizada. Uso: ${pct}%.`,
  msgFailedToRefresh: (error) => `Error al actualizar quota: ${error}`,
  msgNoDataAvailable: 'No hay datos de quota disponibles. Intenta actualizar manualmente.',
  msgRefreshNow: 'Actualizar Ahora',
  msgConfigureCredentials: 'Configurar Credenciales',
  msgWindowChanged: (label) => `Ventana cambiada a: ${label}`,
  msgHistoryExported: (path) => `Historial exportado a: ${path}`,
  msgFailedToExport: (error) => `Error al exportar historial: ${error}`,
  msgCredentialsCleared: 'Credenciales de OpenCode Go eliminadas.',
  
  // Configure prompts
  promptWorkspaceId: 'Introduce tu workspace ID de OpenCode (encontrado en la URL del dashboard después de /workspace/)',
  promptWorkspaceIdPlaceholder: 'ej., workspace-abc123',
  promptAuthCookie: 'Introduce tu auth cookie de OpenCode (abre DevTools del navegador → Application → Cookies → console.opencode.ai → copia el valor)',
  promptAuthCookiePlaceholder: 'Pega tu auth cookie aquí',
  
  // Display window picker
  pickDisplayWindowPlaceholder: 'Selecciona la ventana de quota a mostrar en la barra de estado',
  pickRollingLabel: 'Uso Continuo',
  pickRollingDesc: 'Se reinicia cada ~5 horas',
  pickWeeklyLabel: 'Uso Semanal',
  pickWeeklyDesc: 'Se reinicia cada ~7 días',
  pickMonthlyLabel: 'Uso Mensual',
  pickMonthlyDesc: 'Se reinicia cada ~30 días',
  pickCurrent: '✓ Actual',
  
  // Details quickpick
  detailsTitle: 'Detalles de Quota OpenCode Go',
  detailsRolling: 'Continuo',
  detailsWeekly: 'Semanal',
  detailsMonthly: 'Mensual',
  detailsPrediction: (time) => `Agotamiento predicho: ${time}`,
  detailsNoPrediction: 'No hay suficientes datos para predicción',
  detailsHistoryCount: (count) => `${count} snapshots en el historial`,
  detailsReconfigure: 'Reconfigurar credenciales',
  detailsLogout: 'Cerrar sesión (Borrar credenciales)',
  
  // Errors
  errCredentialsNotFound: 'Credenciales no encontradas',
  errParseFailed: 'Error al parsear respuesta',
  errNetworkFailed: 'Error de red',
};

export function getTranslations(locale: Locale): Translations {
  return locale === 'es' ? es : en;
}

export function detectLocale(): Locale {
  const vscode = require('vscode');
  const lang = vscode.env.language;
  return lang.startsWith('es') ? 'es' : 'en';
}
