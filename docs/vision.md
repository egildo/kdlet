# Vision

> **Proposed — to be ratified by the maintainer.** Drawn from the decisions of the planning session of 3 October 2026. Once ratified, this document changes only on purpose, with the reason recorded.

> **When the vision and the principles collide:** the vision decides what kdlet is and what it is for; the [principles](principles.md) decide how it gets built. Neither is overridden by a plan, a spec or convenience.

## What it is for

A tree that is written by hand should be readable by a person. Pug made that true for HTML, and only for HTML: its conditions are JavaScript, and what it produces is a string.

kdlet keeps Pug's readability and drops both ties. It is a template language written in [KDL](https://kdl.dev/). A file says what a tree looks like once data is put into it: where values go, what repeats, and what appears only under a named condition.

The language has no elements of its own. A **renderer**, the program that turns the result into something real, brings its words. So one grammar describes a web page in HTML's words and a frame in a design tool's words, and whoever has learned to read one file can read the other.

What every renderer receives is a plain tree in which each node can be found again on the next run. A renderer that writes a file once does not need that. One that updates a page while it is open, or changes a document in place, cannot work without it.

## Who it serves

- **The author** of a file, who wants to read it a year later.
- **The writer of a renderer**, who brings a vocabulary and receives a tree, and never parses anything.
- **The host**, the program that supplies the data and whatever has to be computed.

## The stages

1. **Static.** Read a file, evaluate it, render it once. Built, with one renderer, for HTML.
2. **Live.** The same file kept in step with changing inputs, in a running page. Not built. The identity every node already carries is there for it.

## What it deliberately is not

Each exclusion names what adding it back would cost.

- **Not a programming language.** A file computes nothing. Adding expressions means a grammar of our own inside strings, or a tie to one host's language.
- **Not a vocabulary.** No element or field belongs to the language. Adding one means a shared idea of what an element is, which is either too small to build with or as large as its largest renderer.
- **Not one file for every renderer.** A file is written in one renderer's words. The language offers a single thing toward more: a definition can be supplied per renderer, under one name.
- **Not where data is prepared.** Sorting, filtering and formatting happen before the template. Adding them brings the expressions back.
- **Not aware of who uses it.** The language provides fundamentals, and what is built on them stays outside. Adding one consumer's logic makes every other consumer carry it.
