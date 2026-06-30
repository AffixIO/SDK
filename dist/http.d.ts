export type HttpResponse = {
    status: number;
    ok: boolean;
    json(): Promise<Record<string, unknown>>;
};
export declare function requestJson(url: string, options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}): Promise<HttpResponse>;
