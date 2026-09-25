const { contextBridge, ipcRenderer } = require("electron");

const invokeFile = (operation, payload = {}) => ipcRenderer.invoke("editor:file-system", { operation, ...payload });

contextBridge.exposeInMainWorld("webRevisionDesktop", Object.freeze({
  request: (request) => ipcRenderer.invoke("editor:api-request", request),
  openExternal: (url) => ipcRenderer.invoke("editor:open-external", url),
  fileSystem: Object.freeze({
    selectProjectDirectory: () => invokeFile("select"),
    listRecentProjectDirectories: () => invokeFile("recent-list"),
    openRecentProjectDirectory: (projectPath) => invokeFile("open-recent", { parts: [projectPath] }),
    openProjectDirectory: () => invokeFile("open-project-directory"),
    removeRecentProjectDirectory: (projectPath) => invokeFile("remove-recent", { parts: [projectPath] }),
    ensureDirectory: (parts, create) => invokeFile("ensure-directory", { parts, create }),
    ensureFile: (parts, create) => invokeFile("ensure-file", { parts, create }),
    readText: (parts) => invokeFile("read-text", { parts }),
    writeText: (parts, content) => invokeFile("write-text", { parts, content }),
    saveOutput: ({ suggestedName, contentBase64, filters }) => invokeFile("save-output", { suggestedName, contentBase64, filters }),
    chooseOutput: ({ suggestedName, filters }) => invokeFile("choose-output", { suggestedName, filters }),
    writeOutput: ({ token, contentBase64 }) => invokeFile("write-output", { token, contentBase64 }),
    remove: (parts, recursive) => invokeFile("remove", { parts, recursive }),
  }),
}));
