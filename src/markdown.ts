import type { Root } from 'mdast';

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
}

export interface TiptapDocument extends TiptapNode {
  type: 'doc';
  content: TiptapNode[];
}

export interface MarkdownConversionOptions {
  linkBaseUrl?: string;
  imageBaseUrl?: string;
}

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  label?: string | null;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  children?: MdastNode[];
}

interface Definition {
  url: string;
  title?: string | null;
}

interface ConversionContext {
  definitions: Map<string, Definition>;
  options: MarkdownConversionOptions;
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replace(/\s+/g, ' ').toLowerCase();
}

function collectDefinitions(root: MdastNode): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  for (const child of root.children || []) {
    if (child.type === 'definition' && child.identifier && child.url) {
      definitions.set(normalizeIdentifier(child.identifier), { url: child.url, title: child.title });
    }
  }
  return definitions;
}

function resolveUrl(value: string, baseUrl: string | undefined, image: boolean): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!image && trimmed.startsWith('#')) return trimmed;

  try {
    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    const allowed = image ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS;
    return allowed.has(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    // Preserve unresolved relative URLs when no repository base was available.
    return baseUrl ? undefined : trimmed;
  }
}

function marksEqual(left: TiptapMark[] | undefined, right: TiptapMark[] | undefined): boolean {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function normalizeInline(nodes: TiptapNode[]): TiptapNode[] {
  const normalized: TiptapNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && !node.text) continue;
    const previous = normalized[normalized.length - 1];
    if (
      previous?.type === 'text' &&
      node.type === 'text' &&
      marksEqual(previous.marks, node.marks)
    ) {
      previous.text = `${previous.text || ''}${node.text || ''}`;
    } else {
      normalized.push(node);
    }
  }
  return normalized;
}

function textNode(text: string, marks: TiptapMark[] = []): TiptapNode {
  const node: TiptapNode = { type: 'text', text };
  if (marks.length > 0) node.marks = marks;
  return node;
}

function withMark(marks: TiptapMark[], mark: TiptapMark): TiptapMark[] {
  return [...marks, mark];
}

function imageNode(node: MdastNode, context: ConversionContext): TiptapNode | undefined {
  let url = node.url;
  let title = node.title;
  if (!url && node.identifier) {
    const definition = context.definitions.get(normalizeIdentifier(node.identifier));
    url = definition?.url;
    title = title || definition?.title;
  }
  if (!url) return undefined;

  const src = resolveUrl(url, context.options.imageBaseUrl, true);
  if (!src) return undefined;
  const attrs: Record<string, unknown> = { src };
  if (node.alt) attrs.alt = node.alt;
  if (title) attrs.title = title;
  return { type: 'image', attrs };
}

function convertInlineNode(
  node: MdastNode,
  context: ConversionContext,
  marks: TiptapMark[] = []
): TiptapNode[] {
  switch (node.type) {
    case 'text':
      return node.value ? [textNode(node.value.replace(/\r?\n/g, ' '), marks)] : [];
    case 'strong':
      return convertInlineChildren(node, context, withMark(marks, { type: 'bold' }));
    case 'emphasis':
      return convertInlineChildren(node, context, withMark(marks, { type: 'italic' }));
    case 'delete':
      return convertInlineChildren(node, context, withMark(marks, { type: 'strike' }));
    case 'inlineCode':
      return node.value ? [textNode(node.value, withMark(marks, { type: 'code' }))] : [];
    case 'inlineMath':
      return node.value ? [{ type: 'math', attrs: { latex: node.value, inline: true } }] : [];
    case 'footnoteReference': {
      const label = node.label || node.identifier;
      return label ? [textNode(`[${label}]`, withMark(marks, { type: 'superscript' }))] : [];
    }
    case 'footnote':
      return convertInlineChildren(node, context, withMark(marks, { type: 'superscript' }));
    case 'break':
      return [{ type: 'hardBreak' }];
    case 'image':
    case 'imageReference': {
      const image = imageNode(node, context);
      return image ? [image] : node.alt ? [textNode(node.alt, marks)] : [];
    }
    case 'link':
    case 'linkReference': {
      let url = node.url;
      if (!url && node.identifier) {
        url = context.definitions.get(normalizeIdentifier(node.identifier))?.url;
      }
      const href = url ? resolveUrl(url, context.options.linkBaseUrl, false) : undefined;
      return href
        ? convertInlineChildren(node, context, withMark(marks, { type: 'link', attrs: { href } }))
        : convertInlineChildren(node, context, marks);
    }
    case 'html':
      if (/^<br\s*\/?\s*>$/i.test(node.value || '')) return [{ type: 'hardBreak' }];
      return node.value ? [textNode(node.value, marks)] : [];
    default:
      if (node.children) return convertInlineChildren(node, context, marks);
      return node.value ? [textNode(node.value, marks)] : [];
  }
}

function convertInlineChildren(
  node: MdastNode,
  context: ConversionContext,
  marks: TiptapMark[] = []
): TiptapNode[] {
  return normalizeInline((node.children || []).flatMap((child) => convertInlineNode(child, context, marks)));
}

function inlineFallbackText(node: TiptapNode): TiptapNode | undefined {
  if (node.type !== 'image') return node;
  const alt = node.attrs?.alt;
  return typeof alt === 'string' && alt ? textNode(alt) : undefined;
}

function inlineOnly(nodes: TiptapNode[]): TiptapNode[] {
  return normalizeInline(nodes.map(inlineFallbackText).filter((node): node is TiptapNode => Boolean(node)));
}

function paragraphBlocks(node: MdastNode, context: ConversionContext): TiptapNode[] {
  const inline = convertInlineChildren(node, context);
  const blocks: TiptapNode[] = [];
  let current: TiptapNode[] = [];

  const flush = (): void => {
    if (current.length > 0 || blocks.length === 0) {
      const paragraph: TiptapNode = { type: 'paragraph' };
      if (current.length > 0) paragraph.content = normalizeInline(current);
      blocks.push(paragraph);
    }
    current = [];
  };

  for (const child of inline) {
    if (child.type === 'image') {
      if (current.length > 0) flush();
      blocks.push(child);
    } else {
      current.push(child);
    }
  }
  if (current.length > 0 || blocks.length === 0) flush();
  return blocks;
}

function parseCodeAttrs(node: MdastNode): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (node.lang) attrs.language = node.lang;
  const meta = node.meta || '';
  const highlights = meta.match(/(?:^|\s)\{([^}]+)\}/);
  if (highlights) attrs.highlightLines = highlights[1].trim();
  const showLineNumbers = meta.match(/(?:^|\s)showLineNumbers(?:=(true|false))?(?=\s|$)/i);
  if (showLineNumbers) attrs.showLineNumbers = showLineNumbers[1]?.toLowerCase() !== 'false';
  const lineNumberStart = meta.match(/(?:^|\s)lineNumberStart=(\d+)(?=\s|$)/i);
  if (lineNumberStart) attrs.lineNumberStart = Number(lineNumberStart[1]);
  const diffLanguage = meta.match(/(?:^|\s)diffLanguage=([\w+-]+)(?=\s|$)/i);
  if (diffLanguage) attrs.diffLanguage = diffLanguage[1];
  return attrs;
}

function textContent(value: string): TiptapNode[] | undefined {
  return value ? [{ type: 'text', text: value }] : undefined;
}

function convertTable(node: MdastNode, context: ConversionContext): TiptapNode {
  const rows = (node.children || []).map((row, rowIndex) => ({
    type: 'tableRow',
    content: (row.children || []).map((cell) => {
      const inline = inlineOnly(convertInlineChildren(cell, context));
      const paragraph: TiptapNode = { type: 'paragraph' };
      if (inline.length > 0) paragraph.content = inline;
      return {
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [paragraph]
      };
    })
  }));
  return { type: 'table', content: rows };
}

function convertList(node: MdastNode, context: ConversionContext): TiptapNode {
  const children = node.children || [];
  const taskList = children.some((child) => child.checked !== null && child.checked !== undefined);
  const listType = taskList ? 'taskList' : node.ordered ? 'orderedList' : 'bulletList';
  const attrs: Record<string, unknown> = {};
  if (node.ordered && typeof node.start === 'number' && node.start !== 1) attrs.start = node.start;

  const content = children.map((item) => {
    const itemType = taskList ? 'taskItem' : 'listItem';
    const itemContent = convertBlocks(item.children || [], context);
    const converted: TiptapNode = {
      type: itemType,
      content: itemContent.length > 0 ? itemContent : [{ type: 'paragraph' }]
    };
    if (taskList) converted.attrs = { checked: item.checked === true };
    return converted;
  });

  const result: TiptapNode = { type: listType, content };
  if (Object.keys(attrs).length > 0) result.attrs = attrs;
  return result;
}

function convertBlock(node: MdastNode, context: ConversionContext): TiptapNode[] {
  switch (node.type) {
    case 'paragraph':
      return paragraphBlocks(node, context);
    case 'heading': {
      const content = inlineOnly(convertInlineChildren(node, context));
      const heading: TiptapNode = {
        type: 'heading',
        attrs: { level: Math.min(6, Math.max(1, node.depth || 1)) }
      };
      if (content.length > 0) heading.content = content;
      return [heading];
    }
    case 'blockquote':
      return [{ type: 'blockquote', content: convertBlocks(node.children || [], context) }];
    case 'thematicBreak':
      return [{ type: 'horizontalRule' }];
    case 'list':
      return [convertList(node, context)];
    case 'code': {
      if (node.lang?.toLowerCase() === 'mermaid') {
        return [{ type: 'mermaidDiagram', attrs: { code: node.value || '' } }];
      }
      const codeBlock: TiptapNode = { type: 'codeBlock' };
      const attrs = parseCodeAttrs(node);
      if (Object.keys(attrs).length > 0) codeBlock.attrs = attrs;
      codeBlock.content = textContent(node.value || '');
      return [codeBlock];
    }
    case 'math':
      return [{ type: 'math', attrs: { latex: node.value || '', inline: false } }];
    case 'table':
      return [convertTable(node, context)];
    case 'html': {
      const codeBlock: TiptapNode = { type: 'codeBlock', attrs: { language: 'html' } };
      codeBlock.content = textContent(node.value || '');
      return [codeBlock];
    }
    case 'image':
    case 'imageReference': {
      const image = imageNode(node, context);
      return image ? [image] : [];
    }
    case 'definition':
      return [];
    case 'footnoteDefinition': {
      const blocks = convertBlocks(node.children || [], context);
      const label = node.label || node.identifier;
      if (!label) return blocks;
      const marker = textNode(`[${label}]`, [{ type: 'superscript' }]);
      if (blocks[0]?.type === 'paragraph') {
        blocks[0].content = normalizeInline([marker, textNode(' '), ...(blocks[0].content || [])]);
      } else {
        blocks.unshift({ type: 'paragraph', content: [marker] });
      }
      return blocks;
    }
    default:
      if (node.children) return convertBlocks(node.children, context);
      if (node.value) return [{ type: 'paragraph', content: [textNode(node.value)] }];
      return [];
  }
}

function convertBlocks(nodes: MdastNode[], context: ConversionContext): TiptapNode[] {
  return nodes.flatMap((node) => convertBlock(node, context));
}

/** Convert GitHub Flavored Markdown into NexusMC-compatible TipTap JSON. */
export async function markdownToTiptap(
  markdown: string,
  options: MarkdownConversionOptions = {}
): Promise<TiptapDocument> {
  const [fromMarkdownModule, gfmModule, gfmMdastModule, mathModule, mathMdastModule] = await Promise.all([
    import('mdast-util-from-markdown'),
    import('micromark-extension-gfm'),
    import('mdast-util-gfm'),
    import('micromark-extension-math'),
    import('mdast-util-math')
  ]);

  const root: Root = fromMarkdownModule.fromMarkdown(markdown, {
    extensions: [gfmModule.gfm(), mathModule.math()],
    mdastExtensions: [gfmMdastModule.gfmFromMarkdown(), mathMdastModule.mathFromMarkdown()]
  });
  const mdastRoot = root as unknown as MdastNode;
  const context: ConversionContext = {
    definitions: collectDefinitions(mdastRoot),
    options
  };
  return {
    type: 'doc',
    content: convertBlocks(mdastRoot.children || [], context)
  };
}
