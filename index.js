const express = require('express')
const fs = require('fs')
const path = require('path')
const http = require('http')
const localtunnel = require('localtunnel')

const app = express()
app.use(express.json())

let HOST_PORT = 8443
let USER_PORT = 80

let sharedPath = process.cwd()
let isServerActive = true

let hostServerInstance = null
let userServerInstance = null
let tunnelInstance = null
let tunnelUrl = null
let isTunnelActive = false
let tunnelStartupPromise = null
let tunnelLifecycleId = 0

let sseClients = []
let activeTransfers = []

function broadcastToHost(type, data) {
	const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`
	sseClients.forEach((client) => client.res.write(payload))
}

function logEvent(message, isSystem = false) {
	console.log(
		`[${new Date().toLocaleTimeString()}] ${isSystem ? '[SYSTEM] ' : ''}${message}`
	)
	broadcastToHost('log', { message, system: isSystem })
}

function isHostDashboardRequest(req) {
	return req.socket.localPort === HOST_PORT
}

function requireHostDashboard(req, res, next) {
	if (!isHostDashboardRequest(req)) {
		return res.status(403).json({
			error: 'Host controls are only available from the dashboard port.',
		})
	}
	next()
}

function getTunnelState() {
	return {
		tunnelActive: isTunnelActive,
		tunnelUrl,
	}
}

function broadcastTunnelState() {
	broadcastToHost('tunnel', getTunnelState())
}

function createLocalTunnel() {
	return new Promise((resolve, reject) => {
		let settled = false
		let client = null
		const timeoutMs = 15000

		const timeout = setTimeout(() => {
			if (settled) return
			settled = true

			if (client) {
				try {
					client.close()
				} catch (err) {}
			}

			reject(
				new Error(
					'Timed out while connecting to localtunnel. Check your internet connection and try again.'
				)
			)
		}, timeoutMs)

		client = localtunnel(
			{ port: USER_PORT, local_host: '127.0.0.1' },
			(err, tunnel) => {
				if (settled) {
					if (tunnel) {
						try {
							tunnel.close()
						} catch (closeErr) {}
					}
					return
				}

				settled = true
				clearTimeout(timeout)

				if (err) {
					reject(err)
				} else {
					resolve(tunnel)
				}
			}
		)
	})
}

async function enableTunnel() {
	if (tunnelInstance && isTunnelActive && tunnelUrl) {
		return tunnelUrl
	}

	if (tunnelStartupPromise) {
		return tunnelStartupPromise
	}

	const lifecycleId = tunnelLifecycleId
	const startupPromise = (async () => {
		const tunnel = await createLocalTunnel()

		if (lifecycleId !== tunnelLifecycleId) {
			try {
				tunnel.close()
			} catch (err) {}
			throw new Error('Tunnel startup was canceled.')
		}

		tunnelInstance = tunnel
		tunnelUrl = tunnel.url
		isTunnelActive = true

		tunnel.on('close', () => {
			if (tunnel !== tunnelInstance) return

			tunnelInstance = null
			tunnelUrl = null
			isTunnelActive = false
			logEvent('Public tunnel connection closed.', true)
			broadcastTunnelState()
		})

		tunnel.on('error', (err) => {
			if (tunnel !== tunnelInstance) return
			logEvent(`Public tunnel error: ${err.message}`, true)
		})

		tunnel.on('request', (req) => {
			if (tunnel !== tunnelInstance) return
			logEvent(`Public tunnel request: ${req.method} ${req.path}`)
		})

		logEvent(`Public tunnel enabled: ${tunnelUrl}`, true)
		broadcastTunnelState()
		return tunnelUrl
	})()

	tunnelStartupPromise = startupPromise

	try {
		return await startupPromise
	} finally {
		if (tunnelStartupPromise === startupPromise) {
			tunnelStartupPromise = null
		}
	}
}

function disableTunnel({ announce = true } = {}) {
	tunnelLifecycleId += 1
	tunnelStartupPromise = null

	const tunnel = tunnelInstance
	tunnelInstance = null
	tunnelUrl = null
	isTunnelActive = false

	if (tunnel) {
		try {
			tunnel.close()
		} catch (err) {}
	}

	if (announce) {
		logEvent('Public tunnel disabled.', true)
	}
	broadcastTunnelState()
}

function isPathInside(rootPath, candidatePath) {
	const relative = path.relative(rootPath, candidatePath)
	return (
		relative === '' ||
		(!relative.startsWith('..') && !path.isAbsolute(relative))
	)
}

app.use('/api/host', requireHostDashboard)

app.get('/api/host/config', (req, res) => {
	res.json({
		port: USER_PORT,
		hostPort: HOST_PORT,
		sharedPath: sharedPath,
		active: isServerActive,
		...getTunnelState(),
	})
})

app.post('/api/host/validate-path', (req, res) => {
	const { targetPath } = req.body
	if (!targetPath) {
		return res
			.status(400)
			.json({ valid: false, error: 'Path parameter is missing.' })
	}

	try {
		if (
			fs.existsSync(targetPath) &&
			fs.statSync(targetPath).isDirectory()
		) {
			return res.json({ valid: true })
		}
		return res.json({
			valid: false,
			error: 'Selected path is not a valid directory.',
		})
	} catch (err) {
		return res.json({
			valid: false,
			error: 'Target directory is inaccessible.',
		})
	}
})

app.post('/api/host/config', async (req, res) => {
	const { port, sharedPath: newPath } = req.body

	if (!port || !newPath) {
		return res.status(400).json({ error: 'Missing config properties.' })
	}

	if (!fs.existsSync(newPath)) {
		return res
			.status(400)
			.json({ error: 'Target directory path does not exist.' })
	}

	const nextUserPort = parseInt(port)
	if (
		Number.isNaN(nextUserPort) ||
		nextUserPort < 1 ||
		nextUserPort > 65535
	) {
		return res
			.status(400)
			.json({ error: 'User port must be between 1 and 65535.' })
	}

	if (nextUserPort === HOST_PORT) {
		return res
			.status(400)
			.json({ error: 'User port cannot conflict with the Host port!' })
	}

	logEvent(
		`Updating user network layout to Port: ${nextUserPort} | Directory: ${newPath}`,
		true
	)

	const previousUserPort = USER_PORT
	const previousSharedPath = sharedPath
	const wasTunnelActive = isTunnelActive || Boolean(tunnelStartupPromise)

	if (wasTunnelActive) {
		disableTunnel({ announce: false })
	}

	USER_PORT = nextUserPort
	sharedPath = path.resolve(newPath)

	try {
		await restartUserServer()
	} catch (err) {
		USER_PORT = previousUserPort
		sharedPath = previousSharedPath
		logEvent(`Failed to update public server: ${err.message}`, true)

		try {
			await restartUserServer()
		} catch (restartErr) {
			logEvent(
				`Failed to restore previous public server: ${restartErr.message}`,
				true
			)
		}

		if (wasTunnelActive) {
			try {
				await enableTunnel()
			} catch (tunnelErr) {
				logEvent(
					`Failed to restore public tunnel: ${tunnelErr.message}`,
					true
				)
			}
		}

		res.status(500).json({ error: err.message, ...getTunnelState() })
		return
	}

	if (wasTunnelActive) {
		try {
			await enableTunnel()
		} catch (err) {
			logEvent(`Failed to restart public tunnel: ${err.message}`, true)
		}
	}

	res.json({ success: true, ...getTunnelState() })
})

app.post('/api/host/toggle', (req, res) => {
	isServerActive = !isServerActive
	logEvent(
		`Public server set to ${isServerActive ? 'ACTIVE' : 'INACTIVE'}.`,
		true
	)

	if (!isServerActive) {
		activeTransfers = []
		broadcastToHost('metrics', { connections: 0, transfers: [] })
	}
	res.json({ active: isServerActive })
})

app.post('/api/host/tunnel', async (req, res) => {
	const { enabled } = req.body || {}

	if (enabled) {
		try {
			await enableTunnel()
			return res.json({ success: true, ...getTunnelState() })
		} catch (err) {
			logEvent(`Tunnel startup failed: ${err.message}`, true)
			broadcastTunnelState()
			return res
				.status(500)
				.json({ error: err.message, ...getTunnelState() })
		}
	}

	disableTunnel()
	res.json({ success: true, ...getTunnelState() })
})

app.get('/api/host/stream', (req, res) => {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	})
	const clientId = Date.now()
	sseClients.push({ id: clientId, res })
	res.write(
		`data: ${JSON.stringify({ type: 'metrics', connections: sseClients.length - 1, transfers: activeTransfers })}\n\n`
	)

	req.on('close', () => {
		sseClients = sseClients.filter((c) => c.id !== clientId)
	})
})

app.get('/', (req, res) => {
	const incomingPort = req.socket.localPort

	if (incomingPort === HOST_PORT) {
		return res.sendFile(path.join(__dirname, 'index.html'))
	} else if (incomingPort === USER_PORT) {
		return res.sendFile(path.join(__dirname, 'host.html'))
	}

	res.status(404).send('Not Found')
})

app.use(express.static(__dirname))

app.get('/api/files', (req, res) => {
	if (!isServerActive) return res.status(503).json([])
	const targetDir = path.resolve(sharedPath, req.query.path || '')
	if (!isPathInside(sharedPath, targetDir)) return res.status(403).json([])

	try {
		const items = fs
			.readdirSync(targetDir)
			.map((name) => {
				const lowerName = name.toLowerCase()
				if (
					lowerName === 'desktop.ini' ||
					lowerName.startsWith('fileequinox')
				)
					return null
				const stats = fs.statSync(path.join(targetDir, name))
				return {
					name,
					type: stats.isDirectory() ? 'directory' : 'file',
				}
			})
			.filter(Boolean)
		res.json(items)
	} catch {
		res.json([])
	}
})

app.get('/download', (req, res) => {
	if (!isServerActive) return res.status(503).send('Server is down.')

	const fileQuery = req.query.file
	if (!fileQuery) {
		return res.status(400).send("Missing 'file' parameter.")
	}

	const rawPath = decodeURIComponent(fileQuery)
	const safePath = path.resolve(sharedPath, path.normalize(rawPath))
	const clientIp = req.ip || req.socket.remoteAddress
	const filename = path.basename(safePath)

	const isOutside = !isPathInside(sharedPath, safePath)

	if (isOutside) {
		return res.status(403).send('Access Forbidden.')
	}

	if (filename.startsWith('.') || !filename) {
		logEvent(
			`⚠️ Blocked transmission request from ${clientIp} for a nameless file.`,
			true
		)
		return res.status(400).send('Invalid file name.')
	}

	let stat
	try {
		if (!fs.existsSync(safePath)) {
			return res
				.status(404)
				.send(
					'<h1>404 Not Found</h1><p>The requested file does not exist.</p>'
				)
		}
		stat = fs.statSync(safePath)
		if (stat.isDirectory()) {
			return res
				.status(400)
				.send('Requested path is a directory, not a file.')
		}
	} catch (err) {
		logEvent(
			`Internal structural error accessing file: ${err.message}`,
			true
		)
		return res.status(500).send('Internal Server Error.')
	}

	logEvent(`📥 ${clientIp} requested download: ${filename}`)

	const totalBytes = stat.size
	const transferId = Date.now() + Math.random().toString()

	let bytesSent = 0
	let lastBytesSent = 0

	res.setHeader('Content-Length', totalBytes)
	res.setHeader(
		'Content-Disposition',
		`attachment; filename="${encodeURIComponent(filename)}"`
	)
	res.setHeader('Content-Type', 'application/octet-stream')

	activeTransfers.push({
		id: transferId,
		filename,
		ip: clientIp,
		speed: '0 KB/s',
		progress: 0,
	})

	broadcastToHost('metrics', {
		connections: sseClients.length - 1,
		transfers: activeTransfers,
	})

	const fileStream = fs.createReadStream(safePath)

	fileStream.on('error', (err) => {
		logEvent(`Stream error reading ${filename}: ${err.message}`, true)
		if (!res.headersSent) {
			res.status(500).send('Error streaming file.')
		}
	})

	const metricInterval = setInterval(() => {
		const currentActiveIdx = activeTransfers.findIndex(
			(t) => t.id === transferId
		)
		if (currentActiveIdx === -1) return

		const bytesInThisSecond = bytesSent - lastBytesSent
		lastBytesSent = bytesSent

		let speedString = '0 B/s'
		if (bytesInThisSecond >= 1024 * 1024) {
			speedString = `${(bytesInThisSecond / (1024 * 1024)).toFixed(1)} MB/s`
		} else if (bytesInThisSecond >= 1024) {
			speedString = `${(bytesInThisSecond / 1024).toFixed(0)} KB/s`
		} else if (bytesInThisSecond > 0) {
			speedString = `${bytesInThisSecond} B/s`
		}

		const progressPercent = Math.min(
			Math.floor((bytesSent / totalBytes) * 100),
			100
		)

		activeTransfers[currentActiveIdx].speed = speedString
		activeTransfers[currentActiveIdx].progress = progressPercent

		broadcastToHost('metrics', {
			connections: sseClients.length - 1,
			transfers: activeTransfers,
		})
	}, 1000)

	fileStream.on('data', (chunk) => {
		bytesSent += chunk.length
	})

	fileStream.pipe(res)

	function handleTransferEnd(isSuccess) {
		clearInterval(metricInterval)
		activeTransfers = activeTransfers.filter((t) => t.id !== transferId)
		broadcastToHost('metrics', {
			connections: sseClients.length - 1,
			transfers: activeTransfers,
		})
		if (isSuccess) {
			logEvent(`✅ Successfully sent ${filename} to ${clientIp}`)
		} else {
			logEvent(`❌ Download interrupted for ${filename} by ${clientIp}`)
		}
	}

	res.on('finish', () => handleTransferEnd(true))
	res.on('close', () => {
		if (bytesSent < totalBytes) handleTransferEnd(false)
	})
})

function findAvailablePort(startingPort, label) {
	return new Promise((resolve, reject) => {
		const server = http.createServer()
		server.once('error', (err) => {
			if (err.code === 'EADDRINUSE') {
				const nextPort = startingPort + 1
				if (nextPort > 65535) {
					reject(new Error(`No available port found for ${label}.`))
				} else {
					resolve(findAvailablePort(nextPort, label))
				}
			} else {
				reject(err)
			}
		})
		server.once('listening', () => {
			const { port } = server.address()
			server.close(() => resolve(port))
		})
		server.listen(startingPort)
	})
}

function closeHttpServer(server) {
	return new Promise((resolve) => {
		if (!server || !server.listening) {
			resolve()
			return
		}

		server.close(() => resolve())
	})
}

function startHttpServer(server, port, label) {
	return new Promise((resolve, reject) => {
		const handleListening = () => {
			cleanup()
			server.on('error', (err) => {
				console.error(`${label} server error:`, err)
			})
			resolve()
		}

		const handleError = (err) => {
			cleanup()
			reject(err)
		}

		const cleanup = () => {
			server.off('listening', handleListening)
			server.off('error', handleError)
		}

		server.once('listening', handleListening)
		server.once('error', handleError)
		server.listen(port)
	})
}

async function restartUserServer() {
	await closeHttpServer(userServerInstance)

	userServerInstance = http.createServer(app)

	try {
		await startHttpServer(userServerInstance, USER_PORT, 'User')
		logEvent(`User service spun up on port ${USER_PORT}`, true)
	} catch (err) {
		if (userServerInstance) {
			try {
				userServerInstance.close()
			} catch (closeErr) {}
		}
		userServerInstance = null

		if (err.code === 'EADDRINUSE') {
			throw new Error(`Port ${USER_PORT} is already in use.`)
		}
		throw err
	}
}

async function startServers() {
	try {
		HOST_PORT = await findAvailablePort(HOST_PORT, 'host')
	} catch (err) {
		console.error('Could not find an available host port:', err)
		return
	}

	try {
		USER_PORT = await findAvailablePort(USER_PORT, 'user')
	} catch (err) {
		console.error('Could not find an available user port:', err)
		return
	}

	try {
		hostServerInstance = http.createServer(app)
		await startHttpServer(hostServerInstance, HOST_PORT, 'Host')
		console.log(`Host server running on ${HOST_PORT}`)
	} catch (err) {
		console.error('Could not start the host server:', err)
		return
	}

	try {
		await restartUserServer()
	} catch (err) {
		console.error('Could not start the user server:', err)
	}
}

const serverReady = startServers()

function getHostUrl() {
	return `http://localhost:${HOST_PORT}`
}

async function stopAllServers() {
	console.log('⚡ Initiating application shutdown sequence...')

	sseClients.forEach((client) => {
		try {
			client.res.end()
		} catch (e) {}
	})
	sseClients = []

	if (tunnelInstance) {
		try {
			tunnelInstance.close()
		} catch (e) {}
	}
	tunnelInstance = null
	tunnelUrl = null
	isTunnelActive = false

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

module.exports = { stopAllServers, serverReady, getHostUrl }
