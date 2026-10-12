import json
import urllib.error
import urllib.parse
import urllib.request


class AffixError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class AffixClient:
    def __init__(self, api_key, api_base="https://api.affix-io.com", timeout=20):
        parsed = urllib.parse.urlsplit(api_base)
        if (parsed.scheme != "https" or not parsed.netloc or parsed.username
                or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ("", "/")):
            raise ValueError("API base must be an HTTPS origin")
        if not isinstance(api_key, str) or not api_key or any(c in api_key for c in "\r\n"):
            raise ValueError("API key required")
        if not 0 < timeout <= 300:
            raise ValueError("Timeout must be between 0 and 300 seconds")
        self._key = api_key
        self.api_base = api_base.rstrip("/")
        self.timeout = timeout
        self._opener = urllib.request.build_opener(_NoRedirect())

    def _request(self, path, body=None):
        headers = {"Accept": "application/json", "Content-Type": "application/json",
                   "Authorization": "Bearer " + self._key, "X-API-Key": self._key,
                   "User-Agent": "AffixIO-Python/2.0.0"}
        data = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
        request = urllib.request.Request(self.api_base + path, data=data, headers=headers,
                                         method="GET" if body is None else "POST")
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise AffixError(None, "API response exceeds size limit")
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            raise AffixError(error.code, "AffixIO API returned HTTP " + str(error.code)) from None
        except urllib.error.URLError:
            raise AffixError(None, "Request failed; reconcile state before retrying writes") from None

    def auth_check(self):
        return self._request("/v1/auth/check")

    def auth_pulse(self):
        return self._request("/v1/auth/pulse")

    def circuits(self):
        return self._request("/v1/circuits")

    def verify(self, circuit_id, proof_body):
        if not isinstance(circuit_id, str) or not circuit_id:
            raise ValueError("Circuit id required")
        return self._request("/v1/circuits/" + urllib.parse.quote(circuit_id, safe="") + "/verify", proof_body)

    def merkle_root(self):
        return self._request("/v1/merkle/root")

    def merkle_audit(self, body):
        return self._request("/v1/merkle/audit", body)

    def merkle_verify_proof(self, body):
        return self._request("/v1/merkle/verify-proof", body)

    def attest(self, payload):
        return self._request("/api/attest", {"payload": payload})

    def aggregate_verify(self, items):
        if not isinstance(items, list) or not 1 <= len(items) <= 25:
            raise ValueError("Provide 1 to 25 proofs")
        return self._request("/v1/aggregate/verify", {"items": items})
