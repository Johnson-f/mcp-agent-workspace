import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "./markdown-message";

test("renders assistant Markdown as semantic HTML", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      content={
        "**Connected servers**\n\n- Webull\n- Smoke MCP\n\nUse `get_news`."
      }
    />,
  );

  assert.match(html, /<strong[^>]*>Connected servers<\/strong>/);
  assert.match(html, /<ul/);
  assert.match(html, /<li[^>]*>Webull<\/li>/);
  assert.match(html, /<code[^>]*>get_news<\/code>/);
});

test("keeps raw HTML inert and opens external links safely", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage
      content={
        '<script>alert("unsafe")</script>\n\n[Docs](https://example.com)'
      }
    />,
  );

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
