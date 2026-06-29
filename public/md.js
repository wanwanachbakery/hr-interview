/* md.js — tiny, dependency-free Markdown -> HTML renderer.
 *
 * Shared by every tenant page that shows generated reports (dashboard
 * Optimization report, per-employee documents). It handles exactly the
 * constructs our mock-ai / Claude documents produce:
 *   # ## ### headings · **bold** · *italic* · `code` · [text](url)
 *   - / * bullet lists (one level of nesting) · 1. ordered lists
 *   > blockquotes · ```fenced code``` (incl. mermaid) · --- rules · | tables |
 *
 * Output is escaped first, so it is safe to inject untrusted document text.
 * Usage:  el.className = 'md-body'; el.innerHTML = renderMarkdown(text);
 */
(function () {
  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Inline spans (run on a single line). Escapes HTML, then applies markup.
  function inline(s) {
    s = escHtml(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return s;
  }

  function splitRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  }

  // Render a block of consecutive list lines (supports one nested level).
  function renderList(block) {
    const items = [];
    let cur = null, baseIndent = null;
    for (const raw of block) {
      const m = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (m) {
        const indent = m[1].length;
        if (baseIndent === null) baseIndent = indent;
        if (indent > baseIndent && cur) {
          cur.children.push(raw);
        } else {
          cur = { ordered: /\d+\./.test(m[2]), text: m[3], children: [] };
          items.push(cur);
        }
      } else if (cur) {
        cur.children.push(raw);
      }
    }
    const ordered = items.length && items[0].ordered;
    let html = ordered ? '<ol>' : '<ul>';
    for (const it of items) {
      html += '<li>' + inline(it.text);
      if (it.children.length) {
        const dedented = it.children.map(l => l.replace(new RegExp('^\\s{0,' + (baseIndent + 2) + '}'), ''));
        if (dedented.some(l => /^\s*([-*+]|\d+\.)\s+/.test(l))) html += renderList(dedented);
        else html += '<br>' + dedented.map(inline).join('<br>');
      }
      html += '</li>';
    }
    return html + (ordered ? '</ol>' : '</ul>');
  }

  function render(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    let i = 0;
    const n = lines.length;

    while (i < n) {
      const line = lines[i];

      // fenced code (```lang ... ```)
      const fence = line.match(/^```\s*([\w-]+)?\s*$/);
      if (fence) {
        flush();
        const lang = (fence[1] || '').toLowerCase();
        const code = [];
        i++;
        while (i < n && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // closing fence
        const cls = lang ? ` data-lang="${escHtml(lang)}"` : '';
        out.push(`<pre class="md-code"${cls}><code>${escHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      if (/^\s*$/.test(line)) { flush(); i++; continue; }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flush(); const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2].trim())}</h${lvl}>`); i++; continue; }

      if (/^\s*([-*_])\1\1+\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

      if (/^>\s?/.test(line)) {
        flush();
        const quote = [];
        while (i < n && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push(`<blockquote>${render(quote.join('\n'))}</blockquote>`);
        continue;
      }

      // table: header row + separator (|---|---|)
      if (/\|/.test(line) && i + 1 < n && /\|/.test(lines[i + 1]) && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1])) {
        flush();
        const header = splitRow(line);
        i += 2;
        let t = '<table class="md-table"><thead><tr>' + header.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        while (i < n && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
          t += '<tr>' + splitRow(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
          i++;
        }
        out.push(t + '</tbody></table>');
        continue;
      }

      // list block (collect consecutive list items + their indented children)
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        flush();
        const block = [];
        while (i < n && !/^\s*$/.test(lines[i]) && (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) || (block.length && /^\s+\S/.test(lines[i])))) {
          block.push(lines[i]); i++;
        }
        out.push(renderList(block));
        continue;
      }

      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  }

  window.renderMarkdown = render;
})();
