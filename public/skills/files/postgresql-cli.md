# psql — PostgreSQL Interactive Terminal

psql is PostgreSQL's feature-rich interactive terminal. It lets you write and execute queries, inspect database objects, import/export data, script batch operations, and customize output formatting — all from the command line.

## Prerequisites

Before using psql, verify it is installed and available:

```bash
# Check if psql is installed
psql --version

# If not found, install PostgreSQL client tools:

# macOS (Homebrew)
brew install libpq
brew link --force libpq

# Ubuntu / Debian
sudo apt install postgresql-client

# CentOS / RHEL
sudo yum install postgresql

# Alpine
apk add postgresql-client

# Windows — install PostgreSQL via the official installer or use WSL
```

psql ships as part of the `postgresql-client` package. The server (`postgresql`) is not required — you only need the client to connect to a remote PostgreSQL instance.

## Quick Reference

### Connecting

```
# 1. CLI flags
psql -h host -p port -U user -d dbname

# 2. Connection URI
# WARNING: Password in URI is visible in shell history and process listings.
#          Prefer ~/.pgpass for production use (see method 4 below).
psql "postgresql://user:YOUR_PASSWORD@host:port/dbname"

# 3. Environment variables (no flags needed)
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=mydb
export PGUSER=postgres
# WARNING: PGPASSWORD is visible in process listings (e.g. `ps aux`).
#          Use ~/.pgpass in production instead.
export PGPASSWORD=YOUR_PASSWORD
psql                       # picks up all params from env

# 4. ~/.pgpass file (RECOMMENDED for passwords)
#    Format: hostname:port:database:username:password
touch ~/.pgpass && chmod 600 ~/.pgpass
# Then manually edit ~/.pgpass and add entries (avoids password in shell history):
# hostname:port:database:username:password
# Example: localhost:5432:mydb:postgres:YOUR_PASSWORD
psql -h localhost -U postgres -d mydb   # no password prompt

# 5. Execute and exit
psql -f script.sql dbname                        # execute file then exit
psql -c "SELECT 1" dbname                        # run single command then exit
psql -1 -f migration.sql dbname                  # run in single transaction

# 6. Service connection (reads from pg_service.conf)
psql service=mydb_prod

# 7. Reconnect within a session
\c dbname                                       # reconnect to different db
\c -reuse-previous=on sslmode=require           # change only sslmode
\c "host=newhost port=5432 dbname=mydb"         # conninfo string
```

On connection failure: interactive mode keeps the previous connection; script mode closes it and all subsequent database commands fail until the next successful `\c`.

Key flags: `-h` host, `-p` port, `-U` user, `-d` database, `-w` no password prompt, `-W` force password prompt, `-1` single transaction, `-f` execute file, `-c` execute command, `-t` tuples only, `-x` expanded, `-A` unaligned, `-E` echo hidden queries (`\d` internals), `-L` log file, `-X` skip `~/.psqlrc`.

**Connection precedence**: CLI flags > environment variables > `pg_service.conf` > defaults. **Password precedence**: connection string/password flag > `PGPASSWORD` env > `~/.pgpass`. Use `~/.pgpass` instead of `PGPASSWORD` in production — `PGPASSWORD` is visible in process listings (`ps aux`).

### Object Inspection (\d family)

| Command           | Shows                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `\d`            | All tables, views, materialized views, sequences, foreign tables (equiv.`\dtvmsE`)                  |
| `\dP`           | Partitioned tables                                                                                    |
| `\dt`           | Tables only                                                                                           |
| `\dv`           | Views only                                                                                            |
| `\di`           | Indexes only                                                                                          |
| `\ds`           | Sequences only                                                                                        |
| `\dm`           | Materialized views only                                                                               |
| `\det`          | Foreign tables (mnemonic: "external tables")                                                          |
| `\dT`           | Data types                                                                                            |
| `\df`           | Functions (use modifiers:`a`=aggregate, `n`=normal, `p`=procedure, `t`=trigger, `w`=window) |
| `\da`           | Aggregate functions                                                                                   |
| `\dn`           | Schemas                                                                                               |
| `\du` / `\dg` | Roles                                                                                                 |
| `\db`           | Tablespaces                                                                                           |
| `\dc`           | Conversions                                                                                           |
| `\dD`           | Domains                                                                                               |
| `\dl`           | Large objects (alias for `\lo_list`)                                                                |
| `\dF`           | Text search configurations                                                                            |
| `\dFd`          | Text search dictionaries                                                                              |
| `\dFp`          | Text search parsers                                                                                   |
| `\dFt`          | Text search templates                                                                                 |
| `\des`          | Foreign servers                                                                                       |
| `\deu`          | User mappings                                                                                         |
| `\dew`          | Foreign-data wrappers                                                                                 |
| `\dp`           | Privileges (GRANT/REVOKE)                                                                             |
| `\drds`         | Per-role and per-database configuration settings                                                      |
| `\l`            | List databases (accepts pattern:`\l test*`)                                                         |

| `\dA`           | Access methods                                           |
| `\dAc` / `\dAf` / `\dAo` / `\dAp` | Operator classes, families, operators, support functions |
| `\dC`           | Type casts                                               |
| `\dconfig`      | Server configuration parameters (`\dconfig *` for all, PostgreSQL 16+)  |
| `\dd`           | Object descriptions (comments)                           |
| `\ddp`          | Default privileges                                       |
| `\dL`           | Procedural languages                                     |
| `\do`           | Operators (accepts arg type patterns)                    |
| `\dO`           | Collations                                               |
| `\dP[itn]`      | Partitioned tables (`t`=tables, `i`=indexes, `n`=nested) |
| `\drg`          | Granted role memberships                                 |
| `\dRp` / `\dRs` | Replication publications / subscriptions                 |
| `\dX`           | Extended statistics                                      |
| `\dx`           | Installed extensions                                     |
| `\dy`           | Event triggers                                           |
| `\sf[+]`        | Show function definition                                 |
| `\sv[+]`        | Show view definition                                     |
| `\z`            | Privileges (alias for `\dp`)                             |

**Modifiers** (append to most `\d` commands):

- `+` — extra info (size, description): `\dt+`, `\l+`, `\du+`
- `S` — include system objects: `\dtS`, `\dfS+`
- `x` — expanded display mode: `\dt+x` (note: `\dx` is a different command; `x` must follow `S` or `+`)

Provide a name for details: `\d table_name` shows columns, types, indexes, constraints, foreign keys.

**Pattern matching** in \d commands:

- `*` = any sequence of characters, `?` = single character
- `.` separates schema from object: `\dt public.*` or `\dt my_schema.users`
- `..` separates database.schema.object: `\dt mydb.public.*` (db must match current db)
- Double quotes stop case folding and wildcard expansion: `\dt "FOO"` matches `FOO` not `foo`
- `$` is matched literally (not regex anchor)
- Regex chars like `[0-9]` work: `\dt user[0-9]*` matches `user1`, `user2`
- No pattern: shows all objects visible in current `search_path` (not all objects in DB)
- Use `*.*` to see all objects in all schemas regardless of visibility

### Query Execution

| Command                               | Action                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `;`                                 | Execute the current query buffer                                                       |
| `\g`                                | Execute (like `;`, but can add options)                                              |
| `\gx`                               | Execute with expanded output (like `\g`, forces `\x on`)                           |
| `\g filename`                       | Execute and send output to file                                                        |
| `\g \| command`                      | Execute and pipe output to shell command                                               |
| `\g (format=csv footer=off) file`   | Execute with one-shot formatting options                                               |
| `\gdesc`                            | Describe result columns without executing                                              |
| `\gset [prefix]`                    | Execute and store results in psql variables                                            |
| `\gexec`                            | Execute each cell of result as a SQL command                                           |
| `\crosstabview`                     | Display result as crosstab (pivot table)                                               |
| `\watch`                            | Re-execute query periodically (see below)                                              |
| `\bind [params...]`                 | Use extended query protocol with parameters. Works with `\g`, `\gx`, and `\gset` |
| `\bind_named stmt_name [params...]` | Bind named prepared statement                                                          |
| `\parse stmt_name`                  | Create prepared statement from current query buffer                                    |
| `\close_prepared stmt_name`         | Close a prepared statement                                                             |
| `\;`                                | Append semicolon to buffer without executing                                           |

### Data Import/Export

```sql
-- Server-side (requires superuser for file access, uses server filesystem)
COPY table TO '/path/file.csv' WITH (FORMAT csv, HEADER true);
COPY table FROM '/path/file.csv' WITH (FORMAT csv, HEADER true);

-- Client-side (runs with client permissions, no superuser need

…(the rest of this skill is left out)