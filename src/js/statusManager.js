import { detectFileType } from './utils.js';

export class StatusManager {
  constructor(elements) {
    this.elements = elements;
  }

  update({ tab, stats }) {
    const fileType = detectFileType(tab?.filePath, tab?.title);
    if (this.elements.cursor) this.elements.cursor.textContent = `Ln ${stats.cursor.line}, Col ${stats.cursor.column}`;
    if (this.elements.words) this.elements.words.textContent = `${stats.words} ${stats.words === 1 ? 'word' : 'words'}`;
    if (this.elements.chars) this.elements.chars.textContent = `${stats.chars} ${stats.chars === 1 ? 'char' : 'chars'}`;
    if (this.elements.fileType) this.elements.fileType.textContent = fileType;
    if (this.elements.saveStatus) this.elements.saveStatus.textContent = tab?.isDirty ? 'Unsaved changes' : 'Saved';
    if (this.elements.zoom) this.elements.zoom.textContent = `${stats.zoom}%`;
    if (this.elements.activeFile) this.elements.activeFile.textContent = tab?.filePath || (tab ? 'New Document (Unsaved)' : 'No file open');
    if (this.elements.saveState) this.elements.saveState.textContent = tab?.isDirty ? 'Unsaved' : 'Saved';
  }
}
