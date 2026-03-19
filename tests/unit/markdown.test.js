import { describe, it, expect } from 'vitest';

const { escapeHtml, processLists, renderMarkdown } = require('../../utils/markdown.js');

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('escapes all entities in a single string', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('processLists', () => {
  it('converts unordered list items', () => {
    const input = '- Item 1\n- Item 2\n- Item 3';
    const result = processLists(input);
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>Item 1</li>');
    expect(result).toContain('<li>Item 2</li>');
    expect(result).toContain('<li>Item 3</li>');
    expect(result).toContain('</ul>');
  });

  it('converts ordered list items', () => {
    const input = '1. First\n2. Second\n3. Third';
    const result = processLists(input);
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>First</li>');
    expect(result).toContain('</ol>');
  });

  it('handles loose lists (blank lines between items)', () => {
    const input = '- Item 1\n\n- Item 2\n\n- Item 3';
    const result = processLists(input);
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>Item 1</li>');
    expect(result).toContain('<li>Item 3</li>');
  });

  it('handles asterisk list markers', () => {
    const input = '* Alpha\n* Beta';
    const result = processLists(input);
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>Alpha</li>');
  });

  it('flushes list when switching from ol to ul', () => {
    const input = '1. Ordered\n- Unordered';
    const result = processLists(input);
    expect(result).toContain('<ol>');
    expect(result).toContain('<ul>');
  });

  it('passes through non-list content unchanged', () => {
    const input = 'Just a paragraph\nof text';
    const result = processLists(input);
    expect(result).toBe(input);
  });

  it('ends list when non-list content follows', () => {
    const input = '- Item 1\n- Item 2\nSome text after';
    const result = processLists(input);
    expect(result).toContain('</ul>');
    expect(result).toContain('Some text after');
  });
});

describe('renderMarkdown', () => {
  describe('headers', () => {
    it('renders h1', () => {
      expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
    });

    it('renders h2', () => {
      expect(renderMarkdown('## Subtitle')).toContain('<h2>Subtitle</h2>');
    });

    it('renders h3', () => {
      expect(renderMarkdown('### Section')).toContain('<h3>Section</h3>');
    });
  });

  describe('bold and italic', () => {
    it('renders **bold**', () => {
      expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    });

    it('renders __bold__', () => {
      expect(renderMarkdown('__bold__')).toContain('<strong>bold</strong>');
    });

    it('renders *italic*', () => {
      expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
    });

    it('renders _italic_', () => {
      expect(renderMarkdown('_italic_')).toContain('<em>italic</em>');
    });
  });

  describe('code', () => {
    it('renders inline code', () => {
      const result = renderMarkdown('Use `console.log` here');
      expect(result).toContain('<code>console.log</code>');
    });

    it('renders fenced code blocks', () => {
      const result = renderMarkdown('```\nconst x = 1;\n```');
      expect(result).toContain('<pre><code>');
      expect(result).toContain('const x = 1;');
      expect(result).toContain('</code></pre>');
    });

    it('renders fenced code blocks with language', () => {
      const result = renderMarkdown('```javascript\nconst x = 1;\n```');
      expect(result).toContain('<pre><code>');
      expect(result).toContain('const x = 1;');
    });

    it('does not process markdown inside code blocks', () => {
      const result = renderMarkdown('```\n**not bold** # not header\n```');
      expect(result).not.toContain('<strong>');
      expect(result).not.toContain('<h1>');
    });

    it('escapes HTML inside code blocks', () => {
      const result = renderMarkdown('```\n<script>alert("xss")</script>\n```');
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });
  });

  describe('blockquotes', () => {
    it('renders blockquotes', () => {
      const result = renderMarkdown('> This is a quote');
      expect(result).toContain('<blockquote>This is a quote</blockquote>');
    });
  });

  describe('lists', () => {
    it('renders unordered lists', () => {
      const result = renderMarkdown('- Item 1\n- Item 2');
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>Item 1</li>');
    });

    it('renders ordered lists', () => {
      const result = renderMarkdown('1. First\n2. Second');
      expect(result).toContain('<ol>');
      expect(result).toContain('<li>First</li>');
    });
  });

  describe('paragraphs', () => {
    it('wraps text in p tags', () => {
      const result = renderMarkdown('Hello world');
      expect(result).toContain('<p>Hello world</p>');
    });

    it('creates new paragraphs on double newlines', () => {
      const result = renderMarkdown('First paragraph\n\nSecond paragraph');
      expect(result).toContain('<p>First paragraph</p>');
      expect(result).toContain('<p>Second paragraph</p>');
    });

    it('converts single newlines to br', () => {
      const result = renderMarkdown('Line 1\nLine 2');
      expect(result).toContain('<br>');
    });
  });

  describe('XSS safety', () => {
    it('escapes <script> tags', () => {
      const result = renderMarkdown('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });

    it('escapes HTML tags in regular text', () => {
      const result = renderMarkdown('<img src=x onerror=alert(1)>');
      expect(result).not.toContain('<img');
      expect(result).toContain('&lt;img');
    });

    it('escapes HTML but still applies markdown formatting', () => {
      const result = renderMarkdown('**bold** and <script>bad</script>');
      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('&lt;script&gt;');
    });
  });

  describe('mixed content', () => {
    it('handles headers followed by paragraphs', () => {
      const result = renderMarkdown('# Title\n\nSome text here');
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<p>Some text here</p>');
    });

    it('handles code blocks between paragraphs', () => {
      const result = renderMarkdown('Before\n\n```\ncode\n```\n\nAfter');
      expect(result).toContain('<p>Before</p>');
      expect(result).toContain('<pre><code>');
      expect(result).toContain('<p>After</p>');
    });
  });
});
