## When to Use

Use this skill when you need hugging Face Hub CLI (`hf`) for downloading, uploading, and managing models, datasets, spaces, buckets, repos, papers, jobs, and more on the Hugging Face Hub. Use when: handling authentication; managing local cache; managing Hugging Face Buckets; running or scheduling jobs on Hugging...

Install by downloading the installer script first, reviewing it, and then running it locally:
`tmpdir="$(mktemp -d)" && trap 'rm -rf "$tmpdir"' EXIT && curl -LsSf https://hf.co/cli/install.sh -o "$tmpdir/hf-install.sh" && less "$tmpdir/hf-install.sh" && bash "$tmpdir/hf-install.sh"`

The Hugging Face Hub CLI tool `hf` is available. IMPORTANT: The `hf` command replaces the deprecated `huggingface-cli` command.

Use `hf --help` to view available functions. Note that auth commands are now all under `hf auth` e.g. `hf auth whoami`.

Generated with `huggingface_hub v1.21.0`. Run `hf skills add --force` to regenerate.

## Commands

- `hf cp SRC` — Copy files between local paths, repositories, and buckets. `[--format [auto|human|agent|json|quiet]]`
- `hf download REPO_ID` — Download files from the Hub. `[--type [model|dataset|space] --revision TEXT --include TEXT --exclude TEXT --cache-dir TEXT --local-dir TEXT --force-download --dry-run --max-workers INTEGER --format [auto|human|agent|json|quiet]]`
- `hf env` — Print information about the environment. `[--format [auto|human|agent|json|quiet]]`
- `hf sync` — Sync files between local directory and a bucket. `[--delete --ignore-times --ignore-sizes --plan TEXT --apply TEXT --dry-run --include TEXT --exclude TEXT --filter-from TEXT --existing --ignore-existing --verbose --format [auto|human|agent|json|quiet]]`
- `hf update` — Update the `hf` CLI to the latest version. `[--format [auto|human|agent|json|quiet]]`
- `hf upload REPO_ID` — Upload a file or a folder to the Hub. Recommended for single-commit uploads. `[--type [model|dataset|space] --revision TEXT --private --include TEXT --exclude TEXT --delete TEXT --commit-message TEXT --commit-description TEXT --create-pr --every FLOAT --format [auto|human|agent|json|quiet]]`
- `hf upload-large-folder REPO_ID LOCAL_PATH` — Upload a large folder to the Hub. Recommended for resumable uploads. `[--type [model|dataset|space] --revision TEXT --private --include TEXT --exclude TEXT --num-workers INTEGER --no-report --no-bars --format [auto|human|agent|json|quiet]]`
- `hf version` — Print information about the hf version. `[--format [auto|human|agent|json|quiet]]`

### `hf auth` — Manage authentication (login, logout, etc.).

- `hf auth list` — List all stored access tokens. `[--format [auto|human|agent|json|quiet]]`
- `hf auth login` — Login from your browser, or using a token from huggingface.co/settings/tokens. `[--add-to-git-credential --force --format [auto|human|agent|json|quiet]]`
- `hf auth logout` — Logout from a specific token. `[--token-name TEXT --format [auto|human|agent|json|quiet]]`
- `hf auth switch` — Switch between access tokens. `[--token-name TEXT --add-to-git-credential --format [auto|human|agent|json|quiet]]`
- `hf auth token` — Print the current access token to stdout. `[--format [auto|human|agent|json|quiet]]`
- `hf auth whoami` — Find out which huggingface.co account you are logged in as. `[--format [auto|human|agent|json|quiet]]`

### `hf buckets` — Commands to interact with buckets.

- `hf buckets cp SRC` — Copy files between local paths, repositories, and buckets. `[--format [auto|human|agent|json|quiet]]`
- `hf buckets create BUCKET_ID` — Create a new bucket. `[--private --region [us|eu] --exist-ok --format [auto|human|agent|json|quiet]]`
- `hf buckets delete BUCKET_ID` — Delete a bucket. `[--yes --missing-ok --format [auto|human|agent|json|quiet]]`
- `hf buckets info BUCKET_ID` — Get info about a bucket. `[--format [auto|human|agent|json|quiet]]`
- `hf buckets list` — List buckets or files in a bucket. `[--human-readable --tree --recursive --search TEXT --format [auto|human|agent|json|quiet]]`
- `hf buckets move FROM_ID TO_ID` — Move (rename) a bucket to a new name or namespace. `[--format [auto|human|agent|json|quiet]]`
- `hf buckets remove ARGUMENT` — Remove files from a bucket. `[--recursive --yes --dry-run --include TEXT --exclude TEXT --format [auto|human|agent|json|quiet]]`
- `hf buckets sync` — Sync files between local directory and a bucket. `[--delete --ignore-times --ignore-sizes --plan TEXT --apply TEXT --dry-run --include TEXT --exclude TEXT --filter-from TEXT --existing --ignore-existing --verbose --format [auto|human|agent|json|quiet]]`

### `hf cache` — Manage local cache directory.

- `hf cache list` — List cached repositories or revisions. `[--cache-dir TEXT --revisions --filter TEXT --sort [accessed|accessed:asc|accessed:desc|modified|modified:asc|modified:desc|name|name:asc|name:desc|size|size:asc|size:desc] --limit INTEGER --format [auto|human|agent|json|quiet]]`
- `hf cache prune` — Remove detached revisions from the cache. `[--cache-dir TEXT --yes --dry-run --format [auto|human|agent|json|quiet]]`
- `hf cache rm TARGETS` — Remove cached repositories or revisions. `[--cache-dir TEXT --yes --dry-run --format [auto|human|agent|json|quiet]]`
- `hf cache verify REPO_ID` — Verify checksums for a single repo revision from cache or a local directory. `[--type [model|dataset|space] --revision TEXT --cache-dir TEXT --local-dir TEXT --fail-on-missing-files --fail-on-extra-files --format [auto|human|agent|json|quiet]]`

### `hf collections` — Interact with collections on the Hub.

- `hf collections add-item COLLECTION_SLUG ITEM_ID ITEM_TYPE` — Add an item to a collection. `[--note TEXT --exists-ok --format [auto|human|agent|json|quiet]]`
- `hf collections create TITLE` — Create a new collection on the Hub. `[--namespace TEXT --description TEXT --private --exists-ok --format [auto|human|agent|json|quiet]]`
- `hf collections delete COLLECTION_SLUG` — Delete a collection from the Hub. `[--missing-ok --format [auto|human|agent|json|quiet]]`
- `hf collections delete-item COLLECTION_SLUG ITEM_OBJECT_ID` — Delete an item from a collection. `[--missing-ok --format [auto|human|agent|json|quiet]]`
- `hf collections info COLLECTION_SLUG` — Get info about a collection on the Hub. `[--format [auto|human|agent|json|quiet]]`
- `hf collections list` — List collections on the Hub. `[--owner TEXT --item TEXT --sort [lastModified|trending|upvotes] --limit INTEGER --format [auto|human|agent|json|quiet]]`
- `hf collections update COLLECTION_SLUG` — Update a collection's metadata on the Hub. `[--title TEXT --description TEXT --position INTEGER --private --theme TEXT --format [auto|human|agent|json|quiet]]`
- `hf collections update-item COLLECTION_SLUG ITEM_OBJECT_ID` — Update an item in a collection. `[--note TEXT --position INTEGER --format [auto|human|agent|json|quiet]]`

### `hf datasets` — Interact with datasets on the Hub.

- `hf datasets card DATASET_ID` — Get the dataset card (README) for a dataset on the Hub. `[--metadata --text --format [auto|human|agent|json|quiet]]`
- `hf datasets info DATASET_ID` — Get info about a dataset on the Hub. `[--revision TEXT --expand TEXT --format [auto|human|agent|json|quiet]]`
- `hf datasets leaderboard DATASET_ID` — List model scores from a dataset leaderboard. This command helps find the best models for a task or compare models by benchmark scores. Use 'hf datasets ls --filter benchmark:official' to list available leaderboards. `[--limit INTEGER --format [auto|human|agent|json|quiet]]`
- `hf datasets list` — List datasets on the Hub, or files in a dataset repo. `[--search TEXT --author TEXT --filter TEXT --sort [created_at|downloads|last_modified|likes|trending_score] --limit INTEGER --expand TEXT --human-readable --tree --recursive --revision TEXT --format [auto|human|agent|json|quiet]]`
- `hf datasets parquet DATASET_ID` — List parquet file URLs available for a dataset. `[--subset TEXT --split TEXT --format [auto|human|agent|json|quiet]]`
- `hf datasets sql SQL` — Execute a raw SQL query with DuckDB against dataset parquet URLs. `[--format [auto|human|agent|json|quiet]]`

### `hf discussions` — Manage discussions and pull requests on the Hub.

- `hf discussions close REPO_ID NUM` — Close a discussion or pull request. `[--comment TEXT --yes --type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions comment REPO_ID NUM` — Comment on a discussion or pull request. `[--body TEXT --body-file PATH --type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions create REPO_ID --title TEXT` — Create a new discussion or pull request on a repo. `[--body TEXT --body-file PATH --pull-request --type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions diff REPO_ID NUM` — Show the diff of a pull request. `[--type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions info REPO_ID NUM` — Get info about a discussion or pull request. `[--type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions list REPO_ID` — List discussions and pull requests on a repo. `[--status [open|closed|merged|draft|all] --kind [all|discussion|pull_request] --author TEXT --limit INTEGER --type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions merge REPO_ID NUM` — Merge a pull request. `[--comment TEXT --yes --type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions rename REPO_ID NUM NEW_TITLE` — Rename a discussion or pull request. `[--type [model|dataset|space] --format [auto|human|agent|json|quiet]]`
- `hf discussions reopen REPO_ID NUM` — Reopen a closed discussion or pull request. `[--comment TEXT --yes --type [model|dataset|space] --format [auto|human|agent|json|quiet]]`

### `hf endpoints` — Manage Hugging Face Inference Endpoints.

- `hf endpoints catalog deploy --repo TEXT` — Deploy an Inference Endpoint from the Model Catalog. `[--name TEXT --accelerator TEXT --namespace TEXT --format [auto|human|agent|json|quiet]]`
- `hf endpoints catalog list` — List available Catalog models. `[--format [auto|human|agent|json|quiet]]`
- `hf endpoints delete NAME` — Delete an Inference Endpoint permanently. `[--namespace TEXT --yes --format [auto|human|agent|json|quiet]]`
- `hf endpoints deploy NAME --repo TEXT --framework TEXT --accelerator TEXT --instance-size TEXT --instance-type TEXT --region TEXT --vendor TEXT` — Deploy an Inference Endpoint from a Hub repository. `[--namespace TEXT --task TEXT --min-replica INTEGER --max-replica INTEGER --scale-to-zero-timeout INTEGER --scaling-metric [pendingRequests|hardwareUsage] --scaling-threshold FLOAT --revision TEXT --custom-image TEXT --health-route TEXT --port INTEGER --container-command TEXT --container-args TEXT --env TEXT --env-file TEXT --secrets TEXT --secrets-file TEXT --type [public|protected|authenticated|private] --format [auto|human|agent|json|quiet]]`
- `hf endpoints describe NAME` — Get information about an existing endpoint. `[--namespace TEXT --format [auto|human|agent|json|quiet]]`
- `hf endpoints list` — Lists all Inference Endpoints for the given namespace. `[--namespace TEXT --format [auto|human|agent|json|quiet]]`
- `hf endpoints pause NAME` — Pause an Inference Endpoint. `[--namespace TEXT --format [auto|human|agent|json|quiet]]`
- `hf endpoints resume NAME` — Resume an Inference Endpoint. `[--namespace TEXT --fail-if-already-running --format [auto|human|agent|json|quiet]]`
- `hf endpoints scale-to-zero NAME` — Scale an Inference Endpoint to zero. `[--namespace TEXT --format [auto|human|agent|json|quiet]]`
- `hf endpoints update NAME` — Update an existing endpoint. `[--namespace TEXT --repo TEXT --accelerator TEXT --instance-size TEXT --instance-type TEXT --framework TEXT --revision TEXT --task TEXT --min-replica INTEGER --max-replica INTEGER --scale-to-zero-timeout INTEGER --scaling-metric [pendingRequests|hardwareUsage] --scaling-threshold FLOAT --format [auto|human|agent|json|quiet]]`



…(the rest of this skill is left out)