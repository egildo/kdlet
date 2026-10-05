# Changelog

## 0.1.1 — 2026-10-06

- `kdlet-guards`: `check(condition, host)` answers `{ holds, errors }` without building a trace, and is now the one evaluator; `evaluate` wraps it and adds the trace. `kdlet` uses `check`, so a bundle of `kdlet`'s `evaluate` is about 450 characters smaller (about 115 gzipped). Nothing a file or a host can say changes.

## 0.1.0 — 2026-10-05

The first version.

- `kdlet`: `read` turns KDL text into a document with positions and every problem found; `evaluate` turns a document, inputs, host guards, host definitions and a vocabulary into a plain tree in which every node has an identity, plus every problem found; `defineVocabulary` registers a renderer's words and refuses a collision with the language's.
- The language: the reserved words `define`, `guard`, `when`, `else`, `each` and `block`, calls written `+name`, the `(element)` escape, references `(input)name` and `(item)field`, host tags, and top-level words of the host. A field written as a child node holds the list of its arguments, or a `Structure` when it carries properties or children. A file may end in `.kdl` or `.kdlet`.
- `kdlet-guards`: the guard language as plain data (`is`, `has`, `not`, `all`, `any`, a named guard, a registered word), with positions optional. `evaluate(condition, host)` returns a trace with every node's result; `problems(condition, host)` names an unknown guard or word, a word's own complaint and a cycle. The host resolves references, supplies named guards as conditions or functions, registers words and chooses `missing: 'error'` or `'false'`. `kdlet-guards/kdl` reads a guard's body from KDL with positions and problems, writes a condition back as KDL text, and exports the reader's helpers.
- `kdlet-html`: the HTML vocabulary and `render`, with Pug's attribute rules, escaping of every value, and an optional `doctype`.
- The manual, the vision and the principles (both proposed, to be ratified), and the glossary.
