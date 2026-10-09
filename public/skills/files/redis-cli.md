# redis-cli — Redis Command Line Interface
## When to Use

Use this skill when you need redis command-line interface (redis-cli) reference and usage guide. Use this skill whenever the user mentions redis-cli, Redis CLI, or any task involving querying, inspecting, debugging, or managing Redis from the command line. Triggers on key/value reads and writes, SCAN or keyspace...


redis-cli is the primary command-line tool for interacting with Redis. It supports two modes: **command-line execution** (run a command and exit) and **interactive mode** (a REPL with tab completion, history, and hints). It also provides special modes for monitoring, latency analysis, key space scanning, and data import/export.

**Official resources:** [Redis CLI Docs](https://redis.io/docs/latest/develop/tools/cli/) | [Commands](https://redis.io/commands/) | [Download](https://redis.io/downloads/)

## Prerequisites

```bash
# Check if redis-cli is installed
redis-cli --version

# Install options:

# macOS (Homebrew)
brew install redis

# Ubuntu / Debian
sudo apt install redis-tools

# CentOS / RHEL
sudo yum install redis

# Alpine
apk add redis

# Build from source (binary only)
make redis-cli
# Binary at: src/redis-cli

# Docker (no installation needed)
docker run -it --rm redis redis-cli -h <host> -p <port> PING
```

## Security Considerations

> **IMPORTANT**: Redis provides powerful operations that can irreversibly modify or delete data.
> Pay close attention to the following safety guidelines:

- **Never pass passwords via `-a` in production** — visible in shell history and process listings. Use `REDISCLI_AUTH` environment variable instead.
- **`KEYS *` blocks the server** on large databases — always use `SCAN` in production code.
- **`MONITOR` logs all commands** including sensitive data — use cautiously, and never for extended periods on production servers.
- **`FLUSHALL` / `FLUSHDB` are irreversible** — verify target database with `CLIENT LIST` or `INFO keyspace` first.
- **`--rdb` transfer during write operations** may produce inconsistent snapshots on busy servers.

## Quick Reference

### Connection

```bash
# Basic connection (default: 127.0.0.1:6379)
redis-cli
redis-cli -h redis15.localnet.org -p 6390 PING

# With password (prefer REDISCLI_AUTH env var for security)
redis-cli -a myUnguessablePazzzzzword123 PING

# URI connection
redis-cli -u redis://user:password@host:port/dbnum PING

# TLS
redis-cli --tls --cacert /path/to/ca.crt -h redis.example.com PING

# Specific database
redis-cli -n 2 DBSIZE

# IPv4/IPv6 preference
redis-cli -4 PING   # prefer IPv4
redis-cli -6 PING   # prefer IPv6
```

### Command-Line vs Interactive Mode

```bash
# Command-line mode: execute one command and exit
redis-cli INCR mycounter
redis-cli GET mykey

# Interactive mode: type commands at the prompt
redis-cli
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> SELECT 2
OK
127.0.0.1:6379[2]> DBSIZE
(integer) 1
```

The prompt shows `host:port[db]`. Use `CONNECT <host> <port>` to switch instances interactively.

### Data Query Cheat Sheet

**String operations** (O(1)):
```
GET key                        # Get value
SET key value [NX|XX] [EX sec|PX ms|KEEPTTL]  # Set with conditions/TTL
SET key value GET              # Set new, return old value
GETSET key newvalue            # [Use SET key value GET instead]
MGET key1 key2 ...             # Get multiple values
INCR key                       # Increment integer (+1)
INCRBY key 10                  # Increment by amount
STRLEN key                     # String length
GETRANGE key 0 50              # Substring
```

**Hash operations**:
```
HGET key field                 # Get field value            O(1)
HMGET key f1 f2                # Get multiple fields        O(N)
HGETALL key                    # Get all fields/values      O(N)
HKEYS key                      # Get all field names        O(N)
HLEN key                       # Number of fields           O(1)
HEXISTS key field              # Check field exists         O(1)
HSCAN key 0 [MATCH pat]        # Iterate hash fields        O(1) per call
```

**List operations**:
```
LRANGE key 0 -1                # Get all elements           O(N)
LLEN key                       # List length                O(1)
LINDEX key 0                   # Get by index               O(N)
LPOS key value                 # Find element position      O(N)
```

**Set operations**:
```
SMEMBERS key                   # Get all members            O(N)
SCARD key                      # Set cardinality            O(1)
SISMEMBER key member           # Check membership           O(1)
SMISMEMBER key m1 m2           # Multi-membership check     O(N)
SSCAN key 0 [MATCH pat]        # Iterate set members        O(1) per call
```

**Sorted Set operations**:
```
ZRANGE key 0 -1 [WITHSCORES]           # By index              O(log(N)+M)
ZRANGE key -inf +inf BYSCORE           # By score range        O(log(N)+M)
ZRANGE key [a [z BYLEX                 # By lexicographic      O(log(N)+M)
ZCARD key                               # Member count          O(1)
ZSCORE key member                       # Get score             O(1)
ZRANK key member                        # Get rank              O(log(N))
ZSCAN key 0 [MATCH pat]                 # Iterate members       O(1) per call
```

**Key inspection**:
```
EXISTS key [key ...]           # Check existence (O(N) for multi) — returns count
TYPE key                       # Data type: string|list|set|zset|hash|stream  O(1)
TTL key                        # Seconds until expiry (-1=none, -2=not exists)  O(1)
PTTL key                       # Milliseconds until expiry                      O(1)
MEMORY USAGE key [SAMPLES n]   # Memory consumption in bytes                    O(N)
OBJECT ENCODING key            # Internal encoding (ziplist, hashtable, etc.)   O(1)
OBJECT IDLETIME key            # Seconds since last access                      O(1)
DBSIZE                         # Total keys in current database                 O(1)
RANDOMKEY                      # Return a random key                            O(1)
```

### Key Scanning (Production-Safe)

SCAN-based iteration never blocks the server, unlike `KEYS *` which should be avoided in production.

```bash
# redis-cli built-in scan mode
redis-cli --scan                          # List all keys
redis-cli --scan --pattern 'user:*'       # Filter by pattern
redis-cli --scan --pattern '*:12345*'     # Glob patterns
redis-cli --scan --count 100              # Batch size hint

# Programmatic SCAN in interactive mode
SCAN 0 MATCH user:* COUNT 100
# Returns: 1) next_cursor  2) [keys...]
# Continue with: SCAN <next_cursor> MATCH user:* COUNT 100
# Iteration complete when cursor returns 0

# Count keys matching a pattern
redis-cli --scan --pattern 'session:*' | wc -l
```

SCAN guarantees: a full iteration (cursor 0 → cursor 0) always returns all elements that existed for the entire duration. Elements may appear multiple times — handle duplicates in your application.

### Server Inspection

```bash
# Real-time stats (updates every second, use -i to change interval)
redis-cli --stat

# Server information
redis-cli INFO server             # Server details
redis-cli INFO memory             # Memory usage
redis-cli INFO keyspace           # Database key counts
redis-cli INFO replication        # Replication status
redis-cli INFO all                # Everything

# Key space analysis
redis-cli --bigkeys               # Find largest keys by element count
redis-cli --memkeys               # Find largest keys by memory usage
redis-cli --keystats              # Combined bigkeys + memkeys with distribution

# Latency analysis
redis-cli --latency               # Continuous latency sampling
redis-cli --latency-history       # Latency over time (15s windows)
redis-cli --latency-dist          # Latency spectrum visualization
redis-cli --intrinsic-latency 5   # System baseline latency (run on Redis host)
```

### Output Control

```bash
# Raw output (no type prefixes) — default when piping
redis-cli --raw GET mykey
redis-cli GET mykey > /tmp/output.txt    # auto raw mode

# Human-readable (force) when piping
redis-cli --no-raw GET mykey | cat

# CSV output
redis-cli --csv LRANGE mylist 0 -1

# JSON output (RESP3, use -2 for RESP2)
redis-cli --json HGETALL user:1

# Read last argument from stdin
cat /etc/services | redis-cli -x SET net_services

# Pipe commands from file
cat /tmp/commands.txt | redis-cli
```

### Repeat Commands

```bash
# Run command N times
redis-cli -r 5 INCR counter

# Run with delay (seconds, supports decimals)
redis-cli -r -1 -i 1 INFO | grep rss_human    # infinite, every 1s

# Interactive: prefix with count
5 INCR mycounter    # runs 5 times
```

### Server Administration

```bash
# ACL management
redis-cli ACL LIST                                    # List all users
redis-cli ACL SETUSER admin on >pwd ~* +@all          # Create admin user
redis-cli ACL SETUSER readonly on >pwd ~* +@read      # Create read-only user
redis-cli ACL DELUSER username                        # Delete user
redis-cli ACL DRYRUN username GET key                 # Test user permission
redis-cli ACL GENPASS                                 # Generate random password

# Client management
redis-cli CLIENT LIST                                 # List all connections
redis-cli CLIENT KILL ADDR ip:port                    # Disconnect client
redis-cli CLIENT PAUSE 5000 WRITE                     # Pause writes for 5s
redis-cli CLIENT SETNAME my-app                       # Name current connection

# Configuration
redis-cli CONFIG GET maxmemory                        # Read config
redis-cli CONFIG SET maxmemory 100mb                  # Set config at runtime
redis-cli CONFIG REWRITE                              # Persist to redis.conf
redis-cli CONFIG RESETSTAT                            # Reset INFO counters

# Replication acknowledgment
redis-cli WAIT 2 5000                                 # Wait for 2 replicas (5s timeout)
redis-cli WAITAOF 1 1 5000                            # Wait for AOF fsync (Redis 7.2+)

# Persistence
redis-cli BGSAVE                                      # Background RDB save
redis-cli BGREWRITEAOF                                # Background AOF rewrite
redis-cli LASTSAVE                                    # Last save timestamp

# Replication
redis-cli REPLICAOF host port                         # Become replica
redis-cli REPLICAOF NO ONE                            # Promote to master

# Server lifecycle
redis-cli SHUTDOWN SAVE                               # Save and stop
redis-cli SHUTDOWN NOSAVE                             # Stop without saving

# Slow log
redis-cli SLOWLOG GET 10                              # Recent slow commands
redis-cli SLOWLOG LEN                                 # Entry count
redis-cli SLOWLOG RESET                               # Clear entries

# Cluster management
redis-cli --cluster check host:port                   # Check cluster health
redis-cli --cluster reshard host:port                 # Move slots between nodes
redis-cli -c -h cluster-node PING                     # Cluster-aware connection
```

## Detailed Reference Files

| File | Content | When to read |
|------|---------|-------------|
| `references/connection-and-options.md` | Full connection options, CLI flags, SSL/TLS, environment variables, interactive mode features (completion, history, preferences), RESP protocol versions | Configuring connections, setting up TLS, customizing CLI behavior |
| `references/data-query-commands.md` | Core data type commands: Strings, Hashes, Lists, Sets, Sorted Sets, Streams, Bitmaps, HyperLogLog, Geospatial, plus Key Operations, Database Operations, and Transactions | Looking up core command syntax, understanding command options and return values |
| `references/module-data-types.md` | Module data types: JSON (RedisJSON), Vector Sets (Redis 8.0+), Bloom Filter, Cuckoo Filter, Top-K, Count-Min Sketch, T-Digest, TimeSeries (TS.*), Full-Text Search / RediSearch (FT.*) — with f

…(the rest of this skill is left out)