# NoTrack as an API (the official one)

notrack.ai already publishes an OpenAI-compatible API (docs: https://notrack.ai/api/docs). Use that. Do NOT build a wrapper around the chat page: `https://notrack.ai/chat` answers "Automated access is not allowed on this endpoint", and `/api/` is closed to crawlers in robots.txt except the docs page. Scraping the chat page would break their rules and fail anyway.

## Facts from the docs (read them again before relying on a number)
- Base URL `https://api.notrack.ai/v1` · header `Authorization: Bearer sk-notrack-…` · endpoints `GET /v1/models`, `POST /v1/chat/completions` (streaming with `"stream": true`, tools and `response_format: json_object` supported; text only, no images).
- One model: `notrack-uncensored` (any model name sent is routed to it). Context window 100,000 tokens.
- A key is created by the user on notrack.ai/api-keys (needs a confirmed e-mail); the first key has $0.50 free credit for 7 days. After that it is prepaid: $0.15 per 1M input tokens, $0.50 per 1M output tokens, no subscription.
- Limits: trial key 2 concurrent / 60 per minute; topped-up key 8 concurrent / 300 per minute. 429 → back off using the `X-RateLimit-*` headers; 402 `no_credit` → top up; 502/503 are not billed, retry with backoff.
- It is an uncensored model for adults, with a child-safety filter that refuses and ends such requests. Do not try to work around it.

## Put it in Chomugiri (works on a phone)
1. The user opens notrack.ai/api-keys, creates a key (you never create it for them and never ask them to paste it into a file; they type it in the app).
2. Chomugiri → Settings → Custom Endpoints → add: Base URL `https://api.notrack.ai/v1`, Auth `Authorization: Bearer <key>`, model `notrack-uncensored`. The app probes `/models` itself.
3. Test: say "hi" in a chat that uses it. If it answers 401, the key is wrong or expired; 402, no credit.
4. Set a daily cap on the key (keys page) so a leaked key cannot drain the account.

## From code
```sh
curl https://api.notrack.ai/v1/chat/completions -H "Authorization: Bearer $NOTRACK_KEY" -H "Content-Type: application/json" \
  -d '{"model":"notrack-uncensored","messages":[{"role":"user","content":"hello"}],"max_tokens":200}'
```
Keep the key in an environment variable, never in a repository or a chat message.

## Rules
- Only the official API. If a user insists on the web chat, say what its rules are and offer the API instead.
- Say honestly that it is paid after the trial credit, with the prices above, and that the user must create the key.