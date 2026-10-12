/* AffixIO local ops dashboard types. Credit: @paparichens */
export declare function runDashboard(options?: {
  host?: string;
  port?: number | string;
  apiKey?: string;
  apiBase?: string;
  operatorBaseDir?: string;
  kyaStorageDir?: string;
  sdk?: unknown;
}): Promise<{
  server: import("node:http").Server;
  url: string;
  host: string;
  port: number;
  shutdown: () => void;
  sdk: unknown;
  trust: unknown;
}>;
export default runDashboard;
