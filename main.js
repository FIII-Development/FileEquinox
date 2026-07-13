const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')

const { stopAllServers } = require('./index.js')

let mainWindow

app.commandLine.appendSwitch('ignore-certificate-errors')

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

	const targetUrl = 'https://localhost:8443'

	function loadDashboard() {
		mainWindow.loadURL(targetUrl).catch((err) => {
			console.log(
				'⏳ Express backend is still warming up... retrying in 500ms'
			)
			setTimeout(loadDashboard, 500)
		})
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

app.on(
	'certificate-error',
	(event, webContents, url, error, certificate, callback) => {
		if (
			url.startsWith('https://localhost:8443') ||
			url.startsWith('https://localhost:443')
		) {
			event.preventDefault()
			callback(true)
		} else {
			callback(false)
		}
	}
)

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
