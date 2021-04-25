const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld('launcher', {
    ipcSend: (channel, data) => {
        ipcRenderer.send(channel, data);
    },
    ipcReceive: (channel, callback) => {
        ipcRenderer.on(channel, callback);
    },
    appVersion: require('@electron/remote').app.getVersion()
});