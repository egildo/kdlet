<p align="center"><img src="https://codeberg.org/egildo/kdlet/raw/branch/main/docs/logo.svg" alt="kdlet" width="260"></p>

**The HTML renderer for [kdlet](https://www.npmjs.com/package/kdlet), a template language written in KDL.**

It brings HTML's words to the language and writes the evaluated tree as a string.

```sh
npm install kdlet kdlet-html
```

```kdl
guard featured { is (input)kind featured }
guard has-summary { has (input)summary }

article.teaser {
    when featured class=is-featured
    h2 (input)title
    when has-summary { p.summary (input)summary }
}
```

```ts
import { evaluate, read } from 'kdlet';
import { render, vocabulary } from 'kdlet-html';

const { tree } = evaluate(read(text), { vocabulary, inputs });
const html = render(tree, { doctype: true });
```

## What it does

- **Classes on the name.** `article.teaser` is an `article` with the class `teaser`. An id is written `id=main`.
- **Pug's attribute rules.** `class` and `style` add; for every other attribute the later one wins. `#true` writes a bare attribute; `#false` and `#null` drop it.
- **Text.** A node's arguments are its text, joined in order. A child named `-` is text among child elements.
- **Everything is escaped.** Text and attribute values, always. There is no raw output.

`render` throws a `RenderError` that lists every problem, each with its line and column.

Node 20 or later, ESM only.

## Read next

- [The manual](https://codeberg.org/egildo/kdlet/src/branch/main/docs/manual.md): the language, and this renderer's own rules.
- [The repository](https://codeberg.org/egildo/kdlet).

## License

MIT.
