# Steam HTTP fixtures

These fixtures are synthetic, minimal representations of documented Steam
response shapes. They contain no API keys, account identifiers, cookies,
authorization headers, request URLs, or captured personal data.

Before adding or refreshing a fixture:

1. Replace SteamID64 values, vanity names, and user-authored text with synthetic
   values.
2. Remove credentials, headers, full URLs, timestamps, and unrelated fields.
3. Keep only fields required by the contract under test.
4. Review the staged fixture for key-like strings before committing it.

The default contract suite automatically rejects credential fields,
authorization or cookie headers, SteamID64 values, URLs, and email addresses.
Live probe responses are never written to this directory automatically.

`malformed-response.txt` intentionally contains invalid JSON and therefore uses
a text extension so formatters do not attempt to parse it.
