const killBtn = document.getElementById('kill-btn')
const statusDiv = document.getElementById('status')
const rootDirSpan = document.getElementById('root-dir')
const userCountDiv = document.getElementById('user-count')
const linkAnchor = document.getElementById('link-anchor')
const transfersContainer = document.getElementById('transfers-container')
const logConsole = document.getElementById('log-console')
const settingsForm = document.getElementById('settings-form')
const browseBtn = document.getElementById('browse-btn')
const tunnelToggleBtn = document.getElementById('tunnel-toggle')
const tunnelUrlSpan = document.getElementById('tunnel-url')

let eventSource = null
let currentTunnelUrl = null
let isTunnelEnabled = false

function appendLog(message, isSystem = false) {
	const entry = document.createElement('div')
	entry.className = 'log-entry'
	const timeStr = new Date().toLocaleTimeString()

	const time = document.createElement('span')
	time.className = 'log-time'
	time.textContent = `[${timeStr}]`
	entry.appendChild(time)
	entry.appendChild(document.createTextNode(' '))

	if (isSystem) {
		const system = document.createElement('span')
		system.style.color = '#ffa500'
		system.textContent = '[SYSTEM] '
		entry.appendChild(system)
	}

	entry.appendChild(document.createTextNode(message))
	logConsole.appendChild(entry)
	logConsole.scrollTop = logConsole.scrollHeight
}

function openExternalUrl(targetUrl) {
	if (window.electronAPI && window.electronAPI.openExternal) {
		window.electronAPI.openExternal(targetUrl)
	} else {
		window.open(targetUrl, '_blank')
	}
}

function setTunnelUI({ tunnelActive, tunnelUrl }, isPending = false) {
	currentTunnelUrl = tunnelUrl || null
	isTunnelEnabled = Boolean(tunnelActive && currentTunnelUrl)

	tunnelUrlSpan.textContent = currentTunnelUrl || 'No public link yet'
	tunnelUrlSpan.href = currentTunnelUrl || '#'
	tunnelUrlSpan.classList.toggle('active', Boolean(currentTunnelUrl))
	tunnelUrlSpan.setAttribute(
		'aria-disabled',
		currentTunnelUrl ? 'false' : 'true'
	)

	tunnelToggleBtn.disabled = isPending
	if (isPending) {
		tunnelToggleBtn.textContent = isTunnelEnabled
			? 'Stopping...'
			: 'Starting...'
	} else {
		tunnelToggleBtn.textContent = isTunnelEnabled
			? 'Disable Tunnel'
			: 'Enable Tunnel'
	}
}

async function loadServerConfig() {
	try {
		const res = await fetch('/api/host/config')
		const data = await res.json()

		document.getElementById('server-port').value = data.port
		document.getElementById('shared-path').value = data.sharedPath
		rootDirSpan.textContent = `📁 Sharing: ${data.sharedPath}`

		linkAnchor.textContent = `http://${window.location.hostname}:${data.port}`
		linkAnchor.href = `http://${window.location.hostname}:${data.port}`

		setTunnelUI(data)

		updateStatusUI(data.active)
	} catch (err) {
		appendLog('Failed to fetch server configuration settings.', true)
	}
}

function updateStatusUI(active) {
	if (!active) {
		statusDiv.textContent = '🔴 Inactive'
		statusDiv.className = 'status inactive'
		killBtn.textContent = 'START SERVER'
		killBtn.style.background = '#4caf50'
	} else {
		statusDiv.textContent = '🟢 Active'
		statusDiv.className = 'status active'
		killBtn.textContent = 'STOP SERVER'
		killBtn.style.background = '#ffa500'
	}
}

function establishEventStream() {
	if (eventSource) eventSource.close()

	eventSource = new EventSource('/api/host/stream')

	eventSource.onmessage = (event) => {
		const data = JSON.parse(event.data)

		if (data.type === 'log') {
			appendLog(data.message, data.system)
		} else if (data.type === 'metrics') {
			userCountDiv.textContent = `👥 Users: ${data.connections}`
			renderTransfers(data.transfers)
		} else if (data.type === 'tunnel') {
			setTunnelUI(data)
		}
	}

	eventSource.onerror = () => {
		appendLog('Real-time data stream disconnected. Retrying...', true)
		eventSource.close()
	}
}

function renderTransfers(transfers) {
	if (!transfers || transfers.length === 0) {
		transfersContainer.innerHTML =
			'<div class="empty-notice">No active file transfers.</div>'
		return
	}

	transfersContainer.innerHTML = ''
	transfers.forEach((t) => {
		const item = document.createElement('div')
		item.className = 'transfer-item'

		const meta = document.createElement('div')
		meta.className = 'transfer-meta'

		const filename = document.createElement('strong')
		filename.textContent = t.filename

		const details = document.createElement('span')
		details.textContent = `${t.ip} (${t.speed})`

		const progressBg = document.createElement('div')
		progressBg.className = 'progress-bar-bg'

		const progressFill = document.createElement('div')
		progressFill.className = 'progress-bar-fill'
		progressFill.style.width = `${t.progress}%`

		meta.appendChild(filename)
		meta.appendChild(details)
		progressBg.appendChild(progressFill)
		item.appendChild(meta)
		item.appendChild(progressBg)
		transfersContainer.appendChild(item)
	})
}

killBtn.addEventListener('click', async () => {
	try {
		const res = await fetch('/api/host/toggle', {
			method: 'POST',
		})
		const data = await res.json()
		updateStatusUI(data.active)
	} catch (err) {
		appendLog('Error toggling the server runtime state.', true)
	}
})

linkAnchor.addEventListener('click', (e) => {
	e.preventDefault()

	const targetUrl = linkAnchor.href
	openExternalUrl(targetUrl)
})

tunnelUrlSpan.addEventListener('click', (e) => {
	e.preventDefault()

	if (!currentTunnelUrl) return
	openExternalUrl(currentTunnelUrl)
})

settingsForm.addEventListener('submit', async (e) => {
	e.preventDefault()
	const body = {
		port: parseInt(document.getElementById('server-port').value),
		sharedPath: document.getElementById('shared-path').value,
	}

	try {
		const res = await fetch('/api/host/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		const data = await res.json()

		if (res.ok) {
			setTunnelUI(data)
			appendLog(
				'Configuration updated successfully! Re-initializing system...',
				true
			)
			setTimeout(() => {
				loadServerConfig()
				establishEventStream()
			}, 1000)
		} else {
			appendLog(
				data.error || 'Server rejected configuration adjustments.',
				true
			)
		}
	} catch (err) {
		appendLog('Error updating target configuration values.', true)
	}
})

browseBtn.addEventListener('click', async () => {
	if (window.electronAPI && window.electronAPI.selectFolder) {
		try {
			const folderPath = await window.electronAPI.selectFolder()
			if (folderPath) {
				document.getElementById('shared-path').value = folderPath
			}
		} catch (err) {
			appendLog('Failed to resolve native directory path.', true)
		}
	} else {
		appendLog(
			'Folder browser dialog requires the native Electron desktop application wrapper layer.',
			true
		)
	}
})

tunnelToggleBtn.addEventListener('click', async () => {
	const enabled = !isTunnelEnabled
	setTunnelUI(
		{
			tunnelActive: isTunnelEnabled,
			tunnelUrl: currentTunnelUrl,
		},
		true
	)

	try {
		const res = await fetch('/api/host/tunnel', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled }),
		})
		const data = await res.json()

		if (!res.ok || !data.success) {
			throw new Error(data.error || 'Tunnel toggle failed.')
		}

		setTunnelUI(data)
		appendLog(
			data.tunnelUrl
				? `Tunnel enabled: ${data.tunnelUrl}`
				: 'Tunnel disabled.',
			true
		)
	} catch (err) {
		appendLog(err.message || 'Failed to toggle tunnel.', true)
		setTunnelUI({
			tunnelActive: isTunnelEnabled,
			tunnelUrl: currentTunnelUrl,
		})
		loadServerConfig()
	}
})

document.addEventListener('DOMContentLoaded', () => {
	loadServerConfig()
	establishEventStream()

	// Safe event binding checking if elements exist first
	if (killBtn) {
		killBtn.addEventListener('click', async () => {
			try {
				const res = await fetch('/api/host/toggle', { method: 'POST' })
				const data = await res.json()
				updateStatusUI(data.active)
			} catch (err) {
				appendLog('Error toggling the server runtime state.', true)
			}
		})
	}

	if (linkAnchor) {
		linkAnchor.addEventListener('click', (e) => {
			e.preventDefault()
			openExternalUrl(linkAnchor.href)
		})
	}

	if (tunnelUrlSpan) {
		tunnelUrlSpan.addEventListener('click', (e) => {
			e.preventDefault()
			if (!currentTunnelUrl) return
			openExternalUrl(currentTunnelUrl)
		})
	}

	if (settingsForm) {
		settingsForm.addEventListener('submit', async (e) => {
			e.preventDefault()
			const body = {
				port: parseInt(document.getElementById('server-port').value),
				sharedPath: document.getElementById('shared-path').value,
			}

			try {
				const res = await fetch('/api/host/config', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				})
				const data = await res.json()

				if (res.ok) {
					setTunnelUI(data)
					appendLog(
						'Configuration updated successfully! Re-initializing system...',
						true
					)
					setTimeout(() => {
						loadServerConfig()
						establishEventStream()
					}, 1000)
				} else {
					appendLog(
						data.error ||
							'Server rejected configuration adjustments.',
						true
					)
				}
			} catch (err) {
				appendLog('Error updating target configuration values.', true)
			}
		})
	}

	if (browseBtn) {
		browseBtn.addEventListener('click', async () => {
			if (window.electronAPI && window.electronAPI.selectFolder) {
				try {
					const folderPath = await window.electronAPI.selectFolder()
					if (folderPath) {
						document.getElementById('shared-path').value =
							folderPath
					}
				} catch (err) {
					appendLog('Failed to resolve native directory path.', true)
				}
			} else {
				appendLog(
					'Folder browser dialog requires the native Electron desktop application wrapper layer.',
					true
				)
			}
		})
	}

	if (tunnelToggleBtn) {
		tunnelToggleBtn.addEventListener('click', async () => {
			const enabled = !isTunnelEnabled
			setTunnelUI(
				{ tunnelActive: isTunnelEnabled, tunnelUrl: currentTunnelUrl },
				true
			)

			try {
				const res = await fetch('/api/host/tunnel', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ enabled }),
				})
				const data = await res.json()

				if (!res.ok || !data.success) {
					throw new Error(data.error || 'Tunnel toggle failed.')
				}

				setTunnelUI(data)
				appendLog(
					data.tunnelUrl
						? `Tunnel enabled: ${data.tunnelUrl}`
						: 'Tunnel disabled.',
					true
				)
			} catch (err) {
				appendLog(err.message || 'Failed to toggle tunnel.', true)
				setTunnelUI({
					tunnelActive: isTunnelEnabled,
					tunnelUrl: currentTunnelUrl,
				})
				loadServerConfig()
			}
		})
	}
})
