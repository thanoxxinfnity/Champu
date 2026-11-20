#!/usr/bin/env python3
"""Run the shell steps of a generated GitHub workflow on this machine, in order.

The CI check uses it to prove that the workflow Chomugiri pushes really builds an APK: the setup actions (java, flutter,
gradle) come from the CI job around it, and every `run:` step of the generated file is executed as written. The release
step is skipped (it needs a GitHub release), and GitHub expressions are given fixed values.

    python3 scripts/run-generated-workflow.py <workflow.yml> <project-dir>
"""
import re
import subprocess
import sys

import yaml

workflow, project = sys.argv[1], sys.argv[2]
doc = yaml.safe_load(open(workflow))
(job,) = doc["jobs"].values()
values = {"github.run_number": "7", "github.sha": "0" * 40, "github.ref": "refs/heads/main", "github.token": "unused"}


def expand(text):
    return re.sub(r"\$\{\{\s*([\w.]+)\s*\}\}", lambda m: values.get(m.group(1), ""), text)


ran = 0
for step in job["steps"]:
    run = step.get("run")
    name = step.get("name") or (run or step.get("uses", "")).splitlines()[0][:60]
    if not run:
        print(f"-- provided by the job around this: {name}")
        continue
    if "gh release create" in run:
        print(f"-- skipped (needs a release): {name}")
        continue
    print(f"== {name}", flush=True)
    subprocess.run(["bash", "-eo", "pipefail", "-c", expand(run)], cwd=project, check=True)
    ran += 1
print(f"ran {ran} steps")
