function createHostOnly({ getHostPort }) {
	return (req, res, next) => {
		if (req.socket.localPort !== getHostPort()) {
			return res.status(403).json({
				error: 'Host controls are only available from the dashboard port.',
			})
		}

		next()
	}
}

module.exports = createHostOnly
