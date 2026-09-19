function desktop() {
  if (!globalThis.webRevisionDesktop?.fileSystem) throw new Error("デスクトップ版のフォルダ機能を利用できません。");
  return globalThis.webRevisionDesktop.fileSystem;
}

async function unwrap(promise) {
  const result = await promise;
  if (result?.ok) return result.value;
  const error = new Error(result?.message || "ファイル操作に失敗しました。");
  error.name = result?.errorName || "Error";
  throw error;
}

class DesktopFileHandle {
  constructor(parts, name) {
    this.parts = parts;
    this.name = name;
    this.kind = "file";
  }

  async getFile() {
    const text = await unwrap(desktop().readText(this.parts));
    return { name: this.name, text: async () => text };
  }

  async createWritable() {
    let content = "";
    return {
      write: async (value) => { content = typeof value === "string" ? value : await new Blob([value]).text(); },
      close: async () => unwrap(desktop().writeText(this.parts, content)),
    };
  }
}

class DesktopDirectoryHandle {
  constructor(parts = [], name = "") {
    this.parts = parts;
    this.name = name;
    this.kind = "directory";
  }

  async requestPermission() { return "granted"; }

  async getDirectoryHandle(name, options = {}) {
    const parts = [...this.parts, name];
    await unwrap(desktop().ensureDirectory(parts, options.create === true));
    return new DesktopDirectoryHandle(parts, name);
  }

  async getFileHandle(name, options = {}) {
    const parts = [...this.parts, name];
    await unwrap(desktop().ensureFile(parts, options.create === true));
    return new DesktopFileHandle(parts, name);
  }

  async removeEntry(name, options = {}) {
    return unwrap(desktop().remove([...this.parts, name], options.recursive === true));
  }
}

export function desktopFileSystemAvailable() {
  return Boolean(globalThis.webRevisionDesktop?.fileSystem);
}

export async function selectDesktopProjectDirectory() {
  const selected = await unwrap(desktop().selectProjectDirectory());
  if (!selected) {
    const error = new Error("フォルダ選択をキャンセルしました。");
    error.name = "AbortError";
    throw error;
  }
  return new DesktopDirectoryHandle([], selected.name);
}

