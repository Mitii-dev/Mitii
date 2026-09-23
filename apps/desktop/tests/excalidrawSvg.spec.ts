import { describe, expect, it } from 'vitest';

import {
  elementsToSvg,
  isExcalidrawSource,
  parseExcalidrawDocument,
} from '../src/shared/excalidrawSvg.js';

const SAMPLE = `{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    {
      "id": "title",
      "type": "text",
      "x": 10,
      "y": 10,
      "width": 200,
      "height": 30,
      "text": "BillDesk Architecture",
      "fontSize": 20,
      "strokeColor": "#1e1e1e"
    },
    {
      "id": "box",
      "type": "rectangle",
      "x": 10,
      "y": 50,
      "width": 160,
      "height": 60,
      "strokeColor": "#1971c2",
      "backgroundColor": "#d0ebff",
      "roundness": { "type": 3 }
    }
  ]
}`;

describe('excalidrawSvg', () => {
  it('detects excalidraw fences from language or JSON body', () => {
    expect(isExcalidrawSource('excalidraw', SAMPLE)).toBe(true);
    expect(isExcalidrawSource('json', SAMPLE)).toBe(true);
    expect(isExcalidrawSource('json', '{"hello":1}')).toBe(false);
  });

  it('parses elements and renders an SVG preview', () => {
    const parsed = parseExcalidrawDocument(SAMPLE);
    expect(parsed?.title).toBe('BillDesk Architecture');
    expect(parsed?.elements).toHaveLength(2);
    const svg = elementsToSvg(parsed!.elements, parsed!.title);
    expect(svg).toContain('<svg');
    expect(svg).toContain('BillDesk Architecture');
    expect(svg).toContain('<rect');
  });

  it('returns null for truncated JSON', () => {
    expect(parseExcalidrawDocument(SAMPLE.slice(0, 80))).toBeNull();
  });
});
