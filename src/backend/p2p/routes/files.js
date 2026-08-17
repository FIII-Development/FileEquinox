const express = require('express')

const path = require('path')
const fs = require('fs')

function createFilesRouter({ getServerActive, isPathInside, getSharedPath }) {
	const router = express.Router()
	router.get('/', (req, res) => {
		if (!getServerActive()) return res.status(503).json([])
		const targetDir = path.resolve(getSharedPath(), req.query.path || '')
		if (!isPathInside(getSharedPath(), targetDir))
			return res.status(403).json([])

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
			res.json(['error'])
		}
	})
	return router
}

module.exports = createFilesRouter
