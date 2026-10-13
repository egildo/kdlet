# kdlet-guards — the plan for the module

Status: built 2026-10-05, in `packages/kdlet-guards`; kdlet uses it. Agreed with Egildo: kdlet's guard
logic is taken out into a package of this monorepo, `kdlet-guards`, so that kdlet and consequitur
(`~/privata/dev/consequitur`) both use it. Section 4 is met; «As built» lists where the build chose.

## 1 · Why

kdlet's guards are a minimal condition language: named conditions, `is`, `has`, `not`, `all`,
`any`, references by tag, host guards for what a file cannot say, no expressions. consequitur needs
exactly that for a gist's `when` and a goal's conditions, plus two words of its own. Two copies
would drift; one module serves both.

## 2 · What moves, what stays

| Moves into `kdlet-guards` | Stays in `kdlet` |
|---|---|
| the guard model (`GuardWord`, `Ref`, `Value`, `Name`) as plain JSON-serialisable data, positions optional | scopes of `define` and `each`, and which guards a body can see |
| the evaluator: `is`, `has`, `not`, `all`, `any`, named guards and their cycle check, host guards | what an item in scope is (`(input)`, `(post)`) — kdlet's resolver |
| the KDL reader of a guard body (`kdlet-guards/kdl`, on `@bgotink/kdl`, an optional peer dependency that only this entry needs) | kdlet's file reader, which calls it |

## 3 · The module

```ts
// kdlet-guards — no dependency
export type Ref = { from: string; field: string };
export type Operand = Primitive | { ref: Ref };
export type Condition =
  | { is: Operand; values: Operand[] }          // equal to one of
  | { has: Operand }                            // there is something
  | { not: Condition }                          // negation (a name is `{ guard: 'x' }`)
  | { all: Condition[] } | { any: Condition[] }
  | { guard: string }                           // a named guard
  | { word: string; args?: Json; body?: Condition[] };   // a registered word

export interface Host {
  resolve(ref: Ref): unknown;                   // undefined when there is nothing there
  guards?: Record<string, Condition | ((host: Host) => boolean)>;   // named, or supplied by code
  words?: Record<string, Word>;                 // registered words
  missing: 'error' | 'false';                   // `is` on an absent operand
}

export interface Word {                          // e.g. consequitur's `line`, `at-least`
  read?(args: Json, body: Condition[] | undefined): string | undefined;   // a problem, or nothing
  test(args: Json, body: Trace[] | undefined, host: Host): { holds: boolean; detail?: Json };
}

export interface Trace { holds: boolean; condition: Condition; children?: Trace[]; detail?: Json }
export function evaluate(condition: Condition, host: Host): Trace;
export function problems(condition: Condition, host: Pick<Host, 'guards' | 'words'>): string[];
```

- **The host resolves.** The module never knows what `input` or `value` means.
- **`missing`** is the one difference between the two users: kdlet keeps its strictness
  (`'error'`), consequitur's reading never throws (`'false'`).
- **`not` takes a condition.** kdlet's reader may keep allowing only a name after `not` in its
  files; the model allows both.
- **The trace** carries every node's result and a word's `detail`, so a screen can tick each
  condition and a caller can analyse the tree (consequitur works out from it whether a goal can
  still come true).
- **Registered words** cover kdlet's host guards and consequitur's `line` and `at-least` with one
  mechanism; a word that wraps children receives their traces.
- `kdlet-guards/kdl`: `readGuard(node)` / `readBody(nodes)` → `Condition` and problems with
  positions; `writeGuard(condition)` → KDL text, for showing a condition.

## 4 · Done when

kdlet uses the module and every test it has passes unchanged; the module has its own tests,
including a registered word and `missing: 'false'`; kdlet's manual says where guards live.

## 5 · As built

Where the plan was silent or the build chose otherwise.

**The model**

- `loc?` is on every condition, and an operand that is a reference is `{ ref, loc? }`. The name in
  `{ guard, loc? }` carries the position of where it is used, which is where its errors point.
- `Ref`, `Loc`, `Json`, `Primitive` and `Problem` moved, and kdlet re-exports them from the module.
  `Value` and `Name` stayed kdlet's: they describe a value in a file and a name in a file, and the
  model needs neither. `GuardWord` is gone from kdlet; `Condition` takes its place.
- `all: []` holds and `any: []` does not.
- `Word.read` and `Word.test` take `args: Json`, which is `null` when the condition gave none.

**Evaluation**

- `check(condition, host, observer?)` is the evaluator and returns `{ holds, errors }` (and `unknown`, below); it builds no trace. `evaluate` is `check` plus an observer that keeps what it hears (`enter`, `error`, `leave`) as a tree, so the semantics are written once and the tracing is in a bundle only when `evaluate` is imported. kdlt calls `check`: it needs the answer and the errors, never the tree. Under `check` a word that wraps conditions receives a bare `{ holds, condition }` for each; under `evaluate` it receives the full trace. One table of conditions is run through both and they must agree on `holds` and on every error.

- `evaluate` never throws for what a condition says. What goes wrong is in the node's `errors`
  (`{ message, loc? }`) and the node does not hold; `errors(trace)` lists every one, depth first.
  This is how kdlet keeps its messages and positions.
- A guard supplied by code is `(host) => boolean | 'unknown' | { error: string }`. Anything else it returns is
  an error in the trace. kdlet answers a guard its file declares and the host never supplied with
  `{ error }`.
- `all` stops at the first child that fails and `any` at the first that holds, so the trace has no
  entry for a child not asked. A word that wraps conditions receives the trace of every one of them.
- `missing: 'error'` records `is`'s absent operands, each one on the right, and the left alone when it is absent, and takes the comparison as false;
  `'false'` records nothing. `has` is the same under both.
- `problems` returns text and does not look at positions. kdlet does not call it: its reader and
  evaluator already say the same things, with their lines and columns.
- A cycle is found where the loop closes, by name, within one `host.guards`. A word that evaluates again with the same `host` object joins the check; one that builds a new host starts its own.
- **The unknown.** A reference can be not yet known, which is not the same as absent. `resolve` may return `UNKNOWN`, a unique symbol the module exports. `undefined` still means absent, `Host` has no new field, and `missing` is untouched. A condition then has three answers, by Kleene's strong three-valued logic (SQL's `NULL` uses the same tables): true, false, and unknown. Unknown is a flag on a false: `check` returns `{ holds, errors, unknown?: true }`, a `Trace` has `unknown?: true`, a word's `test` may return `{ holds, unknown?: true, detail? }` and a guard function may answer `'unknown'`. When `unknown` is set, `holds` is false, so a reader of `holds` alone takes unknown as false, as SQL's `WHERE` does. The flag is set only when it is true: a host that never says unknown gets the same types and the same values as before, trace keys included. kdlet never says it: its resolver answers a value or `undefined`, its host guards answer `boolean`, and it registers no word.
- The tables. `is`: an `UNKNOWN` on the left is unknown; a known left with some right equal is true; otherwise some right `UNKNOWN` makes it unknown, and else it is false. An absent operand is still false, with `missing` as before. `has` of `UNKNOWN` is unknown. `not` swaps true and false and leaves unknown. `all` is false if any child is false, otherwise unknown if any is unknown, otherwise true; `any` is true if any child is true, otherwise unknown if any is unknown, otherwise false. `all` still stops at its first false child and `any` at its first true one; an unknown child does not stop the walk. A `guard` answers as its body or its function does. A word with a body receives its children's traces, with `unknown` where it applies, and answers as it decides; the module defines no word.
- An error wins over the unknown: a node with an error of its own does not hold and is not unknown. The nodes around it answer by the tables, so `any` of an unknown and an error is unknown, and the error is in the trace. `problems` is unchanged, and so are the KDL reader and writer: `UNKNOWN` is a run-time answer of the host and is never written in a file.
- A value that is not a condition (`null`, an object with none of the words) is an error in the trace, not a throw. A guard found by name is
  one of that host's `guards` and nothing on `Object.prototype`.

**Reading and writing KDL**

- `readBody(nodes, options)` gives `{ conditions, problems }` and `readGuard(node, options)` gives
  `{ condition, problems }`. Several conditions in a body are all of them; kdlet keeps the list and
  joins it when it evaluates.
- A condition inside `not`, `all`, `any`, a word's body or an `is`'s values that could not be read is left out together with the whole condition around it, so a read never gives a narrower condition than the one written. At the top of `readBody` the unreadable nodes are left out of the list: check `problems` before trusting it.
- The helpers the reader is built on (`locOf`, `report`, `show`, `entriesOf`, `noBody`, `noEntries`, `plainWord`, `readRef`) are exported from `kdlet-guards/kdl`, for a host that reads the rest of a KDL file itself. kdlet uses them, so the rules for a reference and a plain word are written once.
- The options carry what is the host's: `isReference(tag)` (default every tag), `checkGuard(name)`
  (the host's message for a name not visible, so kdlet's scoping and messages stay kdlet's),
  `words`, and `guardNames: 'under-not'`, which gives kdlet's rule that a name appears only after
  `not`. By default a name may also stand alone as `guard name`, and `not` may hold a body.
- A registered word reads as `name arg… { body }`: arguments alone are a list, properties alone are
  an object, both together are refused, and a tag on a value is refused. A word whose arguments KDL
  cannot hold is a `RangeError` when written.
- A tagged value in an `is` that is not a reference is refused by the reader. kdlet used to refuse it
  when the guard was first evaluated; the message and the position are the same, and a file that never
  uses the guard now hears of it too.

**kdlet**

- kdlet builds one host for each scope it evaluates in, with the guards visible there. A guard
  written in an enclosing scope is read through the scope that uses it, which sees the same values:
  scopes only grow inward, and a definition, which is closed, starts over.
- The packages read each other's built output, so `pnpm build` comes first on a fresh checkout.

**Open for consequitur**

- Set membership (a list among the values of an `is` standing for its members) is not in `is`: it
  compares strictly. A registered word can carry it, or the module can take it as a rule of `is` if
  kdlet agrees.
- A word's arguments in KDL cannot hold a reference or a nested value. A word that needs them in KDL
  files will need a reading of its own.

## 6 · Ordering: `before`, `after`, `less`, `more`

Proposed 2026-10-13, for 0.3.0. The language compares only by equality (`is`). A host that keeps dates and amounts needs order: a date before a deadline, an approval within five days of a request, a count less than the one announced.

**Two pairs of words, one for each kind of value.** `before` and `after` compare times; `less` and `more` compare numbers. Each takes two operands, the left first:

```ts
  | { before: [Operand, Operand]; days?: number }   // the left is earlier than the right, moved by `days`
  | { after: [Operand, Operand]; days?: number }    // the left is later than the right, moved by `days`
  | { less: [Operand, Operand] }                    // the left is a smaller number
  | { more: [Operand, Operand] }                    // the left is a greater number
```

All four are strict. «On or before» is `not` of `after`, «at least» is `not` of `less`: the language already has `not`, so the inclusive forms need no word.

**Two kinds of time, never compared with each other.** The canon is TC39's Temporal, which keeps a calendar date and an instant as different types. A **date** is RFC 3339's `full-date`, `2026-10-13`: a day, in no time zone. An **instant** is RFC 3339's `date-time` with its offset, `2026-10-13T17:00:00Z` or `2026-10-13T19:00:00+02:00`, compared as the moment it names, whatever offset it was written with. A date against an instant does not hold: a date has no time zone, so which instant it is cannot be said. A host that compares a deadline with a moment states the deadline as an instant.

**`days` moves the right operand by whole days, and only a date.** `{ before: [approved, requested], days: 5 }` holds when `approved` is earlier than five days after `requested`: «within five days». A negative number moves it back: `{ before: [sent, deadline], days: -2 }` is «at least two days before the deadline». Days are calendar days, so a date plus one day is the next date, with no time zone involved. `days` on instants is not read: a day is not always 24 hours where clocks change, and that arithmetic is a later step.

**Numbers are JSON numbers.** A string that looks like a number is not one: `"7"` is text.

**What does not compare.** An operand of the wrong kind (text that is not a date or an instant, a number where a time is due, a time where a number is due, a date against an instant, `days` with an instant) makes the comparison false, and `missing: 'error'` records it as it records an absent operand; `problems` reports what can be seen without a value (a literal of the wrong kind, `days` that is not a whole number, a list that is not two operands). An absent operand is false, under `missing` as for `is`. An `UNKNOWN` operand makes the comparison unknown, by the same tables as `is`.

**In KDL**, the four are nodes whose two arguments are the operands, the left first, and `days` a property: `before (ref)approved (ref)requested days=5`. A reference argument is read as the module reads one in `is`.

The four are built into the language, not registered words: a registered word cannot hold a reference among its arguments in KDL (§5), and order is as general as equality.
