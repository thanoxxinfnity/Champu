# Application Insights JavaScript SDK (Web) for TypeScript
## When to Use

Use this skill when you need instrument browser/web apps with the Application Insights JavaScript SDK (@microsoft/applicationinsights-web). Use for Real User Monitoring (RUM) — page views, clicks, AJAX/fetch dependencies, exceptions, custom events, and browser-side GenAI agent traces correlated to backend...


Real User Monitoring (RUM) for browser apps with `@microsoft/applicationinsights-web`. Auto-collects page views, AJAX/fetch dependencies, unhandled exceptions, and (with the Click Analytics plugin) clicks. Supports custom events, metrics, and **GenAI agent traces** that follow OpenTelemetry GenAI semantic conventions and correlate to backend spans via W3C Trace Context.

> **Distinct from `azure-monitor-opentelemetry-ts`**, which is for Node.js server apps. This skill is for **browser/web** code (and React Native).

## Before Implementation

Search `microsoft-docs` MCP for current API patterns:

- Query: "Application Insights JavaScript SDK setup"
- Query: "Application Insights JavaScript SDK configuration"
- Query: "Application Insights JavaScript framework extensions React Angular"
- Verify package version: `npm view @microsoft/applicationinsights-web version`

## Packages

| Package | Purpose |
| --- | --- |
| `@microsoft/applicationinsights-web` | Core RUM SDK (page views, AJAX, exceptions). |
| `@microsoft/applicationinsights-clickanalytics-js` | Auto-collect click telemetry. |
| `@microsoft/applicationinsights-react-js` | React plugin (router instrumentation, hooks, HOC, ErrorBoundary). |
| `@microsoft/applicationinsights-react-native` | React Native plugin (native crashes, sessions). |
| `@microsoft/applicationinsights-angularplugin-js` | Angular plugin (router events, ErrorHandler). |
| `@microsoft/applicationinsights-debugplugin-js` | Dev-only telemetry inspector. |
| `@microsoft/applicationinsights-perfmarkmeasure-js` | User Timing (`performance.mark/measure`) integration. |

## Installation

```bash
npm i --save @microsoft/applicationinsights-web
# Optional plugins (install only what you use):
npm i --save @microsoft/applicationinsights-clickanalytics-js
npm i --save @microsoft/applicationinsights-react-js @microsoft/applicationinsights-react-native @microsoft/applicationinsights-angularplugin-js
```

Typings ship with the package — no separate `@types/...` install needed.

## Connection String

The browser SDK requires a connection string at init time. **It ships in plaintext to clients** — Microsoft Entra ID auth is not supported for browser telemetry. Use a separate App Insights resource with local auth enabled for browser RUM if you need to isolate it from backend telemetry.

```bash
# Vite / CRA / Next.js — expose to client via the public env prefix
VITE_APPINSIGHTS_CONNECTION_STRING="InstrumentationKey=...;IngestionEndpoint=https://...;LiveEndpoint=https://..."
NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING="InstrumentationKey=..."
```

## Quick Start (npm)

```typescript
import { ApplicationInsights } from "@microsoft/applicationinsights-web";

export const appInsights = new ApplicationInsights({
  config: {
    connectionString: import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING,
    enableAutoRouteTracking: true,        // SPA route changes -> page views
    enableCorsCorrelation: true,          // propagate Request-Id / traceparent to cross-origin AJAX
    enableRequestHeaderTracking: true,
    enableResponseHeaderTracking: true,
    distributedTracingMode: 2,            // DistributedTracingModes.AI_AND_W3C — emit traceparent for backend correlation
    autoTrackPageVisitTime: true,
    disableFetchTracking: false,          // fetch() is auto-instrumented by default
    excludeRequestFromAutoTrackingPatterns: [/livemetrics\.azure\.com/i]
  }
});

appInsights.loadAppInsights();
appInsights.trackPageView();
```

Call `loadAppInsights()` exactly once, as early as possible (before user interactions you want tracked). Then `trackPageView()` for the initial load — when `enableAutoRouteTracking` is on, subsequent route changes are automatic.

## Quick Start (SDK Loader Script)

Recommended when you want auto-updating SDK and zero build pipeline. Paste this as the **first** `<script>` in `<head>`:

```html
<script type="text/javascript" src="https://js.monitor.azure.com/scripts/b/ai.3.gbl.min.js" crossorigin="anonymous"></script>
<script type="text/javascript">
  var appInsights = window.appInsights || function (cfg) {
    /* See: https://learn.microsoft.com/azure/azure-monitor/app/javascript-sdk
       Use the latest snippet from the Microsoft Learn page above — it includes
       backup-CDN failover (cr), SDK-load-failure reporting, and the queue shim
       so calls before SDK ready are not lost. */
  }({ src: "https://js.monitor.azure.com/scripts/b/ai.3.gbl.min.js",
      crossOrigin: "anonymous",
      cfg: { connectionString: "YOUR_CONNECTION_STRING" } });
</script>
```

Loader-only API (queued until SDK loads): `trackEvent`, `trackPageView`, `trackException`, `trackTrace`, `trackDependencyData`, `trackMetric`, `trackPageViewPerformance`, `startTrackPage`, `stopTrackPage`, `startTrackEvent`, `stopTrackEvent`, `addTelemetryInitializer`, `setAuthenticatedUserContext`, `clearAuthenticatedUserContext`, `flush`.

## Core Tracking APIs

```typescript
// Page views (SPAs that disable enableAutoRouteTracking)
appInsights.trackPageView({ name: "Checkout", uri: "/checkout", properties: { cartSize: 3 } });

// Custom events (user actions, business events)
appInsights.trackEvent({ name: "PurchaseCompleted" }, { orderId: "ord_123", amountUsd: 49.95 });

// Exceptions (caught errors)
try {
  await pay(order);
} catch (err) {
  appInsights.trackException({ exception: err as Error, severityLevel: 3, properties: { orderId: order.id } });
}

// Traces (logs, severity 0=Verbose, 1=Info, 2=Warning, 3=Error, 4=Critical)
appInsights.trackTrace({ message: "Cart hydrated from local storage", severityLevel: 1 });

// Custom metrics (numeric)
appInsights.trackMetric({ name: "checkout.duration_ms", average: 1234 });

// Dependencies (manually-tracked outbound calls — fetch/XHR are auto-tracked)
appInsights.trackDependencyData({
  id: crypto.randomUUID(),
  name: "GET /api/orders",
  duration: 87, success: true, responseCode: 200,
  data: "https://api.example.com/api/orders", target: "api.example.com", type: "Fetch"
});

// User identity (set ONCE per authenticated session — values are PII; do not pass emails)
appInsights.setAuthenticatedUserContext("user-id-123", "tenant-456", /*storeInCookie*/ true);
appInsights.clearAuthenticatedUserContext(); // on logout

// Force send before unload
appInsights.flush();
```

## Telemetry Initializers (enrichment & filtering)

Run for every envelope before send. Return `false` to drop.

```typescript
import type { ITelemetryItem } from "@microsoft/applicationinsights-web";

appInsights.addTelemetryInitializer((item: ITelemetryItem) => {
  item.tags ??= {};
  item.tags["ai.cloud.role"] = "web-shop";
  item.tags["ai.cloud.roleInstance"] = window.location.hostname;
  item.data ??= {};
  item.data["app.version"] = import.meta.env.VITE_APP_VERSION;
  item.data["app.build"] = import.meta.env.VITE_BUILD_SHA;

  // Drop noisy health-check page views
  if (item.baseType === "PageviewData" && item.baseData?.uri?.endsWith("/healthz")) return false;

  // Scrub query-string secrets
  if (item.baseData?.uri) {
    item.baseData.uri = item.baseData.uri.replace(/([?&](https://github.com/microsoft/skills/tree/main/.github/plugins/azure-sdk-typescript/skills/applicationinsights-web-ts/token|sig|key)=)[^&]+/gi, "$1REDACTED");
  }
});
```

## Click Analytics

```typescript
import { ClickAnalyticsPlugin } from "@microsoft/applicationinsights-clickanalytics-js";

const clickPlugin = new ClickAnalyticsPlugin();
const appInsights = new ApplicationInsights({
  config: {
    connectionString: import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING,
    extensions: [clickPlugin],
    extensionConfig: {
      [clickPlugin.identifier]: {
        autoCapture: true,
        dataTags: { useDefaultContentNameOrId: true, customDataPrefix: "data-ai-" },
        urlCollectHash: false,
        behaviorValidator: (b: string) => /^[a-z0-9_]+$/.test(b) ? b : ""
      }
    }
  }
});
appInsights.loadAppInsights();
```

Mark elements with `data-ai-*` attributes; clicks are emitted as Custom Events with parent-content metadata.

## SPA Route Tracking

- **Built-in:** set `enableAutoRouteTracking: true`. Hooks `history.pushState/replaceState` and `popstate`.
- **React Router:** use `@microsoft/applicationinsights-react-js` `withAITracking` HOC (see [references/framework-extensions.md](https://github.com/microsoft/skills/tree/main/.github/plugins/azure-sdk-typescript/skills/applicationinsights-web-ts/references/framework-extensions.md)).
- **Manual:** call `appInsights.trackPageView({ name, uri })` in your router's `useEffect` on route change. Disable `enableAutoRouteTracking` to avoid double counting.

## Distributed Tracing (correlate to backend)

Set `distributedTracingMode: 2` (`DistributedTracingModes.AI_AND_W3C`). The SDK adds `traceparent` (and legacy `Request-Id`) to outbound `fetch`/`XHR`. Backends instrumented with **OpenTelemetry** (e.g. `@azure/monitor-opentelemetry`) auto-link to the browser's operation_Id.

For cross-origin calls, also set `enableCorsCorrelation: true` and add the calling origin to the **CORS exposed headers** on the API.

## GenAI Agent Traces (OTel semantic conventions)

When the browser invokes an AI agent (function-calling, tool-use, model calls direct from the client), emit App Insights **Dependency** telemetry whose attributes follow the OpenTelemetry **GenAI semantic conventions** so they are queryable alongside backend agent spans in App Insights / Log Analytics.

**Set the opt-in env first** so backend instrumentations agree on the same schema version:

```bash
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
```

### Required attribute keys (use the OTel names verbatim)

| Span / op | Required attributes |
| --- | --- |
| `invoke_agent {agent.name}` | `gen_ai.operation.name=invoke_agent`, `gen_ai.provider.name`, `gen_ai.agent.name`, `gen_ai.agent.id` (when known) |
| `create_agent {agent.name}` | `gen_ai.operation.name=create_agent`, `gen_ai.provider.name`, `gen_ai.agent.name`, `gen_ai.request.model` |
| `chat {model}` | `gen_ai.operation.name=chat`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` |
| `execute_tool {tool.name}` | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.type` (`function` \| `extension` \| `datastore`), `gen_ai.tool.call.id` |

`gen_ai.provider.name` well-known values: `openai`, `azure.ai.openai`, `azure.ai.inference`, `anthropic`, `aws.bedrock`, `gcp.gemini`, `gcp.vertex_ai`, `cohere`, `mistral_ai`, `groq`, `deepseek`, `perplexity`, `x_ai`, `ibm.watsonx.ai`.

> **Sensitive content opt-in.** `gen_ai.system_instructions`, `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` are **Opt-In** by default. Gate them behind a runtime flag and avoid them in production unless you have approved data handling.

### Pattern: invoke_agent + nested tool/model spans

```typescript
import { ApplicationInsights, SeverityLevel } from "@microsoft/applicationinsights-web";

type GenAiAttrs = Record<string, string | number | boolean | undefined>;

function startGenAiSpan(name: string, attrs: GenAiAttrs) {
  const id = crypto.randomUUID();
  const start = performance.now();
  const baseProps: GenAiAttrs = { "gen_ai.span.id": id, ...attrs };
  return {
    end(success: boolean, extra: GenAiAttrs = {}, error?: Error) {
      const duration = Math.round(performance.now() - start);
      const properties = { ...baseProps, ...extra };
      appInsights.trackDependencyData({
        id, name, duration, success,
   

…(the rest of this skill is left out)