/**
 * Pure Excalidraw → SVG helpers (no Node APIs).
 * Used by the chat markdown renderer and by engine persistence.
 */

export function isExcalidrawSource(language: string, text: string): boolean {
  const lang = language.trim().toLowerCase();
  if (lang === 'excalidraw') return true;
  if (lang !== 'json' && lang !== 'text' && lang !== '') return false;
  return looksLikeExcalidrawJson(text);
}

export function looksLikeExcalidrawJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;
  if (!/"type"\s*:\s*"excalidraw"/i.test(trimmed)) return false;
  if (!/"elements"\s*:\s*\[/i.test(trimmed)) return false;
  return true;
}

export function parseExcalidrawDocument(
  text: string,
): { elements: unknown[]; title?: string } | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const doc = parsed as { type?: unknown; elements?: unknown };
    if (doc.type !== 'excalidraw') return null;
    if (!Array.isArray(doc.elements) || doc.elements.length === 0) return null;
    return {
      elements: doc.elements,
      title: inferTitle(doc.elements),
    };
  } catch {
    return null;
  }
}

function inferTitle(elements: unknown[]): string | undefined {
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    const typed = el as { type?: string; text?: string };
    if (
      typed.type === 'text' &&
      typeof typed.text === 'string' &&
      typed.text.trim()
    ) {
      return typed.text.trim().slice(0, 80);
    }
  }
  return undefined;
}

/** Lightweight SVG export for common Excalidraw element types. */
export function elementsToSvg(elements: unknown[], title?: string): string {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const shapes: string[] = [];
  for (const raw of elements) {
    if (!raw || typeof raw !== 'object') continue;
    const el = raw as Record<string, unknown>;
    if (el.isDeleted === true) continue;
    const type = String(el.type ?? '');
    if (
      type === 'cameraUpdate' ||
      type === 'restoreCheckpoint' ||
      type === 'delete'
    ) {
      continue;
    }
    const x = num(el.x);
    const y = num(el.y);
    const w = Math.max(1, num(el.width, 100));
    const h = Math.max(1, num(el.height, 40));
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);

    const stroke = String(el.strokeColor ?? '#1e1e1e');
    const fill =
      el.backgroundColor && el.backgroundColor !== 'transparent'
        ? String(el.backgroundColor)
        : 'none';
    const strokeWidth = Math.max(1, num(el.strokeWidth, 2));

    if (type === 'rectangle' || type === 'image') {
      const rx = el.roundness ? 12 : 2;
      shapes.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" />`,
      );
    } else if (type === 'ellipse') {
      shapes.push(
        `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" />`,
      );
    } else if (type === 'diamond') {
      const cx = x + w / 2;
      const cy = y + h / 2;
      shapes.push(
        `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" />`,
      );
    } else if (type === 'text') {
      const text = String(el.text ?? '');
      const fontSize = Math.max(10, num(el.fontSize, 16));
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        shapes.push(
          `<text x="${x + 4}" y="${y + fontSize + index * (fontSize + 4)}" font-size="${fontSize}" font-family="Virgil, Segoe UI, sans-serif" fill="${escapeXml(stroke)}">${escapeXml(line)}</text>`,
        );
      });
    } else if (type === 'arrow' || type === 'line') {
      const points = Array.isArray(el.points) ? el.points : [];
      if (points.length >= 2) {
        const cmds: string[] = [];
        for (let i = 0; i < points.length; i += 1) {
          const pt = points[i] as unknown;
          const px = Array.isArray(pt) ? num(pt[0]) : 0;
          const py = Array.isArray(pt) ? num(pt[1]) : 0;
          cmds.push(`${i === 0 ? 'M' : 'L'} ${x + px} ${y + py}`);
          minX = Math.min(minX, x + px);
          minY = Math.min(minY, y + py);
          maxX = Math.max(maxX, x + px);
          maxY = Math.max(maxY, y + py);
        }
        const marker = type === 'arrow' ? ` marker-end="url(#arrowhead)"` : '';
        shapes.push(
          `<path d="${cmds.join(' ')}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"${marker} />`,
        );
      }
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 450;
  }
  const pad = 24;
  const width = Math.max(120, maxX - minX + pad * 2);
  const height = Math.max(80, maxY - minY + pad * 2);
  const body = shapes.join('\n  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="${minX - pad} ${minY - pad} ${width} ${height}" role="img"${title ? ` aria-label="${escapeXml(title)}"` : ''}>
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#1e1e1e" />
    </marker>
  </defs>
  <rect x="${minX - pad}" y="${minY - pad}" width="${width}" height="${height}" fill="#ffffff"/>
  ${body}
</svg>
`;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
