const express = require('express')
const path = require('path')
const fs = require('fs')

function createDownloadsRouter({
	getServerActive,
	getSharedPath,
	isPathInside,
	logEvent,
	transferManager,
}) {
	const router = express.Router()
	router.get('/', (req, res) => {
		if (!getServerActive()) return res.status(503).send('Server is down.')

		const fileQuery = req.query.file
		if (!fileQuery) {
			return res.status(400).send("Missing 'file' parameter.")
		}

		const rawPath = decodeURIComponent(fileQuery)
		const safePath = path.resolve(getSharedPath(), path.normalize(rawPath))
		const clientIp = req.ip || req.socket.remoteAddress
		const filename = path.basename(safePath)

		const isOutside = !isPathInside(getSharedPath(), safePath)

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

		transferManager.add({
			id: transferId,
			filename,
			ip: clientIp,
			speed: '0 KB/s',
			progress: 0,
		})

		const fileStream = fs.createReadStream(safePath)

		fileStream.on('error', (err) => {
			logEvent(`Stream error reading ${filename}: ${err.message}`, true)
			if (!res.headersSent) {
				res.status(500).send('Error streaming file.')
			}
		})

		const metricInterval = setInterval(() => {
			const transfers = transferManager.getAll()
			const currentTransfer = transfers.find((t) => t.id === transferId)

			if (!currentTransfer) return

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

			transferManager.update(transferId, {
				speed: speedString,
				progress: progressPercent,
			})
		}, 1000)

		fileStream.on('data', (chunk) => {
			bytesSent += chunk.length
		})

		fileStream.pipe(res)

		function handleTransferEnd(isSuccess) {
			clearInterval(metricInterval)
			transferManager.remove(transferId)
			if (isSuccess) {
				logEvent(`✅ Successfully sent ${filename} to ${clientIp}`)
			} else {
				logEvent(
					`❌ Download interrupted for ${filename} by ${clientIp}`
				)
			}
		}

		res.on('finish', () => handleTransferEnd(true))
		res.on('close', () => {
			if (bytesSent < totalBytes) handleTransferEnd(false)
		})
	})

	return router
}

module.exports = createDownloadsRouter
