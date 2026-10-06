<p align="center"><img src="https://codeberg.org/egildo/kdlet/raw/branch/main/docs/logo.svg" alt="kdlet" width="260"></p>

**Named conditions as plain data: `is`, `has`, `not`, `all`, `any`, with the host answering for the rest.**

The guard language of [kdlet](https://www.npmjs.com/package/kdlet), as a package of its own. A condition is JSON. A host resolves what it reads, supplies named guards and registers words of its own. Evaluating returns a trace: whether each node held, and what a word said about itself.

```sh
npm install kdlet-guards
```

```ts
import { evaluate } from 'kdlet-guards';

const condition = { all: [{ has: { ref: { from: 'input', field: 'summary' } } }, { not: { guard: 'draft' } }] };

const trace = evaluate(condition, {
  resolve: (ref) => data[ref.from]?.[ref.field],
  guards: { draft: { is: { ref: { from: 'input', field: 'status' } }, values: ['draft'] } },
  missing: 'error', // or 'false': an absent operand makes `is` false, silently
});

trace.holds; // true or false; trace.children holds each node's own result
```

A host may answer `UNKNOWN` (exported by the package) for a reference that is not yet known; `undefined` still means there is nothing there. A condition that depends on it is neither true nor false: `holds` is `false` and the trace, and the result of `check`, carry `unknown: true`, by the three-valued tables of Kleene (SQL's `NULL` uses them): `not` leaves it, `all` and `any` give way to a child that settles them. A host that never answers `UNKNOWN` sees no change.

`kdlet-guards/kdl` reads a guard's body from [`@bgotink/kdl`](https://github.com/bgotink/kdl) nodes, with positions and problems, and writes a condition back as KDL text: `@bgotink/kdl` is an optional peer dependency: a host that uses `kdlet-guards/kdl` installs it; one that only evaluates conditions does not need it.

```kdl
all {
    has (input)summary
    not draft
}
```

## What it exports

| Export | What it does |
|---|---|
| `check(condition, host)` | A condition to `{ holds, errors }`, with no trace. The semantics live here; kdlet uses it, so a bundle that only checks does not carry the tracing |
| `evaluate(condition, host)` | `check` with a trace. Never throws for what the condition says; an error is in the trace |
| `errors(trace)` | Every error of a trace, with its position when the condition had one |
| `problems(condition, host)` | An unknown guard or word, a word's own complaint, a cycle |
| `readBody`, `readGuard`, `writeGuard` (from `kdlet-guards/kdl`) | KDL to conditions with positions and problems, and a condition to KDL text |
| `readRef`, `plainWord`, `entriesOf`, `locOf`, `report`, … (from `kdlet-guards/kdl`) | The pieces of the reader, for a host that reads the rest of its KDL itself |

Node 20 or later, ESM only.

## Read next

- [The plan and what was built](https://codeberg.org/egildo/kdlet/src/branch/main/docs/guards-module.md).
- [The manual](https://codeberg.org/egildo/kdlet/src/branch/main/docs/manual.md), for guards as a kdlet file writes them.

## License

MIT.
