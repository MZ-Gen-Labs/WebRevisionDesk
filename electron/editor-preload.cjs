const { contextBridge, ipcRenderer } = require("electron");

const invokeFile = (operation, payload = {}) => ipcRenderer.invoke("editor:file-system", { operation, ...payload });

contextBridge.exposeInMainWorld("webRevisionDesktop", Object.freeze({
  request: (request) => ipcRenderer.invoke("editor:api-request", request),
  fileSystem: Object.freeze({
    selectProjectDirectory: () => invokeFile("select"),
    listRecentProjectDirectories: () => invokeFile("recent-list"),
    openRecentProjectDirectory: (projectPath) => invokeFile("open-recent", { parts: [projectPath] }),
    removeRecentProjectDirectory: (projectPath) => invokeFile("remove-recent", { parts: [projectPath] }),
    ensureDirectory: (parts, create) => invokeFile("ensure-directory", { parts, create }),
    ensureFile: (parts, create) => invokeFile("ensure-file", { parts, create }),
    readText: (parts) => invokeFile("read-text", { parts }),
    writeText: (parts, content) => invokeFile("write-text", { parts, content }),
    saveOutput: ({ suggestedName, contentBase64, filters }) => invokeFile("save-output", { suggestedName, contentBase64, filters }),
    remove: (parts, recursive) => invokeFile("remove", { parts, recursive }),
  }),
}));
