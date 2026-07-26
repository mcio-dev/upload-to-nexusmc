const assert = require('node:assert/strict');
const test = require('node:test');

const { markdownToTiptap } = require('../dist/markdown.js');

function nodesOfType(node, type, result = []) {
  if (node?.type === type) result.push(node);
  for (const child of node?.content || []) nodesOfType(child, type, result);
  return result;
}

test('converts core GFM blocks and marks to NexusMC TipTap nodes', async () => {
  const markdown = `# Install

Use **bold**, *italic*, ~~old~~, [guide](guide.md), and \`code\`.

> Quoted text

- Fabric
- NeoForge

3. Third
4. Fourth

- [x] Released
- [ ] Documented

| Loader | Version |
| --- | --- |
| Fabric | 1.21.1 |

---
`;

  const doc = await markdownToTiptap(markdown, {
    linkBaseUrl: 'https://github.com/example/project/blob/abc123/'
  });

  assert.equal(doc.type, 'doc');
  assert.equal(nodesOfType(doc, 'heading')[0].attrs.level, 1);
  assert.equal(nodesOfType(doc, 'blockquote').length, 1);
  assert.equal(nodesOfType(doc, 'bulletList').length, 1);
  assert.equal(nodesOfType(doc, 'orderedList')[0].attrs.start, 3);
  assert.deepEqual(nodesOfType(doc, 'taskItem').map((node) => node.attrs.checked), [true, false]);
  assert.equal(nodesOfType(doc, 'tableHeader').length, 2);
  assert.equal(nodesOfType(doc, 'tableCell').length, 2);
  assert.equal(nodesOfType(doc, 'horizontalRule').length, 1);

  const markedText = nodesOfType(doc, 'text');
  assert.ok(markedText.some((node) => node.text === 'bold' && node.marks?.[0]?.type === 'bold'));
  assert.ok(markedText.some((node) => node.text === 'italic' && node.marks?.[0]?.type === 'italic'));
  assert.ok(markedText.some((node) => node.text === 'old' && node.marks?.[0]?.type === 'strike'));
  assert.ok(markedText.some((node) => node.text === 'code' && node.marks?.[0]?.type === 'code'));
  assert.ok(markedText.some((node) =>
    node.text === 'guide' &&
    node.marks?.[0]?.attrs?.href === 'https://github.com/example/project/blob/abc123/guide.md'
  ));
});

test('converts images, fenced code metadata, Mermaid, and GitHub math', async () => {
  const markdown = `Before image ![Preview](images/demo.png "Demo") after image.

\`\`\`ts {1,3-4} showLineNumbers lineNumberStart=5
const value = 1
\`\`\`

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

Inline math $E = mc^2$.

$$
x^2 + y^2 = z^2
$$
`;

  const doc = await markdownToTiptap(markdown, {
    imageBaseUrl: 'https://github.com/example/project/raw/abc123/'
  });

  const image = nodesOfType(doc, 'image')[0];
  assert.deepEqual(image.attrs, {
    src: 'https://github.com/example/project/raw/abc123/images/demo.png',
    alt: 'Preview',
    title: 'Demo'
  });
  assert.equal(doc.content[0].type, 'paragraph');
  assert.equal(doc.content[1].type, 'image');
  assert.equal(doc.content[2].type, 'paragraph');

  const code = nodesOfType(doc, 'codeBlock').find((node) => node.attrs?.language === 'ts');
  assert.deepEqual(code.attrs, {
    language: 'ts',
    highlightLines: '1,3-4',
    showLineNumbers: true,
    lineNumberStart: 5
  });
  assert.equal(nodesOfType(doc, 'mermaidDiagram')[0].attrs.code, 'flowchart TD\n  A --> B');
  assert.ok(nodesOfType(doc, 'math').some((node) => node.attrs.inline === true && node.attrs.latex === 'E = mc^2'));
  assert.ok(nodesOfType(doc, 'math').some((node) => node.attrs.inline === false && /x\^2/.test(node.attrs.latex)));
});

test('resolves reference links and rejects unsafe protocols', async () => {
  const doc = await markdownToTiptap(`Read [the docs][docs] and [unsafe](javascript:alert(1)).

[docs]: https://example.com/docs
`);

  const texts = nodesOfType(doc, 'text');
  const docs = texts.find((node) => node.text === 'the docs');
  const unsafe = texts.find((node) => node.text.includes('unsafe'));
  assert.equal(docs.marks[0].attrs.href, 'https://example.com/docs');
  assert.equal(unsafe.marks, undefined);
});

test('preserves unsupported raw HTML as an inert HTML code block', async () => {
  const doc = await markdownToTiptap('<details><summary>More</summary>Body</details>');
  assert.deepEqual(doc.content, [{
    type: 'codeBlock',
    attrs: { language: 'html' },
    content: [{ type: 'text', text: '<details><summary>More</summary>Body</details>' }]
  }]);
});

test('preserves GitHub footnotes as superscript references and definition paragraphs', async () => {
  const doc = await markdownToTiptap('Text with note[^1].\n\n[^1]: Footnote **content**.');
  const superscript = nodesOfType(doc, 'text').filter((node) =>
    node.marks?.some((mark) => mark.type === 'superscript')
  );
  assert.deepEqual(superscript.map((node) => node.text), ['[1]', '[1]']);
  assert.ok(nodesOfType(doc, 'text').some((node) =>
    node.text === 'content' && node.marks?.some((mark) => mark.type === 'bold')
  ));
});

test('normalizes CommonMark soft line breaks while preserving explicit hard breaks', async () => {
  const doc = await markdownToTiptap('soft\nline  \nhard');
  assert.equal(doc.content[0].content[0].text, 'soft line');
  assert.equal(doc.content[0].content[1].type, 'hardBreak');
  assert.equal(doc.content[0].content[2].text, 'hard');
});

test('creates a valid paragraph inside an empty list item', async () => {
  const doc = await markdownToTiptap('-');
  assert.deepEqual(nodesOfType(doc, 'listItem')[0].content, [{ type: 'paragraph' }]);
});
