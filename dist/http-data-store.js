/* Credit: @paparichens */
import { requestJson } from "./http.js";

/**
 * HTTP profile for internal/external customer data APIs (not Affix licence).
 */
export class HttpDataStore {
    name;
    style;
    profile;
    constructor(profile, name = "http") {
        this.profile = profile;
        this.name = name;
        this.style = "modern";
    }
    headers() {
        const headers = { Accept: "application/json" };
        const tokenEnv = this.profile.authEnv;
        if (tokenEnv && process.env[tokenEnv]) {
            const scheme = this.profile.authScheme ?? "Bearer";
            headers.Authorization = `${scheme} ${process.env[tokenEnv]}`;
        }
        if (this.profile.headers) {
            Object.assign(headers, this.profile.headers);
        }
        return headers;
    }
    urlFor(id) {
        const template = this.profile.pathTemplate ?? "/records/:id";
        return `${this.profile.baseUrl.replace(/\/$/, "")}${template.replace(":id", encodeURIComponent(id))}`;
    }
    async lookup(query) {
        const url = this.urlFor(query.id);
        const res = await requestJson(url, {
            method: this.profile.method ?? "GET",
            headers: this.headers(),
            timeoutMs: this.profile.timeoutMs ?? 10_000,
        });
        const data = await res.json();
        if (!res.ok) {
            return null;
        }
        const row = this.profile.recordsPath
            ? this.profile.recordsPath.split(".").reduce((acc, key) => acc?.[key], data)
            : data;
        if (!row || typeof row !== "object") {
            return null;
        }
        const claimField = query.claimField ?? "status";
        const claim = String(row[claimField] ?? "");
        const required = query.required;
        const fields = { claim, required };
        for (const key of query.select ?? []) {
            if (key !== "claim" && key !== "required") {
                fields[key] = String(row[key] ?? "");
            }
        }
        if (claimField !== "claim" && claimField !== "required") {
            fields[claimField] = claim;
        }
        return {
            pass: claim === required,
            fields,
            source: this.name,
            style: this.style,
            record_id: String(row.id ?? query.id),
            meta: { profile: this.profile.name ?? this.name },
        };
    }
}

export function createHttpDataStore(profile, name) {
    if (!profile?.baseUrl) {
        throw new Error("http_profile_requires_baseUrl");
    }
    return new HttpDataStore(profile, name);
}

export async function testHttpProfile(profile) {
    const store = createHttpDataStore(profile, "test");
    const sampleId = profile.sampleId ?? "test";
    try {
        const url = store.urlFor(sampleId);
        const res = await requestJson(url, {
            method: profile.method ?? "GET",
            headers: store.headers(),
            timeoutMs: profile.timeoutMs ?? 10_000,
        });
        return { ok: res.ok, status: res.status, url };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
