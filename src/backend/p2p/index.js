const path = require('path')
const http = require('http')

const EventBus = require('./services/eventBus')
const TransferManager = require('./services/transferManager')
const TunnelManager = require('./services/tunnelManager')
const ServerManager = require('./services/serverManager')

const createHostRouter = require('./routes/host')
const createFilesRouter = require('./routes/files')
const createDownloadsRouter = require('./routes/download')

const createDynamicStatic = require('./middleware/dynamicStatic')
const createHostOnly = require('./middleware/hostOnly')

const { isPathInside } = require('./utils/path')

const {
	getHostPort,
	getUserPort,
	setHostPort,
	setUserPort,
} = require('./config/serverConfig')

const createApp = require('./app')
console.log('CREATE APP TYPE:', typeof createApp)
console.log('CREATE APP VALUE:', createApp)

const senderPath = path.join(__dirname, '../../web/sender/')
const receiverPath = path.join(__dirname, '../../web/receiver/')

const dynamicStatic = createDynamicStatic({
	getHostPort,
	senderPath,
	receiverPath,
})

let sharedPath = process.cwd()
let isServerActive = true

let hostServerInstance = null
let userServerInstance = null

const eventBus = new EventBus()
const transferManager = new TransferManager(eventBus)

function setSharedPath(newPath) {
	sharedPath = path.resolve(newPath)
}

function getSharedPath() {
	return sharedPath
}

function logEvent(message, isSystem = false) {
	console.log(
		`[${new Date().toLocaleTimeString()}] ${
			isSystem ? '[SYSTEM] ' : ''
		}${message}`
	)

	eventBus.broadcast('log', {
		message,
		system: isSystem,
	})
}

function setServerActive(active) {
	isServerActive = active
}

const tunnelManager = new TunnelManager({
	getUserPort,
	eventBus,
	log: logEvent,
})

const serverManager = new ServerManager({
	eventBus,
	tunnelManager,
	log: logEvent,
	getHostPort,
	getUserPort,
	setHostPort,
	setUserPort,
})

const hostRouter = createHostRouter({
	getUserPort,
	getHostPort,
	getSharedPath,
	getServerActive: () => isServerActive,
	tunnelManager,
	setUserPort,
	setSharedPath,
	serverManager,
	logEvent,
	transferManager,
	setServerActive,
	eventBus,
})

const fileRouter = createFilesRouter({
	getServerActive: () => isServerActive,
	isPathInside,
	getSharedPath,
})

const downloadRouter = createDownloadsRouter({
	getServerActive: () => isServerActive,
	getSharedPath,
	isPathInside,
	logEvent,
	transferManager,
})

const requireHostDashboard = createHostOnly({
	getHostPort,
})

const app = createApp({
	getHostPort,
	getUserPort,
	senderPath,
	receiverPath,
	dynamicStatic,
	requireHostDashboard,
	hostRouter,
	fileRouter,
	downloadRouter,
})

const serverReady = serverManager.startServers(app)

function getHostUrl() {
	return serverManager.getHostUrl()
}

async function stopAllServers() {
	console.log('⚡ Initiating application shutdown sequence...')

	eventBus.closeAll()

	tunnelManager.close()

	if (hostServerInstance) {
		hostServerInstance.close(() => {
			console.log('🔒 Host Admin Server completely offline.')
		})
	}

	if (userServerInstance) {
		userServerInstance.close(() => {
			console.log('🔒 Public User Server completely offline.')
		})
	}
}

module.exports = {
	stopAllServers,
	serverReady,
	getHostUrl,
	setSharedPath,
	getSharedPath,
}
