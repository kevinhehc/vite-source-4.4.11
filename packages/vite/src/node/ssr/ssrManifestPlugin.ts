import { basename, dirname, join, relative } from 'node:path'
// 用于解析 JavaScript 代码里的 import 语句。
import { parse as parseImports } from 'es-module-lexer'
import type { ImportSpecifier } from 'es-module-lexer'
// Rollup 打包生成的 chunk 类型。
import type { OutputChunk } from 'rollup'
// 稳定的 JSON 字符串化，保证输出一致。
import jsonStableStringify from 'json-stable-stringify'
import type { ResolvedConfig } from '..'
import type { Plugin } from '../plugin'
// 标记那些需要 preload 的代码方法名（例如：懒加载组件需要预加载依赖的 CSS）。
import { preloadMethod } from '../plugins/importAnalysisBuild'
import {
  generateCodeFrame,
  joinUrlSegments,
  normalizePath,
  numberToPos,
} from '../utils'

export function ssrManifestPlugin(config: ResolvedConfig): Plugin {
  // module id => preload assets mapping
  const ssrManifest: Record<string, string[]> = {}
  const base = config.base // TODO:base

  // 在构建时生成 ssr-manifest.json 文件。
  // ssr-manifest.json 记录了：
  // 每个模块（模块 ID）需要预加载的静态资源（JS chunk、CSS文件、图片等）。
  // 这个文件专门给 SSR（服务器端渲染）模式 使用，让服务器知道：在返回 HTML 页面时要预加载哪些资源，以加速页面渲染和首屏体验。
  return {
    name: 'vite:ssr-manifest',
    generateBundle(_options, bundle) {
      for (const file in bundle) {
        const chunk = bundle[file]
        if (chunk.type === 'chunk') {
          for (const id in chunk.modules) {
            // 标准化它的模块路径（用 normalizePath(relative(config.root, id))）
            // 在 ssrManifest 里为它建立一条记录，收集它关联的静态资源。
            const normalizedId = normalizePath(relative(config.root, id))
            const mappedChunks =
              ssrManifest[normalizedId] ?? (ssrManifest[normalizedId] = [])
            // 非 entry chunk（非主入口文件）
            // 收集它自己和它引入的 CSS 文件作为 preload 资源。
            // 所有的静态资源（比如图片）
            // 也会加进来，记录在 preload 列表中。
            if (!chunk.isEntry) {
              mappedChunks.push(joinUrlSegments(base, chunk.fileName))
              // <link> tags for entry chunks are already generated in static HTML,
              // so we only need to record info for non-entry chunks.
              chunk.viteMetadata!.importedCss.forEach((file) => {
                mappedChunks.push(joinUrlSegments(base, file))
              })
            }
            chunk.viteMetadata!.importedAssets.forEach((file) => {
              mappedChunks.push(joinUrlSegments(base, file))
            })
          }
          if (chunk.code.includes(preloadMethod)) {
            // 如果某个 chunk 的代码中包含 preloadMethod，说明：
            // 这个 chunk 动态引入了模块（比如懒加载的子模块）。
            // 就要进一步分析这个 chunk 的代码，提取出 动态 import 的模块。
            // generate css deps map
            const code = chunk.code
            let imports: ImportSpecifier[]
            try {
              imports = parseImports(code)[0].filter((i) => i.n && i.d > -1)
            } catch (e: any) {
              const loc = numberToPos(code, e.idx)
              this.error({
                name: e.name,
                message: e.message,
                stack: e.stack,
                cause: e.cause,
                pos: e.idx,
                loc: { ...loc, file: chunk.fileName },
                frame: generateCodeFrame(code, loc),
              })
            }
            if (imports.length) {
              // 逐个 import：
              // 找出对应的 chunk。
              // 递归收集这个动态模块相关的 CSS 依赖。
              // 最终把这些 CSS 也挂到 ssrManifest 里。
              for (let index = 0; index < imports.length; index++) {
                const { s: start, e: end, n: name } = imports[index]
                // check the chunk being imported
                const url = code.slice(start, end)
                const deps: string[] = []
                const ownerFilename = chunk.fileName
                // literal import - trace direct imports and add to deps
                const analyzed: Set<string> = new Set<string>()
                const addDeps = (filename: string) => {
                  if (filename === ownerFilename) return
                  if (analyzed.has(filename)) return
                  analyzed.add(filename)
                  const chunk = bundle[filename] as OutputChunk | undefined
                  if (chunk) {
                    chunk.viteMetadata!.importedCss.forEach((file) => {
                      deps.push(joinUrlSegments(base, file)) // TODO:base
                    })
                    chunk.imports.forEach(addDeps)
                  }
                }
                const normalizedFile = normalizePath(
                  join(dirname(chunk.fileName), url.slice(1, -1)),
                )
                addDeps(normalizedFile)
                ssrManifest[basename(name!)] = deps
              }
            }
          }
        }
      }

      // 用 this.emitFile 把收集好的 ssrManifest 内容输出成 ssr-manifest.json 文件。
      // 也是稳定排序的，保证一致性。
      this.emitFile({
        fileName:
          typeof config.build.ssrManifest === 'string'
            ? config.build.ssrManifest
            : 'ssr-manifest.json',
        type: 'asset',
        source: jsonStableStringify(ssrManifest, { space: 2 }),
      })
    },
  }
}
