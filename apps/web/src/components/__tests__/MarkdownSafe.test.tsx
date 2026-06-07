import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownSafe } from '../MarkdownSafe';

describe('MarkdownSafe — formatting parity', () => {
  it('renders plain text as a paragraph', () => {
    const { container } = render(<MarkdownSafe>hello world</MarkdownSafe>);
    expect(container.querySelector('p')?.textContent).toBe('hello world');
  });

  it('renders **bold** and *italic*', () => {
    const { container } = render(<MarkdownSafe>Some **bold** and *italic* text</MarkdownSafe>);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
  });

  it('renders headings (## and ###)', () => {
    const { container } = render(<MarkdownSafe>{'## Title\n\n### Subtitle'}</MarkdownSafe>);
    const h2 = container.querySelector('h2');
    const h3 = container.querySelector('h3');
    expect(h2?.textContent).toBe('Title');
    expect(h3?.textContent).toBe('Subtitle');
  });

  it('renders unordered and ordered lists', () => {
    const { container } = render(
      <MarkdownSafe>{'- one\n- two\n\n1. alpha\n2. beta'}</MarkdownSafe>,
    );
    expect(container.querySelectorAll('ul > li').length).toBe(2);
    expect(container.querySelectorAll('ol > li').length).toBe(2);
  });

  it('renders fenced code blocks and inline code', () => {
    const { container } = render(
      <MarkdownSafe>{'Inline `code` and\n\n```\nblock\n```'}</MarkdownSafe>,
    );
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('pre code')?.textContent?.trim()).toBe('block');
  });

  it('renders GFM tables', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |';
    const { container } = render(<MarkdownSafe>{md}</MarkdownSafe>);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('th').length).toBe(2);
    expect(container.querySelectorAll('td').length).toBe(2);
  });

  it('renders safe anchor with rel=noopener and target=_blank', () => {
    const { container } = render(<MarkdownSafe>[safe](https://example.com)</MarkdownSafe>);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('rel')).toMatch(/noopener/);
    expect(a?.getAttribute('target')).toBe('_blank');
  });
});

describe('MarkdownSafe — injection defenses (cr-8cl)', () => {
  it('strips raw <script> tags', () => {
    const { container } = render(
      <MarkdownSafe>{'Player name: </script><script>window.__pwn = 1</script>'}</MarkdownSafe>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
  });

  it('strips <img onerror> injections', () => {
    const { container } = render(
      <MarkdownSafe>{'Name: <img src=x onerror="window.__pwn2 = 1">'}</MarkdownSafe>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwn2?: number }).__pwn2).toBeUndefined();
  });

  it('drops javascript: URLs from anchors', () => {
    const { container } = render(<MarkdownSafe>{'[click me](javascript:alert(1))'}</MarkdownSafe>);
    const a = container.querySelector('a');
    // rehype-sanitize either strips the href entirely or rewrites
    // it away from the javascript: scheme — both are acceptable.
    const href = a?.getAttribute('href') ?? '';
    expect(href.toLowerCase().startsWith('javascript:')).toBe(false);
  });

  it('strips inline event handler attributes from raw anchor HTML', () => {
    const { container } = render(
      <MarkdownSafe>
        {'<a href="https://example.com" onclick="window.__pwn3 = 1">x</a>'}
      </MarkdownSafe>,
    );
    // react-markdown treats raw HTML as literal text by default —
    // the <a> is never rendered, which is the safest possible
    // outcome. If we ever opt into rehype-raw, the sanitize schema
    // must still strip the onclick attribute. Assert both invariants:
    // no live onclick attribute anywhere in the DOM, and no handler
    // executed.
    const anyOnclick = container.querySelector('[onclick]');
    expect(anyOnclick).toBeNull();
    expect((window as unknown as { __pwn3?: number }).__pwn3).toBeUndefined();
  });

  it('strips <iframe> even when wrapped in a paragraph', () => {
    const { container } = render(
      <MarkdownSafe>{'See this: <iframe src="https://evil.example"></iframe>'}</MarkdownSafe>,
    );
    expect(container.querySelector('iframe')).toBeNull();
  });
});
