<p align="center"><img src="https://codeberg.org/egildo/kdlet/raw/branch/main/docs/logo.svg" alt="kdlet" width="260"></p>

**Templates that read like Pug, for any tree, written in KDL.**

kdlet is a small template language. A file says what a tree looks like once data is put into it: where values go, what repeats, and what appears only under a named condition. It has no elements of its own; a renderer brings its words.

This package is the language. It reads a file and evaluates it into a plain tree. To get HTML out, add [`kdlet-html`](https://www.npmjs.com/package/kdlet-html).

```sh
npm install kdlet kdlet-html
```

```kdl
ul.posts {
    each post in=(input)posts key=slug { li (post)title }
    else { li "No posts yet." }
}
```

```ts
import { evaluate, read } from 'kdlet';
import { render, vocabulary } from 'kdlet-html';

const document = read(text); // document.problems: every problem, with line and column
const { tree, problems } = evaluate(document, { vocabulary, inputs: { posts } });
const html = render(tree);
```

## What it exports

| Export | What it does |
|---|---|
| `read(text, options?)` | KDL text to a document, with every problem found and its line and column |
| `evaluate(document, options)` | A document, inputs, the host's guards and definitions, and a vocabulary, to a plain tree in which every node has an identity |
| `defineVocabulary(vocabulary)` | Registers a renderer's words, and refuses a collision with the language's |

Node 20 or later, ESM only.

## Read next

- [The manual](https://codeberg.org/egildo/kdlet/src/branch/main/docs/manual.md): the syntax and every rule, with worked examples.
- [The repository](https://codeberg.org/egildo/kdlet): the vision, the principles and the source.

## License

MIT.
