import path from 'node:path'

import RC from 'rc'
import envPaths from 'env-paths'

const paths = envPaths('agregore-cli')

const USER_DATA = paths.data
const DEFAULT_IPFS_DIR = path.join(USER_DATA, 'ipfs')
const DEFAULT_HYPER_DIR = path.join(USER_DATA, 'hyper')
const DEFAULT_BT_DIR = path.join(USER_DATA, 'bt')

export function loadConfig (opts = {}) {
  return RC('agregore', {
    llm: {
      enabled: true,

      baseURL: 'http://127.0.0.1:11434/v1/',
      // Uncomment this to use OpenAI instead
      // baseURL: 'https://api.openai.com/v1/'
      apiKey: 'ollama',
      model: 'qwen2.5-coder:3b',
      temperature: 0.7
    },

    httpOptions: true,
    httpsOptions: true,

    // All options here: https://github.com/ipfs/js-ipfs/blob/master/docs/CONFIG.md
    ipfsOptions: {
      repo: DEFAULT_IPFS_DIR,
      silent: true,
      preload: {
        enabled: false
      },
      config: {
        Ipns: {
          UsePubsub: true
        },
        Pubsub: {
          Enabled: true
        },
        Addresses: {
          API: '/ip4/127.0.0.1/tcp/2473',
          Gateway: '/ip4/127.0.0.1/tcp/2474',
          Swarm: [
            '/ip4/0.0.0.0/tcp/2475',
            '/ip6/::/tcp/2475',
            '/ip4/0.0.0.0/udp/2475/quic',
            '/ip6/::/udp/2475/quic'
          ]
        },
        // We don't need a gateway running. 🤷
        Gateway: null
      }
    },

    // All options here: https://github.com/datproject/sdk/#const-hypercore-hyperdrive-resolvename-keypair-derivesecret-registerextension-close--await-sdkopts
    hyperOptions: {
      storage: DEFAULT_HYPER_DIR
    },

    // All options here: https://github.com/webtorrent/webtorrent/blob/master/docs/api.md
    btOptions: {
      folder: DEFAULT_BT_DIR
    },
    ...opts
  })
}
