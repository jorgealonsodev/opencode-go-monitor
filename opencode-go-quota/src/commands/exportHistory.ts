import * as fs from 'fs';
import type { HistoryStorage } from '../storage/history';
import type { CommandsLike, WindowLike, UriLike, DisposableLike } from './types';

export function registerExportHistoryCommand(
  historyStorage: HistoryStorage,
  window: WindowLike,
  commands: CommandsLike,
  uriFactory: { file: (path: string) => UriLike } = {
    file: (path) => ({ fsPath: path, toString: () => path, scheme: 'file' }),
  },
  writeFileSync: (path: string, data: string, encoding?: string) => void = fs.writeFileSync as unknown as (path: string, data: string, encoding?: string) => void,
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.exportHistory', async () => {
    const history = historyStorage.getAll();
    if (history.length === 0) {
      await window.showErrorMessage('No history to export.');
      return;
    }

    const uri = await window.showSaveDialog({
      defaultUri: uriFactory.file('opencode-go-quota-history.json'),
      filters: {
        'JSON files': ['json'],
        'All files': ['*'],
      },
    });

    if (!uri) {
      return;
    }

    try {
      const json = historyStorage.exportToJson();
      writeFileSync(uri.fsPath, json, 'utf-8');
      await window.showInformationMessage(`History exported to ${uri.fsPath}`);
    } catch (err) {
      await window.showErrorMessage(
        `Failed to export history: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}
