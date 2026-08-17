const path = require('path')

function isPathInside(rootPath, candidatePath) {
	const relative = path.relative(rootPath, candidatePath)

	return (
		relative === '' ||
		(!relative.startsWith('..') && !path.isAbsolute(relative))
	)
}

module.exports = {
	isPathInside,
}
