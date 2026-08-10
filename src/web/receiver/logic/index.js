async function fetchDirectoryItems(path = '') {
	try {
		let response = await fetch(
			`/api/files?path=${encodeURIComponent(path)}`
		)
		return await response.json()
	} catch (err) {
		return []
	}
}

async function buildTree(targetElement, currentPath = '') {
	const files = await fetchDirectoryItems(currentPath)

	if (!files || files.length === 0) {
		targetElement.innerHTML =
			"<li style='color:#6c7086;'>[Empty Folder]</li>"
		return
	}

	const ul = document.createElement('ul')

	files.forEach((item) => {
		const li = document.createElement('li')
		const itemRelativePath = currentPath
			? `${currentPath}/${item.name}`
			: item.name

		if (item.type === 'directory') {
			li.classList.add('folder')

			// Use a span for the folder label to prevent click-target bugs
			const span = document.createElement('span')
			span.textContent = item.name
			li.appendChild(span)

			// ✅ FIX: Use a nested <ul> instead of a <div> for valid list structures
			const subContainer = document.createElement('ul')
			subContainer.classList.add('hidden')
			li.appendChild(subContainer)

			li.addEventListener('click', async (e) => {
				e.stopPropagation()
				li.classList.toggle('open')
				subContainer.classList.toggle('hidden')

				if (subContainer.children.length === 0) {
					subContainer.innerHTML =
						"<li style='color:#6c7086;'>Loading directory...</li>"
					await buildTree(subContainer, itemRelativePath)
				}
			})
		} else {
			const a = document.createElement('a')
			a.classList.add('file')
			a.href = `/download?file=${encodeURIComponent(itemRelativePath)}`
			a.textContent = item.name
			a.setAttribute('download', '')
			li.appendChild(a)
		}
		ul.appendChild(li)
	})

	targetElement.innerHTML = ''
	targetElement.appendChild(ul)
}

document.addEventListener('DOMContentLoaded', () => {
	const explorer = document.getElementById('explorer')
	if (explorer) {
		buildTree(explorer)
	} else {
		console.error("Element with ID 'explorer' not found in DOM.")
	}
})
