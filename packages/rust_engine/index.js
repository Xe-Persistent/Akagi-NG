const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

const { platform, arch } = process

let nativeBinding = null
let localFileExisted = false
let loadError = null

switch (platform) {
  case 'win32':
    switch (arch) {
      case 'x64':
        localFileExisted = existsSync(
          join(__dirname, 'akagi-engine.win32-x64-msvc.node')
        )
        try {
          if (localFileExisted) {
            nativeBinding = require('./akagi-engine.win32-x64-msvc.node')
          } else {
            nativeBinding = require('@akagi-ng/rust-engine-win32-x64-msvc')
          }
        } catch (e) {
          loadError = e
        }
        break
      default:
        throw new Error(`Unsupported architecture on Windows: ${arch}`)
    }
    break
  default:
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`)
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError
  }
  throw new Error(`Failed to load native binding`)
}

const { AkagiEngine } = nativeBinding

module.exports.AkagiEngine = AkagiEngine
