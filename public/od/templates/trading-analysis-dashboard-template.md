# Trading Analysis Dashboard Template

Produce a premium, data-dense, Wall-Street style trading dashboard as a self-contained HTML artifact.

## Resource map

```text
trading-analysis-dashboard-template/
├── SKILL.md
├── assets/
│   └── template.html
├── references/
│   └── checklist.md
└── example.html
```

## Workflow

1. Read active `DESIGN.md`, then map typography/color/layout into CSS variables.
2. Copy `assets/template.html` to `index.html`.
3. Personalize headings, instrument names, and numeric labels to the user brief.
4. Preserve interaction fidelity:
   - Light/Dark mode switch
   - Live/Demo mode
   - Chart hover crosshair and tooltip
   - Click-to-focus chart (floating modal style)
   - Keyboard command palette (`/`)
5. Keep output single-file HTML (inline CSS + inline JS, no framework dependency).
6. Keep placeholders honest (`—` or neutral labels) where real numbers are unknown.
7. Validate against `references/checklist.md` before emitting.

## Output contract

One sentence before artifact, then:

```xml
<artifact identifier="trading-analysis-dashboard" type="text/html" title="Trading Analysis Dashboard">
<!doctype html>
<html>...</html>
</artifact>
```