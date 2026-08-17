class TransferManager {
	constructor(eventBus) {
		this.eventBus = eventBus
		this.transfers = []
	}

	add(transfer) {
		this.transfers.push(transfer)
		this.broadcast()
	}

	update(id, updates) {
		const transfer = this.transfers.find((transfer) => transfer.id === id)

		if (!transfer) return false

		Object.assign(transfer, updates)
		this.broadcast()

		return true
	}

	remove(id) {
		this.transfers = this.transfers.filter((transfer) => transfer.id !== id)

		this.broadcast()
	}

	clear() {
		this.transfers = []
		this.broadcast()
	}

	getAll() {
		return this.transfers
	}

	count() {
		return this.transfers.length
	}

	broadcast() {
		this.eventBus.broadcast('metrics', {
			connections: this.eventBus.getClientCount(),
			transfers: this.transfers,
		})
	}
}

module.exports = TransferManager
