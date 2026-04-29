import type { CommandsLike, EnvLike, UriLike, DisposableLike } from './types';

export function registerOpenDashboardCommand(
  workspaceId: string,
  env: EnvLike,
  commands: CommandsLike,
  uriFactory: { parse: (uri: string) => UriLike } = {
    parse: (uri) => ({ fsPath: uri, toString: () => uri, scheme: 'https' }),
  },
): DisposableLike {
  return commands.registerCommand('opencodeGoQuota.openDashboard', async () => {
    const url = `https://opencode.ai/workspace/${workspaceId}/go`;
    await env.openExternal(uriFactory.parse(url));
  });
}
