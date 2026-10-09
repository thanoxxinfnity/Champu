# Cloud and Observability Planning

**What it is:** the plan for what the business runs on, what it watches, what wakes
someone up, and what that costs - written before any of it is bought.

## Overview

Works out the smallest monitoring plan that would actually catch this business's worst
failure, then builds it only when asked. The default output is a short recommendation, not
a service register. The register - CSV, SQL DDL, JSON Schema, Notion mapping - is produced
on request, from one field list so the four cannot drift apart.

Layer: Layer 8: Operate. Fits: Growth stage. Table code: n/a.

**The rule this table exists to enforce:** an alert is a human cost, so `Alert Channel` and
`Severity` decide whether a person is woken at 3am. Everything else in this table exists to
make that decision possible: what the service does (`SLI Definition`), what good looks like
(`SLO Target`), what is measured (`Dashboard URL`), what it costs (`Monthly Cost Estimate`),
and - the field most tables leave out - what happens when the alert fires (`Runbook URL`).
An alert with no runbook converts a technical problem into a panicked one.

**The second rule:** `Phase` is the field that keeps this affordable. A ten-service stack
with four signals each, on a plan tier, ordered by what would hurt the business most. A
business with no developer should be running a managed platform and three alerts, not a
stack of collectors.

## When to Use This Skill

- monitoring, observability, alerting, uptime, "we found out from a customer"
- SLI, SLO, error rate, latency, p95, p99
- "what should we watch", "how do we know the site is down"
- incident response, on-call, runbook, postmortem
- cloud cost, what is it costing, what should we turn off
- "which service should we use", VPS, containers, serverless, managed hosting
- incident readiness, status page, downtime prevention

Do not use it for: application code, infrastructure as code, or a deployment pipeline
(`devops-pipeline-designer`, `ci-cd-pipeline-builder` in the engineering pack); a security
architecture review (`security-and-privacy`); or a real incident, which is a live
situation, not a plan.

## How It Works

Follow the shared execution contract. The module-specific rules below define only domain fields, decisions, calculations, and safety constraints.

### Step 1 - Identify intent

Read the request and pick the intent before asking anything.

- "plan" / "set up" / "we need" -> artifacts wanted; go to Step 2.
- "the site is down" / "is it down" / "we are down" -> an incident, right now. Confirm the
  user-facing failure first and point at the runbook; do not build anything.
- "what does this cost" / "review" / "audit" -> a review, not a build.
- "should we use" -> a decision question; answer with trade-offs, then offer the register.

Ask only if this is the highest-value missing fact; otherwise proceed without an opener:

> **Q:** What breaks for the business if the site or app is down for one hour, and who
> would notice first - a customer, a member of staff, or an automated system?

### Step 2 - Ask only what is missing

Treat ambiguous replies as unanswered and ask which explicit option the user means. Record unknown values as `Unknown`; `Unknown` is not zero. A record must not be `Done` when a required check fails.

Skip anything already answered. Ask the rest one at a time, and stop as soon as the
remaining answers would not change the plan.

- **Failure** - What is the business-critical thing - the website, the booking form, the
  till, email, the file uploads? / What is the worst realistic failure - down, slow, wrong
  data, or an email that silently stops arriving? / How long is a customer willing to wait
  before they complain, and how long before they leave?
- **Stack** - What is actually running today - shared hosting, a VPS, a managed platform, a
  SaaS tool, containers? / Who set it up, and is that person still available? / Is there a
  repository, and who can deploy?
- **Traffic** - Roughly how many visitors, orders or jobs a day? / Any seasonal or campaign
  peaks that change it by an order of magnitude? / Are there peak periods where being slow
  is worse than being down?
- **People** - Is there anyone who can be on call, and at what hours? / Does someone already
  use a tool the business pays for? / Who is allowed to restart something at 3am?
- **Data and money** - What must not be lost, and what is the acceptable recovery point? /
  What is the current monthly spend, roughly, and the budget ceiling? / Does anything
  process a payment, personal data, or health data?

Never invent an answer. Traffic numbers, costs, hostnames, provider names, service
identifiers, error rates, uptime figures and recovery times the user has not supplied are
`Unknown`. A monitoring plan built on invented traffic or invented spend is worthless, and
invented SLOs are worse - they create an alert nobody can satisfy.

### Step 3 - Hold the internal context

```yaml
module: observability-cloud-planning
intent: null            # set up | review | report | import
scale: null             # Starter | Growth | Scale, only if the answer changes it
areas:
  "Failure": null
  "Stack": null
  "Traffic": null
  "People": null
  "Data and money": null
requested_outputs: []
confirmed_facts: []
open_questions: []
```

### Step 4 - Recommend the smallest workflow

Build an already requested artifact without asking again. For advice-only requests, give a short recommendation and offer the relevant artifact.

**Recommended approach:** Start with the one thing whose failure stops the business earning -
usually the checkout or the booking form - and watch exactly that from outside the
infrastructure, so the check does not fail with the thing it is checking. Three signals and
no more: is it reachable, is it answering within a target time, and is the thing that
transacts money or data actually succeeding. One alert channel that reaches a human, a
runbook for each alert, and a named owner. Everything else - traces, log aggregation, five
custom dashboards, a status page - goes in a later phase once the first phase has proven
someone reads it.

**Why this one:** The failure mode of observability is not too little monitoring, it is too
much of the wrong. A business that installs fifteen alerts stops reading them within a
week and returns to finding out from customers. And external monitoring matters more than
internal: an uptime check that runs on the same box as the site reports the site is fine
right up to the moment it is not.

**Workflow:** Worst failure named → What must be measured to catch it, from outside →
Baseline measured, not assumed → Three signals defined with targets → Alerts with a channel
and a runbook each → Costs estimated against a ceiling → Owner and review date set →
Runbook rehearsed → Phase 2 only after phase 1 is being read → Quarterly review of alerts
kept, deleted and added

### Step 5 - Build only on request

Once the user asks for it, derive the fields from the confirmed context and emit the
requested artifacts. For machine-readable text, keep prose outside the data; for files,
provide a usable link. Report material validation failures or limitations separately.

**A selected Notion output is rendered by `notion-manual-import`, so route the
Notion step there.** When the user selects Notion, hand that step to
](https://github.com/sickn33/agentic-awesome-skills/blob/main/skills/notion-manual-import/SKILL.md): it holds the CSV, the property
mapping, the import steps and the verification checklist, and it renders the Field
Reference below instead of defining a table of its own. Do not restate the mapping
here and do not improvise the import steps. Manual CSV and mapping outputs need no
connection. For requested workspace changes, follow the shared contract: verify actual
tool access and the target before writing. A user saying "connected" is not tool evidence.
Never ask for a Notion password or token.

```csv
Service ID,Service Name,Purpose,Criticality,Owner,Environment,Monitored From,SLI Definition,SLO Target,Dashboard URL,Log Source,Alert Channel,Severity,Alert Threshold,Runbook URL,Escalation Path,Monthly Cost Estimate,Data Handled,Deployment Method,Dependencies,Phase,Review Date,Status,Notes
,Example Booking Service,Takes customer bookings and confirms by email,High,Example Owner,Production,External region outside the hosting provider,Uptime of the public booking page,99.5% monthly,Not yet created,Application and web server logs,Email and SMS to on-call,Critical,3 consecutive failed checks or 5 minutes above target,Not yet created,On-call then business owner,Unknown,Payment card details,Managed platform,None,1,2026-10-27,Not started,Example row - replace every value before use.
```

```sql
-- Engine assumption: PostgreSQL. For another engine use the engine's auto-increment
-- equivalent and keep the rest portable.
CREATE TABLE obs_service (
  service_id BIGINT PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  purpose TEXT NOT NULL,
  criticality VARCHAR(50) NOT NULL,
  owner VARCHAR(255) NOT NULL,
  environment VARCHAR(50) NOT NULL,
  monitored_from VARCHAR(100) NOT NULL,
  sli_definition TEXT NOT NULL,
  slo_target VARCHAR(50) NOT NULL,
  dashboard_url VARCHAR(255),
  log_source VARCHAR(255) NOT NULL,
  alert_channel VARCHAR(255) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  alert_threshold VARCHAR(255) NOT NULL,
  runbook_url VARCHAR(255),
  escalation_path TEXT,
  monthly_cost_estimate NUMERIC(10,2),
  data_handled VARCHAR(255) NOT NULL,
  deployment_method VARCHAR(100) NOT NULL,
  dependencies TEXT,
  phase VARCHAR(50) NOT NULL,
  review_date DATE,
  status VARCHAR(50) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT obs_service_phase CHECK (phase IN ('1 - core','2 - deepen','3 - optional','Sunset')),
  CONSTRAINT obs_service_status CHECK (status IN ('Not started','In progress','Blocked','Done','Cancelled')),
  CONSTRAINT obs_service_severity CHECK (severity IN ('Info','Warning','Critical')),
  CONSTRAINT obs_service_criticality CHECK (criticality IN ('Low','Medium','High','Critical')),
  CONSTRAINT obs_service_cost_non_negative CHECK (monthly_cost_estimate IS NULL OR monthly_cost_estimate >= 0)
);

CREATE INDEX idx_obs_service_status ON obs_service (status);
CREATE INDEX idx_obs_service_phase ON obs_service (phase);
CREATE INDEX idx_obs_service_review ON obs_service (review_date);
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Cloud and Observability Plan",
  "type": "object",
  "additionalProperties": false,
  "properties": {
      "Service ID": { "type": "integer" },
      "Service Name": { "type": "string" },
      "Purpose": { "type": "string" },
      "Criticality": { "type": "string" },
      "Owner": { "type": "string" },
      "Environment": { "type": "string" },
      "Monitored From": { "type": "string" },
      "SLI Definition": { "type": "string" },
      "SLO Target": { "type": "string" },
      "Dashboard URL": { "type": "string" },
      "Log Source": { "type": "string" },
      "Alert Channel": { "type": "string" },
      "Severity": { "type": "string" },
      "Alert Threshold": { "type": "string" },
      "Runbook URL": { "type": "string" },
      "Escalation Path": { "type": "string" },
      "Monthly Cost Estimate": { "type": "number" },
      "Data Handled": { "type": "string" },
      "Deployment Method": { "type": "string" },
      "Dependencies": { "type": "string" },
      "Phase": { "type": "string" },
      "Review Date": { "type": "string", "format": "date" },
      "Status": { "type": "string" },
      "Notes": { "type": "string" }
  },
  "required": [
      "Service Name",
      "Purpose",
      "Criticality",
      "Owner",
      "Environment",
      "Monitored From",
      "SLI Definition",
      "SLO Target",
      "Log Source",
      "Alert Channel",
      "Severity",
      "Alert Threshold",
      "Data

…(the rest of this skill is left out)