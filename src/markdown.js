/**
 * [INPUT]: 无外部依赖，纯字符串操作
 * [OUTPUT]: protectFormatting, restoreFormatting, extractTextNodes, reconstructMarkdown
 * [POS]: 翻译管线的格式保护层，被 translator.js 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 格式保护 ──

function protectFormatting(text) {
  const markers = [];
  let result = text;

  const protect = (match) => {
    markers.push(match);
    return `{{MD${markers.length - 1}}}`;
  };

  result = result.replace(/<[^>]+>/g, protect);
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, protect);
  result = result.replace(/\[[^\]]*\]\([^)]*\)/g, protect);
  result = result.replace(/`[^`]*`/g, protect);
  result = result.replace(/\*\*/g, protect);
  result = result.replace(/\*/g, protect);

  return { text: result, markers };
}

function restoreFormatting(text, original) {
  const { markers } = protectFormatting(original);
  let result = text;
  for (let index = 0; index < markers.length; index++) {
    result = result.replace(new RegExp(`\\{\\{MD${index}\\}\\}`, 'g'), markers[index]);
  }
  return result;
}

// ── 行级解析 ──

function isFenceLine(trimmed) {
  return /^(```|~~~)/.test(trimmed);
}

function isTableDivider(trimmed) {
  return /^\|[\s\-|:]+\|$/.test(trimmed);
}

function isHtmlOnly(trimmed) {
  return /^<[^>]+>$/.test(trimmed);
}

function pushNode(nodes, original, meta) {
  const text = original.trim();
  if (!text) {
    return;
  }
  const protectedText = protectFormatting(text);
  nodes.push({
    value: protectedText.text,
    original: text,
    index: nodes.length,
    ...meta
  });
}

function extractTextNodes(markdown) {
  const nodes = [];
  const lines = markdown.split('\n');
  let inCode = false;

  lines.forEach((line, lineNumber) => {
    const trimmed = line.trim();
    if (isFenceLine(trimmed)) {
      inCode = !inCode;
      return;
    }
    if (inCode || !trimmed) {
      return;
    }
    if (line.startsWith('    ') || line.startsWith('\t')) {
      return;
    }
    if (isTableDivider(trimmed) || isHtmlOnly(trimmed)) {
      return;
    }

    const headingMatch = line.match(/^(\s*#{1,6}\s+)(.*)$/);
    if (headingMatch) {
      pushNode(nodes, headingMatch[2], {
        kind: 'heading',
        lineNumber,
        prefix: headingMatch[1]
      });
      return;
    }

    const listMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
    if (listMatch) {
      pushNode(nodes, listMatch[2], {
        kind: 'list',
        lineNumber,
        prefix: listMatch[1]
      });
      return;
    }

    const quoteMatch = line.match(/^(\s*>+\s?)(.*)$/);
    if (quoteMatch) {
      pushNode(nodes, quoteMatch[2], {
        kind: 'quote',
        lineNumber,
        prefix: quoteMatch[1]
      });
      return;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|') && !isTableDivider(trimmed)) {
      const parts = line.split('|');
      for (let cellIndex = 1; cellIndex < parts.length - 1; cellIndex++) {
        const cell = parts[cellIndex];
        const text = cell.trim();
        if (!text || /^[\s\-:]+$/.test(text)) {
          continue;
        }
        pushNode(nodes, text, {
          kind: 'table',
          lineNumber,
          cellIndex
        });
      }
      return;
    }

    pushNode(nodes, trimmed, {
      kind: 'paragraph',
      lineNumber,
      prefix: line.match(/^\s*/)?.[0] || ''
    });
  });

  return nodes;
}

// ── 用翻译结果重建 Markdown ──

function reconstructMarkdown(originalMarkdown, translatedNodes) {
  const lines = originalMarkdown.split('\n');
  const nodesByLine = new Map();

  translatedNodes.forEach((node) => {
    const bucket = nodesByLine.get(node.lineNumber) || [];
    bucket.push(node);
    nodesByLine.set(node.lineNumber, bucket);
  });

  return lines
    .map((line, lineNumber) => {
      const lineNodes = nodesByLine.get(lineNumber);
      if (!lineNodes?.length) {
        return line;
      }

      const first = lineNodes[0];
      if (first.kind === 'table') {
        const parts = line.split('|');
        lineNodes
          .slice()
          .sort((a, b) => a.cellIndex - b.cellIndex)
          .forEach((node) => {
            const rawCell = parts[node.cellIndex] ?? '';
            const leading = rawCell.match(/^\s*/)?.[0] || '';
            const trailing = rawCell.match(/\s*$/)?.[0] || '';
            parts[node.cellIndex] = `${leading}${restoreFormatting(node.value, node.original)}${trailing}`;
          });
        return parts.join('|');
      }

      const prefix = first.prefix || '';
      return prefix + restoreFormatting(first.value, first.original);
    })
    .join('\n');
}

window.ReadmdMarkdown = {
  protectFormatting,
  restoreFormatting,
  extractTextNodes,
  reconstructMarkdown
};
