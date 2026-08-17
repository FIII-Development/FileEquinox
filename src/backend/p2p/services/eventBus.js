class EventBus {
	constructor() {
		this.clients = []
	}

	broadcast(type, data) {
		const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`

		this.clients.forEach((client) => {
			client.res.write(payload)
		})
	}

	addClient(req, res) {
		const clientId = Date.now() + Math.random()

		this.clients.push({
			id: clientId,
			res,
		})

		req.on('close', () => {
			this.removeClient(clientId)
		})

		return clientId
	}

	removeClient(clientId) {
		this.clients = this.clients.filter((client) => client.id !== clientId)
	}

	getClientCount() {
		return this.clients.length
	}

	sendInitialMetrics(res, data) {
		res.write(
			`data: ${JSON.stringify({
				type: 'metrics',
				...data,
			})}\n\n`
		)
	}

	closeAll() {
		this.clients.forEach((client) => {
			try {
				client.res.end()
			} catch {}
		})

		this.clients = []
	}
}

module.exports = EventBus
