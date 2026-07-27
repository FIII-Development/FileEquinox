const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')

const { stopAllServers, serverReady, getHostUrl } = require('./index.js')

let mainWindow

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1000,
		height: 750,
		icon: path.join(__dirname, 'icons/favicon.ico'),
		title: 'FileEquinox Admin Dashboard',
		show: true,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js'),
		},
	})

	async function loadDashboard() {
		try {
			await serverReady
			await mainWindow.loadURL(getHostUrl())
		} catch (err) {
			console.log(
				'⏳ Express backend is still warming up... retrying in 500ms'
			)
			setTimeout(loadDashboard, 500)
		}
	}

	loadDashboard()

	mainWindow.once('ready-to-show', () => {
		mainWindow.show()
	})

	mainWindow.on('closed', () => {
		mainWindow = null
	})
}

ipcMain.handle('dialog:openDirectory', async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		properties: ['openDirectory'],
	})
	if (!canceled) {
		return filePaths[0]
	}
	return null
})

app.whenReady().then(() => {
	createWindow()

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('before-quit', () => {
	stopAllServers()
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('open-external-url', (event, url) => {
	shell.openExternal(url)
})
