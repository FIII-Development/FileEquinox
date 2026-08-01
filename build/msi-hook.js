const fs = require('fs')

const COMPONENT_ID = 'FileEquinoxContextMenu'

module.exports = async function msiProjectCreated(wixProjectPath) {
	if (!fs.existsSync(wixProjectPath)) {
		throw new Error(`WiX project was not found: ${wixProjectPath}`)
	}

	let wix = fs.readFileSync(wixProjectPath, 'utf8')

	if (wix.includes(`Id="${COMPONENT_ID}"`)) {
		console.log('FileEquinox Explorer context menu is already present.')
		return
	}

	const marker =
		'    <ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">'

	const component = `
      <Component Id="${COMPONENT_ID}" Guid="*">
        <RegistryKey Root="HKCU" Key="Software\\Classes\\Directory\\shell\\FileEquinoxShare">
          <RegistryValue Type="string" Value="Share This Folder" KeyPath="yes"/>
          <RegistryValue Name="Icon" Type="string" Value="[#mainExecutable]"/>
          <RegistryKey Key="command">
            <RegistryValue
              Type="string"
              Value="&quot;[#mainExecutable]&quot; &quot;%1&quot;"/>
          </RegistryKey>
        </RegistryKey>
      </Component>
`

	const markerIndex = wix.indexOf(marker)

	if (markerIndex === -1) {
		throw new Error(
			'Could not find ProductComponents in the generated WiX project.'
		)
	}

	const insertAt = markerIndex + marker.length

	wix = wix.slice(0, insertAt) + component + wix.slice(insertAt)

	fs.writeFileSync(wixProjectPath, wix, 'utf8')

	console.log(
		'Added FileEquinox Explorer context menu to the MSI WiX project.'
	)
}
