import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

// TODO: Add more APIs (like localStorage)
import { GLOBAL_LIST } from './globals.js'

const DEFAULT_ROOT = pathToFileURL(process.cwd()).href

export class ProtocolRegistry {
  handlers = new Map()

  register (protocol, fetch) {
    if (this.handlers.has(protocol)) {
      throw new Error(`Protocol scheme already registered: ${protocol}`)
    }
    this.handlers.set(protocol, fetch)
  }

  registerLazy (protocol, getFetch) {
    let fetch = null
    let loading = null

    async function getAndFetch (...args) {
      if (loading) {
        await loading
      } else if (!fetch) {
        loading = getFetch()
        fetch = await loading
        loading = null
      }
      return fetch(...args)
    }

    this.register(protocol, getAndFetch)
  }

  get (protocol) {
    if (!this.handlers.has(protocol)) {
      throw new Error(`Unknown protocol: ${protocol}`)
    }
    return this.handlers.get(protocol)
  }

  alias (originalProtol, newProtool) {
    const aliased = (...args) => this.get(originalProtol)(...args)
    this.register(newProtool, aliased)
  }

  fetch (url, init = {}) {
    if (typeof url !== 'string') {
      throw new TypeError('Must normalize first parameter to `fetch` to be a URL')
    }
    const { protocol } = new URL(url)
    if (!this.handlers.has(protocol)) {
      throw new Error(`Protocol scheme invalid: ${protocol}`)
    }
    return this.handlers.get(protocol)(url, init)
  }
}

export class GlobalRegistry {
  globals = new Map()
  constructor () {
    for (const name of GLOBAL_LIST) {
      this.register(name, globalThis[name])
    }
  }

  // TODO: Can we figure out lazy loading?
  register (name, value) {
    if (this.globals.has(name)) throw new Error(`Global already registered: ${name}`)
    this.globals.set(name, value)
  }

  createContext () {
    const context = {}
    for (const [key, value] of this.globals) {
      context[key] = value
    }

    return vm.createContext(context)
  }
}

export default class Agregore {
  context = null
  root = null
  modules = new Map()
  moduleLoaders = new Map()
  protocols = new ProtocolRegistry()
  globals = new GlobalRegistry()

  constructor ({
    root = DEFAULT_ROOT,
    https = true,
    http = true,
    hyper = { persist: false },
    ipfs = {
      silent: true,
      repo: join(root, '.ipfs')
    }
  } = {}) {
    this.root = root

    if (http) {
      this.protocols.register('http:', globalThis.fetch)
    }
    if (https) {
      this.protocols.register('https:', globalThis.fetch)
    }
    if (hyper) {
      this.protocols.registerLazy('hyper:', async () => {
        const { default: makeHyper } = await import('hypercore-fetch')
        const fetch = await makeHyper(hyper)
        return fetch
      })
    }

    if (ipfs) {
      this.protocols.registerLazy('ipfs', async () => {
        const { default: IPFS } = await import('ipfs-core')
        const { default: makeIPFSFetch } = await import('js-ipfs-fetch')
        const node = await IPFS.create(ipfs)
        const fetch = await makeIPFSFetch({ ipfs: node })
        return fetch
      })
      this.protocols.alias('ipfs', 'ipns')
      this.protocols.alias('ipfs', 'ipld')
      this.protocols.alias('ipfs', 'pubsub')
    }

    this.globals.register('fetch', (...args) => this.protocols.fetch(...args))
  }

  #initCheck () {
    if (!this.context) {
      throw new Error('Agregore was not initialized, use await agregore.init() before doing any evaluation')
    }
  }

  resolveURL (url) {
    return new URL(url, this.root).href
  }

  async init () {
    // This is where we can register any async-loaded globals?
    this.context = this.globals.createContext()
  }

  fetch (urlOrRequest, init = {}) {
    this.#initCheck()
    if (!urlOrRequest) throw new Error('Must specify URL or request to fetch')
    // TODO: Normalize URL if it's relative
    let url = urlOrRequest
    let finalInit = init
    if (typeof urlOrRequest === 'object') {
      url = urlOrRequest.url
      finalInit = { ...urlOrRequest, ...init }
      delete finalInit.url
    }
    const resolved = this.resolveURL(url)
    return this.protocols.fetch(resolved, finalInit)
  }

  eval (code) {
    this.#initCheck()
    const importModuleDynamically = (url) => this.importModule(url)
    const script = new vm.Script(code, {
      filename: '<eval>',
      importModuleDynamically
    })
    return script.runInContext(this.context)
  }

  async import (url) {
    const module = await this.importModule(url)
    return module.namespace
  }

  async importModule (url) {
    this.#initCheck()

    const parsed = new URL(url, this.root)
    parsed.hash = ''
    const sanitized = parsed.href

    if (this.modules.has(sanitized)) {
      return this.modules.get(sanitized)
    } else if (this.moduleLoaders.has(sanitized)) {
      return this.moduleLoaders.get(sanitized)
    } else {
      const loader = this.#loadModule(sanitized)
      this.moduleLoaders.set(sanitized, loader)
      const module = await loader
      this.modules.set(sanitized, module)
      this.moduleLoaders.delete(sanitized)
      return module
    }
  }

  async #loadModule (url) {
    this.#initCheck()
    const sourceRequest = await this.fetch(url)
    if (!sourceRequest.ok) {
      const reason = await sourceRequest.text()
      throw new Error(`Unable to download module source: ${reason}`)
    }
    const source = await sourceRequest.text()

    const initializeImportMeta = (meta, module) => {
      meta.url = module.identifier
    }
    const importModuleDynamically = (specifier, module) => {
      const resolved = new URL(specifier, module.identifier).href
      return this.importModule(resolved)
    }

    const module = new vm.SourceTextModule(source, {
      identifier: url,
      context: this.context,
      initializeImportMeta
    })

    await module.link(importModuleDynamically)

    await module.evaluate()

    return module
  }
}
