const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronFeasibility", {
  getInfo: () => ipcRenderer.invoke("feasibility:get-info"),
  openPage: (url) => ipcRenderer.invoke("feasibility:open-page", { url }),
  showPage: () => ipcRenderer.invoke("feasibility:show-page"),
  inspectPage: () => ipcRenderer.invoke("feasibility:inspect-page"),
  crawl: (baseUrl, maxPages) => ipcRenderer.invoke("feasibility:crawl", { baseUrl, maxPages }),
  saveArtifacts: () => ipcRenderer.invoke("feasibility:save-artifacts"),
  onProgress: (listener) => {
    const handler = (_event, detail) => listener(detail);
    ipcRenderer.on("feasibility:progress", handler);
    return () => ipcRenderer.removeListener("feasibility:progress", handler);
  },
});
