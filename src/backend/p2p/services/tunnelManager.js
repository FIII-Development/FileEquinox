const localtunnel = require('localtunnel')

class TunnelManager {
	constructor({ getUserPort, eventBus, log }) {
		this.userPort = getUserPort()
		this.eventBus = eventBus
		this.log = log

		this.instance = null
		this.url = null
		this.active = false
		this.startupPromise = null
		this.lifecycleId = 0
	}

	setUserPort(userPort) {
		this.userPort = userPort
	}

	getState() {
		return {
			tunnelActive: this.active,
			tunnelUrl: this.url,
		}
	}

	broadcastState() {
		this.eventBus.broadcast('tunnel', this.getState())
	}

	createLocalTunnel() {
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
				{
					port: this.userPort,
					local_host: '127.0.0.1',
				},
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

	async enable() {
		if (this.instance && this.active && this.url) {
			return this.url
		}

		if (this.startupPromise) {
			return this.startupPromise
		}

		const lifecycleId = this.lifecycleId

		const startupPromise = (async () => {
			const tunnel = await this.createLocalTunnel()

			if (lifecycleId !== this.lifecycleId) {
				try {
					tunnel.close()
				} catch (err) {}

				throw new Error('Tunnel startup was canceled.')
			}

			this.instance = tunnel
			this.url = tunnel.url
			this.active = true

			tunnel.on('close', () => {
				if (tunnel !== this.instance) return

				this.instance = null
				this.url = null
				this.active = false

				this.log('Public tunnel connection closed.', true)
				this.broadcastState()
			})

			tunnel.on('error', (err) => {
				if (tunnel !== this.instance) return

				this.log(`Public tunnel error: ${err.message}`, true)
			})

			tunnel.on('request', (req) => {
				if (tunnel !== this.instance) return

				this.log(`Public tunnel request: ${req.method} ${req.path}`)
			})

			this.log(`Public tunnel enabled: ${this.url}`, true)
			this.broadcastState()

			return this.url
		})()

		this.startupPromise = startupPromise

		try {
			return await startupPromise
		} finally {
			if (this.startupPromise === startupPromise) {
				this.startupPromise = null
			}
		}
	}

	disable({ announce = true } = {}) {
		this.lifecycleId += 1
		this.startupPromise = null

		const tunnel = this.instance

		this.instance = null
		this.url = null
		this.active = false

		if (tunnel) {
			try {
				tunnel.close()
			} catch (err) {}
		}

		if (announce) {
			this.log('Public tunnel disabled.', true)
		}

		this.broadcastState()
	}

	isActiveOrStarting() {
		return this.active || Boolean(this.startupPromise)
	}

	close() {
		this.disable({ announce: false })
	}
}

module.exports = TunnelManager
