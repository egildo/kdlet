# Glossary

The named things of kdlet, one entry each. The names are the code's names. Where a name is a KDL word, it says so. The rules themselves are in the [manual](manual.md).

**address** — A node's own name in a renderer's world, found by the vocabulary's `address` function. Part of an identity; absent when the renderer has none. In code: `Identity.address`.

**adds** — The fields of a vocabulary where a later write adds to the earlier ones instead of replacing them. A field that adds holds a list. In code: `Vocabulary.adds`.

**argument** — A KDL value on a node with no name, as `"Hours"` in `h2 "Hours"`. Owned by the renderer. In code: `args`.

**block** — The word that marks, inside a definition, where the caller's children go. A definition has at most one. In code: item kind `block`; `Scope.block`.

**call** — A node whose name starts with `+`, naming a definition and giving its parameters by name. It is expanded when a definition is available, and kept as a node of kind `call` when not. In code: item kind `call`; `OutNode.kind`.

**child field** — A field a vocabulary writes as a child node of its element, `name value…`, instead of as a property. Its value is the list of its arguments, or a structure when the node carries properties or children. In code: `Vocabulary.childFields`.

**definition** — A named, closed body with parameters, written `define` at the top of a file or supplied by the host. In code: item kind `define`; `EvaluateOptions.definitions`.

**document** — What `read` returns: the file's top-level nodes with their positions, and the problems found reading. In code: `Document`.

**each** — The word that repeats a body once per item of a list, naming the item, the list and the key. In code: item kind `each`.

**element** — A node the renderer names and the language passes on, as `li` or `BOX`. The tag `(element)` forces a node to be one. In code: `OutNode.kind` `element`; `Item.forced`.

**else** — The word that follows a `when` or an `each`: the next case of a chain, or what applies when a list is empty. In code: item kind `else`.

**evaluate** — To turn a document, inputs, host guards, host definitions and a vocabulary into a tree and problems. In code: `evaluate`, `Evaluation`.

**field** — A named value of a node, written as a property, by the name itself, by a `when`, or as a child field. In code: `OutNode.fields`.

**guard** — A condition defined once by name and used by that name. In code: item kind `guard`, whose body is `Condition[]` of `kdlet-guards`.

**guard word** — One of `is`, `has`, `not`, `all` and `any`, written inside a guard's body. They belong to `kdlet-guards`. In code: `Condition`.

**host** — The program that calls kdlet: it supplies the text, the inputs, the vocabulary, its guards and its definitions. In code: whatever calls `read` and `evaluate`. In `kdlet-guards` the host is the object that answers for a condition: it resolves references, supplies guards and registers words. kdlet builds one for each scope it evaluates in. In code: `Host` of `kdlet-guards`.

**host guard** — A guard declared in a file with no body. The host supplies it as a function of the inputs and items in scope where it was written. In code: `GuardFn`, `GuardScope`, `EvaluateOptions.guards`. kdlet hands it to `kdlet-guards` as a guard that is a function.

**host tag** — A tag on a value that the vocabulary accepts, such as `(literal)8`. The evaluator keeps the value as `{ tag, value }` and does not interpret it. In code: `Vocabulary.tags`.

**host word** — A top-level node name the host claims. The reader hands such a node back unread. In code: `ReadOptions.words`; item kind `host`.

**identity** — What a node of the output carries so it can be found again: its place, its keys and, where there is one, its address. In code: `Identity`.

**input** — A named value the host supplies, read with `(input)name`. Inside a definition the same tag reads a parameter. In code: `EvaluateOptions.inputs`; `Ref.from` is `input`.

**item** — The record an enclosing `each` is currently on, under the name the author gave it. Read with `(item)field`. In code: `Scope.items`; `Ref.from` is the item's name.

**key** — The field of a record that identifies it in an `each`, and its value. The keys of the enclosing `each`es are part of a node's identity. In code: `Key`, `Identity.keys`.

**loc** — A position in a file, line and column, one-based. In code: `Loc`.

**missing** — A value that is not there: an input or field that was not given, or is `undefined`. `#null` is a value, not a missing one. An error where it would be shown.

**node** — A node of the output tree. In code: `OutNode`. Also a KDL node, in the source.

**parameter** — A name a definition takes: bare when required, with a value when optional. In code: `Param`.

**pass-through** — What happens to a call no definition was supplied for: it becomes a node of kind `call` in the output.

**place** — Where a node is written inside its parent in the file, as the indexes of nodes joined with `/`; a node an expanded call produced has the call site in front, joined with `>`. In code: `Identity.place`.

**problem** — Something wrong, with its message, line and column. One run reports all of them. In code: `Problem`.

**read** — To turn KDL text into a document, checking everything that follows from the file alone. In code: `read`.

**reference** — A value whose tag is `input` or an item's name, naming one field: `(input)title`, `(post)title`. In code: `Ref`.

**registered word** — In `kdlet-guards`, a word the host adds to the guard language, such as one that tests something no file can say, or one that wraps conditions and reads their traces. Not a host word: that is a top-level word of a file. kdlet registers none. In code: `Word`, `Host.words`.

**renderer** — The program that turns the evaluated tree into something: an HTML string, a page, the nodes of a tool. It supplies a vocabulary. Not a type in the code; `kdlet-html` is one.

**reserved word** — One of `define`, `guard`, `when`, `else`, `each` and `block`: no element may take it. In code: `RESERVED`.

**scope** — What a body can see where it is written: the inputs or parameters, the items of enclosing `each`es, and the guards in scope. A definition's scope is closed. In code: the evaluator's `Scope` and the reader's.

**structure** — The value of a child field written with properties or children: the node's name, arguments, properties and nested nodes as plain JSON, with positions. In code: `Structure`.

**tag** — The word in parentheses before a KDL value or node. On a value it makes a reference (`input`, an item name) or a host tag; on a node the only tag is `element`.

**text node** — The HTML renderer's own convention: a child node named `-` holds text among child elements. Not part of the language.

**trace** — What evaluating a condition leaves: for each node of the condition whether it held, what a registered word reported about itself, and what went wrong there. A screen can tick each condition from it. In code: `Trace`.

**value** — A KDL value, with its tag and position, in the source; plain JSON in the output. In code: `Value`, `Json`.

**vocabulary** — What a renderer supplies: its elements, how a name is read, its child fields, which fields add, how an address is found and its host tags. Registered with `defineVocabulary`, which refuses a collision with the language's words. In code: `Vocabulary`.

**when** — The word that names guards inside an element: when all hold, its properties and children apply to that element. In code: item kind `when`.
