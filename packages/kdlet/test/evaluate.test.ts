import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineVocabulary, evaluate, read } from '../src/index.js';
import { assertUnique, boxes, flatten, guards, plain, run, shape } from './helpers.js';

/** One problem, at this position, saying this. */
function problem(text: string, at: string, message: RegExp, options: Parameters<typeof run>[1] = {}): void {
  const { lines } = run(text, options);
  assert.equal(lines.length, 1, `expected one problem, got:\n${lines.join('\n')}`);
  assert.match(lines[0], new RegExp(`^${at} `));
  assert.match(lines[0], message);
}

// ---------------------------------------------------------------------------
// References and missing values
// ---------------------------------------------------------------------------

test('an input is read where it is written, and an item field in an each', () => {
  const r = run('h1 (input)title\neach p in=(input)posts key=slug { li (p)name }', {
    inputs: { title: 'Hello', posts: [{ slug: 'a', name: 'One' }, { slug: 'b', name: 'Two' }] },
  });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(shape(r.tree), [
    { kind: 'element', name: 'h1', args: ['Hello'], fields: {}, children: [] },
    { kind: 'element', name: 'li', args: ['One'], fields: {}, children: [] },
    { kind: 'element', name: 'li', args: ['Two'], fields: {}, children: [] },
  ]);
});

test('a missing value is an error where it would be shown: in an argument', () => {
  problem('p (input)title', '1:3', /\(input\)title has no value here/);
});

test('a missing value is an error where it would be shown: in a field', () => {
  problem('p id=(input)title', '1:3', /\(input\)title has no value here/);
  problem('p {\n  when g id=(input)x\n}\nguard g { has (input)y }', '2:10', /\(input\)x has no value/, { inputs: { y: 1 } });
});

test('a missing item field is an error too, at its own position', () => {
  problem('each p in=(input)xs key=k {\n  li (p)name\n}', '2:6', /\(p\)name has no value/, { inputs: { xs: [{ k: 1 }] } });
});

test('#null is a value, not a missing one: it travels', () => {
  const r = run('p (input)x', { inputs: { x: null } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree[0].args, [null]);
});

test('an unknown tag is refused where it is met', () => {
  problem('p (markdown)"x"', '1:3', /unknown tag "\(markdown\)"/);
});

test('has: what counts as something to show', () => {
  const doc = `r {
    guard a { has (input)a }
    guard b { has (input)b }
    guard c { has (input)c }
    guard d { has (input)d }
    guard e { has (input)e }
    guard f { has (input)f }
    guard g { has (input)g }
    guard h { has (input)h }
    when a has-a=#true
    when b has-b=#true
    when c has-c=#true
    when d has-d=#true
    when e has-e=#true
    when f has-f=#true
    when g has-g=#true
    when h has-h=#true
  }`;
  const r = run(doc, { inputs: { a: 0, b: false, c: '', d: [], e: null, f: 'x', g: {} } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(Object.keys(r.tree[0].fields), ['has-a', 'has-b', 'has-f', 'has-g']);
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const fieldsOf = (text: string, inputs: Record<string, unknown> = {}) => {
  const r = run(text, { inputs });
  assert.deepEqual(r.problems, []);
  return r.tree[0].fields;
};

test('is: equal to any of the values, which may be references', () => {
  const doc = `r {
    guard one { is (input)s a b }
    guard two { is (input)s (input)t }
    guard num { is (input)n 1 }
    guard bool { is (input)b #true }
    when one one=#true
    when two two=#true
    when num num=#true
    when bool bool=#true
  }`;
  assert.deepEqual(fieldsOf(doc, { s: 'b', t: 'b', n: 1, b: true }), { one: true, two: true, num: true, bool: true });
  assert.deepEqual(fieldsOf(doc, { s: 'z', t: 'y', n: '1', b: 'true' }), {});
});

test('is on a missing reference is an error, on either side', () => {
  problem('guard g { is (input)s a }\nr { when g x=1 }', '1:14', /\(input\)s has no value here; ask with "has"/);
  problem('guard g { is (input)s (input)t }\nr { when g x=1 }', '1:23', /\(input\)t has no value/, { inputs: { s: 'a' } });
});

test('is compares plain values and references, not a renderer tag', () => {
  problem('guard g { is (input)s (literal)1 }\nr { when g x=1 }', '1:23', /plain values and references/, { inputs: { s: 1 } });
});

test('not, all and any, and a body with several children is all of them', () => {
  const doc = `r {
    guard a { has (input)a }
    guard b { has (input)b }
    guard notA { not a }
    guard both { all { has (input)a; has (input)b } }
    guard either { any { has (input)a; has (input)b } }
    guard implicit { has (input)a; has (input)b }
    when notA not-a=#true
    when both both=#true
    when either either=#true
    when implicit implicit=#true
  }`;
  assert.deepEqual(fieldsOf(doc, { a: 1 }), { either: true });
  assert.deepEqual(fieldsOf(doc, { a: 1, b: 1 }), { both: true, either: true, implicit: true });
  assert.deepEqual(fieldsOf(doc, {}), { 'not-a': true });
});

test('all and any stop at the first child that settles them', () => {
  const doc = 'guard g { all { has (input)k; is (input)k v } }\nr { when g x=#true }';
  const r = run(doc, { inputs: {} });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree[0].fields, {});
});

test('a guard reads what is in scope where it is written', () => {
  const doc = `each p in=(input)posts key=slug {
    guard featured { is (p)kind featured }
    li (p)slug {
        when featured class=hot
    }
}`;
  const r = run(doc, { inputs: { posts: [{ slug: 'a', kind: 'featured' }, { slug: 'b', kind: 'plain' }] } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree.map((n) => n.fields), [{ class: ['hot'] }, {}]);
});

test('a host guard is a function of the inputs and items where it was written', () => {
  const seen: unknown[] = [];
  const r = run(
    `each item in=(input)items key=sku {
    guard pricey
    li (item)sku { when pricey class=pricey }
}`,
    {
      inputs: { items: [{ sku: 'a', price: 5 }, { sku: 'b', price: 500 }], limit: 100 },
      guards: guards({
        pricey: (scope) => {
          seen.push(scope);
          return (scope.items.item.price as number) > (scope.inputs.limit as number);
        },
      }),
    },
  );
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree.map((n) => n.fields), [{}, { class: ['pricey'] }]);
  assert.deepEqual((seen[0] as { inputs: unknown }).inputs, { items: [{ sku: 'a', price: 5 }, { sku: 'b', price: 500 }], limit: 100 });
});

test('a host guard with no function supplied, or one that does not answer true or false, is an error at its use', () => {
  const doc = 'guard pricey\nr { when pricey x=1 }';
  problem(doc, '2:10', /guard "pricey" is the host's and the host supplied none/);
  problem(doc, '2:10', /returned string/, { guards: { pricey: (() => 'yes') as never } });
});

test('guards that depend on themselves are an error, not a hang', () => {
  problem('guard a { not b }\nguard b { not a }\nr { when a x=1 }', '2:15', /depends on itself/);
});

// ---------------------------------------------------------------------------
// when and else
// ---------------------------------------------------------------------------

test('a when carries fields and children for its element; the element is written once', () => {
  const doc = `guard on { has (input)on }
box a=1 {
    when on b=2 { span; em }
    p
}`;
  assert.deepEqual(shape(run(doc, { inputs: { on: 1 } }).tree), [
    {
      kind: 'element', name: 'box', args: [], fields: { a: 1, b: 2 },
      children: [
        { kind: 'element', name: 'span', args: [], fields: {}, children: [] },
        { kind: 'element', name: 'em', args: [], fields: {}, children: [] },
        { kind: 'element', name: 'p', args: [], fields: {}, children: [] },
      ],
    },
  ]);
  assert.deepEqual(shape(run(doc).tree), [
    { kind: 'element', name: 'box', args: [], fields: { a: 1 }, children: [{ kind: 'element', name: 'p', args: [], fields: {}, children: [] }] },
  ]);
});

test('all guards of a when must hold', () => {
  const doc = 'guard a { has (input)a }\nguard b { has (input)b }\nr { when a b x=1 }';
  assert.deepEqual(run(doc, { inputs: { a: 1 } }).tree[0].fields, {});
  assert.deepEqual(run(doc, { inputs: { a: 1, b: 1 } }).tree[0].fields, { x: 1 });
});

test('order: the line first, then children in file order; later replaces, unless the field adds', () => {
  const doc = `guard g { has (input)g }
r x=1 class=a {
    when g x=2 class=b
    q x=#null
    when g x=3 class=c
}`;
  const r = run(doc, { inputs: { g: 1 } });
  assert.deepEqual(r.tree[0].fields, { x: 3, class: ['a', 'b', 'c'] });
  assert.deepEqual(r.tree[0].fieldLocs, { x: { line: 5, column: 12 }, class: { line: 5, column: 16 } });
});

test('else: the first that holds wins, and a guard after a winner is not asked', () => {
  const asked: string[] = [];
  const doc = `guard a
guard b
guard c
r {
    when a x=a
    else b x=b
    else c x=c
    else x=other
}`;
  const answer = (name: string, value: boolean) => () => (asked.push(name), value);
  const evaluateWith = (a: boolean, b: boolean, c: boolean) => {
    asked.length = 0;
    const r = run(doc, { guards: guards({ a: answer('a', a), b: answer('b', b), c: answer('c', c) }) });
    assert.deepEqual(r.problems, []);
    return [r.tree[0].fields.x, asked.join('')];
  };
  assert.deepEqual(evaluateWith(true, true, true), ['a', 'a']);
  assert.deepEqual(evaluateWith(false, true, true), ['b', 'ab']);
  assert.deepEqual(evaluateWith(false, false, true), ['c', 'abc']);
  assert.deepEqual(evaluateWith(false, false, false), ['other', 'abc']);
});

test('else carries children like a when does', () => {
  const doc = `guard has { has (input)s }
r {
    when has { p (input)s }
    else { p.muted "None." }
}`;
  assert.deepEqual(shape(run(doc, { inputs: { s: 'x' } }).tree)[0], {
    kind: 'element', name: 'r', args: [], fields: {}, children: [{ kind: 'element', name: 'p', args: ['x'], fields: {}, children: [] }],
  });
  assert.equal((run(doc).tree[0].children[0].args as string[])[0], 'None.');
});

// ---------------------------------------------------------------------------
// each
// ---------------------------------------------------------------------------

test('each: the keys of its items go into identity, nested ones outermost first', () => {
  const doc = `each a in=(input)xs key=id {
    ul { each b in=(a)ys key=id { li (b)id } }
}`;
  const r = run(doc, { inputs: { xs: [{ id: 'p', ys: [{ id: 1 }, { id: 2 }] }, { id: 'q', ys: [{ id: 1 }] }] } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    flatten(r.tree).filter((n) => n.name === 'li').map((n) => n.identity.keys),
    [['p', 1], ['p', 2], ['q', 1]],
  );
  assertUnique(r.tree);
});

test('each: two items with one key are an error, at the key', () => {
  problem('each p in=(input)xs key=slug { li (p)slug }', '1:21', /two items of \(input\)xs have the key "a"/, { inputs: { xs: [{ slug: 'a' }, { slug: 'a' }] } });
  problem('each p in=(input)xs key=slug { li }', '1:21', /two items .* the key "1"/, { inputs: { xs: [{ slug: 1 }, { slug: '1' }] } });
});

test('each: a key must be there, and a list holds records', () => {
  problem('each p in=(input)xs key=slug { li }', '1:21', /no text or number in "slug"/, { inputs: { xs: [{ other: 1 }] } });
  problem('each p in=(input)xs key=slug { li }', '1:8', /not one/, { inputs: { xs: ['plain'] } });
});

test('each: a missing or non-list value is an error, not an empty list', () => {
  problem('ul { each p in=(input)xs key=k { li } }', '1:13', /\(input\)xs has no value here, so there is no list/);
  problem('ul { each p in=(input)xs key=k { li } }', '1:13', /not a list/, { inputs: { xs: 'text' } });
});

test('each: an item name may not equal a tag of the renderer', () => {
  const boxy = run('each literal in=(input)xs key=k { BOX }', { vocabulary: boxes, inputs: { xs: [{ k: 1 }] } });
  assert.deepEqual(boxy.lines, ['1:1 "literal" is a tag of the renderer and cannot be an item name']);
});

test('else after an each applies when the list is empty, and only then', () => {
  const doc = 'ul {\n  each p in=(input)xs key=k { li (p)k }\n  else { li "No posts yet." }\n}';
  assert.deepEqual(run(doc, { inputs: { xs: [] } }).tree[0].children.map((c) => c.args), [['No posts yet.']]);
  assert.deepEqual(run(doc, { inputs: { xs: [{ k: 'a' }] } }).tree[0].children.map((c) => c.args), [['a']]);
});

test('else after an each in an element sets that element\'s fields when empty', () => {
  const doc = 'ul {\n  each p in=(input)xs key=k { li }\n  else class=empty\n}';
  assert.deepEqual(run(doc, { inputs: { xs: [] } }).tree[0].fields, { class: ['empty'] });
  assert.deepEqual(run(doc, { inputs: { xs: [{ k: 1 }] } }).tree[0].fields, {});
});

// ---------------------------------------------------------------------------
// define and call
// ---------------------------------------------------------------------------

const teaser = `define teaser title kind=standard summary=#null {
    guard featured { is (input)kind featured }
    guard has-summary { has (input)summary }
    article.teaser {
        when featured class=is-featured
        h2 (input)title
        when has-summary { p.summary (input)summary }
    }
}
`;

test('a definition is expanded in place: required and optional parameters, defaults', () => {
  const r = run(`${teaser}+teaser title="A"\n+teaser title="B" kind=featured summary="S"`);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(shape(r.tree), [
    { kind: 'element', name: 'article.teaser', args: [], fields: {}, children: [{ kind: 'element', name: 'h2', args: ['A'], fields: {}, children: [] }] },
    {
      kind: 'element', name: 'article.teaser', args: [], fields: { class: ['is-featured'] },
      children: [
        { kind: 'element', name: 'h2', args: ['B'], fields: {}, children: [] },
        { kind: 'element', name: 'p.summary', args: ['S'], fields: {}, children: [] },
      ],
    },
  ]);
});

test('a call with a missing required parameter, or an unknown one, is refused at the call', () => {
  problem(`${teaser}+teaser kind=featured`, '10:1', /"teaser" needs "title"/);
  problem(`${teaser}+teaser title="A" colour=red`, '10:19', /"colour" is not a parameter of "teaser"; it takes title, kind, summary/);
});

test('absence travels through a call; the error comes where it would be shown', () => {
  const r = run(`${teaser}each p in=(input)ps key=k { +teaser title=(p)title summary=(p)summary }`, {
    inputs: { ps: [{ k: 1, title: 'No summary here' }] },
  });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree[0].children.map((c) => c.name), ['h2']);

  const shown = `define card title { h2 (input)title }\n+card title=(input)nothing`;
  problem(shown, '1:24', /\(input\)title has no value here/);
  assert.deepEqual(run(shown).tree.map((n) => [n.name, n.args]), [['h2', []]]);
});

test('a definition is closed: it does not see the items around its call', () => {
  const doc = 'define d { p (post)title }\neach post in=(input)xs key=k { +d }';
  problem(doc, '1:14', /unknown tag "\(post\)"/, { inputs: { xs: [{ k: 1, title: 'x' }] } });
});

test('block is where the caller\'s children go, read in the caller\'s scope', () => {
  const doc = `define card title {
    article {
        h2 (input)title
        block
    }
}
each post in=(input)posts key=slug {
    guard long { has (post)body }
    +card title=(post)title { p (post)slug; when long }
}`.replace('; when long', '');
  const r = run(doc, { inputs: { posts: [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }] } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree.map((n) => n.children.map((c) => [c.name, c.args[0]])), [[['h2', 'A'], ['p', 'a']], [['h2', 'B'], ['p', 'b']]]);
  assertUnique(r.tree);
});

test('children given to a definition with no block are an error', () => {
  problem('define d { p }\n+d { q }', '2:1', /has no "block"/);
});

test('a call nobody supplied a definition for is passed through as a node of its own kind', () => {
  const r = run('+Icon name=chevron size=(input)size { p "in" }', { inputs: { size: 'large' } });
  assert.deepEqual(r.problems, []);
  const [call] = r.tree;
  assert.equal(call.kind, 'call');
  assert.equal(call.name, 'Icon');
  assert.deepEqual(call.fields, { name: 'chevron', size: 'large' });
  assert.deepEqual(call.fieldLocs, { name: { line: 1, column: 7 }, size: { line: 1, column: 20 } });
  assert.equal(call.children[0].name, 'p');
});

test('a call passed through carries absence as well: the field is left out', () => {
  const r = run('+Icon size=(input)size', {});
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.tree[0].fields, {});
});

test('the host supplies definitions: a call to one is expanded', () => {
  const supplied = read('define Icon name { i.icon (input)name }');
  const r = run('p { +Icon name=chevron }', { definitions: [supplied] });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(shape(r.tree), [
    { kind: 'element', name: 'p', args: [], fields: {}, children: [{ kind: 'element', name: 'i.icon', args: ['chevron'], fields: {}, children: [] }] },
  ]);
});

test('a definition both in the file and supplied by the host is an error', () => {
  const supplied = read('define d { i }');
  problem('define d { b }\n+d', '1:1', /defined in the file and also supplied by the host/, { definitions: [supplied] });
});

test('a body may call another definition; one that calls itself is an error', () => {
  const doc = 'define inner { b }\ndefine outer { p { +inner } }\n+outer';
  assert.deepEqual(shape(run(doc).tree)[0], {
    kind: 'element', name: 'p', args: [], fields: {}, children: [{ kind: 'element', name: 'b', args: [], fields: {}, children: [] }],
  });
  problem('define a { +b }\ndefine b { +a }\n+a', '2:12', /"a" calls itself/);
});

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

test('a place is where the node is written, and survives a when removing its siblings', () => {
  const doc = `guard g { has (input)g }
box {
    when g { first }
    second
    third
}`;
  const on = run(doc, { inputs: { g: true } }).tree[0];
  const off = run(doc, { inputs: {} }).tree[0];
  assert.deepEqual(on.children.map((c) => [c.name, c.identity.place]), [['first', '1/0/0'], ['second', '1/1'], ['third', '1/2']]);
  assert.deepEqual(off.children.map((c) => [c.name, c.identity.place]), [['second', '1/1'], ['third', '1/2']]);
});

test('two calls of one definition do not collide; the call site is part of the place', () => {
  const r = run('define d { p { q } }\n+d\n+d\n+d\neach x in=(input)xs key=k { +d }', { inputs: { xs: [{ k: 'a' }, { k: 'b' }] } });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(flatten(r.tree).map((n) => [n.name, n.identity.place, n.identity.keys]), [
    ['p', '1>0', []], ['q', '1>0/0', []],
    ['p', '2>0', []], ['q', '2>0/0', []],
    ['p', '3>0', []], ['q', '3>0/0', []],
    ['p', '4/0>0', ['a']], ['q', '4/0>0/0', ['a']],
    ['p', '4/0>0', ['b']], ['q', '4/0>0/0', ['b']],
  ]);
  assertUnique(r.tree);
});

test('the caller\'s own children keep the place where the caller wrote them', () => {
  const r = run('define d { section { block } }\n+d { p; q }');
  assert.deepEqual(flatten(r.tree).map((n) => [n.name, n.identity.place]), [['section', '1>0'], ['p', '1/0'], ['q', '1/1']]);
});

test('every node carries its position in the file', () => {
  const r = run('nav {\n  a "x" href="/"\n}');
  assert.deepEqual(r.tree[0].loc, { line: 1, column: 1 });
  const a = r.tree[0].children[0];
  assert.deepEqual([a.loc, a.argLocs, a.fieldLocs], [{ line: 2, column: 3 }, [{ line: 2, column: 5 }], { href: { line: 2, column: 9 } }]);
});

test('one document is evaluated again with other inputs, and is not changed by it', () => {
  const doc = read('guard on { is (input)s on }\nbox { when on class=on; p (input)label }');
  const before = JSON.stringify(doc.nodes);
  const first = evaluate(doc, { vocabulary: plain, inputs: { s: 'on', label: 'A' } });
  const second = evaluate(doc, { vocabulary: plain, inputs: { s: 'off', label: 'B' } });
  assert.equal(JSON.stringify(doc.nodes), before);
  assert.deepEqual(first.tree[0].fields, { class: ['on'] });
  assert.deepEqual(second.tree[0].fields, {});
  assert.deepEqual([first.tree[0].children[0].args, second.tree[0].children[0].args], [['A'], ['B']]);
  assert.notDeepEqual(first.tree, second.tree);
});

test('a document that did not read cleanly is not evaluated; its problems come back', () => {
  const r = run('p x=1 x=2');
  assert.deepEqual(r.tree, []);
  assert.deepEqual(r.lines, ['1:7 "x" is written twice on "p"; KDL would keep only the last']);
  const supplied = read('define d {');
  assert.equal(run('p', { definitions: [supplied] }).problems.length, 1);
});

// ---------------------------------------------------------------------------
// the vocabulary
// ---------------------------------------------------------------------------

test('a vocabulary whose words collide with the language is refused at registration', () => {
  assert.throws(() => defineVocabulary({ elements: ['p', 'when'] }), /element "when" is a word of the language/);
  assert.throws(() => defineVocabulary({ elements: '*', childFields: ['each'] }), /child field "each"/);
  assert.throws(() => defineVocabulary({ elements: ['+x'] }), /starts with "\+"/);
  assert.throws(() => defineVocabulary({ elements: '*', tags: ['input'] }), /tag "input"/);
  assert.throws(() => defineVocabulary({ elements: '*', tags: ['element'] }), /tag "element"/);
  assert.throws(() => evaluate(read('p'), { vocabulary: { elements: ['define'] } }), /word of the language/);
});

test('(element) lets an element carry a reserved name', () => {
  const r = run('(element)when "Hours"');
  assert.deepEqual(r.problems, []);
  assert.equal(r.tree[0].name, 'when');
});

test('an element outside the vocabulary is refused at its node', () => {
  const r = run('BOX B\nCIRCLE C', { vocabulary: boxes });
  assert.deepEqual(r.lines, ['2:1 "CIRCLE" is not an element of this vocabulary']);
});

test('readName can refuse a name', () => {
  const v = defineVocabulary({ elements: '*', readName: (name) => (name.startsWith('.') ? { problem: 'no implied div' } : { element: name }) });
  assert.deepEqual(run('.x', { vocabulary: v }).lines, ['1:1 no implied div']);
});
