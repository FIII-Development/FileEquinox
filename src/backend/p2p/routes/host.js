const express = require('express')

const fs = require('fs')
const path = require('path')

function createHostRouter({
	getUserPort,
	setUserPort,
	getHostPort,
	getSharedPath,
	setSharedPath,
	getServerActive,
	tunnelManager,
	serverManager,
	logEvent,
	setServerActive,
	transferManager,
	eventBus,
}) {
	const router = express.Router()

	// Host routes go here
	router.get('/config', (req, res) => {
		res.json({
			port: getUserPort(),
			hostPort: getHostPort(),
			sharedPath: getSharedPath(),
			active: getServerActive(),
			...tunnelManager.getState(),
		})
	})

	router.post('/validate-path', (req, res) => {
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

	router.post('/config', async (req, res) => {
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

		if (nextUserPort === getHostPort()) {
			return res.status(400).json({
				error: 'User port cannot conflict with the Host port!',
			})
		}

		logEvent(
			`Updating user network layout to Port: ${nextUserPort} | Directory: ${newPath}`,
			true
		)

		const previousUserPort = getUserPort()
		const previousSharedPath = getSharedPath()
		const wasTunnelActive = tunnelManager.isActiveOrStarting()

		if (wasTunnelActive) {
			tunnelManager.disable({ announce: false })
		}

		setUserPort(nextUserPort)
		tunnelManager.setUserPort(nextUserPort)
		serverManager.setUserPort(nextUserPort)
		setSharedPath(newPath)

		try {
			await serverManager.restartUserServer()
		} catch (err) {
			USER_PORT = previousUserPort
			sharedPath = previousSharedPath
			logEvent(`Failed to update public server: ${err.message}`, true)

			try {
				await serverManager.restartUserServer()
			} catch (restartErr) {
				logEvent(
					`Failed to restore previous public server: ${restartErr.message}`,
					true
				)
			}

			if (wasTunnelActive) {
				try {
					await tunnelManager.enable()
				} catch (tunnelErr) {
					logEvent(
						`Failed to restore public tunnel: ${tunnelErr.message}`,
						true
					)
				}
			}

			res.status(500).json({
				error: err.message,
				...tunnelManager.getState(),
			})
			return
		}

		if (wasTunnelActive) {
			try {
				await tunnelManager.enable()
			} catch (err) {
				logEvent(
					`Failed to restart public tunnel: ${err.message}`,
					true
				)
			}
		}

		res.json({ success: true, ...tunnelManager.getState() })
	})

	router.post('/toggle', (req, res) => {
		setServerActive(!getServerActive())
		logEvent(
			`Public server set to ${getServerActive() ? 'ACTIVE' : 'INACTIVE'}.`,
			true
		)

		if (!getServerActive()) {
			transferManager.clear()
		}
		res.json({ active: getServerActive() })
	})

	router.post('/tunnel', async (req, res) => {
		const { enabled } = req.body || {}

		if (enabled) {
			try {
				await tunnelManager.enable()
				return res.json({ success: true, ...tunnelManager.getState() })
			} catch (err) {
				logEvent(`Tunnel startup failed: ${err.message}`, true)
				tunnelManager.broadcastState()
				return res
					.status(500)
					.json({ error: err.message, ...tunnelManager.getState() })
			}
		}

		tunnelManager.disable()
		res.json({ success: true, ...tunnelManager.getState() })
	})

	router.get('/stream', (req, res) => {
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		})

		eventBus.addClient(req, res)

		eventBus.sendInitialMetrics(res, {
			connections: eventBus.getClientCount(),
			transfers: transferManager.getAll(),
		})
	})

	return router
}

module.exports = createHostRouter
