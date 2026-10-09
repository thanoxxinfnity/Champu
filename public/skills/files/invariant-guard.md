# invariant-guard — Correctness-First Coding

The model knows what a loop invariant is. It knows recursion needs a base case. It knows about empty lists, integer overflow, and the difference between `<` and `≤`. It just does not write these down before producing code, so it ships subtle correctness bugs that tests do not catch.

invariant-guard fixes the behavior. State the invariants. State the base case. State the termination argument. State the edge cases. Then write the code — and verify that the code maintains what you stated.

**Violating the letter of these rules is violating the spirit of the skill.** "I know this algorithm" is the exact rationalization that ships off-by-one and missing-postcondition bugs.

## When to Use This Skill

Use **invariant-guard** when writing or reviewing algorithms where the obvious implementation is subtly wrong:

- Postcondition stronger than the loop's natural invariant: Boyer–Moore majority, Floyd's cycle detection, leftmost vs any binary search, QuickSelect partition.
- In-place mutation with read+write pointers: dedup-in-place, partition, rotate.
- Recursion with multiple parameters or accumulator state.
- Off-by-one suspects with duplicates, empty inputs, boundary values.
- Iterative refinements that must terminate: fixed-point, Newton, EM.
- Any function where you catch yourself thinking "I know this algorithm" — the trap is usually in the contract, not the loop body.

Pairs with `lemmaly` (picks the algorithm) and `mathguard` (picks the math). Load `invariant-guard` *after* the algorithm has been chosen and *before* the loop body is written.

## The Iron Law

```text
NO LOOP OR RECURSION WITHOUT A WRITTEN INVARIANT AND TERMINATION ARGUMENT
```

If you cannot write the invariant in one sentence, you have not designed the loop. Write code anyway and you are coding by guess — and the bug will be in the case you did not enumerate.

## Non-negotiable rules

1. **Every loop gets a one-line invariant.** Before writing any loop, state in one sentence what is true at the top of every iteration. Examples:
   - "At loop top: `result` contains the sum of `a[0..i)`."
   - "At loop top: `lo ≤ target_position ≤ hi`."
   - "At loop top: `seen` contains every element processed so far; `dups` contains every element that appeared at least twice."

   If you cannot write the invariant in one sentence, you have not designed the loop yet.

2. **Every loop gets a one-line termination argument.** Name the quantity that strictly decreases (or strictly increases toward a bound) on every iteration. Examples:
   - "`hi − lo` strictly decreases each iteration."
   - "`i` increases by 1 and is bounded above by `n`."
   - "`stack.length` strictly decreases each pop; nothing pushes inside this branch."

   No termination argument, no loop.

3. **Every recursion gets an explicit base case and a measure.** Before writing a recursive function, state:
   - The base case(s) — the smallest inputs that return without recursing.
   - The measure — a non-negative integer that strictly decreases on every recursive call (e.g. `len(xs)`, `hi − lo`, `depth`, `n`).
   - The combination — how the recursive results combine into the answer.

   No base case + measure, no recursion. (Mutual recursion: state the measure across the cycle.)

4. **List edge cases before writing, not after.** For every function operating on a collection or number, list which of these apply and how they behave:
   - Empty input (`[]`, `""`, `null`, `undefined`, `None`).
   - Singleton (`[x]`).
   - All-equal elements.
   - Already-sorted / reverse-sorted input.
   - Duplicates (when uniqueness is assumed).
   - Negative numbers, zero, exactly the boundary value.
   - Integer overflow / underflow at the type max/min.
   - NaN, ±Infinity, `-0`, denormals (for floats).
   - Off-by-one boundaries: index 0, index n−1, index n, length 0, length 1.
   - Concurrent modification while iterating.

   The cases that apply must each have a one-phrase expected behavior written down.

5. **Make illegal states unreachable, not just unhandled.** Prefer encoding constraints in types and structure so the wrong state cannot be constructed:
   - Sum type over boolean flag soup (`Loading | Loaded(data) | Error(msg)` not `{loading, data, error}`).
   - Newtype for IDs that must not be swapped (`UserId` vs `OrderId`).
   - Non-empty list type when the function requires at least one element.
   - Parsed value at the boundary, not validated repeatedly downstream (parse-don't-validate).

   If the language cannot encode it, write the invariant as a comment and assert it at the boundary.

## The pre-write protocol

Before producing non-trivial code that has loops, recursion, or non-trivial state, your message must contain — in this order:

1. **Function contract** — preconditions, postconditions, and what the function returns. One line each.
2. **Loop invariants** — one per loop. (Rule 1.)
3. **Termination arguments** — one per loop or recursion. (Rules 2, 3.)
4. **Base cases and measure** — for recursion. (Rule 3.)
5. **Edge case table** — bullets, one per applicable case, with expected behavior. (Rule 4.)
6. **Illegal states made unrepresentable** — name the types or asserts that enforce invariants. (Rule 5.)
7. **The code.**
8. **Self-check** — one line per loop confirming the invariant holds at top, body preserves it, and exit implies postcondition.

If any of 1–6 is missing, do not emit code.

## Worked trap — Boyer–Moore majority vote

This is the canonical "the trap is in the contract, not the loop body" case.

**Naive baseline (what gets shipped without the skill):**

```typescript
function findMajority(arr: number[]): number | null {
  if (arr.length === 0) return null;
  let candidate = arr[0], count = 0;
  for (const x of arr) {
    if (count === 0) candidate = x;
    if (x === candidate) count++; else count--;
  }
  return candidate;   // BUG: returns the candidate even when no majority exists
}
```

This implementation fails on `[1,2,3]` (returns `3`, expected `null`) and `[2,2,1,1]` (returns `1`, expected `null`). The voting loop is correct; the postcondition is wrong.

**Why the protocol catches it.** Writing **step 1 (function contract)** forces the postcondition in plain language:

> Returns `x` iff `count(x, arr) > arr.length / 2`; else `null`.

Then writing **step 2 (loop invariant)** forces the invariant of the voting pass:

> If a strict majority element exists in `arr`, it equals `candidate` when the loop exits.

These two statements are not equivalent. The loop invariant guarantees "if a majority exists, it is the candidate" — not "the candidate is a majority." Once you write both down, the gap is visible: you need a second pass to verify, or the postcondition is unmet.

**Correct implementation that survives the protocol:**

```typescript
function findMajority(arr: number[]): number | null {
  if (arr.length === 0) return null;
  // Pass 1: vote.
  let candidate = arr[0], count = 0;
  // inv: if a strict majority exists in arr, it equals candidate at every count===0 reset.
  for (const x of arr) {
    if (count === 0) candidate = x;
    if (x === candidate) count++; else count--;
  }
  // Pass 2: verify — the voting invariant is strictly weaker than the postcondition.
  let tally = 0;
  // inv: tally = count of candidate in arr[0..i).
  for (const x of arr) if (x === candidate) tally++;
  return tally * 2 > arr.length ? candidate : null;
}
```

**Pattern to generalize.** The same trap appears in:

- **Floyd's cycle detection** — finding the meeting point tells you a cycle exists, *not* where it starts. You need a second walk.
- **Two-pointer "find any"** vs **"find leftmost"** — the loop invariant for one does not satisfy the postcondition of the other.
- **QuickSelect partition** — the loop returns a position; the postcondition is that the element at that position is the k-th smallest. Off by one in the partition invariant silently breaks it.
- **DP with reconstruction** — the table tells you the optimum value; reconstructing the optimum path needs separate invariants on the choice array.

In every case: **write the postcondition first; write the loop invariant second; check that the second implies the first. If not, you are missing a pass, a check, or an auxiliary state.**

## Canonical example — binary search for the leftmost match

Most "I know binary search" implementations are written for "find any match." The trap is the postcondition.

**Problem.** Given a sorted array with duplicates, return the index of the **leftmost** occurrence of `target`, or `-1`.

### Without the protocol — returns any match

```ts
function leftmost(a: number[], target: number): number {
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] === target) return mid;       // returns ANY occurrence
    if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
// leftmost([1,2,2,2,3], 2) → may return 2, not 1
```

The loop invariant ("target lies in `a[lo..hi]` if anywhere") is satisfied. But the postcondition ("returned index is the *smallest* `i` with `a[i] === target`") is strictly stronger. The loop body's early return abandons the search before reaching the leftmost.

### With the protocol — contract-driven leftmost

```ts
function leftmost(a: number[], target: number): number {
  // contract:
  //   pre:  a is sorted ascending
  //   post: returns smallest i with a[i] === target, or -1 if absent
  let lo = 0, hi = a.length;                 // half-open [lo, hi)
  // inv: every index < lo has a[i] < target; every index ≥ hi has a[i] > target OR is past leftmost match
  // term: hi - lo strictly halves each iteration
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < target) lo = mid + 1; else hi = mid;
  }
  // exit: lo === hi, and by invariant lo is the leftmost index where a[lo] >= target
  return lo < a.length && a[lo] === target ? lo : -1;
}
```

Same loop shape. The difference is the contract was written first — and the loop body was chosen to maintain an invariant that *implies* the postcondition.

## Common invariant patterns to reach for

| Loop / algorithm shape | Canonical invariant | Termination |
|---|---|---|
| Linear scan accumulating | `acc = f(a[0..i))` at top | `i` increases by 1, bounded by `n` |
| Two-pointer (sorted) | `target (if any) lies in a[lo..hi]` | `hi − lo` strictly decreases |
| Binary search | `target (if present) ∈ a[lo..hi]` and `a[lo..hi]` non-empty | `hi − lo` strictly halves |
| Sliding window | window `[l..r)` satisfies the constraint; answer ≥ best so far | `r` advances at least once per outer iter |
| BFS | every node at distance < d has been popped; queue contains some at distance d | strict node count decrease per pop |
| DFS / recursion on tree | result for subtree rooted at v = combine(children results) | depth (or remaining nodes) strictly decreases |
| Divide and conquer | result on `a[lo..hi]` = combine(results on the two halves) | `hi − lo` strictly halves |
| Greedy with priority queue | extracted item is globally optimal for the remaining problem | heap size strictly decreases per extract |
| Union-Find op | `find(x)` always returns the canonical root of x's component | tree height bounded by O(log n) (with rank) |
| In-place partition | `a[0..i)` < pivot; `a[i..j)` ≥ pivot; `a[j..n)` unseen | `n − j` strictly decreases |

## Edge case table — defaults to consider

| Input shape | Cases to check |
|---|---|
| Array / list | empty, singleton, all-equal, sorted, reversed, with duplicates |
| String | empty, single char, all whitespace, unicode (surrogates, combining), bytes vs code points |
| Integer | 0, 1, −1, MIN, MAX, MAX − 1, near overflow in arithmetic, division by 0 |
| Float | 0.0, −0.0, NaN, ±Inf, denormal, exact comparison should be ε-based |
| Map / dict | empty, missing key (default vs error), key collision semantics |
| Tree / graph | empty, single node, cycle (if undirected), s

…(the rest of this skill is left out)