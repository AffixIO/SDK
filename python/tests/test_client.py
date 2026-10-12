import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from affixio_client import AffixClient, _NoRedirect


class ClientTests(unittest.TestCase):
    def test_https_origin_only(self):
        for url in ["http://api.test", "https://user:pass@api.test", "https://api.test/path", "https://api.test/?secret=x"]:
            with self.assertRaises(ValueError):
                AffixClient("test-key", url)

    def test_exact_verify_route_and_key_in_header(self):
        client = AffixClient("test-key")
        client._opener = Mock()
        client._opener.open.return_value = io.BytesIO(b'{"ok":true}')
        self.assertEqual(client.verify("a/b", {"proof": "proof-data"}), {"ok": True})
        request = client._opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.affix-io.com/v1/circuits/a%2Fb/verify")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(json.loads(request.data), {"proof": "proof-data"})

    def test_no_redirect(self):
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.test"))

    def test_api_shapes(self):
        client = AffixClient("test-key")
        client._request = Mock(return_value={})
        client.attest({"decision": "yes"})
        client._request.assert_called_with("/api/attest", {"payload": {"decision": "yes"}})
        client.auth_check()
        client._request.assert_called_with("/v1/auth/check")
        with self.assertRaises(ValueError):
            client.aggregate_verify([])


if __name__ == "__main__":
    unittest.main()
