console.log('LOADED APP.JS')
const express = require('express')
const path = require('path')

function createApp({
	getHostPort,
	getUserPort,
	senderPath,
	receiverPath,
	dynamicStatic,
	requireHostDashboard,
	hostRouter,
	fileRouter,
	downloadRouter,
}) {
	const app = express()
	app.use((req, res, next) => {
		console.log('HTTP REQUEST:', req.method, req.url, req.socket.localPort)
		next()
	})
	app.use(express.json())

	app.use('/api/host', requireHostDashboard)
	app.use('/api/host', hostRouter)
	app.use('/api/files', fileRouter)
	app.use('/download', downloadRouter)

	app.use('/assets', dynamicStatic.assets)
	app.use('/logic', dynamicStatic.logic)

	app.get('/', (req, res) => {
		const incomingPort = req.socket.localPort

		if (incomingPort === getHostPort()) {
			return res.sendFile(path.join(senderPath, 'index.html'))
		}

		if (incomingPort === getUserPort()) {
			return res.sendFile(path.join(receiverPath, 'index.html'))
		}

		res.status(404).send('Not Found')
	})

	app.use(express.static(__dirname))

	return app
}

module.exports = createApp
