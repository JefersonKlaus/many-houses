// The runtime config is NOT bundled: it is /js/config.js, generated at deploy time with the AWS data (see
// .github/workflows/deploy-reusable.yml) or by the local server (skipLogin). So one build works everywhere.
export interface Config {
  region: string;
  clientId: string;
  apiUrl: string;
  skipLogin?: boolean;
}

export let CONFIG: Config = { region: "", clientId: "", apiUrl: "" };

export async function loadConfig(): Promise<Config> {
  const path = "/js/config.js";
  const module = (await import(/* @vite-ignore */ path)) as { CONFIG: Config };
  CONFIG = module.CONFIG;
  return CONFIG;
}
