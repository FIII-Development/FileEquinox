const express = require('express')
const fs = require('fs')
const path = require('path')
const https = require('https')
const { exec } = require('child_process')

const app = express()
app.use(express.json())

const HOST_PORT = 8443
let USER_PORT = 443

let sharedPath = process.cwd()
let isServerActive = true

let hostServerInstance = null
let userServerInstance = null

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

app.get('/api/host/config', (req, res) => {
	res.json({
		port: USER_PORT,
		hostPort: HOST_PORT,
		sharedPath: sharedPath,
		active: isServerActive,
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

app.post('/api/host/config', (req, res) => {
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
	if (nextUserPort === HOST_PORT) {
		return res
			.status(400)
			.json({ error: 'User port cannot conflict with the Host port!' })
	}

	logEvent(
		`Updating user network layout to Port: ${nextUserPort} | Directory: ${newPath}`,
		true
	)

	USER_PORT = nextUserPort
	sharedPath = path.resolve(newPath)

	restartUserServer()
	res.json({ success: true })
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
	if (!targetDir.startsWith(sharedPath)) return res.status(403).json([])

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

	const relative = path.relative(sharedPath, safePath)
	const isOutside = relative.startsWith('..') || path.isAbsolute(relative)

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

const sslOptions = {
	key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
	cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem')),
}

function restartUserServer() {
	if (userServerInstance) userServerInstance.close()

	userServerInstance = https
		.createServer(sslOptions, app)
		.listen(USER_PORT, () =>
			logEvent(
				`User service spun up via HTTPS on port ${USER_PORT}`,
				true
			)
		)
}

hostServerInstance = https
	.createServer(sslOptions, app)
	.listen(HOST_PORT, () =>
		console.log(`Host server running via HTTPS on ${HOST_PORT}`)
	)

restartUserServer()

function stopAllServers() {
	console.log('⚡ Initiating application shutdown sequence...')

	sseClients.forEach((client) => {
		try {
			client.res.end()
		} catch (e) {}
	})
	sseClients = []

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

module.exports = { stopAllServers }
