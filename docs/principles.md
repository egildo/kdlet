# Design principles

> **Proposed — to be ratified by the maintainer.** Drawn from the decisions of the planning session of 3 October 2026. Once ratified, this document changes only on purpose, with the reason recorded.

> **When the principles and the vision collide:** the [vision](vision.md) decides what kdlet is and what it is for; the principles decide how it gets built. Neither is overridden by a plan, a spec or convenience.

A principle is known by its name. Each says what it forbids and the problem it came from. The rules that follow from them are in the [manual](manual.md), which owns them.

## kdl-is-the-syntax

Every file is valid KDL, and nothing inside a string means anything to the language.

- **Forbids:** interpolation, an expression in quotes, a list packed into one value with a separator, and a parser of our own.
- **From:** an early sketch matched two values with `"hover|pressed"`, which needed a rule about the bar. Listing the values as arguments needed no rule.

## no-words-of-its-own

Element and field names belong to the renderer. The language owns its reserved words and nothing else.

- **Forbids:** an element, a field or an attribute defined by the core.
- **From:** earlier attempts at one component model for many targets. They died, or survived by narrowing to one family of targets.

## fundamentals-only

The language provides the means: inputs, references, guards, `when`, `each`, definitions and calls. What a consumer builds with them stays in the consumer.

- **Forbids:** a consumer's name, its concepts or its workflow in source, tests or documents. A capability enters in general form or not at all.
- **From:** the language was drawn out of one tool's format, and the first thing left behind was that tool's own logic.

## conditions-have-names

A condition is defined once, as a guard, and used by its name.

- **Forbids:** a condition written in the place where it is used.
- **From:** conditions repeat. A named one is written once, reads as a word, and can be checked wherever it is used.

## the-host-computes

A file shows values and never makes them. Anything computed is supplied by the host, under a name the file declares.

- **Forbids:** arithmetic, comparisons beyond equality, formatting, sorting or filtering in a file, and code of any host's language.
- **From:** Pug's conditions are JavaScript, so Pug exists only where JavaScript runs. Evaluating such strings in a browser also needs a security exception or a build step.

## written-where-it-reads

A guard reads what is in scope where it is written. A definition is closed: it sees its parameters, its block and its own guards.

- **Forbids:** a guard that reads whatever happens to be in scope where it is used, and a definition that works only when called from the right place.
- **From:** the first draft of a worked example. Its guards read the caller's item from inside a definition, and the definition broke at every other call site.

## strict-on-missing

A missing value is an error at the place it would be shown, with its line and column.

- **Forbids:** empty output for a name that was misspelt or never supplied. `has` is the one place where absence is an answer.
- **From:** Mustache prints nothing for a missing value. Jinja, Handlebars and Liquid are silent by default too, and each offers a strict mode to undo it.

## every-node-identified

Every node of the output carries its place in the template, the keys of the `each`es around it, and its address where the renderer has one.

- **Forbids:** an identity counted in the output, where a removed sibling renumbers the rest, and an `each` without a key.
- **From:** a renderer that runs twice has to find the node it made the first time. Pug cannot offer this, because it produces a string.

## pug-before-invention

Where Pug already has a form and it fits KDL, kdlet takes it: `+name` for a call, `block`, `else`, `else` after `each`, classes on an element's name, inputs that are not declared.

- **Forbids:** a new spelling for something Pug already spells well.
- **From:** the language exists because Pug reads well. A form its readers already know costs them nothing.
