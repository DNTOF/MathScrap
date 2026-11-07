/**
 * Write keystore.properties from ANDROID_KEY_* and point the generated Gradle
 * release build at it. Does not create a keystore. Prints no secret values.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const alias = process.env.ANDROID_KEY_ALIAS ?? ''
const password = process.env.ANDROID_KEY_PASSWORD ?? ''
const b64 = process.env.ANDROID_KEY_BASE64 ?? ''
if (!alias || !password || !b64) {
  console.error('ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, and ANDROID_KEY_BASE64 are required.')
  process.exit(2)
}

const root = process.cwd()
const gen = path.join(root, 'src-tauri/gen/android')
const keystore = path.join(gen, 'upload-keystore.jks')
writeFileSync(keystore, Buffer.from(b64, 'base64'), { mode: 0o600 })
writeFileSync(
  path.join(gen, 'keystore.properties'),
  `keyAlias=${alias}\npassword=${password}\nstoreFile=${keystore.replace(/\\/g, '/')}\n`,
  { mode: 0o600 },
)

const gradle = path.join(gen, 'app/build.gradle.kts')
if (!existsSync(gradle)) {
  console.error('Missing app/build.gradle.kts. Run tauri android init first.')
  process.exit(1)
}
let text = readFileSync(gradle, 'utf8')
if (!text.includes('import java.io.FileInputStream') && !text.includes('java.io.FileInputStream')) {
  text = `import java.io.FileInputStream\nimport java.util.Properties\n${text}`
}
if (!text.includes('signingConfigs')) {
  const block = `
signingConfigs {
    create("release") {
        val keystorePropertiesFile = rootProject.file("keystore.properties")
        val keystoreProperties = Properties()
        if (keystorePropertiesFile.exists()) {
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))
        }
        keyAlias = keystoreProperties["keyAlias"] as String
        keyPassword = keystoreProperties["password"] as String
        storeFile = file(keystoreProperties["storeFile"] as String)
        storePassword = keystoreProperties["password"] as String
    }
}
`
  const at = text.indexOf('buildTypes')
  if (at < 0) {
    console.error('build.gradle.kts has no buildTypes block; the Tauri Android template changed.')
    process.exit(1)
  }
  text = `${text.slice(0, at)}${block}${text.slice(at)}`
}
if (!text.includes('signingConfig = signingConfigs.getByName("release")') && !text.includes('signingConfig = signingConfigs.getByName("release")')) {
  text = text.replace(/getByName\("release"\)\s*\{/, 'getByName("release") {\n            signingConfig = signingConfigs.getByName("release")')
}
writeFileSync(gradle, text)
console.log('Android release signing is wired to the supplied keystore. The keystore stays under src-tauri/gen and is gitignored.')
