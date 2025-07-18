export function createLLM (config, fetch) {
  let isInitialized = false

  return {
    isSupported,
    chat: (...args) => ({
      then: (resolve, reject) => chat(...args).then(resolve, reject),
      [Symbol.asyncIterator]: (...args) => chatStream(...args)
    }),
    complete: (...args) => ({
      then: (resolve, reject) => complete(...args).then(resolve, reject),
      [Symbol.asyncIterator]: (...args) => completeStream(...args)
    })
  }

  async function isSupported () {
    if (!config.llm.enabled) return false
    const has = await hasModel()
    if (has) return true
    return (config.llm.apiKey === 'ollama')
  }

  async function init () {
    if (!config.llm.enabled) throw new Error('LLM API is disabled')
    if (isInitialized) return
    // TODO: prompt for download
    if (config.llm.apiKey === 'ollama') {
      try {
        await listModels()
      } catch {
        throw new Error('LLM API needs system service install')
      }

      const has = await hasModel()
      if (!has) {
        await confirmPull()
        await pullModel()
      }
    }
    isInitialized = true
  }

  async function listModels () {
    const { data } = await get('./models', 'Unable to list models')
    return data
  }

  async function confirmPull () {
    if (!config.llm.autopull) throw new Error('.agregorerc[llm.autopull] is not enabled, unable to download model')
  }

  async function pullModel () {
    await post('/api/pull', {
      name: config.llm.model
    }, `Unable to pull model ${config.llm.model}`, false)
  }

  async function hasModel () {
    try {
      const models = await listModels()

      return !!models.find(({ id }) => id === config.llm.model)
    } catch (e) {
      console.error(e.stack)
      return false
    }
  }

  async function chat ({
    messages = [],
    temperature = config.llm.temperature,
    maxTokens,
    stop
  }) {
    await init()
    const { choices } = await post('./chat/completions', {
      messages,
      model: config.llm.model,
      temperature,
      max_tokens: maxTokens,
      stop
    }, 'Unable to generate completion')

    return choices[0].message
  }

  async function complete (prompt, {
    temperature = config.llm.temperature,
    maxTokens,
    stop
  } = {}) {
    await init()
    const { choices } = await post('./completions', {
      prompt,
      model: config.llm.model,
      temperature,
      max_tokens: maxTokens,
      stop
    }, 'Unable to generate completion')

    return choices[0].text
  }

  async function * chatStream ({
    messages = [],
    temperature = config.llm.temperature,
    maxTokens,
    stop
  } = {}) {
    await init()
    for await (const { choices } of stream('./chat/completions', {
      messages,
      model: config.llm.model,
      temperature,
      max_tokens: maxTokens,
      stop
    }, 'Unable to generate completion')) {
      yield choices[0].delta
    }
  }

  async function * completeStream (prompt, {
    temperature = config.llm.temperature,
    maxTokens,
    stop
  } = {}) {
    await init()

    for await (const { choices } of stream('./completions', {
      prompt,
      model: config.llm.model,
      temperature,
      max_tokens: maxTokens,
      stop
    }, 'Unable to generate completion')) {
      yield choices[0].text
    }
  }

  async function * stream (path, data = {}, errorMessage = 'Unable to stream') {
    const url = new URL(path, config.llm.baseURL).href
    if (!data.stream) data.stream = true

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf8',
        Authorization: `Bearer ${config.llm.apiKey}`
      },
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      throw new Error(`${errorMessage} ${await response.text()}`)
    }

    const decoder = new TextDecoder('utf-8')
    let remaining = ''

    const reader = response.body.getReader()

    for await (const chunk of iterate(reader)) {
      remaining += decoder.decode(chunk)
      const lines = remaining.split('data: ')
      remaining = lines.splice(-1)[0]

      yield * lines
        .filter((line) => !!line)
        .map((line) => JSON.parse(line))
    }
  }

  async function get (path, errorMessage, parseBody = true) {
    const url = new URL(path, config.llm.baseURL).href

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.llm.apiKey}`
      }
    })

    if (!response.ok) {
      throw new Error(`${errorMessage} ${await response.text()}`)
    }

    if (parseBody) {
      return await response.json()
    } else {
      return await response.text()
    }
  }

  async function post (path, data, errorMessage, shouldParse = true) {
    const url = new URL(path, config.llm.baseURL).href

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf8',
        Authorization: `Bearer ${config.llm.apiKey}`
      },
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      throw new Error(`${errorMessage} ${await response.text()}`)
    }

    if (shouldParse) {
      return await response.json()
    }
    return await response.text()
  }
}

async function * iterate (reader) {
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    yield value
  }
}
