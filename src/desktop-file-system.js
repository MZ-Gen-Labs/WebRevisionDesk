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
  constructor(parts = [], name = "", path = "") {
    this.parts = parts;
    this.name = name;
    this.path = path;
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

function base64FromBytes(bytes) {
  let text = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(text);
}

async function base64FromBlob(blob) {
  return base64FromBytes(new Uint8Array(await blob.arrayBuffer()));
}

export async function saveDesktopOutput(blob, { suggestedName, filters = [] } = {}) {
  if (!desktopFileSystemAvailable()) return null;
  return unwrap(desktop().saveOutput({
    suggestedName,
    contentBase64: await base64FromBlob(blob),
    filters,
  }));
}

export async function chooseDesktopOutput({ suggestedName, filters = [] } = {}) {
  return unwrap(desktop().chooseOutput({ suggestedName, filters }));
}

export async function writeDesktopOutput(token, blob) {
  return unwrap(desktop().writeOutput({ token, contentBase64: await base64FromBlob(blob) }));
}

export async function selectDesktopProjectDirectory() {
  const selected = await unwrap(desktop().selectProjectDirectory());
  if (!selected) {
    const error = new Error("フォルダ選択をキャンセルしました。");
    error.name = "AbortError";
    throw error;
  }
  return new DesktopDirectoryHandle([], selected.name, selected.path);
}

export async function listRecentDesktopProjectDirectories() {
  return desktopFileSystemAvailable() ? unwrap(desktop().listRecentProjectDirectories()) : [];
}

export async function openRecentDesktopProjectDirectory(projectPath) {
  const selected = await unwrap(desktop().openRecentProjectDirectory(projectPath));
  return new DesktopDirectoryHandle([], selected.name, selected.path);
}

export async function removeRecentDesktopProjectDirectory(projectPath) {
  return unwrap(desktop().removeRecentProjectDirectory(projectPath));
}
