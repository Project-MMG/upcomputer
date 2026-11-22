import { applyUpcomputerEnvAliases } from "@t3tools/shared/upcomputerEnv";
import {
  resolveUpcomputerLocalBuildIdentity,
  UPCOMPUTER_PRIVATE_ALPHA_APP_ID,
} from "@t3tools/shared/upcomputerIdentity";

/**
 * Applies the Up.computer process environment before anything reads it.
 * `main.ts` imports `UpcomputerStartupEnvironmentEffect.ts` first so this runs
 * ahead of every other module, including Finder launches with no shell env.
 */
export function applyUpcomputerStartupEnvironment(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly appVersion: string;
  readonly homeDirectory: string;
  readonly joinPath: (first: string, ...segments: string[]) => string;
}): void {
  const { env } = input;
  applyUpcomputerEnvAliases(env);
  // Local builds carry their own state, port, and updater settings.
  const localBuild = resolveUpcomputerLocalBuildIdentity(input.appVersion);
  if (localBuild) {
    const smokeRoot =
      localBuild.appId === UPCOMPUTER_PRIVATE_ALPHA_APP_ID
        ? env.T3CODE_PRIVATE_ALPHA_SMOKE_ROOT?.trim()
        : undefined;
    env.T3CODE_HOME = smokeRoot
      ? input.joinPath(smokeRoot, "server")
      : input.joinPath(input.homeDirectory, localBuild.homeDirectoryName);
    env.T3CODE_DISABLE_AUTO_UPDATE = "true";
    delete env.VITE_DEV_SERVER_URL;
    delete env.T3CODE_PORT;
  }
}
