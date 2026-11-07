import type { Engine } from './engine.ts';
import { collectFiles, decodeBundle, downloadText, encodeBundle, exportFilename, restoreFiles } from './saves.ts';
import { el } from './ui/dom.ts';
import { confirmSheet, openMenu, openMessage, type MenuItem } from './ui/menus.ts';
import type { Sheets } from './ui/sheet.ts';

interface BackupDeps {
  engine: Engine;
  sheets: Sheets;
  /** The file input a backup is chosen with. */
  input: HTMLInputElement;
  /** Cloud sync, while it is on: told before a backup replaces what is here. */
  cloud(): { restoring(): Promise<void> } | null;
}

function errorText(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}

/** Backup of everything the game keeps in this browser, on the title screen only: every adventure, the Hall of Fame and the deeds earned. */
export class Backup {
  private readonly deps: BackupDeps;

  constructor(deps: BackupDeps) {
    this.deps = deps;
    deps.input.addEventListener('change', () => {
      const file = deps.input.files?.[0];
      if (!file) return;
      this.importSaves(file).catch((err) => openMessage(deps.sheets, 'Import failed', errorText(err)));
    });
  }

  /** Export and import, as menu rows. */
  items(): MenuItem[] {
    return [
      { label: 'Export game data', icon: '⤒', hint: 'Download a backup file', run: () => this.startExport() },
      { label: 'Import game data', icon: '⤓', hint: 'Replace what is here with a backup', run: () => this.startImport() },
    ];
  }

  /** The Backup menu: export or import. */
  open(): void {
    openMenu(this.deps.sheets, 'Backup', this.items(), 'Your adventures, the Hall of Fame and your deeds live in this browser. A backup keeps them safe or moves them to another device.');
  }

  private startExport(): void {
    this.deps.sheets.closeAll();
    this.exportSaves().catch((err) => openMessage(this.deps.sheets, 'Export failed', errorText(err)));
  }

  private startImport(): void {
    this.deps.sheets.closeAll();
    this.deps.input.value = '';
    this.deps.input.click();
  }

  private async exportSaves(): Promise<void> {
    const { engine, sheets } = this.deps;
    const fs = engine.fs;
    const root = engine.savePath;
    if (!fs || !root) {
      openMessage(sheets, 'Export game data', 'The game is still loading. Try again in a moment.');
      return;
    }
    await engine.syncNow().catch((err) => console.warn('Sync before export failed; exporting from memory', err));
    const files = collectFiles(fs, root);
    if (files.length === 0) {
      openMessage(sheets, 'Export game data', 'There is nothing to back up yet.');
      return;
    }
    downloadText(exportFilename(), encodeBundle(files));
  }

  private async importSaves(file: File): Promise<void> {
    const { engine, sheets } = this.deps;
    const fs = engine.fs;
    const root = engine.savePath;
    if (!fs || !root) {
      openMessage(sheets, 'Import game data', 'The game is still loading. Try again in a moment.');
      return;
    }
    if (engine.storageError) {
      openMessage(sheets, 'Import game data', 'Browser storage is unavailable this session, so imported data would be lost on restart.');
      return;
    }
    const files = decodeBundle(await file.text());
    if (files.length === 0) {
      openMessage(sheets, 'Import game data', 'This backup holds no game data.');
      return;
    }
    const cloud = this.deps.cloud();
    confirmSheet(
      sheets,
      'Replace your game data?',
      `Every hero, the Hall of Fame and your deeds on this device are replaced by those in the backup. Export first to keep what is here. The game then restarts.${
        cloud ? ' With cloud sync on, heroes the cloud has too are then compared: where they differ you choose which journey continues, and heroes only in the cloud come back.' : ''
      }`,
      'Replace',
      () => {
        sheets.closeAll();
        void (cloud ? cloud.restoring() : Promise.resolve()).then(() => {
          try {
            restoreFiles(fs, root, files);
          } catch (err) {
            this.importFailed(err);
            return;
          }
          engine.syncNow().then(
            () => location.reload(),
            (err) => this.importFailed(err),
          );
        });
      },
      true,
    );
  }

  /** Says why an import failed, then reloads, which reads storage again as it was before the import (nothing is synced meanwhile). */
  private importFailed(err: unknown): void {
    const { engine, sheets } = this.deps;
    engine.holdStorage();
    const body = el('div', 'prose');
    body.append(el('p', undefined, `Nothing was changed: ${errorText(err)}`));
    sheets.open({ title: 'Import failed', body, kind: 'card', actions: [{ label: 'OK', primary: true, run: () => sheets.back() }], onClose: () => location.reload() });
  }
}
