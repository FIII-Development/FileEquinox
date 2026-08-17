let hostPort = 8443
let userPort = 80

function getHostPort() {
	return hostPort
}

function getUserPort() {
	return userPort
}

function setHostPort(port) {
	hostPort = port
}

function setUserPort(port) {
	userPort = port
}

module.exports = {
	getHostPort,
	getUserPort,
	setHostPort,
	setUserPort,
}
