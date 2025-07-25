import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { sep } from 'node:path'

import createEventSource from '@rangermauve/fetch-event-source'

// TODO: Add more APIs (like localStorage)
import { GLOBAL_LIST } from './globals.js'
import { loadConfig } from './config.js'
import { createLLM } from './llm.js'

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
    if (typeof name === 'object') {
      for (const entry of Object.entries(name)) {
        this.register(...entry)
      }
    } else {
      if (this.globals.has(name)) throw new Error(`Global already registered: ${name}`)
      this.globals.set(name, value)
    }
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
  onbeforeunload = []
  closed = false

  constructor (opts = {}) {
    const config = loadConfig(opts)

    const {
      root = DEFAULT_ROOT,
      httpOptions,
      httpsOptions,
      hyperOptions,
      ipfsOptions,
      geminiOptions
    } = config

    this.root = root

    if (httpOptions) {
      this.protocols.register('http:', globalThis.fetch)
    }
    if (httpsOptions) {
      this.protocols.register('https:', globalThis.fetch)
    }
    if (geminiOptions) {
      this.protocols.registerLazy('gemini:', async () => {
        const { default: makeFetch } = await import('gemini-fetch')
        const fetch = await makeFetch(geminiOptions)
        return fetch
      })
    }
    if (hyperOptions) {
      this.protocols.registerLazy('hyper:', async () => {
        const { default: makeHyper } = await import('hypercore-fetch')
        const SDK = await import('hyper-sdk')
        const sdk = await SDK.create(hyperOptions)
        const fetch = await makeHyper({
          sdk,
          writable: true
        })

        this.addBeforeUnload(() => sdk.close())

        return fetch
      })
    }

    if (ipfsOptions) {
      this.protocols.registerLazy('ipfs:', async () => {
        const { default: makeFetch } = await import('js-ipfs-fetch')
        const ipfsHttpModule = await import('ipfs-http-client')

        const Ctl = await import('ipfsd-ctl')

        const { default: GoIPFS } = await import('go-ipfs')

        const ipfsBin = GoIPFS
          .path()
          .replace(`.asar${sep}`, `.asar.unpacked${sep}`)

        const ipfsdOpts = {
          ipfsOptions,
          type: 'go',
          disposable: false,
          test: false,
          remote: false,
          ipfsHttpModule,
          ipfsBin
        }

        const ipfsd = await Ctl.createController(ipfsdOpts)

        await ipfsd.init({ ipfsOptions })
        await ipfsd.version()

        await ipfsd.start()
        await ipfsd.api.id()

        const fetch = await makeFetch({
          ipfs: ipfsd.api
        })

        this.addBeforeUnload(() => ipfsd.stop())

        return fetch
      })
      this.protocols.alias('ipfs:', 'ipns:')
      this.protocols.alias('ipfs:', 'ipld:')
      this.protocols.alias('ipfs:', 'pubsub:')
    }

    const fetch = (...args) => this.fetch(...args)

    this.globals.register('fetch', fetch)
    this.globals.register('close', () => this.close())

    const {
      EventSource,
      ErrorEvent,
      CloseEvent,
      OpenEvent
    } = createEventSource(fetch)

    const llm = createLLM(config, fetch)

    this.globals.register({
      EventSource,
      ErrorEvent,
      CloseEvent,
      OpenEvent,
      llm
    })
  }

  #initCheck () {
    if (this.closed) {
      throw new Error('Cannot invoke code, Agregore has already been uninitialized with close()')
    }
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

  addBeforeUnload (fn) {
    this.onbeforeunload.unshift(fn)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    for (const fn of this.onbeforeunload) {
      await fn()
    }
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
