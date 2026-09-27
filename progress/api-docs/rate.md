> For the complete documentation index, see [llms.txt](https://docs.nansen.ai/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.nansen.ai/getting-started/rate-limits.md).

# Rate Limits

### Overview

The Nansen API applies rate limits per API key. Limits vary by subscription tier and are measured over both short and sustained windows.

### Plan limits

| Plan                 |  Per second |     Per minute |
| -------------------- | ----------: | -------------: |
| Free                 | 15 requests |   300 requests |
| Pro (all paid plans) | 75 requests | 1,500 requests |

### Per-endpoint limits

These endpoints have an additional per-minute limit for both Free and Pro plans:

| Endpoint                            |              Limit |
| ----------------------------------- | -----------------: |
| `GET /api/v1/search/token-sectors`  | 60 requests/minute |
| `POST /api/v1/tgm/perp-trades`      | 60 requests/minute |
| `POST /api/v1/profiler/perp-trades` |  5 requests/minute |
| `POST /api/v1/search/web-search`    | 15 requests/minute |
| `POST /api/v1/search/web-fetch`     | 15 requests/minute |

### Rate-limit response headers

Responses may include two layers of rate-limit headers:

* `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`, together with `X-RateLimit-Limit-Second`, `X-RateLimit-Remaining-Second`, `X-RateLimit-Limit-Minute`, and `X-RateLimit-Remaining-Minute`, describe overall limits.
* Bare `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` describe the most constrained app-enforced window, which may be plan-wide or endpoint-specific.
* Enforced `429` responses include `X-Nansen-RateLimit-Scope`. Its current values are `second` for a global per-second window, `minute` for a global per-minute window, and `endpoint` for an endpoint-specific window. Treat these values as an open set: do not reject unknown future values; use the generic `429` behavior and honor `Retry-After`.

When both layers are present, self-throttle using the smaller of `RateLimit-Remaining` and `X-RateLimit-Remaining`. If the API returns a **429 Too Many Requests** response, honor `Retry-After` before retrying.

### Exceeding rate limits

If you exceed a limit, the API returns a **429 Too Many Requests** response.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.nansen.ai/getting-started/rate-limits.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
