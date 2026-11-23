# OpenAI-compatible endpoint

Mirrai can answer as an OpenAI model. Point any OpenAI client at this app
and a persona answers with its own voice, its own memories and the same
safety rules the chat page uses.

The endpoint has **no keys until you create one**, so it does nothing at
all by default. Create one in **设置 → AI → OpenAI 兼容端点**, copy it
(the key is shown once), and revoke it there when you are done.

## Connecting

```bash
export OPENAI_BASE_URL="http://localhost:3000/v1"
export OPENAI_API_KEY="mk_…"          # the key, not an OpenAI key
```

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="mk_…")
reply = client.chat.completions.create(
    model="persona-1",                 # see GET /v1/models
    messages=[{"role": "user", "content": "在吗"}],
)
print(reply.choices[0].message.content)
```

`GET /v1/models` lists the personas of the key's owner as
`persona-<id>`. `POST /v1/chat/completions` accepts `model`,
`messages` and `stream`. Anything else in the body is ignored.

## What is different from OpenAI

These are deliberate, and they are the reason the endpoint is safe to
expose to a local client:

- **The conversation lives here.** Only the *last* user turn of
  `messages` is used. Earlier messages and every `system` message are
  ignored — otherwise any client could rewrite the persona's rules or
  bypass the safety layer. A burst of consecutive user messages is joined
  with newlines and treated as one message.
- **The answer is one message.** No typing delay, no split messages, no
  stickers or photographs. The reply comes from the same pipeline as the
  chat page, so the crisis path, the daily care note, the persona's
  memories, the taper, the seal and the sleep state all apply. A sealed,
  tapered or asleep persona answers with its explanation instead of
  ignoring you.
- **`scopes`.** A `chat` key may talk to a persona; a `read` key is for
  the read-only MCP server (`docs/mcp.md`). A key without `chat` gets
  `403` on this endpoint.
- **No CORS headers.** The endpoint is for clients on this machine or on
  the same deployment, not for a random web page.
- **`usage` is zero.** The endpoint does not report the provider's token
  counts; the app's own cost panel has the real numbers.
- **A cookie is not a credential.** Only `Authorization: Bearer mk_…` is
  accepted. The app lock does not cover this endpoint: the key itself is
  the credential.
- **Encrypted accounts.** If the account's data key is not in this
  process (after a restart, before the owner unlocks), the endpoint
  answers `423` with an explanation instead of ciphertext.

## Turning it off

`OPENAI_COMPAT_ENABLED=false` makes both routes answer `404`. With no key
created the endpoint is already unusable; this switch is a second lock for
an operator who wants it gone completely.

## Errors

Errors are OpenAI's shape:

```json
{ "error": { "message": "…", "type": "invalid_request_error", "param": null, "code": "invalid_api_key" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `message_too_long`, `invalid_request` | the one user message is missing or longer than 2000 characters |
| 401 | `invalid_api_key` | no key, a malformed key, an unknown key, a revoked key |
| 403 | `insufficient_scope`, `persona_locked` | a `read`-only key on the chat route, or a persona with the per-persona lock on |
| 404 | `model_not_found`, `endpoint_disabled` | the model is not `persona-<id>` / the persona is not this account's / the endpoint is switched off |
| 423 | `encryption_locked` | the account is encrypted and locked in this process |
| 429 | `rate_limit_exceeded` | the per-account LLM rate limit |

## Security notes

- The key is shown once. The database keeps only `sha256(key)` and the
  first 12 characters.
- Keys are per account and are deleted with the account. Revoking one is
  immediate.
- The endpoint is registered before the `/api` CSRF guard on purpose: a
  Bearer token is not a cookie, so a cross-site request cannot carry it
  by accident.
