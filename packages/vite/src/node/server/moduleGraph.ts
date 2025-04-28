// extname(filePath) 用来提取文件路径的扩展名，比如 'foo/bar/index.vue' 会返回 '.vue'。
import { extname } from 'node:path'
// ModuleInfo：描述一个模块的依赖关系、导出内容、动态导入等信息。
// PartialResolvedId：是解析模块路径后的一个中间结果（不一定完整）。
import type { ModuleInfo, PartialResolvedId } from 'rollup'
// isDirectCSSRequest(url) 判断一个请求是不是直接请求了 CSS 文件
import { isDirectCSSRequest } from '../plugins/css'
// cleanUrl(url)：移除 URL 上的一些查询参数或 hash，例如 ?v=123 或 #section。
// normalizePath(path)：标准化路径格式（一般把 \ 变成 /，适配 Windows）。
// removeImportQuery(url)：移除 URL 中 ?import 之类的特殊参数。
// removeTimestampQuery(url)：移除 URL 中加的时间戳参数（通常是为了热更新 HMR）。
import {
  cleanUrl,
  normalizePath,
  removeImportQuery,
  removeTimestampQuery,
} from '../utils'
import { FS_PREFIX } from '../constants'
// TransformResult 通常是某种代码转换（transform，比如处理 .vue 文件或者 .ts 文件）后的结果数据结构。
import type { TransformResult } from './transformRequest'

// 定义一个 ModuleNode 类，表示 一个模块（一个 .js/.ts/.vue/.css 文件）。
export class ModuleNode {
  /**
   * Public served url path, starts with /
   */
  // 模块对应的 URL 路径，以 / 开头（例如 /src/App.vue）。
  url: string
  /**
   * Resolved file system path + query
   */
  // 模块最终解析出来的 文件系统路径 + 查询字符串（例如 /absolute/path/to/App.vue?vue&type=script）。
  // 初始设为 null，稍后赋值。
  id: string | null = null
  // 物理文件路径（纯粹的路径，不含查询参数），如 /absolute/path/to/App.vue。
  file: string | null = null
  // 这个模块的类型：是 JavaScript 模块 ('js') 还是 CSS 模块 ('css')。
  type: 'js' | 'css'
  // 存放 Rollup 的模块信息，比如依赖图、导出内容等，类型是 ModuleInfo。
  info?: ModuleInfo
  // 一些自定义的、扩展用的 元数据，是个普通对象。
  meta?: Record<string, any>
  // 谁 导入了我（比如 A 文件 import B，那么 B 的 importers 里有 A）。
  importers = new Set<ModuleNode>()
  // 我在 浏览器端代码里直接 import 的模块集合。
  clientImportedModules = new Set<ModuleNode>()
  // 我在 服务端渲染（SSR） 代码里 import 的模块集合。
  ssrImportedModules = new Set<ModuleNode>()
  // HMR（热更新）接受的依赖。
  // 表示如果这些模块变了，我可以局部热更新，而不是整个页面刷新。
  acceptedHmrDeps = new Set<ModuleNode>()
  // 本模块主动声明接受哪些导出（export）在热更新中处理，常见于 import.meta.hot.accept(['foo'])。
  acceptedHmrExports: Set<string> | null = null
  // 记录导入了哪些绑定（binding），比如：从 moduleA 中 import { a, b }，那 moduleA 的 importedBindings 里记录有 a 和 b。
  importedBindings: Map<string, Set<string>> | null = null
  // 是否自我接收热更新。
  // 如果一个模块自己写了 import.meta.hot.accept()，就可以热更新自己，而不用依赖外部模块来管理。
  isSelfAccepting?: boolean
  // 浏览器端构建时，这个模块的 转换结果（比如 .vue 编译成 .js 后的产物）。
  transformResult: TransformResult | null = null
  // 服务端渲染（SSR）构建时，这个模块的 转换结果。
  ssrTransformResult: TransformResult | null = null
  // SSR 加载后的模块对象（import() 后的内容）。
  ssrModule: Record<string, any> | null = null
  // SSR 加载模块时报错时，记录下错误。
  ssrError: Error | null = null
  // 最近一次热更新的时间戳（用于判断文件是否需要重新加载）。
  lastHMRTimestamp = 0
  // 最近一次 失效（invalidation） 的时间戳（比如文件改了，需要重新编译）。
  lastInvalidationTimestamp = 0

  /**
   * @param setIsSelfAccepting - set `false` to set `isSelfAccepting` later. e.g. #7870
   *
   * 设置 URL。
   * 判断是不是 CSS 文件（用 isDirectCSSRequest(url)），决定 type 是 'css' 还是 'js'。
   * isSelfAccepting 默认设为 false，不过这个值可以在外部修改（比如需要延后确认）。
   */
  constructor(url: string, setIsSelfAccepting = true) {
    this.url = url
    this.type = isDirectCSSRequest(url) ? 'css' : 'js'
    if (setIsSelfAccepting) {
      this.isSelfAccepting = false
    }
  }

  // 一个 getter。
  // 返回这个模块在 客户端和服务端都 import 的所有模块合集。
  // 是把 clientImportedModules 和 ssrImportedModules 两个集合合并在一起的。
  get importedModules(): Set<ModuleNode> {
    const importedModules = new Set(this.clientImportedModules)
    for (const module of this.ssrImportedModules) {
      importedModules.add(module)
    }
    return importedModules
  }
}

export type ResolvedUrl = [
  url: string, // 修正后的公开访问 URL（浏览器看到的那种，可能带上了扩展名）
  resolvedId: string, // 真正解析后的文件系统路径，比如 /absolute/path/src/App.vue?vue&type=script
  meta: object | null | undefined, // 解析过程中产生的额外元数据，通常是 Rollup 插件或解析器加的信息，比如虚拟模块的一些自定义信息
]

// 管理整个开发服务器里，所有模块（文件）的依赖关系和状态。
export class ModuleGraph {
  // URL → ModuleNode 的映射表。
  // 比如 /src/App.vue 这个 URL，会映射到对应的 ModuleNode 对象。
  // 浏览器端访问请求是以 URL 开头的，所以这是主要检索表。
  urlToModuleMap = new Map<string, ModuleNode>()
  // 解析后 ID → ModuleNode 的映射表。
  // 解析后的 ID 是磁盘绝对路径+可能带查询参数的，比如 /abs/path/src/App.vue?vue&type=template。
  // Rollup 插件内部处理模块，通常是以 ID 为准。
  idToModuleMap = new Map<string, ModuleNode>()
  // a single file may corresponds to multiple modules with different queries
  // 物理文件路径 → Set<ModuleNode>。
  // 一个文件（比如 /src/App.vue）可能对应多个模块：
  // 比如同一个 .vue 文件里的 template、script、style 都是独立模块（有不同的 query 参数）。
  // 这里用 Set 来支持一对多关系。
  fileToModulesMap = new Map<string, Set<ModuleNode>>()
  // 记录哪些模块路径是“安全的”，具体要看后续逻辑。
  // 通常用于 HMR 热更新时，标记哪些文件改了后，可以安全地局部刷新，不用整个页面 reload。
  safeModulesPath = new Set<string>()

  /**
   * @internal
   * 开发模式下（浏览器端），未解析 URL → ModuleNode（或 Promise）。
   * 用于缓存还没完全解析好的 URL，避免重复解析。
   * 比如用户快速刷新时，很多请求一起来，不缓存的话开销很大。
   */
  _unresolvedUrlToModuleMap = new Map<
    string,
    Promise<ModuleNode> | ModuleNode
  >()
  /**
   * @internal
   * 跟上面一样，不过是专门给 SSR（服务端渲染）用的未解析 URL 缓存表。
   */
  _ssrUnresolvedUrlToModuleMap = new Map<
    string,
    Promise<ModuleNode> | ModuleNode
  >()

  constructor(
    private resolveId: (
      url: string,
      ssr: boolean,
    ) => Promise<PartialResolvedId | null>,
  ) {}

  async getModuleByUrl(
    rawUrl: string,
    ssr?: boolean,
  ): Promise<ModuleNode | undefined> {
    // Quick path, if we already have a module for this rawUrl (even without extension)
    rawUrl = removeImportQuery(removeTimestampQuery(rawUrl))
    const mod = this._getUnresolvedUrlToModule(rawUrl, ssr)
    if (mod) {
      return mod
    }

    const [url] = await this._resolveUrl(rawUrl, ssr)
    return this.urlToModuleMap.get(url)
  }

  getModuleById(id: string): ModuleNode | undefined {
    return this.idToModuleMap.get(removeTimestampQuery(id))
  }

  getModulesByFile(file: string): Set<ModuleNode> | undefined {
    return this.fileToModulesMap.get(file)
  }

  onFileChange(file: string): void {
    const mods = this.getModulesByFile(file)
    if (mods) {
      const seen = new Set<ModuleNode>()
      mods.forEach((mod) => {
        this.invalidateModule(mod, seen)
      })
    }
  }

  invalidateModule(
    mod: ModuleNode,
    seen: Set<ModuleNode> = new Set(),
    timestamp: number = Date.now(),
    isHmr: boolean = false,
    hmrBoundaries: ModuleNode[] = [],
  ): void {
    if (seen.has(mod)) {
      return
    }
    seen.add(mod)
    if (isHmr) {
      mod.lastHMRTimestamp = timestamp
    } else {
      // Save the timestamp for this invalidation, so we can avoid caching the result of possible already started
      // processing being done for this module
      mod.lastInvalidationTimestamp = timestamp
    }
    // Don't invalidate mod.info and mod.meta, as they are part of the processing pipeline
    // Invalidating the transform result is enough to ensure this module is re-processed next time it is requested
    mod.transformResult = null
    mod.ssrTransformResult = null
    mod.ssrModule = null
    mod.ssrError = null

    // Fix #3033
    if (hmrBoundaries.includes(mod)) {
      return
    }
    mod.importers.forEach((importer) => {
      if (!importer.acceptedHmrDeps.has(mod)) {
        this.invalidateModule(importer, seen, timestamp, isHmr)
      }
    })
  }

  invalidateAll(): void {
    const timestamp = Date.now()
    const seen = new Set<ModuleNode>()
    this.idToModuleMap.forEach((mod) => {
      this.invalidateModule(mod, seen, timestamp)
    })
  }

  /**
   * Update the module graph based on a module's updated imports information
   * If there are dependencies that no longer have any importers, they are
   * returned as a Set.
   */
  async updateModuleInfo(
    mod: ModuleNode,
    importedModules: Set<string | ModuleNode>,
    importedBindings: Map<string, Set<string>> | null,
    acceptedModules: Set<string | ModuleNode>,
    acceptedExports: Set<string> | null,
    isSelfAccepting: boolean,
    ssr?: boolean,
  ): Promise<Set<ModuleNode> | undefined> {
    mod.isSelfAccepting = isSelfAccepting
    const prevImports = ssr ? mod.ssrImportedModules : mod.clientImportedModules
    let noLongerImported: Set<ModuleNode> | undefined

    let resolvePromises = []
    let resolveResults = new Array(importedModules.size)
    let index = 0
    // update import graph
    for (const imported of importedModules) {
      const nextIndex = index++
      if (typeof imported === 'string') {
        resolvePromises.push(
          this.ensureEntryFromUrl(imported, ssr).then((dep) => {
            dep.importers.add(mod)
            resolveResults[nextIndex] = dep
          }),
        )
      } else {
        imported.importers.add(mod)
        resolveResults[nextIndex] = imported
      }
    }

    if (resolvePromises.length) {
      await Promise.all(resolvePromises)
    }

    const nextImports = new Set(resolveResults)
    if (ssr) {
      mod.ssrImportedModules = nextImports
    } else {
      mod.clientImportedModules = nextImports
    }

    // remove the importer from deps that were imported but no longer are.
    prevImports.forEach((dep) => {
      if (
        !mod.clientImportedModules.has(dep) &&
        !mod.ssrImportedModules.has(dep)
      ) {
        dep.importers.delete(mod)
        if (!dep.importers.size) {
          // dependency no longer imported
          ;(noLongerImported || (noLongerImported = new Set())).add(dep)
        }
      }
    })

    // update accepted hmr deps
    resolvePromises = []
    resolveResults = new Array(acceptedModules.size)
    index = 0
    for (const accepted of acceptedModules) {
      const nextIndex = index++
      if (typeof accepted === 'string') {
        resolvePromises.push(
          this.ensureEntryFromUrl(accepted, ssr).then((dep) => {
            resolveResults[nextIndex] = dep
          }),
        )
      } else {
        resolveResults[nextIndex] = accepted
      }
    }

    if (resolvePromises.length) {
      await Promise.all(resolvePromises)
    }

    mod.acceptedHmrDeps = new Set(resolveResults)

    // update accepted hmr exports
    mod.acceptedHmrExports = acceptedExports
    mod.importedBindings = importedBindings
    return noLongerImported
  }

  async ensureEntryFromUrl(
    rawUrl: string,
    ssr?: boolean,
    setIsSelfAccepting = true,
  ): Promise<ModuleNode> {
    return this._ensureEntryFromUrl(rawUrl, ssr, setIsSelfAccepting)
  }

  /**
   * @internal
   * 保证一个 URL 在模块图中有对应的 ModuleNode。
   * 如果已有，直接返回。
   * 如果没有，新建一个。
   */
  async _ensureEntryFromUrl(
    // rawUrl：原始 URL。
    // ssr：是不是 SSR 环境。
    // setIsSelfAccepting：是否初始化为支持自接收 HMR。
    // resolved：提前解析过的 PartialResolvedId（优化用）。
    rawUrl: string,
    ssr?: boolean,
    setIsSelfAccepting = true,
    // Optimization, avoid resolving the same url twice if the caller already did it
    resolved?: PartialResolvedId,
  ): Promise<ModuleNode> {
    // Quick path, if we already have a module for this rawUrl (even without extension)
    // 先把 URL 上的 ?import、?t=xxx 时间戳这些 query 都移除，得到纯净的 URL。
    rawUrl = removeImportQuery(removeTimestampQuery(rawUrl))
    // 快速路径：如果已经有了对应的 ModuleNode（或者 Promise），直接返回。
    let mod = this._getUnresolvedUrlToModule(rawUrl, ssr)
    if (mod) {
      return mod
    }
    // 如果没有，则开始真正创建模块节点：
    const modPromise = (async () => {
      // 调用 _resolveUrl，解析出最终路径、URL 和元数据。
      const [url, resolvedId, meta] = await this._resolveUrl(
        rawUrl,
        ssr,
        resolved,
      )
      // 根据解析出的 resolvedId，去模块表 idToModuleMap 里查找已有的 ModuleNode。
      // 如果没有，就新建一个新的 ModuleNode。
      mod = this.idToModuleMap.get(resolvedId)
      if (!mod) {
        mod = new ModuleNode(url, setIsSelfAccepting)
        // 如果解析时有额外的元数据，也挂到 mod.meta 上。
        if (meta) mod.meta = meta
        this.urlToModuleMap.set(url, mod)
        mod.id = resolvedId
        this.idToModuleMap.set(resolvedId, mod)
        // file 是去除 query 后的纯文件路径，比如 /src/App.vue。
        const file = (mod.file = cleanUrl(resolvedId))
        // 建立 文件路径 -> 对应模块列表 的映射关系。
        // 一个物理文件可以对应多个 ModuleNode（比如带不同查询参数的）。
        let fileMappedModules = this.fileToModulesMap.get(file)
        if (!fileMappedModules) {
          fileMappedModules = new Set()
          this.fileToModulesMap.set(file, fileMappedModules)
        }
        fileMappedModules.add(mod)
      }
      // multiple urls can map to the same module and id, make sure we register
      // the url to the existing module in that case
      // 如果 resolvedId 已存在，但 url 没注册过，也要补注册：
      else if (!this.urlToModuleMap.has(url)) {
        this.urlToModuleMap.set(url, mod)
      }
      // 把 rawUrl 和 mod 关联起来。
      this._setUnresolvedUrlToModule(rawUrl, mod, ssr)
      return mod
    })()

    // Also register the clean url to the module, so that we can short-circuit
    // resolving the same url twice
    // 在异步解析还没完成时，也先缓存 Promise，避免同一个 URL 解析多次！
    this._setUnresolvedUrlToModule(rawUrl, modPromise, ssr)
    return modPromise
  }

  // some deps, like a css file referenced via @import, don't have its own
  // url because they are inlined into the main css import. But they still
  // need to be represented in the module graph so that they can trigger
  // hmr in the importing css file.
  // 某些依赖（比如 CSS @import 的子文件）没有独立 URL，但也需要有 ModuleNode 记录它们。
  // 用来专门处理这些只有文件路径、没有访问 URL 的资源。
  createFileOnlyEntry(file: string): ModuleNode {
    // 把路径标准化，保证是 / 分隔。
    file = normalizePath(file)
    // 如果还没有记录这个文件的 Set<ModuleNode>，就新建一个集合。
    let fileMappedModules = this.fileToModulesMap.get(file)
    if (!fileMappedModules) {
      fileMappedModules = new Set()
      this.fileToModulesMap.set(file, fileMappedModules)
    }

    // 给它一个假的 URL，加上前缀 /@fs/xxx，表示文件系统访问。
    const url = `${FS_PREFIX}${file}`
    // 如果已有 ModuleNode，直接返回。
    for (const m of fileMappedModules) {
      if (m.url === url || m.id === file) {
        return m
      }
    }

    // 新建一个 ModuleNode。
    // 只设置 file 和 url。
    // 加入 fileToModulesMap。
    const mod = new ModuleNode(url)
    mod.file = file
    fileMappedModules.add(mod)
    return mod
  }

  // for incoming urls, it is important to:
  // 1. remove the HMR timestamp query (?t=xxxx) and the ?import query
  // 2. resolve its extension so that urls with or without extension all map to
  // the same module
  // 从原始 URL 最终解析出：
  // 浏览器访问用的 URL
  // 真实磁盘路径 ID
  // 元数据 meta
  async resolveUrl(url: string, ssr?: boolean): Promise<ResolvedUrl> {
    // 先清理 URL 上的无关参数。
    url = removeImportQuery(removeTimestampQuery(url))
    // 如果已经存在 ModuleNode，直接返回它的信息。
    const mod = await this._getUnresolvedUrlToModule(url, ssr)
    if (mod?.id) {
      return [mod.url, mod.id, mod.meta]
    }
    // 调用 _resolveUrl，重新解析。
    return this._resolveUrl(url, ssr)
  }

  /**
   * @internal
   */
  _getUnresolvedUrlToModule(
    // url：一个未解析的 URL（就是还没 resolve 过成真实磁盘路径的 URL，比如 /src/App.vue）。
    // ssr?：可选，是否是 SSR（服务端渲染）环境。
    url: string,
    ssr?: boolean,
  ): Promise<ModuleNode> | ModuleNode | undefined {
    // ModuleNode：模块节点对象；
    // 或者是 Promise<ModuleNode>：因为有些是异步解析的；
    // 或者是 undefined：找不到的时候。
    return (
      // 根据 ssr 参数决定用哪张未解析 URL 到 ModuleNode 的 Map：
      // 如果是 SSR，查 _ssrUnresolvedUrlToModuleMap。
      // 如果是普通浏览器环境，查 _unresolvedUrlToModuleMap。
      // 直接用 .get(url) 查询。
      (
        ssr ? this._ssrUnresolvedUrlToModuleMap : this._unresolvedUrlToModuleMap
      ).get(url)
    )
  }
  /**
   * @internal
   */
  _setUnresolvedUrlToModule(
    // url：未解析的 URL。
    // mod：对应的 ModuleNode（或者是异步生成的 Promise<ModuleNode>）。
    // ssr?：是否是服务端渲染环境。
    url: string,
    mod: Promise<ModuleNode> | ModuleNode,
    ssr?: boolean,
  ): void {
    ;(ssr
      ? this._ssrUnresolvedUrlToModuleMap
      : this._unresolvedUrlToModuleMap
    ).set(url, mod)
  }

  /**
   * @internal
   * 定义一个内部私有方法（虽然只是靠注释标的，但其实外部一般不会直接调用）。
   */
  async _resolveUrl(
    // url: 原始 URL。
    // ssr?: 是否在服务端渲染（SSR）环境下处理，boolean 可选。
    // alreadyResolved?: 如果已经提前解析了 ID，可以直接传进来，不用再次 resolve。
    url: string,
    ssr?: boolean,
    alreadyResolved?: PartialResolvedId,
  ): Promise<ResolvedUrl> {
    // 如果传了 alreadyResolved（已解析过的 ID），就直接用。
    // 否则，调用 this.resolveId(url, ssr) 来动态解析 URL。
    // resolveId 是用来做模块路径解析的，比如把 /src/foo.vue 转成 /abs/path/src/foo.vue?vue&type=script。
    const resolved = alreadyResolved ?? (await this.resolveId(url, !!ssr))

    // 从 resolved 里拿 id（解析后的路径），如果没有，就 fallback 用原始的 url。
    const resolvedId = resolved?.id || url
    if (
      url !== resolvedId && // url 和 resolvedId 不一样（说明解析前后不同，比如补充了查询参数）。
      !url.includes('\0') && // url 不是虚拟模块（\0 是 Vite 里用来标记虚拟模块的，比如插件内生成的模块）。
      !url.startsWith(`virtual:`) // url 也不是以 virtual: 开头（Vite 内部的一种虚拟模块格式）。
    ) {
      // 获取解析后 ID 的扩展名（比如 .vue, .js, .css）。
      // 注意：这里用 cleanUrl(resolvedId)，先去掉 URL 里的 query string，再提取扩展名。
      const ext = extname(cleanUrl(resolvedId))
      // 如果解析出了扩展名（正常一般都会有），再把原始 url 也清理掉 query string，拿到纯路径。
      if (ext) {
        const pathname = cleanUrl(url)
        // 检查原始的 pathname 是否以扩展名结尾。
        // 如果没有结尾，就补上扩展名。
        // 这里 url = pathname + ext + url.slice(pathname.length) 的逻辑是：
        // 把 pathname 补上扩展名。
        // 再接上原本 pathname 后剩下的部分（通常是 query，比如 ?import 之类）。
        if (!pathname.endsWith(ext)) {
          url = pathname + ext + url.slice(pathname.length)
        }
      }
    }
    return [url, resolvedId, resolved?.meta]
  }
}
