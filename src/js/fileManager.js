import { formatError } from './utils.js';

export class FileManager {
  constructor(toasts) {
    this.toasts = toasts;
    this.api = window.notepad;
  }

  async listRecent() {
    const result = await this.api.files.listRecent();
    if (!result?.ok) throw new Error(result?.error || 'Unable to load recent files.');
    return result.files || [];
  }

  async clearRecent() {
    const result = await this.api.files.clearRecent();
    if (!result?.ok) throw new Error(result?.error || 'Unable to clear history.');
    return true;
  }

  async openDialog() {
    const result = await this.api.files.openDialog();
    if (result?.canceled) return null;
    if (!result?.ok) throw new Error(result?.error || 'Unable to open file.');
    return result.file;
  }

  async openRecent(filePath) {
    const result = await this.api.files.openRecent(filePath);
    if (!result?.ok) throw new Error(result?.error || 'Unable to open recent file.');
    return result.file;
  }

  async save(tab, saveAs = false) {
    const result = await this.api.files.save({
      filePath: tab.filePath,
      content: tab.content,
      saveAs
    });

    if (result?.canceled) return null;
    if (!result?.ok) throw new Error(result?.error || 'Unable to save file.');
    return result;
  }

  async saveRecovery(tab) {
    if (!tab?.isDirty) return;
    try {
      await this.api.recovery.save({
        id: tab.id,
        title: tab.title,
        filePath: tab.filePath,
        content: tab.content
      });
    } catch (error) {
      this.toasts.warning('Recovery snapshot failed', formatError(error));
    }
  }

  async clearRecovery(tabId) {
    try {
      await this.api.recovery.delete(tabId);
    } catch {
      // Recovery cleanup should never interrupt the user's save flow.
    }
  }
}
