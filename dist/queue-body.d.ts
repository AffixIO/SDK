/** Strip credential/context; persist witness-only bodies for offline resume. */
export declare function redactProveBodyForQueue(circuitId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
