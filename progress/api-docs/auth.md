> For the complete documentation index, see [llms.txt](https://docs.nansen.ai/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.nansen.ai/getting-started/authentication.md).

# Authentication

### Overview

The Nansen API uses API key authentication. All requests must include your API key in the `apikey` header, unless you pay per request with [Agentic Payments](/getting-started/agentic-payments.md) (x402 or MPP). The OpenAPI specification lists those payment rails as security alternatives on each eligible operation.

### Getting Your API Key

1. Log in to your [Nansen Account](https://app.nansen.ai/auth/agent-setup)
2. Generate a new API key

### Using Your API Key

#### Header Format

```
apikey: YOUR_API_KEY
```

HTTP header names are case-insensitive, but Nansen docs use lowercase `apikey` as the canonical form.

#### curl Example

```bash
curl -X POST 'https://api.nansen.ai/api/v1/smart-money/holdings' \
  -H 'Content-Type: application/json' \
  -H 'apikey: YOUR_API_KEY' \
  -d '{"chains": ["ethereum"]}'
```

#### Python Example

```python
import httpx

headers = {
    "Content-Type": "application/json",
    "apikey": "YOUR_API_KEY"
}

response = httpx.post(
    "https://api.nansen.ai/api/v1/smart-money/holdings",
    headers=headers,
    json={"chains": ["ethereum"]}
)
```

#### Python with Environment Variable

```python
import os
import httpx

API_KEY = os.environ.get("NANSEN_API_KEY")

headers = {
    "Content-Type": "application/json",
    "apikey": API_KEY
}

response = httpx.post(
    "https://api.nansen.ai/api/v1/smart-money/holdings",
    headers=headers,
    json={"chains": ["ethereum"]}
)
```

### Authentication Errors

Authentication failures handled by the API use the standard error envelope described in [Error Handling](/getting-started/error-handling.md). A key rejected by the gateway is the exception described below.

#### 401 Unauthorized

Returned when the API key is missing, invalid, or revoked. There are two bodies to expect.

A keyless request to an API-key-only endpoint returns the full envelope, with `code` set to `unauthenticated`:

```json
{
  "error": "Unauthorized",
  "message": "API key required. This endpoint does not support paid access.",
  "code": "unauthenticated",
  "status": 401,
  "request_id": "ea100706f73d3b63e4451a38ece4014f",
  "doc_url": "https://docs.nansen.ai/getting-started/error-handling#unauthenticated"
}
```

A key that is present but not recognised is rejected up front, before the request is processed, so that response carries a `message` only and no `code`:

```json
{
  "message": "Invalid API key. Manage your keys at https://app.nansen.ai/api?tab=api"
}
```

Branch on the HTTP status first — a 401 always means authentication failed — and read `code` only when it is present.

Endpoints that accept [Agentic Payments](/getting-started/agentic-payments.md) answer a keyless request with `402 Payment Required` and a payment challenge rather than a 401.

**Solutions:**

* Verify your API key is correct
* Ensure the header name is `apikey` (lowercase)
* Check that the key hasn't been revoked

#### 403 Forbidden

Returned when the API key is valid but not permitted to call the endpoint. The body is the same envelope shown above with `"status": 403`; the `code` field names the specific reason — `forbidden`, `plan_upgrade_required`, or `insufficient_credits`. See [Error Handling](/getting-started/error-handling.md) for what each one means.

**Solutions:**

* Verify your subscription tier includes access to this endpoint
* Contact support to upgrade your plan

### Key Management

If your key is compromised:

1. Immediately revoke it in your dashboard
2. Generate a new key
3. Update all applications using the old key


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.nansen.ai/getting-started/authentication.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
