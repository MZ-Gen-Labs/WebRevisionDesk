const { contextBridge, ipcRenderer } = require("electron");

const invokeFile = (operation, payload = {}) => ipcRenderer.invoke("editor:file-system", { operation, ...payload });

contextBridge.exposeInMainWorld("webRevisionDesktop", Object.freeze({
  request: (request) => ipcRenderer.invoke("editor:api-request", request),
  fileSystem: Object.freeze({
    selectProjectDirectory: () => invokeFile("select"),
    ensureDirectory: (parts, create) => invokeFile("ensure-directory", { parts, create }),
    ensureFile: (parts, create) => invokeFile("ensure-file", { parts, create }),
    readText: (parts) => invokeFile("read-text", { parts }),
    writeText: (parts, content) => invokeFile("write-text", { parts, content }),
    remove: (parts, recursive) => invokeFile("remove", { parts, recursive }),
  }),
}));

