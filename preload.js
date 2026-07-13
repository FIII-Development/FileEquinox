const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
	selectFolder: () => ipcRenderer.invoke('dialog:openDirectory'),
	openExternal: (url) => ipcRenderer.send('open-external-url', url),
})
