import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemePie } from './look';

/**
 * The Theme card's pie: a theme's three colours, a third each. Drawn as one
 * SVG with no border and nothing light behind the slices, so no fringe shows
 * around it on a dark or a light card.
 */
describe('ThemePie', () => {
  const svg = renderToStaticMarkup(
    createElement(ThemePie, { colors: ['#111111', '#222222', '#333333'] }),
  );

  it('draws the disc in the first colour and the other two as slices on it', () => {
    const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
    expect(fills).toEqual(['#111111', '#222222', '#333333']);
    expect(svg).toContain('<circle cx="1" cy="1" r="1"');
  });

  it('has no border or stroke to fringe the edge', () => {
    expect(svg).not.toMatch(/stroke|border/);
  });
});
