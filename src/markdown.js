/**
 * [INPUT]: 无外部依赖，纯字符串操作
 * [OUTPUT]: protectFormatting, restoreFormatting, extractTextNodes, reconstructMarkdown
 * [POS]: 翻译管线的格式保护层，被 translator.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 格式保护：将 inline markdown 标记替换为占位符 ──

function protectFormatting(text) {
  const markers = [];
  let result = text;

  const protect = (m) => { markers.push(m); return `{{MD${markers.length - 1}}}`; };

  // ── HTML 标签（img, a, br 等）──
  result = result.replace(/<[^>]+>/g, protect);
  // ── 图片 ![alt](url) ──
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, protect);
  // ── 链接 [text](url) — 整体保护 ──
  result = result.replace(/\[[^\]]*\]\([^)]*\)/g, protect);
  // ── 行内代码 ──
  result = result.replace(/`[^`]*`/g, protect);
  // ── 粗体 ──
  result = result.replace(/\*\*/g, protect);
  // ── 斜体 ──
  result = result.replace(/\*/g, protect);

  return { text: result, markers };
}

function restoreFormatting(text, original) {
  const { markers } = protectFormatting(original);
  let result = text;
  for (let i = 0; i < markers.length; i++) {
    result = result.replace(`{{MD${i}}}`, markers[i]);
  }
  return result;
}

// ── 提取可翻译节点 ──

function extractTextNodes(markdown) {
  const nodes = [];
  const lines = markdown.split('\n');
  let idx = 0;
  let inCode = false;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('```')) { inCode = !inCode; continue; }
    if (inCode || !t) continue;
    if (line.startsWith('    ') || line.startsWith('\t')) continue;
    if (t.match(/^\|[\s\-|:]+\|$/)) continue;
    if (t.startsWith('<') && t.endsWith('>')) continue;

    if (t.startsWith('#')) {
      const text = t.replace(/^#+\s*/, '').trim();
      if (text) {
        const p = protectFormatting(text);
        nodes.push({ value: p.text, original: text, index: idx++, type: 'heading' });
      }
      continue;
    }
    if (t.match(/^[-*+]\s+/) || t.match(/^\d+\.\s+/)) {
      const text = t.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '');
      if (text) {
        const p = protectFormatting(text);
        nodes.push({ value: p.text, original: text, index: idx++, type: 'text' });
      }
      continue;
    }
    if (t.startsWith('>')) {
      const text = t.replace(/^>\s*/, '').trim();
      if (text) {
        const p = protectFormatting(text);
        nodes.push({ value: p.text, original: text, index: idx++, type: 'text' });
      }
      continue;
    }
    if (t.startsWith('|') && t.endsWith('|') && !t.match(/^\|[\s\-|:]+\|$/)) {
      const cells = t.split('|').slice(1, -1);
      for (const cell of cells) {
        const ct = cell.trim();
        if (ct && !ct.match(/^[\s\-:]+$/)) {
          const p = protectFormatting(ct);
          nodes.push({ value: p.text, original: ct, index: idx++, type: 'text' });
        }
      }
      continue;
    }
    if (t) {
      const p = protectFormatting(t);
      nodes.push({ value: p.text, original: t, index: idx++, type: 'paragraph' });
    }
  }
  return nodes;
}

// ── 用翻译结果重建 Markdown ──

function reconstructMarkdown(originalMd, translatedNodes) {
  const lines = originalMd.split('\n');
  const nodeMap = new Map();
  const origMap = new Map();
  translatedNodes.forEach(n => {
    nodeMap.set(n.index, n.value);
    origMap.set(n.index, n.original);
  });
  let ni = 0;
  const result = [];
  let inCode = false;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('```')) { inCode = !inCode; result.push(line); continue; }
    if (inCode || !t) { result.push(line); continue; }
    if (line.startsWith('    ') || line.startsWith('\t')) { result.push(line); continue; }
    if (t.match(/^\|[\s\-|:]+\|$/)) { result.push(line); continue; }

    if (t.startsWith('#')) {
      const m = line.match(/^(\s*#+\s*)/);
      if (m && nodeMap.has(ni)) {
        result.push(m[1] + restoreFormatting(nodeMap.get(ni), origMap.get(ni) || ''));
        ni++;
      } else { result.push(line); }
      continue;
    }
    if (t.match(/^[-*+]\s+/) || t.match(/^\d+\.\s+/)) {
      const m = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)/);
      if (m && nodeMap.has(ni)) {
        result.push(m[1] + restoreFormatting(nodeMap.get(ni), origMap.get(ni) || ''));
        ni++;
      } else { result.push(line); }
      continue;
    }
    if (t.startsWith('>')) {
      const m = line.match(/^(\s*>\s*)/);
      if (m && nodeMap.has(ni)) {
        result.push(m[1] + restoreFormatting(nodeMap.get(ni), origMap.get(ni) || ''));
        ni++;
      } else { result.push(line); }
      continue;
    }
    if (t.startsWith('|') && t.endsWith('|') && !t.match(/^\|[\s\-|:]+\|$/)) {
      const cells = t.split('|');
      let row = '|';
      for (let j = 1; j < cells.length - 1; j++) {
        const ct = cells[j].trim();
        if (ct && !ct.match(/^[\s\-:]+$/) && nodeMap.has(ni)) {
          row += ` ${restoreFormatting(nodeMap.get(ni), origMap.get(ni) || ct)} |`;
          ni++;
        } else { row += cells[j] + '|'; }
      }
      result.push(row);
      continue;
    }
    if (t && nodeMap.has(ni)) {
      result.push(restoreFormatting(nodeMap.get(ni), origMap.get(ni) || t));
      ni++;
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

window.ReadmdMarkdown = { protectFormatting, restoreFormatting, extractTextNodes, reconstructMarkdown };
