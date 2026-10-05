# kdlet: the syntax manual

> **Status: built in version 0.1.0.** Every rule below is implemented and has a test. Every `kdl` example in this file is itself a test: it is read without problems, and the worked examples are evaluated with the inputs shown and rendered to exactly the output shown. The syntax was settled in a planning session on 3 October 2026. What that session left open, and what the build had to choose, is in the *Open points* table at the end.

## What it is

A template says what a tree looks like once data is put into it. Pug does this for HTML, and only for HTML, because its expressions are JavaScript and its output is a string.

kdlet keeps Pug's idea and drops both ties. It is written in [KDL](https://kdl.dev/), so it needs no lexer or parser of its own. It has no elements of its own: a **renderer**, the program that turns the result into an HTML file, a live page or the nodes of some other tool, brings its own words. And its output is a plain tree in which every node has an identity, so a renderer can find the same node again on the next run.

```
file ─read─▶ source document ─evaluate with inputs─▶ plain tree, every node identified ─▶ renderer
 KDL         the language's words                                                         its own words
```

The language provides fundamentals only: inputs, references, guards, `when`, `each`, definitions and calls. Everything else a file says comes from the renderer's vocabulary.

A file may end in `.kdl` or in `.kdlet`. Both mean the same. The first is what editors already highlight; the second says that the file is a template. The core takes text and never looks at a file name.

## How a node is read

KDL gives a node four parts. The language says who owns each.

| Part | Example | Owner |
|---|---|---|
| Name | `li.task`, `BOX` | The renderer, unless the name is a reserved word or starts with `+` |
| Arguments | `h2 (post)title` | The renderer. HTML reads them as text; another renderer may read the first as the node's name |
| Properties | `href="/about"` | Fields of the node, named as the renderer names them |
| Children | `{ … }` | Elements, fields the renderer writes as child nodes, or the language's words |

A renderer may read more out of a name. The HTML renderer splits `li.task` on its dots into an element and its classes, as Pug does. `#` is reserved by KDL, so an id is written `id=main`. There is no implied `div`: a name that starts with a dot is an error.

## Reserved words

A renderer's element may not take one of these names: `define`, `guard`, `when`, `else`, `each`, `block`.

The check runs when a renderer registers its vocabulary, so a collision is found once and never in an author's file. For the rare element that must have a reserved name, a tag on the node is the escape:

```kdl
(element)when "Opening hours"
```

Inside a guard's body the language owns every word (`is`, `has`, `all`, `any`, `not`), and no element can appear there, so those are not reserved elsewhere.

A host may also claim **top-level words** of its own, such as the name of a list of settings. The reader hands such a node back unread, with its position, and does not treat it as an element. The words are an option of `read`; they cannot be reserved words or start with `+`.

## Values and tags

A value is a KDL value: a string, a number, `#true`, `#false`, `#null`. KDL lets a value carry a tag in parentheses, and the tag is the language's one extension point.

| Tag | Meaning | Owner |
|---|---|---|
| `(input)title` | The input named `title`, or inside a definition the parameter named `title` | The language |
| `(post)title` | The field `title` of the item an enclosing `each` called `post` | The language; the author chose the word |
| `(literal)8`, `(markdown)"…"` | Whatever the renderer defines; the evaluator keeps it as `{ tag, value }` | The renderer |

An author's item name may not be `input`, may not be `element`, and may not equal a tag the renderer defined. An item name that an enclosing `each` already uses is refused too.

**A reference names a single field.** `(post)title` is the field `title`. A name with a dot in it, such as `(post)author.name`, is refused: paths are not part of the language yet (see *Open points*).

There is no interpolation inside strings. Braces in a string mean nothing to the language, so `"{space.md}"` is free to be a consumer's own reference syntax.

## Inputs

A file is evaluated with **inputs**: named values the host program supplies. The language computes nothing from them. Filtering, sorting and formatting happen before the template, in whatever prepares the data.

**A value arrives ready to show.** A file cannot build a link from a slug or format a date: a property takes one value, and KDL refuses a tag on a value that already has one, so `(markdown)(post)body` cannot be written. The host prepares both, and the file reads them:

```kdl
each post in=(input)posts key=slug {
    a (post)title href=(post)url
    time (post)published-text datetime=(post)published
}
```

Jekyll and Eleventy work the same way: every post arrives with its `url`. The host does more, and the data carries fields meant for display. In exchange the file stays free of functions. Text is the one thing a file can join, because a node takes several arguments: `p "Posted by " (post)author`.

**A file does not declare its inputs.** Its markup stands at the top, as in Pug, and `(input)heading` reads whatever the host passed. One rule keeps this honest, and it holds for every reference: **a missing value is an error where it would be shown**, in an element's arguments or one of its fields, with its line and column. Under `has` it is simply false. Jinja's `StrictUndefined` is the same rule; Mustache's silence is what it avoids.

That leaves one silent case, and the language lives with it. `has` exists to ask whether a value is there, so a misspelt name under `has` is false forever and nothing reports it. Declaring inputs would not close it: most references read a field of an item, `(post)summary`, and no declaration covers the shape of the data.

A value is **missing** when the input or field is not there, or is `undefined`. `#null` is a value: it is present, `has` says false, and it travels to the renderer as `null`.

## Guards

A condition is never written where it is used. It is defined once, by name, as a **guard**, and used by that name. XState names the same idea the same way.

**Where guards live.** The guard language (its words, how a condition is evaluated, how a guard's body is read from KDL and written back) is the package [`kdlet-guards`](../packages/kdlet-guards), which kdlet uses and which a program can use without kdlet. kdlet keeps what belongs to files: which guards a body can see, what `(input)` and an item's name stand for, and the functions the host supplies. The rules below are the ones a kdlet file follows. The package allows more, which a file does not: `not` over a condition and not only over a name, a guard named anywhere in a condition, and words a host registers.

```kdl
each post in=(input)posts key=slug {
    guard featured { is (post)kind featured }
    guard has-summary { has (post)summary }
    guard ordinary { not featured }

    article {
        when ordinary class=plain
        when has-summary { p (post)summary }
    }
}
```

| Word | True when |
|---|---|
| `is <reference> <value>…` | The reference equals one of the values. A value may itself be a reference: `is (link)href (input)path` |
| `has <reference>` | There is something to show (see below) |
| `not <guard>` | The named guard is false |
| `all { … }`, `any { … }` | Every child, or at least one, is true |

- A guard's body with several children is true when all of them are.
- `all` and `any` stop at the first child that settles them. So `all { has (post)kind; is (post)kind featured }` never asks `is` about a kind that is not there.
- `is` compares with strict equality: the text `"1"` is not the number `1`. A value in an `is` is plain text, a number, `#true`, `#false`, `#null` or a reference; a renderer's tagged value is refused.
- **A guard reads what is in scope where it is written,** and can be used from there inward. One about `post` is written inside the `each` that names `post`; one about the inputs is written at the top. A guard is visible in the whole body it is written in, before its line as well as after it.
- A guard name cannot be written twice in one body, and cannot repeat a name from an enclosing scope.
- **A guard with no body is the host's.** `guard pricey` declares that the host supplies it, in its own language, which is where JavaScript goes. The host passes a function for it, and the function sees the inputs and the items in scope where the guard was written. Every other name a `when` uses must be defined in the file, so a misspelt guard is caught by the reader without the host present, and the file's first lines list everything it expects from outside.

```kdl
each item in=(input)items key=sku {
    guard pricey

    li.item (item)name {
        when pricey class=is-pricey
    }
}
```

There are no expressions in a file, in any form.

**`is` is the only spelling of a match.** `is (input)State hover pressed` lists the values.

**`has` is presence, `is` is equality, and neither does the other's job.** `has` never asks whether a value is true.

| The reference is | `has` |
|---|---|
| Missing, or `#null` | False |
| An empty string | False |
| An empty list | False |
| `0` | True |
| `#false` | True |
| Anything else | True |

`0` and `#false` are values: a price of zero and a count of zero should print. Handlebars treats `0` as absent and had to add an option to undo it. A boolean is tested with `is`: `guard draft { is (post)draft #true }`.

**`is` on a missing reference is an error,** on either side of the comparison. Only `has` may ask about absence. See *Open points*.

**Parked:** a guard that takes arguments, and comparisons beyond equality. A real file should ask for each first.

## `when`

A `when` stands directly inside an element and names one or more guards. When all of them hold, what it carries applies to that element.

```kdl
each post in=(input)posts key=slug {
    guard featured { is (post)kind featured }
    guard has-summary { has (post)summary }

    article.teaser {
        when featured class=is-featured
        h2 (post)title
        when has-summary { p.summary (post)summary }
    }
}
```

- **Its arguments are guards.** It takes no condition of any other kind, and it names at least one.
- **Its properties are fields of the enclosing element.** The `when` line reads like the element's own line.
- **Its children are fields or elements of the enclosing element.** A `when` around an element decides whether the element exists. A `when` may hold another `when`, which then applies to the same element.
- **Order:** the element's own line first, then its children in file order. A later write replaces an earlier one, unless the renderer says the field adds. HTML says `class` and `style` add; a renderer of fixed settings may say every field replaces.
- The element is declared once. A `when` never declares it again.
- A `when` outside an element's body, such as directly inside an `each`, is refused: there is no element for it to set fields on.

There is no patch that reaches a node from elsewhere, and no way to move a node.

### `else`

```kdl
each post in=(input)posts key=slug {
    guard featured { is (post)kind featured }
    guard pinned { is (post)kind pinned }
    guard has-summary { has (post)summary }

    article.teaser {
        when featured class=is-featured
        else pinned class=is-pinned
        else class=is-plain

        when has-summary { p.summary (post)summary }
        else { p.muted "No summary." }
    }
}
```

- **An `else` belongs to the `when` just before it.** Just before means the previous node: another node in between, or an `else` that has no guard, ends the chain. One with nothing before it is an error.
- **It has the shape of a `when`:** fields on its line, children in its braces.
- **With guards it is "else, when".** `else pinned` is tried only if `featured` failed, and the first that holds wins. Its guards are not asked at all once an earlier one held.
- **After an `each`, it applies when the list is empty** (see `each`). It takes no guard there.

## `each`

```kdl
each post in=(input)posts key=slug {
    h2 (post)title
}
```

- `each <item> in=<reference> key=<field> { body }` evaluates the body once per item of a list.
- **The key is required.** It names the field that identifies an item, so that a post inserted at the top does not turn every post after it into its neighbour. A key is text or a number. Two items with one key are an error, and the comparison is on the written form, so `1` and `"1"` are one key.
- An `each` may stand inside another.
- The list must be there and must be a list. A missing list is an error, not an empty one.
- **An `else` after an `each` applies when the list is empty,** as in Pug:

```kdl
ul {
    each post in=(input)posts key=slug { li (post)title }
    else { li "No posts yet." }
}
```

**A list holds records.** A plain value has no field to be its key, and no field to read it by. So a post's tags arrive as records with a `name`, prepared by the host like any other value: `each tag in=(post)tags key=name { li (tag)name }`. Mustache and XSLT write a dot for "the item itself"; `(tag).` parses as KDL and can be added later without changing any file.

## Definitions and calls

```kdl
define card title {
    article.card {
        h2 (input)title
        block
    }
}

+card title="Opening hours" { p "Monday to Friday, 9 to 18." }
```

- **`define <name> <parameter>…`** is a name, its parameters and a body. It stands at the top of the file, and each name is defined once.
- **A bare parameter is required; one with a value is optional.** `define teaser title kind=standard summary=#null` must be given `title`, uses `standard` when the call leaves `kind` out, and has no `summary` unless one is given. It is Python's signature, and Jinja's macros have the same shape. A default is a plain value; it cannot read an input.
- **`+name`** is a call, as in Pug. No element can start with `+`, so a call never collides with a renderer's word.
- **Values go by name.** A parameter the definition lacks is refused, and so is a call that leaves out a required one. A call takes no arguments.
- **Absence travels through a call.** `summary=(post)summary` passes the reference along, and that is not reading it: a post with no summary gives a teaser with none. The error comes only where a missing value would be shown.
- **Inside the body, `(input)title` reads a parameter**, exactly as a file reads its inputs.
- **`block`** is where the caller's children go. A definition has at most one. The caller's children are read in the caller's scope: they see the caller's items and guards, not the definition's parameters. A call with children to a definition that has no `block` is an error.
- **A definition is closed.** Its body sees its parameters, its `block` and the guards written inside it, and nothing else. So it can be checked on its own and supplied by any host. The cost: a guard two definitions share is written in each. Pug is open here; a mixin sees every variable of the template around it.
- A body may call other definitions. A definition that calls itself, directly or through others, is an error.
- **A call is expanded when its definition is available, and passed through as a call when it is not.** A definition is available when the file defines it or the host supplies it. A host that supplies a definition the file also defines is an error. The HTML renderer's host supplies bodies, so its calls expand in place. A host whose renderer keeps its own definitions supplies none, receives the call as a node of its own kind, and expands it its own way.

Because each renderer supplies its own definitions, one name can have a different body per renderer. That is the whole of what the language does for a file meant for several renderers; nothing else is built for it.

**Left out:** Pug's extra attributes on a call. A definition that wants a class declares a parameter for it. Also `include`: the host hands the evaluator its definitions.

## Identity

A renderer that runs twice has to find the node it made the first time. So every node of the output carries three things, and the language computes them.

- **Its place in the template:** where it is written inside its parent, in the file. Not where it lands in the output: a `when` that removes an element would then turn every sibling after it into its neighbour.
- **The keys** of the `each`es around it, outermost first.
- **Its address,** when the renderer's words give it one.

Place and keys together are always unique across the output tree.

A place is the index of each node among its parent's nodes in the file, joined with `/`. A `when`, an `else` or an `each` counts as a node and its body continues the path, so `2/0/1` is the second node of the first body inside the node at index `0` of the node at index `2`. Calls and guards count as nodes too, which is why a place does not move when a `when` stops matching.

A node an expanded call produced has the call site in front: `3>0/1` is the second child of the first node of what the call at `3` expanded to. Two calls of one definition therefore never collide. The caller's own children, which land inside the definition's `block`, keep the place where the caller wrote them.

**The limit.** A place survives every re-evaluation of one file. It does not survive an edit to the file: an element inserted above gives every unnamed sibling below it a new place. A renderer that must find its nodes again after an edit requires addresses and uses those instead.

| Renderer | What it needs | What it uses |
|---|---|---|
| Static HTML | Nothing; the output is written once | none |
| Live page | The same node across re-evaluations of one file | Place and keys |
| A tool with named nodes | The same node across edits to the file | Addresses |

## What a renderer supplies

A renderer supplies a **vocabulary**: a plain object, registered with `defineVocabulary`.

| Member | What it says |
|---|---|
| `elements` | The element names that exist, or `'*'` when any name is accepted |
| `readName(name)` | How a node name is read: the element, and any fields the name writes. Fields from the name are written first |
| `childFields` | Child node names that are fields of their element, not child elements. A field written with arguments only holds the list of them; written with properties or children it holds a structure (see *Structured fields*) |
| `adds` | The fields where a later write adds to the earlier ones. Every other field is replaced |
| `address(node)` | How a node's address is found, from its element, arguments and fields |
| `tags` | The host tags it accepts, such as `literal` |

Registration refuses an element or child field that is a reserved word or starts with `+`, and a tag called `input` or `element`.

Beyond the vocabulary, the host gives the evaluator its **definitions** (documents whose `define`s should be expanded), its **host guards** (a function for each guard the file declares without a body) and its **inputs**.

A node named as a child field is a field only directly inside an element. Anywhere else, such as inside an `each`, it is an error; `(element)name` makes it an element.

### Structured fields

A renderer may have a field whose value is a structure: a cell in a grid, a list of tracks. KDL writes that as a node with properties or children, and a child field may do the same.

- **Arguments only** is the list of the arguments, as before: `EDGES left right` is `["left", "right"]`, and `EDGES` alone is the empty list.
- **Properties or children** make it a **structure**. The evaluator hands the renderer plain JSON: the node's `name`, its `args`, its `props` by name, its `children` (each a structure of the same shape) and the position of each, `loc`, `argLocs` and `propLocs`. The field's own place in the node's `fieldLocs` is the line of the field.
- **References and host tags behave as everywhere.** A missing value is an error at its own position, and an unknown tag is refused.
- **A structure holds plain nodes only.** A `when`, an `else`, an `each`, a call or a `guard` inside its body is an error: a structure is data, and its conditions belong to the element around it. A `when` that stands beside the field in the element may write the whole structure again.
- **It follows the field's rule.** A field that replaces is replaced whole by a later write, a `when`'s included. A field that adds receives the structure as one more item of its list, after the arguments of earlier writes.
- **The vocabulary says what it means.** The language checks nothing about the names and numbers inside; a renderer checks them on the tree it gets.

```kdl tracks
BOX Table direction=ROWS {
    TRACKS {
        STRETCH
        SIZE 40
        STRETCH 1.5
    }
    BOX Cell {
        PLACE row=0 column=1
    }
}
```

Here `TRACKS` holds three nested structures, and `PLACE` one with two properties. A renderer that knows `STRETCH` and `SIZE` as track kinds reads `1.5` as the number the node carries.

## The output

A plain tree, JSON all the way down, so it can travel into another runtime. Each node holds its kind, its name, its identity, its arguments, its fields, its children and the position in the file each of those came from. A call that was not expanded is a node of the kind `call`.

A field written once holds its value. A field that adds holds a list. A field written as a child node holds the list of its arguments, or a structure when it carries properties or children.

Every problem carries a line and a column, and one run reports all of them. Evaluation does not run on a document that did not read cleanly. Evaluating the same document again with other inputs is the expected use.

## The HTML renderer

The `kdlet-html` package supplies the vocabulary and `render`.

- Any element name is accepted. A dotted name is an element and its classes: `tr.row.wide`. An id is written `id=main`.
- Arguments are text, joined in order with nothing between. A child node named `-` is text among child elements. The `-` convention belongs to the HTML renderer and not to the language.
- `class` and `style` add; every other attribute: the later write wins. `style` pieces are joined with a semicolon after each, as Pug does.
- `#true` writes a bare attribute. `#false` and `#null` write nothing.
- **Every text and attribute value is escaped.** There is no raw output, and so the text of a `script` or `style` element is escaped too.
- Void elements (`br`, `img`, `input`, `meta`, `link`, `hr` and the rest) have no closing tag and take no content.
- A call that was passed through unexpanded is an error for this renderer.
- Text and attribute values are text or numbers. Anything else, such as a list, is an error with the node's position.
- `render` throws a `RenderError` that lists every problem it found, each with the line and column of its node. A tree that evaluated without problems can still be refused here, because what counts as text is this renderer's rule.
- The one option is `doctype`, which writes `<!DOCTYPE html>` and a newline first.

```kdl
each post in=(input)posts key=slug {
    p {
        - "Read "
        a (post)title href=(post)url
        - " by "
        em (post)author
    }
}
```

## Worked examples

**A navigation menu that marks the current page.**

```kdl nav-menu
nav {
    ul {
        each link in=(input)links key=href {
            guard current { is (link)href (input)path }

            li {
                a (link)label href=(link)href {
                    when current class=is-current aria-current=page
                }
            }
        }
    }
}
```

With these inputs:

```json nav-menu-inputs
{
  "path": "/about",
  "links": [
    { "label": "Home", "href": "/" },
    { "label": "Posts", "href": "/posts" },
    { "label": "About", "href": "/about" }
  ]
}
```

the HTML renderer writes:

```html nav-menu-output
<nav><ul><li><a href="/">Home</a></li><li><a href="/posts">Posts</a></li><li><a href="/about" class="is-current" aria-current="page">About</a></li></ul></nav>
```

**A home page listing posts.** Some are featured, and not every post has a summary.

```kdl post-list
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

```json post-list-inputs
{
  "heading": "Latest",
  "posts": [
    { "slug": "opening", "title": "Opening day", "kind": "featured", "summary": "We open on Monday." },
    { "slug": "closed", "title": "Closed on Sunday", "kind": "standard" },
    { "slug": "garden", "title": "The garden", "kind": "standard", "summary": "Roses are in." }
  ]
}
```

```html post-list-output
<main><h1>Latest</h1><article class="teaser is-featured"><h2>Opening day</h2><p class="summary">We open on Monday.</p></article><article class="teaser"><h2>Closed on Sunday</h2></article><article class="teaser"><h2>The garden</h2><p class="summary">Roses are in.</p></article></main>
```

The second post has no `summary`. `summary=(post)summary` hands the absence on without an error, and `has-summary` is false, so no paragraph is written.

The first draft of this example was wrong in a way worth keeping. Its guards sat at the top of the file and read the caller's item, `(post)summary`, from inside the definition. That works only when the call stands inside the one `each` that names `post`, and the definition breaks anywhere else. It is why a guard reads what is in scope where it is written, and why a definition is closed.

**A made-up renderer, one condition.** A renderer for boxes and text, invented for this manual. Its elements are `BOX` and `TEXT`, its first argument is the node's address, `EDGES` is a field written as a child node holding a list, every field replaces, and `literal` is a tag it accepts for numbers that are on purpose.

```kdl switch
guard on { is (input)state on }

BOX Toggle direction=ROW gap=(literal)8 {
    BOX Track direction=ROW align=START width=(literal)40 {
        EDGES left right
        when on align=END { EDGES left right inner }
        BOX Thumb width=(literal)20
    }
    TEXT Caption label=(input)label
}
```

With `state` set to `on`, the `when` runs after the element's own line: `align` becomes `END` and the second `EDGES` replaces the first. With any other state the box keeps `START` and the first `EDGES`. The `Track` box has the address `Track` and the place `1/0`, because the `guard` is the node at index `0` of the file and `Toggle` the one at index `1`; it has no keys.

## Open points

| Point | State |
|---|---|
| The file extension | Settled: `.kdl` and `.kdlet` both work and mean the same |
| A reference that names a path, `(post)author.name` | Open. A reference names a single field and a name with a dot is refused until the paths are settled |
| Guard arguments; comparisons beyond equality | Parked until a file needs one |
| Several named places for a caller's children; an item's index; a dot for a plain item | Parked until a file needs one |
| `include`; extra attributes on a call | Left out |
| Conditions inside a structured field | Not allowed in 0.1.0: a structure holds plain nodes, and a `when` beside the field rewrites it whole. Parked until a file needs one |
| Moving a node; expressions in a file | Decided against |
| A live renderer | Not built. It is the second stage in the [vision](vision.md) |
| A command line | Not built |
| `is` on a missing reference | Chosen narrowly in 0.1.0: an error, so that `has` is the only silent case. The maintainer is to confirm |
| A definition calling another definition | Chosen in 0.1.0: allowed, with a call that never ends refused. The maintainer is to confirm |
| Where `when` and `else` may stand | Chosen narrowly in 0.1.0: directly in an element's body, or after an `each` anywhere. The maintainer is to confirm |
| Where a `guard` may stand, and shadowing | Chosen in 0.1.0: in any body, visible throughout it; a name is never redefined in an inner scope. The maintainer is to confirm |
| One `block` per definition | Chosen narrowly in 0.1.0, so that place and keys stay unique. The maintainer is to confirm |
| A definition both in the file and supplied by the host | Chosen narrowly in 0.1.0: an error. The maintainer is to confirm |
| Problems in code that does not run | Weaker than it could be: the reader finds shape errors and unknown guards everywhere, but an unknown tag, an unknown parameter or a missing value is found only where evaluation reaches |
