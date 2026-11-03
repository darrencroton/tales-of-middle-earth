import type { MapEffect, MapPoint } from './map.ts';
import type { ScreenCopy } from '../terminal.ts';
import { LAYER_MASK, LAYER_MONSTER, LAYER_OBJECT, type LevelSnapshot } from './snapshot.ts';

/** The level's grid under a terminal cell, or null outside the map view (the message row, the side panel, the status row). */
export function terminalCell(snap: LevelSnapshot, col: number, row: number, rows: number): MapPoint | null {
  if (row < snap.rowMap || row >= rows - 1 || col < snap.colMap) return null;
  const x = col - snap.colMap + snap.panelCol;
  const y = row - snap.rowMap + snap.panelRow;
  if (x < 0 || y < 0 || x >= snap.width || y >= snap.height) return null;
  return { x, y };
}

/**
 * Glyphs tome2 has drawn over the map that are not what lies on their grid:
 * a bolt, a beam or a blast. A cell counts when it differs from the screen at
 * the last idle (`base`) and its character is not the one the level shows
 * there now, so a grid tome2 merely redrew is never taken for one: shimmering
 * terrain (water, lava walls, mist) and multi-hued creatures, which take a new
 * colour on each redraw, a lasting effect's colour, and creatures that moved
 * since the idle; while hallucinating, creatures and items, which take a new
 * symbol on each redraw.
 */
export function drawnEffects(snap: LevelSnapshot, screen: ScreenCopy, base: ScreenCopy, cols: number, rows: number): MapEffect[] {
  const effects: MapEffect[] = [];
  for (let row = snap.rowMap; row < rows - 1; row++) {
    for (let col = snap.colMap; col < cols; col++) {
      const i = row * cols + col;
      const ch = screen.chars[i];
      if (ch === 0x20 || (ch === base.chars[i] && screen.attrs[i] === base.attrs[i])) continue;
      const point = terminalCell(snap, col, row, rows);
      if (!point) continue;
      const cell = point.y * snap.width + point.x;
      if (ch === snap.glyph[cell]) continue;
      const layer = snap.layer[cell] & LAYER_MASK;
      if (snap.hallucinating && (layer === LAYER_OBJECT || layer === LAYER_MONSTER)) continue;
      effects.push({ ...point, ch, attr: screen.attrs[i] });
    }
  }
  return effects;
}
