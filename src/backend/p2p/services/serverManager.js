const http = require('http')

class ServerManager {
	constructor({
		eventBus,
		tunnelManager,
		log,
		getHostPort,
		getUserPort,
		setHostPort,
		setUserPort,
	}) {
		this.eventBus = eventBus
		this.tunnelManager = tunnelManager
		this.log = log

		this.getHostPort = getHostPort
		this.getUserPort = getUserPort
		this.setHostPort = setHostPort
		this.setUserPort = setUserPort

		this.hostServerInstance = null
		this.userServerInstance = null
	}

	async findAvailablePort(startingPort, label) {
		return new Promise((resolve, reject) => {
			const server = http.createServer()

			server.once('error', (err) => {
				if (err.code === 'EADDRINUSE') {
					const nextPort = startingPort + 1

					if (nextPort > 65535) {
						reject(
							new Error(`No available port found for ${label}.`)
						)
					} else {
						resolve(this.findAvailablePort(nextPort, label))
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

	closeHttpServer(server) {
		return new Promise((resolve) => {
			if (!server || !server.listening) {
				resolve()
				return
			}

			server.close(() => resolve())
		})
	}

	startHttpServer(server, port, label) {
		return new Promise((resolve, reject) => {
			console.log(`[${label}] Calling server.listen(${port})`)

			const handleListening = () => {
				console.log(`[${label}] LISTENING EVENT FIRED`)
				cleanup()

				server.on('error', (err) => {
					console.error(`${label} server error:`, err)
				})

				resolve()
			}

			const handleError = (err) => {
				console.log(`[${label}] STARTUP ERROR`, err)
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

			console.log(`[${label}] server.listen() returned`)
		})
	}

	async restartUserServer(app) {
		await this.closeHttpServer(this.userServerInstance)

		this.userServerInstance = http.createServer(app)
		console.log(
			'USER LISTENING:',
			this.userServerInstance.listening,
			this.userServerInstance.address()
		)
		this.userServerInstance.on('listening', () => {
			console.log(
				'USER SERVER EVENT: listening',
				this.userServerInstance.address()
			)
		})

		this.userServerInstance.on('close', () => {
			console.log('USER SERVER EVENT: close')
		})

		this.userServerInstance.on('error', (err) => {
			console.error('USER SERVER EVENT: error', err)
		})

		try {
			const userPort = this.getUserPort()

			await this.startHttpServer(
				this.userServerInstance,
				userPort,
				'User'
			)

			this.log(`User service spun up on port ${userPort}`, true)

			this.tunnelManager.setUserPort(userPort)
		} catch (err) {
			if (this.userServerInstance) {
				try {
					this.userServerInstance.close()
				} catch (closeErr) {}
			}

			this.userServerInstance = null

			if (err.code === 'EADDRINUSE') {
				throw new Error(`Port ${this.getUserPort()} is already in use.`)
			}

			throw err
		}
	}

	async startServers(app) {
		this.app = app
		try {
			const availableHostPort = await this.findAvailablePort(
				this.getHostPort(),
				'host'
			)

			this.setHostPort(availableHostPort)
		} catch (err) {
			console.error('Could not find an available host port:', err)

			return
		}

		try {
			const availableUserPort = await this.findAvailablePort(
				this.getUserPort(),
				'user'
			)

			this.setUserPort(availableUserPort)
		} catch (err) {
			console.error('Could not find an available user port:', err)

			return
		}

		try {
			this.hostServerInstance = http.createServer(this.app)

			await this.startHttpServer(
				this.hostServerInstance,
				this.getHostPort(),
				'Host'
			)

			console.log(`Host server running on ${this.getHostPort()}`)
			console.log(
				'HOST LISTENING:',
				this.hostServerInstance.listening,
				this.hostServerInstance.address()
			)
		} catch (err) {
			console.error('Could not start the host server:', err)

			return
		}

		try {
			await this.restartUserServer(app)
		} catch (err) {
			console.error('Could not start the user server:', err)
		}
	}

	async restart(app) {
		await this.restartUserServer(app)
	}

	getHostUrl() {
		return `http://localhost:${this.getHostPort()}`
	}

	async stopAll() {
		console.log('⚡ Initiating application shutdown sequence...')

		this.eventBus.closeAll()
		this.tunnelManager.close()

		await Promise.all([
			this.closeHttpServer(this.hostServerInstance),
			this.closeHttpServer(this.userServerInstance),
		])

		this.hostServerInstance = null
		this.userServerInstance = null
	}
}

module.exports = ServerManager
