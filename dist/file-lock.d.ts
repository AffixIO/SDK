export declare function withFileLock<T>(lockPath: string, fn: () => T, options?: {
    timeoutMs?: number;
    pollMs?: number;
}): T;
export declare function atomicAppendLine(path: any, line: any): void;
