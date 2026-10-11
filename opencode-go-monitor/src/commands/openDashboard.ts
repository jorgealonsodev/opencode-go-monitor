import type { CommandsLike, EnvLike, UriLike, DisposableLike } from './types';

export const DASHBOARD_URL = 'https://opencode.ai/console';

export function registerOpenDashboardCommand(
  env: EnvLike,
  commands: CommandsLike,
  uriFactory: { parse: (uri: string) => UriLike } = {
    parse: (uri) => ({ fsPath: uri, toString: () => uri, scheme: 'https' }),
  },
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.openDashboard', async () => {
    await env.openExternal(uriFactory.parse(DASHBOARD_URL));
  });
}
