export declare const ENV_FILE_PATH: string;
/** Load variables from this package's .env (does not override existing process.env). */
export declare function loadEnv(): void;
export declare function maskApiKey(key: string): string;
export type EnvStatus = {
    env_file: string;
    env_file_exists: boolean;
    api_key_set: boolean;
    api_key_preview: string | null;
    api_base: string;
};
export declare function envStatus(): EnvStatus;
