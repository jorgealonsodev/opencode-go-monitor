export type Locale = 'en' | 'es';

export interface Translations {
  // Status bar
  statusBarTooltip: (label: string, pct: string) => string;
  /** `value` is `42% · 2h 13m`, `limit · 2h 13m` or `?%`. */
  statusBarText: (label: string, value: string) => string;
  statusBarTextWithProfile: (name: string, label: string, value: string) => string;
  statusBarRolling: string;
  statusBarWeekly: string;
  statusBarMonthly: string;
  statusBarReset: (time: string) => string;
  statusBarUpdated: (time: string) => string;
  statusBarFooter: (name: string, time: string) => string;
  statusBarLimit: string;
  statusBarLimitReached: (time: string) => string;
  statusBarSwitchApiKey: string;
  
  // States
  stateSetup: string;
  stateLoading: string;
  stateInvalidKey: string;
  stateError: string;
  tooltipSetup: string;
  tooltipInvalidKey: (name: string) => string;
  
  // Messages
  msgFailedToRefresh: (error: string) => string;
  errUnexpectedResponse: string;
  errRequestTimedOut: string;
  msgNoDataAvailable: string;
  msgRefreshNow: string;
  msgWindowChanged: (label: string) => string;
  msgHistoryExported: (path: string) => string;
  msgFailedToExport: (error: string) => string;
  
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
  detailsRolling: string;
  detailsWeekly: string;
  detailsMonthly: string;
  detailsPrediction: (time: string) => string;
  detailsNoPrediction: string;
  detailsHistoryCount: (count: number) => string;
  detailsOpenDashboard: string;
  detailsForceRefresh: string;
  detailsSwitchApiKey: (name: string) => string;
  detailsRemoveAllApiKeys: string;
  
  // API keys (profiles)
  promptApiKeyName: string;
  promptApiKeyNamePlaceholder: string;
  promptApiKey: string;
  promptReplaceApiKey: (name: string) => string;
  promptRenameApiKey: (name: string) => string;
  pickSelectApiKey: string;
  pickRenameApiKey: string;
  pickReplaceApiKey: string;
  pickRemoveApiKey: string;
  errNameRequired: string;
  errNameTooLong: string;
  errNameForbidden: string;
  errNameDuplicate: (name: string) => string;
  errKeyInvalid: string;
  msgKeyRejected: string;
  msgKeyUnverified: (reason: string) => string;
  msgKeySaved: (name: string) => string;
  msgConfirmRemove: (name: string) => string;
  msgConfirmRemoveAll: (count: number) => string;
  msgRemoved: (name: string) => string;
  msgRemovedNowMonitoring: (name: string, other: string) => string;
  msgNoApiKeys: string;
  msgAuthRejected: (name: string, httpStatus: number) => string;
  msgApiKeyOperationFailed: (error: string) => string;
  msgLegacyNotice: string;
  actionAddApiKey: string;
  actionSelectApiKey: string;
  actionReplaceApiKey: string;
  actionMonitor: (name: string) => string;
  actionTryAgain: string;
  actionSaveAnyway: string;
  actionCancel: string;
  actionRemove: string;
  actionRemoveAll: string;
}

const en: Translations = {
  // Status bar
  statusBarTooltip: (label, pct) => `**OpenCode Go - ${label} Usage: ${pct}**`,
  statusBarText: (label, value) => `OC Go ${label}: ${value}`,
  statusBarTextWithProfile: (name, label, value) => `OC Go · ${name} · ${label}: ${value}`,
  statusBarRolling: 'Rolling',
  statusBarWeekly: 'Weekly',
  statusBarMonthly: 'Monthly',
  statusBarReset: (time) => `resets in ${time}`,
  statusBarUpdated: (time) => `Updated ${time}`,
  statusBarFooter: (name, time) => `Key: ${name} | Updated ${time}`,
  statusBarLimit: 'limit',
  statusBarLimitReached: (time) => `Limit reached — resets in ${time}`,
  statusBarSwitchApiKey: 'Switch API key',
  
  // States
  stateSetup: 'OC Go: add API key',
  stateLoading: 'OC Go: loading...',
  stateInvalidKey: 'OC Go: invalid key',
  stateError: 'OC Go: error',
  tooltipSetup: 'No OpenCode Go API key configured. Click to add one.',
  tooltipInvalidKey: (name) => `API key '${name}' was rejected (401/403). Click to choose another key.`,
  
  // Messages
  msgFailedToRefresh: (error) => `Failed to refresh quota: ${error}`,
  errUnexpectedResponse: 'Unexpected response from OpenCode — the extension may need an update.',
  errRequestTimedOut: 'Request timed out',
  msgNoDataAvailable: 'No quota data available. Try refreshing manually.',
  msgRefreshNow: 'Refresh Now',
  msgWindowChanged: (label) => `Display window changed to: ${label}`,
  msgHistoryExported: (path) => `History exported to: ${path}`,
  msgFailedToExport: (error) => `Failed to export history: ${error}`,
  
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
  detailsRolling: 'Rolling',
  detailsWeekly: 'Weekly',
  detailsMonthly: 'Monthly',
  detailsPrediction: (time) => `Predicted exhaustion: ${time}`,
  detailsNoPrediction: 'Not enough data for prediction',
  detailsHistoryCount: (count) => `${count} snapshots in history`,
  detailsOpenDashboard: 'Open OpenCode dashboard',
  detailsForceRefresh: 'Force refresh',
  detailsSwitchApiKey: (name) => `Switch API key (${name})`,
  detailsRemoveAllApiKeys: 'Remove All API Keys',
  
  // API keys (profiles)
  promptApiKeyName: 'Name for this API key',
  promptApiKeyNamePlaceholder: 'e.g., Personal, Team 1',
  promptApiKey: 'Paste your OpenCode Go API key',
  promptReplaceApiKey: (name) => `Paste the new API key for '${name}'`,
  promptRenameApiKey: (name) => `New name for '${name}'`,
  pickSelectApiKey: 'Select the API key to monitor',
  pickRenameApiKey: 'Select the API key to rename',
  pickReplaceApiKey: 'Select the API key to replace',
  pickRemoveApiKey: 'Select the API key to remove',
  errNameRequired: 'Name is required',
  errNameTooLong: 'Use 40 characters or fewer',
  errNameForbidden: "Names can't contain [ ] ( ) or control characters",
  errNameDuplicate: (name) => `A key named '${name}' already exists`,
  errKeyInvalid: "This doesn't look like an API key",
  msgKeyRejected: 'The key was rejected by OpenCode.',
  msgKeyUnverified: (reason) => `Couldn't verify the key (${reason}).`,
  msgKeySaved: (name) => `Saved '${name}'.`,
  msgConfirmRemove: (name) => `Remove '${name}' and its stored history? This can't be undone.`,
  msgConfirmRemoveAll: (count) => `Remove all ${count} API keys and their history?`,
  msgRemoved: (name) => `Removed '${name}'.`,
  msgRemovedNowMonitoring: (name, other) => `Removed '${name}'. Now monitoring '${other}'.`,
  msgNoApiKeys: 'No API keys saved.',
  msgAuthRejected: (name, httpStatus) => `API key '${name}' was rejected by OpenCode (HTTP ${httpStatus}).`,
  msgApiKeyOperationFailed: (error) => `Failed to update API keys: ${error}`,
  msgLegacyNotice: 'OpenCode Go Monitor now uses API keys. Cookie setup is no longer supported — add your Go API key to continue.',
  actionAddApiKey: 'Add API Key',
  actionSelectApiKey: 'Select API Key',
  actionReplaceApiKey: 'Replace API Key',
  actionMonitor: (name) => `Monitor ${name}`,
  actionTryAgain: 'Try again',
  actionSaveAnyway: 'Save anyway',
  actionCancel: 'Cancel',
  actionRemove: 'Remove',
  actionRemoveAll: 'Remove all',
};

const es: Translations = {
  // Status bar
  statusBarTooltip: (label, pct) => `**OpenCode Go - Uso ${label}: ${pct}**`,
  statusBarText: (label, value) => `OC Go ${label}: ${value}`,
  statusBarTextWithProfile: (name, label, value) => `OC Go · ${name} · ${label}: ${value}`,
  statusBarRolling: 'Continuo',
  statusBarWeekly: 'Semanal',
  statusBarMonthly: 'Mensual',
  statusBarReset: (time) => `reset en ${time}`,
  statusBarUpdated: (time) => `Actualizado ${time}`,
  statusBarFooter: (name, time) => `Clave: ${name} | Actualizado ${time}`,
  statusBarLimit: 'límite',
  statusBarLimitReached: (time) => `Límite alcanzado — reset en ${time}`,
  statusBarSwitchApiKey: 'Cambiar clave de API',
  
  // States
  stateSetup: 'OC Go: añadir clave de API',
  stateLoading: 'OC Go: cargando...',
  stateInvalidKey: 'OC Go: clave no válida',
  stateError: 'OC Go: error',
  tooltipSetup: 'No hay ninguna clave de API de OpenCode Go configurada. Haz clic para añadir una.',
  tooltipInvalidKey: (name) => `Se rechazó la clave de API '${name}' (401/403). Haz clic para elegir otra clave.`,
  
  // Messages
  msgFailedToRefresh: (error) => `Error al actualizar quota: ${error}`,
  errUnexpectedResponse: 'Respuesta inesperada de OpenCode: puede que la extensión necesite una actualización.',
  errRequestTimedOut: 'Se agotó el tiempo de espera de la solicitud',
  msgNoDataAvailable: 'No hay datos de quota disponibles. Intenta actualizar manualmente.',
  msgRefreshNow: 'Actualizar Ahora',
  msgWindowChanged: (label) => `Ventana cambiada a: ${label}`,
  msgHistoryExported: (path) => `Historial exportado a: ${path}`,
  msgFailedToExport: (error) => `Error al exportar historial: ${error}`,
  
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
  detailsRolling: 'Continuo',
  detailsWeekly: 'Semanal',
  detailsMonthly: 'Mensual',
  detailsPrediction: (time) => `Agotamiento predicho: ${time}`,
  detailsNoPrediction: 'No hay suficientes datos para predicción',
  detailsHistoryCount: (count) => `${count} snapshots en el historial`,
  detailsOpenDashboard: 'Abrir el panel de OpenCode',
  detailsForceRefresh: 'Forzar actualización',
  detailsSwitchApiKey: (name) => `Cambiar clave de API (${name})`,
  detailsRemoveAllApiKeys: 'Eliminar todas las claves de API',
  
  // API keys (profiles)
  promptApiKeyName: 'Nombre para esta clave de API',
  promptApiKeyNamePlaceholder: 'p. ej., Personal, Equipo 1',
  promptApiKey: 'Pega tu clave de API de OpenCode Go',
  promptReplaceApiKey: (name) => `Pega la nueva clave de API para '${name}'`,
  promptRenameApiKey: (name) => `Nuevo nombre para '${name}'`,
  pickSelectApiKey: 'Selecciona la clave de API que quieres supervisar',
  pickRenameApiKey: 'Selecciona la clave de API que quieres renombrar',
  pickReplaceApiKey: 'Selecciona la clave de API que quieres reemplazar',
  pickRemoveApiKey: 'Selecciona la clave de API que quieres eliminar',
  errNameRequired: 'El nombre es obligatorio',
  errNameTooLong: 'Usa 40 caracteres o menos',
  errNameForbidden: 'Los nombres no pueden contener [ ] ( ) ni caracteres de control',
  errNameDuplicate: (name) => `Ya existe una clave llamada '${name}'`,
  errKeyInvalid: 'Esto no parece una clave de API',
  msgKeyRejected: 'OpenCode rechazó la clave.',
  msgKeyUnverified: (reason) => `No se pudo verificar la clave (${reason}).`,
  msgKeySaved: (name) => `Se guardó '${name}'.`,
  msgConfirmRemove: (name) => `¿Eliminar '${name}' y su historial guardado? Esta acción no se puede deshacer.`,
  msgConfirmRemoveAll: (count) => `¿Eliminar las ${count} claves de API y su historial?`,
  msgRemoved: (name) => `Se eliminó '${name}'.`,
  msgRemovedNowMonitoring: (name, other) => `Se eliminó '${name}'. Ahora se supervisa '${other}'.`,
  msgNoApiKeys: 'No hay claves de API guardadas.',
  msgAuthRejected: (name, httpStatus) => `OpenCode rechazó la clave de API '${name}' (HTTP ${httpStatus}).`,
  msgApiKeyOperationFailed: (error) => `Error al actualizar las claves de API: ${error}`,
  msgLegacyNotice: 'OpenCode Go Monitor ahora usa claves de API. La configuración con cookies ya no es compatible: añade tu clave de API de Go para continuar.',
  actionAddApiKey: 'Añadir clave de API',
  actionSelectApiKey: 'Seleccionar clave de API',
  actionReplaceApiKey: 'Reemplazar clave de API',
  actionMonitor: (name) => `Supervisar ${name}`,
  actionTryAgain: 'Reintentar',
  actionSaveAnyway: 'Guardar de todos modos',
  actionCancel: 'Cancelar',
  actionRemove: 'Eliminar',
  actionRemoveAll: 'Eliminar todas',
};

export function getTranslations(locale: Locale): Translations {
  return locale === 'es' ? es : en;
}

export function detectLocale(): Locale {
  const vscode = require('vscode');
  const lang = vscode.env.language;
  return lang.startsWith('es') ? 'es' : 'en';
}
