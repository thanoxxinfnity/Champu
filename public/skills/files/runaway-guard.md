# runaway-guard — $-Cost is the Third Complexity Dimension

Every loop has time complexity and space complexity. A loop that calls a paid API has a third: **dollars per execution**. The model tracks the first two automatically. It does not track the third, so it ships code where a single bug — a retry without bound, a stream reconnect storm, an agent that re-queues itself, a webhook that fires the same job twice — silently spends real money.

The canonical incident: developer writes a Fal.ai image-generation loop. Loop "obviously terminates" because it iterates over a fixed list. The list comes from a callback that fires on every Inngest retry. Each retry doubles the list. By morning, the bill is **$200**. Tests pass. Code review passed. The bug is not in the loop body. The bug is that **no one stated the wallet invariant**.

runaway-guard fixes this. State the max calls. State the max dollars per run. State the max dollars per day. Set the same caps in the provider dashboard so a code bug cannot bypass them. Then write the code.

**Violating the letter of these rules is violating the spirit of the skill.** "I'm only testing locally" is the exact rationalization that ships the $200 bill — local code hits the same paid API as production.

## When to Use This Skill

Use **runaway-guard** when:

- Writing or reviewing code that calls a paid AI / inference API in a loop, queue, retry path, agent step, webhook handler, or background job.
- Importing or wrapping any paid-inference SDK: `@fal-ai/*`, `fal-client`, `@anthropic-ai/sdk`, `anthropic`, `openai`, `replicate`, `elevenlabs`, `together-ai`, `groq-sdk`, `cohere-ai`, `@mistralai/*`.
- Designing an agent loop, fan-out pipeline, retry wrapper, polling job, stream reconnect, or self-rescheduling job that may call a billed endpoint.
- Auditing a codebase / PR for unbounded fan-out, unbounded retries, missing idempotency keys, or missing provider-side spend caps.
- Diagnosing an unexpected bill, runaway loop incident, or surprise overage.

## The Iron Law

```text
NO CALL TO A PAID API WITHOUT A WRITTEN $-CAP AT BOTH THE CODE AND PROVIDER LEVEL
```

A cap only in code can be bypassed by a bug in that code. A cap only at the provider can be hit during normal usage and degrade the product. You need both. If you cannot state both in one sentence each, you have not designed the call site — you have written a wish.

## Non-negotiable rules

1. **Every call site gets a one-line cost contract.** Before writing any paid-API call, state in one sentence:
   - **Max calls per run:** the strict upper bound on invocations in a single execution of this code path.
   - **Max $ per run:** `max_calls × unit_cost` — compute it, don't estimate.
   - **Max $ per day:** the provider-side hard cap that backstops the code-side bound.

   Examples:
   - "Fal flux-pro at $0.05/image; max 20 images per job; max $1 per job; provider Spend Limit $50/day."
   - "Anthropic Sonnet at ~$0.015 per request (cached); max 50 requests per agent run; max $0.75 per run; Workspace Budget hard cap $30/day."

   If you cannot fill in all three numbers, you have not designed the call site.

2. **Every loop calling a paid API gets an explicit iteration bound, not just a termination argument.** `invariant-guard` requires a termination measure. runaway-guard requires the bound to be a **concrete integer in code**, not just "eventually terminates":

   ```ts
   // ❌ Terminates in theory. Bills $200 in practice.
   while (job.status !== 'done') {
     await fal.run(...);
   }

   // ✅ Concrete bound — wallet invariant explicit.
   const MAX_CALLS = 20;
   for (let i = 0; i < MAX_CALLS && job.status !== 'done'; i++) {
     await fal.run(...);
   }
   if (job.status !== 'done') throw new Error('exceeded MAX_CALLS budget');
   ```

3. **Every retry path is bounded by attempts AND total elapsed cost, not by time alone.** Exponential backoff with no attempt cap is a wallet attack on yourself.
   - Max attempts: a small integer (3–5 for transient errors, 1 for 4xx).
   - Cap counts across the whole pipeline, not just one library — Inngest retries × SDK retries × your own retry wrapper multiply.
   - 4xx errors do not retry. Period. They will not become 2xx; they will just bill again.

4. **Every fan-out path declares a concurrency limit.** Parallel calls multiply cost per wall-clock second. State the limit in code, at the queue (Inngest `concurrency`), and at the provider where supported:
   - Inngest: `concurrency: { limit: N }` on the function.
   - BullMQ / Sidekiq / Cloud Tasks: queue-level concurrency.
   - In-process: `p-limit`, semaphore, or batched `Promise.all` chunks — never an unbounded `Promise.all(items.map(...))` on a paid API.

5. **Every paid API has a matching provider-side hard cap, configured out of band.** Defense in depth: if the code is wrong, the provider stops the bleeding. Document the cap in the same file as the call site so future readers know it exists.

   | Provider | Where to set the hard cap |
   |---|---|
   | **Fal.ai** | Dashboard → Billing → **Spend Limit** (e.g. $50/day). Hard stop on exceed. |
   | **Anthropic** | Console → Workspaces → **Workspace Budget** with hard limit. Per-workspace, per-month. |
   | **OpenAI** | Org → Settings → **Usage limits** (org-level hard limit blocks requests). ⚠️ Per-*project* monthly budgets are **soft thresholds only** — they alert but do not block. For a real hard cap use the org-level Usage limit, a billing gateway, or your own fail-closed budget check. |
   | **Replicate** | Account → Billing → **Spend limit**. Per account. |
   | **ElevenLabs** | Workspace → **Usage limits** per workspace / API key. |
   | **Together / Groq / Cohere / Mistral** | Each has a billing dashboard with a monthly spend cap — set it before first deploy, not after. |

   No hard cap, no call site. Set the cap before the first request, not after the first incident.

6. **Idempotency keys on every mutating or charging call.** A webhook that fires twice should bill once. Without an idempotency key, retry policies you cannot see (load balancer, framework, gateway) silently double-charge.

7. **Make the "amplifier" patterns explicit and forbidden by default.** These are the shapes that turn small bugs into large bills:
   - **Self-rescheduling jobs.** A job that re-enqueues itself with no decrementing measure is an unbounded loop with extra steps.
   - **Webhook handlers that call the API that called the webhook.** Cycle detection or it will cycle.
   - **Recursion over LLM output.** "Ask the model what to do next" with no depth cap is a depth-unbounded recursion in dollars.
   - **Polling without a deadline.** `while (!done) await poll()` with no `maxWaitMs` is a wallet leak.
   - **Streaming reconnect storms.** A WebSocket / SSE reconnect with no backoff and no attempt cap can hammer a billed endpoint thousands of times per minute.
   - **Cache-miss stampede on a paid call.** N concurrent requests for the same uncached key → N billed calls. Use `singleflight` / request coalescing.

## The pre-write protocol

Before producing code that calls a paid API, your message must contain — in this order:

1. **Provider + unit cost.** "Fal flux-pro: $0.05/image, billed per success."
2. **Max calls per run.** A literal integer that will appear as a constant in the code.
3. **Max $ per run.** `max_calls × unit_cost`. Compute it.
4. **Max $ per day (provider hard cap).** The dashboard setting that backstops the code.
5. **Concurrency limit.** In code, at the queue, at the provider.
6. **Retry policy.** Max attempts, which error codes retry, idempotency key strategy.
7. **Amplifier audit.** Walk the list in rule 7; declare "none apply" or address each that does.
8. **The code** — with the cost contract in a comment above the call site.
9. **Self-check.** One line: "in the worst case, this code bills $X and the provider cap stops it at $Y."

If any of 1–7 is missing, do not emit code.

## Worked trap — the Inngest + Fal $200 night

This is the canonical case. Observe how each rule would have caught it.

**What shipped:**

```ts
// inngest function: generate images for a campaign
export const generateCampaign = inngest.createFunction(
  { id: 'gen-campaign' },                              // ❌ no concurrency limit
  { event: 'campaign/start' },
  async ({ event, step }) => {
    const prompts = await step.run('fetch', () => fetchPrompts(event.data.id));
    // ❌ unbounded fan-out, no per-run cap, no idempotency
    await Promise.all(prompts.map(p => fal.run('fal-ai/flux-pro', { input: { prompt: p } })));
  }
);
```

**What went wrong.** `fetchPrompts` had a bug: on a transient DB error it returned the partial list *plus the previous run's list appended*. Inngest retried the function at its default retry count (multiple attempts in addition to the initial one). Each retry re-ran `fetchPrompts`, each retry doubled the list (40 → 80 → 160 → 320 prompts). `Promise.all` fanned all 320 out concurrently. At $0.05/image: **$16/retry × triangular growth across overnight retries on the schedule = ~$200 by morning.**

**Why each rule would have caught it.**

| Rule | Catch |
|---|---|
| 1. Cost contract | Forces writing "max calls per run". The number `prompts.length` is not a known integer → rule fails → write a cap. |
| 2. Concrete iteration bound | `Promise.all(prompts.map(...))` has no integer bound → rule fails → wrap in chunks with `MAX_IMAGES_PER_RUN`. |
| 3. Retry policy | Inngest default retries × no idempotency key = double-billed work. Rule forces an idempotency key per `(campaignId, promptHash)`. |
| 4. Concurrency limit | `Promise.all` is unbounded concurrency. Rule forces `p-limit(3)` and Inngest `concurrency: { limit: 3 }`. |
| 5. Provider hard cap | Fal Spend Limit $50/day would have stopped the bleeding at $50 instead of $200. |
| 7. Amplifier audit | "Self-rescheduling jobs" — Inngest's retry IS self-rescheduling. The audit forces you to consider it. |

**The fix that survives the protocol:**

```ts
// cost contract:
//   provider: Fal flux-pro @ $0.05/image
//   max calls per run: 50
//   max $ per run: $2.50
//   provider hard cap: $50/day (set in Fal dashboard 2026-05-22)
//   concurrency: 3 (Inngest + p-limit, matching)
//   idempotency: key = `${campaignId}:${sha1(prompt)}` — provider-side dedup window 24h
const MAX_IMAGES_PER_RUN = 50;
const limit = pLimit(3);

export const generateCampaign = inngest.createFunction(
  {
    id: 'gen-campaign',
    concurrency: { limit: 3 },
    retries: 2,                                        // attempts = 1 + retries
  },
  { event: 'campaign/start' },
  async ({ event, step }) => {
    const prompts = await step.run('fetch', () => fetchPrompts(event.data.id));
    if (prompts.length > MAX_IMAGES_PER_RUN) {
      throw new NonRetriableError(
        `prompt count ${prompts.length} exceeds MAX_IMAGES_PER_RUN=${MAX_IMAGES_PER_RUN}`
      );
    }
    await Promise.all(prompts.map(p => limit(() => step.run(
      `img:${event.data.id}:${sha1(p)}`,               // idempotency key
      () => fal.run('fal-ai/flux-pro', { input: { prompt: p } })
    ))));
  }
);
```

Note: the bug in `fetchPrompts` is still there. The protocol does not fix that bug — it makes the bug **cost $2.50 instead of $200** while you find it. That is the entire point of defense in depth.

## Common runaway patterns and their wallet invariants

| Pattern | Wallet invariant to write | Hard cap to set |
|---|---|---|
| Fan-out over a list of items | `total_cost ≤ list_len × unit_cost ≤ MAX_$_PER_RUN` | provider daily spend limit |
| Retry on transient error | `total_cost ≤ attempts × unit_cost`, attempts ≤ 5 | provider daily spend limit; alert at 50% |
| Agent loop ("ask model what to do next") | `total_cost ≤ MAX_STEPS × per_step_cost`, depth ≤ MAX_DEPTH | per-agent-run cost ceiling, kill-switch |
| Polling for job completion | `total_cost ≤ ceil(MAX_WAIT_MS / poll_interval) × poll_cost` | absolute deadline + alert |
| Webhook handler

…(the rest of this skill is left out)