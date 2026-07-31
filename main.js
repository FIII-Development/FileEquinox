const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const fs = require('fs')
const path = require('path')

const launchDirectory = process.argv
	.slice(1)
	.map((argument) => {
		try {
			return fs.statSync(argument).isDirectory() ? path.resolve(argument) : null
		} catch {
			return null
		}
	})
	.find(Boolean)

const originalWorkingDirectory = process.cwd()
if (launchDirectory) process.chdir(launchDirectory)

const { stopAllServers, serverReady, getHostUrl } = require('./index.js')

process.chdir(originalWorkingDirectory)

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

function createSharedFolderWindow(directory) {
	const window = new BrowserWindow({
		width: 1000,
		height: 750,
		icon: path.join(__dirname, 'icons/favicon.ico'),
		title: `Share This Folder — ${path.basename(directory)}`,
		show: true,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js'),
		},
	})

	async function loadDirectory() {
		try {
			await serverReady
			await window.loadURL(`${getHostUrl()}/host.html`)
		} catch (err) {
			console.log(
				'⏳ Express backend is still warming up... retrying in 500ms'
			)
			setTimeout(loadDirectory, 500)
		}
	}

	loadDirectory()

	window.once('ready-to-show', () => {
		window.show()
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
	if (launchDirectory) {
		createSharedFolderWindow(launchDirectory)
	} else {
		createWindow()
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			if (launchDirectory) createSharedFolderWindow(launchDirectory)
			else createWindow()
		}
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
