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

/** Where tome2's map view starts on the level (its panel's first row and column). */
interface Panel {
  row: number;
  col: number;
}

/**
 * Glyphs tome2 has drawn over the map that are not what lies on their grid
 * (a bolt, a beam or a blast): cells that differ from the same grid on the
 * screen at the last idle (drawn with the view at `basePanel`: the view
 * follows the hero, so it moves when they step before a creature's bolt) and
 * whose character is not the one the snapshot shows there; while
 * hallucinating, creature and item grids are left out.
 */
export function drawnEffects(snap: LevelSnapshot, screen: ScreenCopy, base: ScreenCopy, cols: number, rows: number, basePanel: Panel): MapEffect[] {
  const effects: MapEffect[] = [];
  for (let row = snap.rowMap; row < rows - 1; row++) {
    for (let col = snap.colMap; col < cols; col++) {
      const i = row * cols + col;
      const ch = screen.chars[i];
      if (ch === 0x20) continue;
      const point = terminalCell(snap, col, row, rows);
      if (!point) continue;
      const baseRow = point.y - basePanel.row + snap.rowMap;
      const baseCol = point.x - basePanel.col + snap.colMap;
      const b = baseRow * cols + baseCol;
      const onBase = baseRow >= snap.rowMap && baseRow < rows - 1 && baseCol >= snap.colMap && baseCol < cols;
      if (onBase && ch === base.chars[b] && screen.attrs[i] === base.attrs[b]) continue;
      const cell = point.y * snap.width + point.x;
      if (ch === snap.glyph[cell]) continue;
      const layer = snap.layer[cell] & LAYER_MASK;
      if (snap.hallucinating && (layer === LAYER_OBJECT || layer === LAYER_MONSTER)) continue;
      effects.push({ ...point, ch, attr: screen.attrs[i] });
    }
  }
  return effects;
}
