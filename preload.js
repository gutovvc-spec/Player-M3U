const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("playerApp", {
  platform: process.platform,
  loadPlaylist: (url) => ipcRenderer.invoke("playlist:load", url)
});
