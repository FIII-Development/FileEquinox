const express = require('express')
const path = require('path')

function createDynamicStatic({ getHostPort, senderPath, receiverPath }) {
	const assets = (req, res, next) => {
		const incomingPort = req.socket.localPort
		const targetDir =
			incomingPort === getHostPort() ? senderPath : receiverPath

		express.static(path.join(targetDir, 'assets'))(req, res, next)
	}

	const logic = (req, res, next) => {
		const incomingPort = req.socket.localPort
		const targetDir =
			incomingPort === getHostPort() ? senderPath : receiverPath

		express.static(path.join(targetDir, 'logic'))(req, res, next)
	}

	return { assets, logic }
}

module.exports = createDynamicStatic
