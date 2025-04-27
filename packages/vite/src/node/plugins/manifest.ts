// 处理文件路径。
import path from 'node:path'
// 用来描述打包生成的每个文件（JS/CSS/图片等）。
import type { OutputAsset, OutputChunk } from 'rollup'
// 用来稳定地排序对象，确保输出的 JSON 文件在属性顺序上是一致的。
import jsonStableStringify from 'json-stable-stringify'
import type { ResolvedConfig } from '..'
import type { Plugin } from '../plugin'
// 把路径标准化（不同系统的分隔符统一成 /）。
import { normalizePath } from '../utils'
// 记录在构建过程中动态生成的额外 asset 文件信息。
import { generatedAssets } from './asset'
import type { GeneratedAssetMeta } from './asset'

// 定义了 manifest 中每一项的类型。
export type Manifest = Record<string, ManifestChunk>

export interface ManifestChunk {
  src?: string
  file: string
  css?: string[]
  assets?: string[]
  isEntry?: boolean
  isDynamicEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
}

export function manifestPlugin(config: ResolvedConfig): Plugin {
  const manifest: Manifest = {}

  let outputCount: number

  // 定义了一个 Vite 插件：vite:manifest，用于在打包构建（build）过程中，生成一个 manifest.json 文件。
  // 这个 manifest.json 文件的作用是：
  // 记录所有输出的静态资源（chunk、asset等）的 映射关系。
  // 提供每个资源的一些 额外元信息（比如：原始模块名、是否为入口、CSS、动态导入的文件等）。
  // 方便 服务器端渲染（SSR） 或 客户端动态加载资源 时能正确找到这些打包后的文件。
  // 在生产环境特别重要，因为构建后文件名通常会带 hash，比如 main.js 变成 main.abc123.js，而 manifest 帮助应用在运行时知道最新的文件名。
  return {
    name: 'vite:manifest',

    // 在打包一开始时，把 outputCount 设为 0，准备统计输出了多少个 rollup output。
    buildStart() {
      outputCount = 0
    },

    // 在每次 Rollup 输出 bundle 时触发
    generateBundle({ format }, bundle) {
      // 返回 chunk 对应的“原始”模块名。
      // 对 system 格式输出，还会特别处理成带 -legacy 后缀。
      function getChunkName(chunk: OutputChunk) {
        if (chunk.facadeModuleId) {
          let name = normalizePath(
            path.relative(config.root, chunk.facadeModuleId),
          )
          if (format === 'system' && !chunk.name.includes('-legacy')) {
            const ext = path.extname(name)
            const endPos = ext.length !== 0 ? -ext.length : undefined
            name = name.slice(0, endPos) + `-legacy` + ext
          }
          return name.replace(/\0/g, '')
        } else {
          return `_` + path.basename(chunk.fileName)
        }
      }

      // 过滤只保留内部生成的 import 文件（排除外部CDN的或遗漏的文件）。
      function getInternalImports(imports: string[]): string[] {
        const filteredImports: string[] = []

        for (const file of imports) {
          if (bundle[file] === undefined) {
            continue
          }

          filteredImports.push(getChunkName(bundle[file] as OutputChunk))
        }

        return filteredImports
      }

      // 把一个 OutputChunk（比如一个 js 文件）转成 ManifestChunk 对象。
      // 记录是否是 entry、dynamicEntry，有哪些 import、dynamicImport，关联的 CSS、Assets。
      function createChunk(chunk: OutputChunk): ManifestChunk {
        const manifestChunk: ManifestChunk = {
          file: chunk.fileName,
        }

        if (chunk.facadeModuleId) {
          manifestChunk.src = getChunkName(chunk)
        }
        if (chunk.isEntry) {
          manifestChunk.isEntry = true
        }
        if (chunk.isDynamicEntry) {
          manifestChunk.isDynamicEntry = true
        }

        if (chunk.imports.length) {
          const internalImports = getInternalImports(chunk.imports)
          if (internalImports.length > 0) {
            manifestChunk.imports = internalImports
          }
        }

        if (chunk.dynamicImports.length) {
          const internalImports = getInternalImports(chunk.dynamicImports)
          if (internalImports.length > 0) {
            manifestChunk.dynamicImports = internalImports
          }
        }

        if (chunk.viteMetadata?.importedCss.size) {
          manifestChunk.css = [...chunk.viteMetadata.importedCss]
        }
        if (chunk.viteMetadata?.importedAssets.size) {
          manifestChunk.assets = [...chunk.viteMetadata.importedAssets]
        }

        return manifestChunk
      }

      // 把一个 OutputAsset（比如图片、字体）转成 ManifestChunk 对象。
      function createAsset(
        asset: OutputAsset,
        src: string,
        isEntry?: boolean,
      ): ManifestChunk {
        const manifestChunk: ManifestChunk = {
          file: asset.fileName,
          src,
        }
        if (isEntry) manifestChunk.isEntry = true
        return manifestChunk
      }

      const fileNameToAssetMeta = new Map<string, GeneratedAssetMeta>()
      const assets = generatedAssets.get(config)!
      assets.forEach((asset, referenceId) => {
        const fileName = this.getFileName(referenceId)
        fileNameToAssetMeta.set(fileName, asset)
      })

      const fileNameToAsset = new Map<string, ManifestChunk>()

      for (const file in bundle) {
        const chunk = bundle[file]
        if (chunk.type === 'chunk') {
          manifest[getChunkName(chunk)] = createChunk(chunk)
        } else if (chunk.type === 'asset' && typeof chunk.name === 'string') {
          // Add every unique asset to the manifest, keyed by its original name
          const assetMeta = fileNameToAssetMeta.get(chunk.fileName)
          const src = assetMeta?.originalName ?? chunk.name
          const asset = createAsset(chunk, src, assetMeta?.isEntry)
          manifest[src] = asset
          fileNameToAsset.set(chunk.fileName, asset)
        }
      }

      // Add deduplicated assets to the manifest
      assets.forEach(({ originalName }, referenceId) => {
        if (!manifest[originalName]) {
          const fileName = this.getFileName(referenceId)
          const asset = fileNameToAsset.get(fileName)
          if (asset) {
            manifest[originalName] = asset
          }
        }
      })

      outputCount++
      const output = config.build.rollupOptions?.output
      const outputLength = Array.isArray(output) ? output.length : 1
      if (outputCount >= outputLength) {
        this.emitFile({
          fileName:
            typeof config.build.manifest === 'string'
              ? config.build.manifest
              : 'manifest.json',
          type: 'asset',
          source: jsonStableStringify(manifest, { space: 2 }),
        })
      }
    },
  }
}
