<p align="center"><img src="docs/logo.svg" alt="kdlet" width="260"></p>

**Templates that read like Pug, for any tree, written in KDL.**

kdlet is a small template language. A file says what a tree looks like once data is put into it: where values go, what repeats, and what appears only under a named condition. It has no elements of its own. A renderer brings its words, so the same grammar describes a web page in HTML's words and a frame in a design tool's words.

```kdl
ul.posts {
    each post in=(input)posts key=slug { li (post)title }
    else { li "No posts yet." }
}
```

With two posts the HTML renderer writes `<ul class="posts"><li>One</li><li>Two</li></ul>`. With none it writes `<ul class="posts"><li>No posts yet.</li></ul>`.

- **It is KDL.** Every file is valid [KDL](https://kdl.dev/), so there is no parser of ours to learn, and editors already highlight it.
- **No vocabulary of its own.** Element and field names belong to the renderer. The language owns six words: `define`, `guard`, `when`, `else`, `each`, `block`.
- **No expressions.** A condition is a named guard. Anything computed is supplied by the host program, by name.
- **Strict about what is missing.** A misspelt name is an error with its line and column, not an empty space in the output.
- **Every node can be found again.** The result is a plain tree in which each node carries an identity, so a renderer that runs twice can update what it made the first time.
- **One outside dependency.** The guards depend on [`@bgotink/kdl`](https://github.com/bgotink/kdl) for their KDL reader. The language depends on the guards, and the HTML renderer on the language.

## The problem

Pug made HTML pleasant to write by hand. It did so for HTML only: its conditions are JavaScript, so it runs only where JavaScript does, and what it produces is a string, so nothing can find the same node again on the next run.

Many things besides a web page are trees written by hand: a frame in a design tool, a document, a diagram. Each gets its own format, or a script.

kdlet keeps what made Pug readable and drops both ties. The language holds the structure, and a renderer holds the vocabulary. It is to KDL what XSLT is to XML, without the angle brackets.

## Sixty seconds

A home page listing posts. Some are featured, and not every post has a summary.

```kdl
define teaser title kind=standard summary=#null {
    guard featured { is (input)kind featured }
    guard has-summary { has (input)summary }

    article.teaser {
        when featured class=is-featured
        h2 (input)title
        when has-summary { p.summary (input)summary }
    }
}

main {
    h1 (input)heading
    each post in=(input)posts key=slug {
        +teaser title=(post)title kind=(post)kind summary=(post)summary
    }
}
```

The host reads the file once and evaluates it with data:

```ts
import { evaluate, read } from 'kdlet';
import { render, vocabulary } from 'kdlet-html';

const document = read(text); // document.problems: every problem, with line and column

const { tree, problems } = evaluate(document, {
  vocabulary,
  inputs: {
    heading: 'Latest',
    posts: [
      { slug: 'opening', title: 'Opening day', kind: 'featured', summary: 'We open on Monday.' },
      { slug: 'closed', title: 'Closed on Sunday', kind: 'standard' },
    ],
  },
});

const html = render(tree);
```

The result, indented here for reading:

```html
<main>
  <h1>Latest</h1>
  <article class="teaser is-featured">
    <h2>Opening day</h2>
    <p class="summary">We open on Monday.</p>
  </article>
  <article class="teaser">
    <h2>Closed on Sunday</h2>
  </article>
</main>
```

The second post has no summary. The call hands that absence on without complaint, `has-summary` is false, and no paragraph is written.

## What a file can say

| Word | What it does |
|---|---|
| `(input)name` | Reads a value the host supplied, or a parameter inside a definition |
| `(post)title` | Reads a field of the item an `each` named `post` |
| `guard` | Names a condition, built from `is`, `has`, `not`, `all` and `any`. With no body, the host supplies it |
| `when`, `else` | Apply fields or children to the element they stand in, when the named guards hold |
| `each` | Repeats its body once per record of a list. A key is required. An `else` after it covers the empty list |
| `define`, `+name` | A definition with parameters, and a call to it. `block` is where the caller's children go |

The [manual](docs/manual.md) has every rule, with worked examples.

## Renderers

A renderer supplies a vocabulary: its elements, how it reads a name, which fields add and which replace, and the tags it accepts. It receives a plain tree and never parses anything.

`kdlet-html` is the first. It reads classes off the element's name (`article.teaser`), joins `class` and `style` where Pug does, writes `#true` as a bare attribute, and escapes every value.

## Install

```sh
npm install kdlet kdlet-html
```

Node 20 or later, ESM only. A kdlet file may end in `.kdl` or in `.kdlet`; both mean the same.

| Package | What it is |
|---|---|
| [`kdlet-guards`](packages/kdlet-guards) | The guard language as plain data: `evaluate` and `problems`, and `kdlet-guards/kdl` to read and write it as KDL. kdlet uses it, and so can any program that needs named conditions |
| [`kdlet`](packages/kdlet) | The language: `read`, `evaluate`, and `defineVocabulary` for a renderer's words |
| [`kdlet-html`](packages/kdlet-html) | The HTML renderer: a vocabulary and `render(tree)` |

## Read next

| Document | What it is |
|---|---|
| [`docs/manual.md`](docs/manual.md) | The syntax and the rules, with worked examples. It owns what the language does |
| [`docs/vision.md`](docs/vision.md) | What kdlet is for and what it deliberately is not |
| [`docs/principles.md`](docs/principles.md) | The design principles, each with what it forbids |
| [`docs/glossary.md`](docs/glossary.md) | The named things of the language, matching the code |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed |

## Status

Version 0.1.0 is the first. The language and the HTML renderer are built and tested.

- **Static only.** A file is read, evaluated and rendered once. Keeping a page in step with changing inputs is the next stage and is not built.
- **The vision and the principles are proposed,** not yet ratified.
- **Some rules were chosen narrowly** and may loosen. They are listed under *Open points* in the manual.

## Working on it

```sh
pnpm install
pnpm build    # first: the packages read each other's built output
pnpm typecheck
pnpm test     # also reads every example in the manual and renders its worked examples
```

## License

MIT.
