import type { PluginOptions } from 'claude-code'

import type { Host } from '../host'

/**
 * The GitHub token, tried in the settled order: `GH_TOKEN`, `GITHUB_TOKEN`,
 * `gh auth token` (CLI only), then the plugin's sensitive `githubToken`
 * setting. Null when none of them has one.
 */
export async function resolveToken(
  host: Host,
  options: PluginOptions,
): Promise<string | null> {
  const fromEnv =
    (await host.envGet('GH_TOKEN'))?.trim() || (await host.envGet('GITHUB_TOKEN'))

  if (fromEnv?.trim()) {
    return fromEnv.trim()
  }

  try {
    const { exitCode, stdout } = await host.run(
      ['gh', 'auth', 'token', '--hostname', 'github.com'],
      { timeoutMs: 5000 },
    )

    if (exitCode === 0 && stdout.trim()) {
      return stdout.trim()
    }
  } catch {
    // No gh, or no process noun on this surface: fall through to the setting.
  }

  const fromSetting = options['githubToken']

  return typeof fromSetting === 'string' && fromSetting.trim()
    ? fromSetting.trim()
    : null
}
