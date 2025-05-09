import fs from 'node:fs'
import path from 'node:path'
import colors from 'picocolors'
import type {
  ExternalOption,
  InputOption,
  InternalModuleFormat,
  LoggingFunction,
  ModuleFormat,
  OutputOptions,
  Plugin,
  RollupBuild,
  RollupError,
  RollupLog,
  RollupOptions,
  RollupOutput,
  RollupWarning,
  RollupWatcher,
  WatcherOptions,
} from 'rollup'
import type { Terser } from 'dep-types/terser'
import commonjsPlugin from '@rollup/plugin-commonjs'
import type { RollupCommonJSOptions } from 'dep-types/commonjs'
import type { RollupDynamicImportVarsOptions } from 'dep-types/dynamicImportVars'
import type { TransformOptions } from 'esbuild'
import type { InlineConfig, ResolvedConfig } from './config'
import { isDepsOptimizerEnabled, resolveConfig } from './config'
import { buildReporterPlugin } from './plugins/reporter'
import { buildEsbuildPlugin } from './plugins/esbuild'
import { terserPlugin } from './plugins/terser'
import {
  asyncFlatten,
  copyDir,
  emptyDir,
  joinUrlSegments,
  normalizePath,
  requireResolveFromRootWithFallback,
  withTrailingSlash,
} from './utils'
import { manifestPlugin } from './plugins/manifest'
import type { Logger } from './logger'
import { dataURIPlugin } from './plugins/dataUri'
import { buildImportAnalysisPlugin } from './plugins/importAnalysisBuild'
import {
  cjsShouldExternalizeForSSR,
  cjsSsrResolveExternals,
} from './ssr/ssrExternal'
import { ssrManifestPlugin } from './ssr/ssrManifestPlugin'
import type { DepOptimizationMetadata } from './optimizer'
import {
  findKnownImports,
  getDepsCacheDir,
  initDepsOptimizer,
} from './optimizer'
import { loadFallbackPlugin } from './plugins/loadFallback'
import { findNearestPackageData } from './packages'
import type { PackageCache } from './packages'
import { ensureWatchPlugin } from './plugins/ensureWatch'
import { ESBUILD_MODULES_TARGET, VERSION } from './constants'
import { resolveChokidarOptions } from './watch'
import { completeSystemWrapPlugin } from './plugins/completeSystemWrap'
import { mergeConfig } from './publicUtils'
import { webWorkerPostPlugin } from './plugins/worker'

export interface BuildOptions {
  /**
   * Compatibility transform target. The transform is performed with esbuild
   * and the lowest supported target is es2015/es6. Note this only handles
   * syntax transformation and does not cover polyfills (except for dynamic
   * import)
   *
   * Default: 'modules' - Similar to `@babel/preset-env`'s targets.esmodules,
   * transpile targeting browsers that natively support dynamic es module imports.
   * https://caniuse.com/es6-module-dynamic-import
   *
   * Another special value is 'esnext' - which only performs minimal transpiling
   * (for minification compat) and assumes native dynamic imports support.
   *
   * For custom targets, see https://esbuild.github.io/api/#target and
   * https://esbuild.github.io/content-types/#javascript for more details.
   * @default 'modules'
   */
  // 兼容性转换目标。转换是用esbuild实现的，最低支持的目标是es2015/es6。注意，这只处理语法转换，不涉及polyfills（除了动态导入）。
  // 默认值：` modules `——类似于@babel/preset-env的targets.esmodules，针对原生支持动态es模块导入的浏览器。https://caniuse.com/es6-module-dynamic-import
  // 另一个特殊值是` esnext `——它只执行最小的转译（为了简化），并假定支持本地动态导入。
  // 有关自定义目标的详细信息，请参见https://esbuild.github.io/api/#target和https://esbuild.github.io/content-types/#javascript。
  target?: 'modules' | TransformOptions['target'] | false
  /**
   * whether to inject module preload polyfill.
   * Note: does not apply to library mode.
   * @default true
   * @deprecated use `modulePreload.polyfill` instead
   */
  // 是否注入模块预加载polyfill。注意：不适用于库模式。
  // 弃用:
  // 使用modulePreload。polyfill相反
  polyfillModulePreload?: boolean
  /**
   * Configure module preload
   * Note: does not apply to library mode.
   * @default true
   * hhc
   * 控制这个为false
   */
  modulePreload?: boolean | ModulePreloadOptions
  /**
   * Directory relative from `root` where build output will be placed. If the
   * directory exists, it will be removed before the build.
   * @default 'dist'
   */
  // 输出目录
  outDir?: string
  /**
   * Directory relative from `outDir` where the built js/css/image assets will
   * be placed.
   * @default 'assets'
   */
  // js/css/image等资源的目相对目录，默认是assets
  assetsDir?: string
  /**
   * Static asset files smaller than this number (in bytes) will be inlined as
   * base64 strings. Default limit is `4096` (4kb). Set to `0` to disable.
   * @default 4096
   * hhc
   */
  // 小于多少的图片会内联问 string
  assetsInlineLimit?: number
  /**
   * Whether to code-split CSS. When enabled, CSS in async chunks will be
   * inlined as strings in the chunk and inserted via dynamically created
   * style tags when the chunk is loaded.
   * @default true
   */
  // css代码是否切割为单独的文件
  cssCodeSplit?: boolean
  /**
   * An optional separate target for CSS minification.
   * As esbuild only supports configuring targets to mainstream
   * browsers, users may need this option when they are targeting
   * a niche browser that comes with most modern JavaScript features
   * but has poor CSS support, e.g. Android WeChat WebView, which
   * doesn't support the #RGBA syntax.
   * @default target
   */
  // 你可以为 CSS 压缩 单独设置一个目标浏览器（target），这在某些情况下是有用的。
  //
  // 为什么需要单独设置 CSS 的 target？
  // 有些浏览器，比如：
  // Android 微信内置浏览器（WeChat WebView）
  // 这些浏览器 支持现代 JavaScript 语法，但 不完全支持现代 CSS 特性，比如：
  // 不支持 #RGBA 颜色格式（如 #ff000088）
  // 或其他 CSS 新语法（比如新单位、嵌套、媒体查询增强等）
  // 如果你使用了默认的 target，Vite 可能会输出这些新语法的 CSS，从而导致页面在这些浏览器上出现显示问题。
  cssTarget?: TransformOptions['target'] | false
  /**
   * Override CSS minification specifically instead of defaulting to `build.minify`,
   * so you can configure minification for JS and CSS separately.
   * @default 'esbuild'
   */
  // 值	              说明
  // true	            启用 CSS 压缩，使用默认压缩器（等同于 'esbuild'）
  // 'esbuild'	      使用 esbuild 压缩 CSS（默认）
  // 'lightningcss'	  使用 lightningcss（更快、兼容性更好）压缩 CSS
  // false	          禁用 CSS 压缩

  // lightningcss 简介（可选）
  // 由 Parcel 团队开发，比 esbuild 对 CSS 支持更完整；
  // 支持自动降级、兼容旧浏览器 CSS 特性；
  // 支持 CSS nesting、media query ranges、ICU、更多特性；
  // 更适合复杂或兼容性要求高的项目。
  cssMinify?: boolean | 'esbuild' | 'lightningcss'
  /**
   * If `true`, a separate sourcemap file will be created. If 'inline', the
   * sourcemap will be appended to the resulting output file as data URI.
   * 'hidden' works like `true` except that the corresponding sourcemap
   * comments in the bundled files are suppressed.
   * @default false
   */
  // 选项	          说明
  // false（默认）	  不生成 sourcemap（构建体积最小）
  // true	          生成独立的 .map 文件，调试工具可自动加载
  // 'inline'	      sourcemap 以 Base64 data URI 的形式嵌入到生成的 .js 文件中
  // 'hidden'	      生成 .map 文件，但不会在生成的 .js 文件里插入 //# sourceMappingURL 注释（适合上传 sourcemap 到监控平台但不暴露给用户）
  sourcemap?: boolean | 'inline' | 'hidden'
  /**
   * Set to `false` to disable minification, or specify the minifier to use.
   * Available options are 'terser' or 'esbuild'.
   * @default 'esbuild'
   */
  // build 阶段也用了 esbuild 做 minify
  minify?: boolean | 'terser' | 'esbuild'
  /**
   * Options for terser
   * https://terser.org/docs/api-reference#minify-options
   */
  terserOptions?: Terser.MinifyOptions
  /**
   * Will be merged with internal rollup options.
   * https://rollupjs.org/configuration-options/
   */
  rollupOptions?: RollupOptions
  /**
   * Options to pass on to `@rollup/plugin-commonjs`
   */
  commonjsOptions?: RollupCommonJSOptions
  /**
   * Options to pass on to `@rollup/plugin-dynamic-import-vars`
   */
  dynamicImportVarsOptions?: RollupDynamicImportVarsOptions
  /**
   * Whether to write bundle to disk
   * @default true
   */
  write?: boolean
  /**
   * Empty outDir on write.
   * @default true when outDir is a sub directory of project root
   */
  emptyOutDir?: boolean | null
  /**
   * Copy the public directory to outDir on write.
   * @default true
   * @experimental
   */
  copyPublicDir?: boolean
  /**
   * Whether to emit a manifest.json under assets dir to map hash-less filenames
   * to their hashed versions. Useful when you want to generate your own HTML
   * instead of using the one generated by Vite.
   *
   * Example:
   *
   * ```json
   * {
   *   "main.js": {
   *     "file": "main.68fe3fad.js",
   *     "css": "main.e6b63442.css",
   *     "imports": [...],
   *     "dynamicImports": [...]
   *   }
   * }
   * ```
   * @default false
   */
  manifest?: boolean | string
  /**
   * Build in library mode. The value should be the global name of the lib in
   * UMD mode. This will produce esm + cjs + umd bundle formats with default
   * configurations that are suitable for distributing libraries.
   * @default false
   */
  lib?: LibraryOptions | false
  /**
   * Produce SSR oriented build. Note this requires specifying SSR entry via
   * `rollupOptions.input`.
   * @default false
   */
  ssr?: boolean | string
  /**
   * Generate SSR manifest for determining style links and asset preload
   * directives in production.
   * @default false
   */
  ssrManifest?: boolean | string
  /**
   * Emit assets during SSR.
   * @experimental
   * @default false
   */
  //
  ssrEmitAssets?: boolean
  /**
   * Set to false to disable reporting compressed chunk sizes.
   * Can slightly improve build speed.
   * @default true
   */
  // 压缩大小汇报，关闭可以轻微的提高构建速度
  reportCompressedSize?: boolean
  /**
   * Adjust chunk size warning limit (in kbs).
   * @default 500
   */
  // chunk告警阈值，默认500kbs
  chunkSizeWarningLimit?: number
  /**
   * Rollup watch options
   * https://rollupjs.org/configuration-options/#watch
   * @default null
   */
  watch?: WatcherOptions | null
}

export interface LibraryOptions {
  /**
   * Path of library entry
   */
  entry: InputOption
  /**
   * The name of the exposed global variable. Required when the `formats` option includes
   * `umd` or `iife`
   */
  name?: string
  /**
   * Output bundle formats
   * @default ['es', 'umd']
   */
  formats?: LibraryFormats[]
  /**
   * The name of the package file output. The default file name is the name option
   * of the project package.json. It can also be defined as a function taking the
   * format as an argument.
   */
  fileName?: string | ((format: ModuleFormat, entryName: string) => string)
}

export type LibraryFormats = 'es' | 'cjs' | 'umd' | 'iife'

export interface ModulePreloadOptions {
  /**
   * Whether to inject a module preload polyfill.
   * Note: does not apply to library mode.
   * @default true
   */
  // 默认值： true
  // 作用： 是否自动注入一个 <script> polyfill，用于支持不原生支持 <link rel="modulepreload"> 的旧浏览器（如部分 Safari、早期移动浏览器）。
  // 说明： 仅对非 library 模式有效。
  // 设置为 false： 如果你只面向现代浏览器，可以关闭它，减少构建体积。
  polyfill?: boolean
  /**
   * Resolve the list of dependencies to preload for a given dynamic import
   * @experimental
   */
  // 类型： 函数，参数是一个动态导入的模块，返回其依赖模块列表
  // 作用： 允许自定义“动态导入模块”对应的预加载依赖列表（比如你希望只预加载部分依赖）
  // 状态： @experimental —— 实验性 API，不稳定
  resolveDependencies?: ResolveModulePreloadDependenciesFn
}
export interface ResolvedModulePreloadOptions {
  polyfill: boolean
  resolveDependencies?: ResolveModulePreloadDependenciesFn
}

export type ResolveModulePreloadDependenciesFn = (
  filename: string,
  deps: string[],
  context: {
    hostId: string
    hostType: 'html' | 'js'
  },
) => string[]

export interface ResolvedBuildOptions
  extends Required<Omit<BuildOptions, 'polyfillModulePreload'>> {
  modulePreload: false | ResolvedModulePreloadOptions
}

// 处理 build 部分用户配置，补齐默认值，做一些兼容性处理，最后返回标准化后的 ResolvedBuildOptions。
// 关键步骤：
// 检查 polyfillModulePreload 旧选项，发出警告并自动迁移。
// 设置 modulePreload 的默认值。
// 生成一份默认的 build 配置。
// 如果用户有自定义 build 配置，用 mergeConfig 合并到默认值里。
// 修正一些特殊字段（比如 target、minify、cssMinify）。
export function resolveBuildOptions(
  raw: BuildOptions | undefined,
  logger: Logger,
  root: string,
): ResolvedBuildOptions {
  const deprecatedPolyfillModulePreload = raw?.polyfillModulePreload
  if (raw) {
    const { polyfillModulePreload, ...rest } = raw
    raw = rest
    if (deprecatedPolyfillModulePreload !== undefined) {
      logger.warn(
        'polyfillModulePreload is deprecated. Use modulePreload.polyfill instead.',
      )
    }
    if (
      deprecatedPolyfillModulePreload === false &&
      raw.modulePreload === undefined
    ) {
      raw.modulePreload = { polyfill: false }
    }
  }

  const modulePreload = raw?.modulePreload
  const defaultModulePreload = {
    polyfill: true,
  }

  const defaultBuildOptions: BuildOptions = {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 4096,
    cssCodeSplit: !raw?.lib,
    sourcemap: false,
    rollupOptions: {},
    minify: raw?.ssr ? false : 'esbuild',
    terserOptions: {},
    write: true,
    emptyOutDir: null,
    copyPublicDir: true,
    manifest: false,
    lib: false,
    ssr: false,
    ssrManifest: false,
    ssrEmitAssets: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    watch: null,
  }

  const userBuildOptions = raw
    ? mergeConfig(defaultBuildOptions, raw)
    : defaultBuildOptions

  // @ts-expect-error Fallback options instead of merging
  const resolved: ResolvedBuildOptions = {
    target: 'modules',
    cssTarget: false,
    ...userBuildOptions,
    commonjsOptions: {
      include: [/node_modules/],
      extensions: ['.js', '.cjs'],
      ...userBuildOptions.commonjsOptions,
    },
    dynamicImportVarsOptions: {
      warnOnError: true,
      exclude: [/node_modules/],
      ...userBuildOptions.dynamicImportVarsOptions,
    },
    // Resolve to false | object
    modulePreload:
      modulePreload === false
        ? false
        : typeof modulePreload === 'object'
        ? {
            ...defaultModulePreload,
            ...modulePreload,
          }
        : defaultModulePreload,
  }

  // handle special build targets
  if (resolved.target === 'modules') {
    resolved.target = ESBUILD_MODULES_TARGET
  } else if (resolved.target === 'esnext' && resolved.minify === 'terser') {
    try {
      const terserPackageJsonPath = requireResolveFromRootWithFallback(
        root,
        'terser/package.json',
      )
      const terserPackageJson = JSON.parse(
        fs.readFileSync(terserPackageJsonPath, 'utf-8'),
      )
      const v = terserPackageJson.version.split('.')
      if (v[0] === '5' && v[1] < 16) {
        // esnext + terser 5.16<: limit to es2021 so it can be minified by terser
        resolved.target = 'es2021'
      }
    } catch {}
  }

  if (!resolved.cssTarget) {
    resolved.cssTarget = resolved.target
  }

  // normalize false string into actual false
  if ((resolved.minify as string) === 'false') {
    resolved.minify = false
  }

  if (resolved.minify === true) {
    resolved.minify = 'esbuild'
  }

  if (resolved.cssMinify == null) {
    resolved.cssMinify = !!resolved.minify
  }

  return resolved
}

// 根据 ResolvedConfig 返回构建阶段需要用到的插件列表。
// 分两类插件：
// pre：在 Rollup 核心处理前执行，例如：
// commonjsPlugin
// dataURIPlugin
// 用户自定义的 rollupOptions.plugins
// post：在主构建逻辑后处理，例如：
// buildImportAnalysisPlugin
// buildEsbuildPlugin
// terserPlugin
// manifestPlugin
// （这些插件是在 Rollup 内部的 plugin system 运行的。）
export async function resolveBuildPlugins(config: ResolvedConfig): Promise<{
  pre: Plugin[]
  post: Plugin[]
}> {
  const options = config.build
  const { commonjsOptions } = options
  const usePluginCommonjs =
    !Array.isArray(commonjsOptions?.include) ||
    commonjsOptions?.include.length !== 0
  const rollupOptionsPlugins = options.rollupOptions.plugins
  return {
    pre: [
      completeSystemWrapPlugin(),
      ...(options.watch ? [ensureWatchPlugin()] : []),
      ...(usePluginCommonjs ? [commonjsPlugin(options.commonjsOptions)] : []),
      dataURIPlugin(),
      ...((
        await asyncFlatten(
          Array.isArray(rollupOptionsPlugins)
            ? rollupOptionsPlugins
            : [rollupOptionsPlugins],
        )
      ).filter(Boolean) as Plugin[]),
      ...(config.isWorker ? [webWorkerPostPlugin()] : []),
    ],
    post: [
      buildImportAnalysisPlugin(config),
      ...(config.esbuild !== false ? [buildEsbuildPlugin(config)] : []),
      ...(options.minify ? [terserPlugin(config)] : []),
      ...(!config.isWorker
        ? [
            ...(options.manifest ? [manifestPlugin(config)] : []),
            ...(options.ssrManifest ? [ssrManifestPlugin(config)] : []),
            buildReporterPlugin(config),
          ]
        : []),
      loadFallbackPlugin(),
    ],
  }
}

/**
 * Bundles the app for production.
 * Returns a Promise containing the build result.
 */

// 入口函数，执行实际的打包工作。
// 流程很完整，步骤是：
// 1、解析配置 resolveConfig
// 2、打印构建信息（比如：vite v4.x building for production）
// 3、根据模式确定入口文件 input
//    如果是 library build，入口是 lib.entry
//    如果是 SSR，不能是 HTML 文件
// 4、准备 Rollup 插件列表
//    如果是 SSR，注入 ssr 标志到插件钩子
// 5、处理 external 配置
//    SSR 的时候可能需要额外处理 CJS 模块 external
// 6、初始化依赖优化（optimizer）
// 7、组装 Rollup 配置
// 8、如果 watch 模式
//    调用 rollup.watch，开始监听文件变化
// 9、否则正式执行 rollup.build
//    先清空输出目录 prepareOutDir
//    调用 bundle.write 写入输出文件
// 10、处理 build 失败的错误输出
export async function build(
  inlineConfig: InlineConfig = {},
): Promise<RollupOutput | RollupOutput[] | RollupWatcher> {
  const config = await resolveConfig(
    inlineConfig,
    'build',
    'production',
    'production',
  )
  const options = config.build
  const ssr = !!options.ssr
  const libOptions = options.lib

  config.logger.info(
    colors.cyan(
      `vite v${VERSION} ${colors.green(
        `building ${ssr ? `SSR bundle ` : ``}for ${config.mode}...`,
      )}`,
    ),
  )

  const resolve = (p: string) => path.resolve(config.root, p)
  const input = libOptions
    ? options.rollupOptions?.input ||
      (typeof libOptions.entry === 'string'
        ? resolve(libOptions.entry)
        : Array.isArray(libOptions.entry)
        ? libOptions.entry.map(resolve)
        : Object.fromEntries(
            Object.entries(libOptions.entry).map(([alias, file]) => [
              alias,
              resolve(file),
            ]),
          ))
    : typeof options.ssr === 'string'
    ? resolve(options.ssr)
    : options.rollupOptions?.input || resolve('index.html')

  if (ssr && typeof input === 'string' && input.endsWith('.html')) {
    throw new Error(
      `rollupOptions.input should not be an html file when building for SSR. ` +
        `Please specify a dedicated SSR entry.`,
    )
  }

  const outDir = resolve(options.outDir)

  // inject ssr arg to plugin load/transform hooks
  const plugins = (
    ssr ? config.plugins.map((p) => injectSsrFlagToHooks(p)) : config.plugins
  ) as Plugin[]

  const userExternal = options.rollupOptions?.external
  let external = userExternal

  // In CJS, we can pass the externals to rollup as is. In ESM, we need to
  // do it in the resolve plugin so we can add the resolved extension for
  // deep node_modules imports
  if (ssr && config.legacy?.buildSsrCjsExternalHeuristics) {
    external = await cjsSsrResolveExternal(config, userExternal)
  }

  if (isDepsOptimizerEnabled(config, ssr)) {
    await initDepsOptimizer(config)
  }

  const rollupOptions: RollupOptions = {
    context: 'globalThis',
    preserveEntrySignatures: ssr
      ? 'allow-extension'
      : libOptions
      ? 'strict'
      : false,
    cache: config.build.watch ? undefined : false,
    ...options.rollupOptions,
    input,
    plugins,
    external,
    onwarn(warning, warn) {
      onRollupWarning(warning, warn, config)
    },
  }

  const outputBuildError = (e: RollupError) => {
    let msg = colors.red((e.plugin ? `[${e.plugin}] ` : '') + e.message)
    if (e.id) {
      msg += `\nfile: ${colors.cyan(
        e.id + (e.loc ? `:${e.loc.line}:${e.loc.column}` : ''),
      )}`
    }
    if (e.frame) {
      msg += `\n` + colors.yellow(e.frame)
    }
    config.logger.error(msg, { error: e })
  }

  let bundle: RollupBuild | undefined
  try {
    const buildOutputOptions = (output: OutputOptions = {}): OutputOptions => {
      // @ts-expect-error See https://github.com/vitejs/vite/issues/5812#issuecomment-984345618
      if (output.output) {
        config.logger.warn(
          `You've set "rollupOptions.output.output" in your config. ` +
            `This is deprecated and will override all Vite.js default output options. ` +
            `Please use "rollupOptions.output" instead.`,
        )
      }

      const ssrNodeBuild = ssr && config.ssr.target === 'node'
      const ssrWorkerBuild = ssr && config.ssr.target === 'webworker'
      const cjsSsrBuild = ssr && config.ssr.format === 'cjs'

      const format = output.format || (cjsSsrBuild ? 'cjs' : 'es')
      const jsExt =
        ssrNodeBuild || libOptions
          ? resolveOutputJsExtension(
              format,
              findNearestPackageData(config.root, config.packageCache)?.data
                .type,
            )
          : 'js'
      return {
        dir: outDir,
        // Default format is 'es' for regular and for SSR builds
        format,
        exports: cjsSsrBuild ? 'named' : 'auto',
        sourcemap: options.sourcemap,
        name: libOptions ? libOptions.name : undefined,
        // es2015 enables `generatedCode.symbols`
        // - #764 add `Symbol.toStringTag` when build es module into cjs chunk
        // - #1048 add `Symbol.toStringTag` for module default export
        generatedCode: 'es2015',
        entryFileNames: ssr
          ? `[name].${jsExt}`
          : libOptions
          ? ({ name }) =>
              resolveLibFilename(
                libOptions,
                format,
                name,
                config.root,
                jsExt,
                config.packageCache,
              )
          : path.posix.join(options.assetsDir, `[name]-[hash].${jsExt}`),
        chunkFileNames: libOptions
          ? `[name]-[hash].${jsExt}`
          : path.posix.join(options.assetsDir, `[name]-[hash].${jsExt}`),
        assetFileNames: libOptions
          ? `[name].[ext]`
          : path.posix.join(options.assetsDir, `[name]-[hash].[ext]`),
        inlineDynamicImports:
          output.format === 'umd' ||
          output.format === 'iife' ||
          (ssrWorkerBuild &&
            (typeof input === 'string' || Object.keys(input).length === 1)),
        ...output,
      }
    }

    // resolve lib mode outputs
    const outputs = resolveBuildOutputs(
      options.rollupOptions?.output,
      libOptions,
      config.logger,
    )
    const normalizedOutputs: OutputOptions[] = []

    if (Array.isArray(outputs)) {
      for (const resolvedOutput of outputs) {
        normalizedOutputs.push(buildOutputOptions(resolvedOutput))
      }
    } else {
      normalizedOutputs.push(buildOutputOptions(outputs))
    }

    const outDirs = normalizedOutputs.map(({ dir }) => resolve(dir!))

    // watch file changes with rollup
    if (config.build.watch) {
      config.logger.info(colors.cyan(`\nwatching for file changes...`))

      const resolvedChokidarOptions = resolveChokidarOptions(
        config,
        config.build.watch.chokidar,
      )

      const { watch } = await import('rollup')
      const watcher = watch({
        ...rollupOptions,
        output: normalizedOutputs,
        watch: {
          ...config.build.watch,
          chokidar: resolvedChokidarOptions,
        },
      })

      watcher.on('event', (event) => {
        if (event.code === 'BUNDLE_START') {
          config.logger.info(colors.cyan(`\nbuild started...`))
          if (options.write) {
            prepareOutDir(outDirs, options.emptyOutDir, config)
          }
        } else if (event.code === 'BUNDLE_END') {
          event.result.close()
          config.logger.info(colors.cyan(`built in ${event.duration}ms.`))
        } else if (event.code === 'ERROR') {
          outputBuildError(event.error)
        }
      })

      return watcher
    }

    // write or generate files with rollup
    const { rollup } = await import('rollup')
    // rollup.rollup
    // rollup调用的地方
    bundle = await rollup(rollupOptions)

    if (options.write) {
      prepareOutDir(outDirs, options.emptyOutDir, config)
    }

    const res: RollupOutput[] = []
    for (const output of normalizedOutputs) {
      res.push(await bundle[options.write ? 'write' : 'generate'](output))
    }
    return Array.isArray(outputs) ? res : res[0]
  } catch (e) {
    outputBuildError(e)
    throw e
  } finally {
    if (bundle) await bundle.close()
  }
}

// 作用：
// 清理输出目录、复制 public 目录。
// 主要逻辑：
// 如果 outDir 在 root 外，默认不会自动清空（安全保护）。
// 避免清除 .git 文件夹。
// 如果 copyPublicDir 开启，把 public 目录复制到 outDir 中。
function prepareOutDir(
  outDirs: string[],
  emptyOutDir: boolean | null,
  config: ResolvedConfig,
) {
  const nonDuplicateDirs = new Set(outDirs)
  let outside = false
  if (emptyOutDir == null) {
    for (const outDir of nonDuplicateDirs) {
      if (
        fs.existsSync(outDir) &&
        !normalizePath(outDir).startsWith(withTrailingSlash(config.root))
      ) {
        // warn if outDir is outside of root
        config.logger.warn(
          colors.yellow(
            `\n${colors.bold(`(!)`)} outDir ${colors.white(
              colors.dim(outDir),
            )} is not inside project root and will not be emptied.\n` +
              `Use --emptyOutDir to override.\n`,
          ),
        )
        outside = true
        break
      }
    }
  }
  for (const outDir of nonDuplicateDirs) {
    if (!outside && emptyOutDir !== false && fs.existsSync(outDir)) {
      // skip those other outDirs which are nested in current outDir
      const skipDirs = outDirs
        .map((dir) => {
          const relative = path.relative(outDir, dir)
          if (
            relative &&
            !relative.startsWith('..') &&
            !path.isAbsolute(relative)
          ) {
            return relative
          }
          return ''
        })
        .filter(Boolean)
      emptyDir(outDir, [...skipDirs, '.git'])
    }
    if (
      config.build.copyPublicDir &&
      config.publicDir &&
      fs.existsSync(config.publicDir)
    ) {
      if (!areSeparateFolders(outDir, config.publicDir)) {
        config.logger.warn(
          colors.yellow(
            `\n${colors.bold(
              `(!)`,
            )} The public directory feature may not work correctly. outDir ${colors.white(
              colors.dim(outDir),
            )} and publicDir ${colors.white(
              colors.dim(config.publicDir),
            )} are not separate folders.\n`,
          ),
        )
      }
      copyDir(config.publicDir, outDir)
    }
  }
}

function getPkgName(name: string) {
  return name?.[0] === '@' ? name.split('/')[1] : name
}

type JsExt = 'js' | 'cjs' | 'mjs'

function resolveOutputJsExtension(
  format: ModuleFormat,
  type: string = 'commonjs',
): JsExt {
  if (type === 'module') {
    return format === 'cjs' || format === 'umd' ? 'cjs' : 'js'
  } else {
    return format === 'es' ? 'mjs' : 'js'
  }
}

// 在 library 模式下确定输出文件名。
// 比如，my-lib.es.js 或 my-lib.cjs.js。
// 逻辑：
// 如果用户配置了 fileName，优先用
// 否则用 package.json 的 name
// 根据输出 format 和 package.json 的 type 决定扩展名 .js/.cjs/.mjs
export function resolveLibFilename(
  libOptions: LibraryOptions,
  format: ModuleFormat,
  entryName: string,
  root: string,
  extension?: JsExt,
  packageCache?: PackageCache,
): string {
  if (typeof libOptions.fileName === 'function') {
    return libOptions.fileName(format, entryName)
  }

  const packageJson = findNearestPackageData(root, packageCache)?.data
  const name =
    libOptions.fileName ||
    (packageJson && typeof libOptions.entry === 'string'
      ? getPkgName(packageJson.name)
      : entryName)

  if (!name)
    throw new Error(
      'Name in package.json is required if option "build.lib.fileName" is not provided.',
    )

  extension ??= resolveOutputJsExtension(format, packageJson?.type)

  if (format === 'cjs' || format === 'es') {
    return `${name}.${extension}`
  }

  return `${name}.${format}.${extension}`
}

// 处理 library build 的输出格式，比如 es, cjs, umd, iife。
// 如果 formats 包含 umd/iife，必须只有一个入口，并且必须设置 name
// 如果用户手动指定了 rollupOptions.output，则忽略 build.lib.formats
export function resolveBuildOutputs(
  outputs: OutputOptions | OutputOptions[] | undefined,
  libOptions: LibraryOptions | false,
  logger: Logger,
): OutputOptions | OutputOptions[] | undefined {
  if (libOptions) {
    const libHasMultipleEntries =
      typeof libOptions.entry !== 'string' &&
      Object.values(libOptions.entry).length > 1
    const libFormats =
      libOptions.formats ||
      (libHasMultipleEntries ? ['es', 'cjs'] : ['es', 'umd'])

    if (!Array.isArray(outputs)) {
      if (libFormats.includes('umd') || libFormats.includes('iife')) {
        if (libHasMultipleEntries) {
          throw new Error(
            'Multiple entry points are not supported when output formats include "umd" or "iife".',
          )
        }

        if (!libOptions.name) {
          throw new Error(
            'Option "build.lib.name" is required when output formats include "umd" or "iife".',
          )
        }
      }

      return libFormats.map((format) => ({ ...outputs, format }))
    }

    // By this point, we know "outputs" is an Array.
    if (libOptions.formats) {
      logger.warn(
        colors.yellow(
          '"build.lib.formats" will be ignored because "build.rollupOptions.output" is already an array format.',
        ),
      )
    }

    outputs.forEach((output) => {
      if (['umd', 'iife'].includes(output.format!) && !output.name) {
        throw new Error(
          'Entries in "build.rollupOptions.output" must specify "name" when the format is "umd" or "iife".',
        )
      }
    })
  }

  return outputs
}

const warningIgnoreList = [`CIRCULAR_DEPENDENCY`, `THIS_IS_UNDEFINED`]
const dynamicImportWarningIgnoreList = [
  `Unsupported expression`,
  `statically analyzed`,
]

// 统一处理 Rollup 抛出的警告。
// 特点：
// 某些 warning 直接忽略（比如循环依赖、this为undefined）
// 特别处理动态导入变量的 warning
// UNRESOLVED_IMPORT 直接抛错（防止未正确引入依赖）
// 其他正常打印 warning。
export function onRollupWarning(
  warning: RollupWarning,
  warn: LoggingFunction,
  config: ResolvedConfig,
): void {
  const viteWarn: LoggingFunction = (warnLog) => {
    let warning: string | RollupLog

    if (typeof warnLog === 'function') {
      warning = warnLog()
    } else {
      warning = warnLog
    }

    if (typeof warning === 'object') {
      if (warning.code === 'UNRESOLVED_IMPORT') {
        const id = warning.id
        const exporter = warning.exporter
        // throw unless it's commonjs external...
        if (!id || !/\?commonjs-external$/.test(id)) {
          throw new Error(
            `[vite]: Rollup failed to resolve import "${exporter}" from "${id}".\n` +
              `This is most likely unintended because it can break your application at runtime.\n` +
              `If you do want to externalize this module explicitly add it to\n` +
              `\`build.rollupOptions.external\``,
          )
        }
      }

      if (
        warning.plugin === 'rollup-plugin-dynamic-import-variables' &&
        dynamicImportWarningIgnoreList.some((msg) =>
          // @ts-expect-error warning is RollupLog
          warning.message.includes(msg),
        )
      ) {
        return
      }

      if (warningIgnoreList.includes(warning.code!)) {
        return
      }

      if (warning.code === 'PLUGIN_WARNING') {
        config.logger.warn(
          `${colors.bold(
            colors.yellow(`[plugin:${warning.plugin}]`),
          )} ${colors.yellow(warning.message)}`,
        )
        return
      }
    }

    warn(warnLog)
  }

  const tty = process.stdout.isTTY && !process.env.CI
  if (tty) {
    process.stdout.clearLine(0)
    process.stdout.cursorTo(0)
  }
  const userOnWarn = config.build.rollupOptions?.onwarn
  if (userOnWarn) {
    userOnWarn(warning, viteWarn)
  } else {
    viteWarn(warning)
  }
}

// 在 SSR CJS 模式下，基于依赖扫描结果确定哪些模块应该 external。
// 比如你不希望把 express 打包进 SSR bundle，而是外部 require('express')。
async function cjsSsrResolveExternal(
  config: ResolvedConfig,
  user: ExternalOption | undefined,
): Promise<ExternalOption> {
  // see if we have cached deps data available
  let knownImports: string[] | undefined
  const dataPath = path.join(getDepsCacheDir(config, false), '_metadata.json')
  try {
    const data = JSON.parse(
      fs.readFileSync(dataPath, 'utf-8'),
    ) as DepOptimizationMetadata
    knownImports = Object.keys(data.optimized)
  } catch (e) {}
  if (!knownImports) {
    // no dev deps optimization data, do a fresh scan
    knownImports = await findKnownImports(config, false) // needs to use non-ssr
  }
  const ssrExternals = cjsSsrResolveExternals(config, knownImports)

  return (id, parentId, isResolved) => {
    const isExternal = cjsShouldExternalizeForSSR(id, ssrExternals)
    if (isExternal) {
      return true
    }
    if (user) {
      return resolveUserExternal(user, id, parentId, isResolved)
    }
  }
}

export function resolveUserExternal(
  user: ExternalOption,
  id: string,
  parentId: string | undefined,
  isResolved: boolean,
): boolean | null | void {
  if (typeof user === 'function') {
    return user(id, parentId, isResolved)
  } else if (Array.isArray(user)) {
    return user.some((test) => isExternal(id, test))
  } else {
    return isExternal(id, user)
  }
}

function isExternal(id: string, test: string | RegExp) {
  if (typeof test === 'string') {
    return id === test
  } else {
    return test.test(id)
  }
}

function injectSsrFlagToHooks(plugin: Plugin): Plugin {
  const { resolveId, load, transform } = plugin
  return {
    ...plugin,
    resolveId: wrapSsrResolveId(resolveId),
    load: wrapSsrLoad(load),
    transform: wrapSsrTransform(transform),
  }
}

function wrapSsrResolveId(hook?: Plugin['resolveId']): Plugin['resolveId'] {
  if (!hook) return

  const fn = 'handler' in hook ? hook.handler : hook
  const handler: Plugin['resolveId'] = function (id, importer, options) {
    return fn.call(this, id, importer, injectSsrFlag(options))
  }

  if ('handler' in hook) {
    return {
      ...hook,
      handler,
    } as Plugin['resolveId']
  } else {
    return handler
  }
}

function wrapSsrLoad(hook?: Plugin['load']): Plugin['load'] {
  if (!hook) return

  const fn = 'handler' in hook ? hook.handler : hook
  const handler: Plugin['load'] = function (id, ...args) {
    // @ts-expect-error: Receiving options param to be future-proof if Rollup adds it
    return fn.call(this, id, injectSsrFlag(args[0]))
  }

  if ('handler' in hook) {
    return {
      ...hook,
      handler,
    } as Plugin['load']
  } else {
    return handler
  }
}

function wrapSsrTransform(hook?: Plugin['transform']): Plugin['transform'] {
  if (!hook) return

  const fn = 'handler' in hook ? hook.handler : hook
  const handler: Plugin['transform'] = function (code, importer, ...args) {
    // @ts-expect-error: Receiving options param to be future-proof if Rollup adds it
    return fn.call(this, code, importer, injectSsrFlag(args[0]))
  }

  if ('handler' in hook) {
    return {
      ...hook,
      handler,
    } as Plugin['transform']
  } else {
    return handler
  }
}

function injectSsrFlag<T extends Record<string, any>>(
  options?: T,
): T & { ssr: boolean } {
  return { ...(options ?? {}), ssr: true } as T & { ssr: boolean }
}

/*
  The following functions are copied from rollup
  https://github.com/rollup/rollup/blob/0bcf0a672ac087ff2eb88fbba45ec62389a4f45f/src/ast/nodes/MetaProperty.ts#L145-L193

  https://github.com/rollup/rollup
  The MIT License (MIT)
  Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors)
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const needsEscapeRegEx = /[\n\r'\\\u2028\u2029]/
const quoteNewlineRegEx = /([\n\r'\u2028\u2029])/g
const backSlashRegEx = /\\/g

function escapeId(id: string): string {
  if (!needsEscapeRegEx.test(id)) return id
  return id.replace(backSlashRegEx, '\\\\').replace(quoteNewlineRegEx, '\\$1')
}

const getResolveUrl = (path: string, URL = 'URL') => `new ${URL}(${path}).href`

const getRelativeUrlFromDocument = (relativePath: string, umd = false) =>
  getResolveUrl(
    `'${escapeId(relativePath)}', ${
      umd ? `typeof document === 'undefined' ? location.href : ` : ''
    }document.currentScript && document.currentScript.src || document.baseURI`,
  )

const getFileUrlFromFullPath = (path: string) =>
  `require('u' + 'rl').pathToFileURL(${path}).href`

const getFileUrlFromRelativePath = (path: string) =>
  getFileUrlFromFullPath(`__dirname + '/${path}'`)

const relativeUrlMechanisms: Record<
  InternalModuleFormat,
  (relativePath: string) => string
> = {
  amd: (relativePath) => {
    if (relativePath[0] !== '.') relativePath = './' + relativePath
    return getResolveUrl(`require.toUrl('${relativePath}'), document.baseURI`)
  },
  cjs: (relativePath) =>
    `(typeof document === 'undefined' ? ${getFileUrlFromRelativePath(
      relativePath,
    )} : ${getRelativeUrlFromDocument(relativePath)})`,
  es: (relativePath) => getResolveUrl(`'${relativePath}', import.meta.url`),
  iife: (relativePath) => getRelativeUrlFromDocument(relativePath),
  // NOTE: make sure rollup generate `module` params
  system: (relativePath) => getResolveUrl(`'${relativePath}', module.meta.url`),
  umd: (relativePath) =>
    `(typeof document === 'undefined' && typeof location === 'undefined' ? ${getFileUrlFromRelativePath(
      relativePath,
    )} : ${getRelativeUrlFromDocument(relativePath, true)})`,
}
/* end of copy */

const customRelativeUrlMechanisms = {
  ...relativeUrlMechanisms,
  'worker-iife': (relativePath) =>
    getResolveUrl(`'${relativePath}', self.location.href`),
} as const satisfies Record<string, (relativePath: string) => string>

export type RenderBuiltAssetUrl = (
  filename: string,
  type: {
    type: 'asset' | 'public'
    hostId: string
    hostType: 'js' | 'css' | 'html'
    ssr: boolean
  },
) => string | { relative?: boolean; runtime?: string } | undefined

export function toOutputFilePathInJS(
  filename: string,
  type: 'asset' | 'public',
  hostId: string,
  hostType: 'js' | 'css' | 'html',
  config: ResolvedConfig,
  toRelative: (
    filename: string,
    hostType: string,
  ) => string | { runtime: string },
): string | { runtime: string } {
  const { renderBuiltUrl } = config.experimental
  let relative = config.base === '' || config.base === './'
  if (renderBuiltUrl) {
    const result = renderBuiltUrl(filename, {
      hostId,
      hostType,
      type,
      ssr: !!config.build.ssr,
    })
    if (typeof result === 'object') {
      if (result.runtime) {
        return { runtime: result.runtime }
      }
      if (typeof result.relative === 'boolean') {
        relative = result.relative
      }
    } else if (result) {
      return result
    }
  }
  if (relative && !config.build.ssr) {
    return toRelative(filename, hostId)
  }
  return joinUrlSegments(config.base, filename)
}

export function createToImportMetaURLBasedRelativeRuntime(
  format: InternalModuleFormat,
  isWorker: boolean,
): (filename: string, importer: string) => { runtime: string } {
  const formatLong = isWorker && format === 'iife' ? 'worker-iife' : format
  const toRelativePath = customRelativeUrlMechanisms[formatLong]
  return (filename, importer) => ({
    runtime: toRelativePath(
      path.posix.relative(path.dirname(importer), filename),
    ),
  })
}

export function toOutputFilePathWithoutRuntime(
  filename: string,
  type: 'asset' | 'public',
  hostId: string,
  hostType: 'js' | 'css' | 'html',
  config: ResolvedConfig,
  toRelative: (filename: string, hostId: string) => string,
): string {
  const { renderBuiltUrl } = config.experimental
  let relative = config.base === '' || config.base === './'
  if (renderBuiltUrl) {
    const result = renderBuiltUrl(filename, {
      hostId,
      hostType,
      type,
      ssr: !!config.build.ssr,
    })
    if (typeof result === 'object') {
      if (result.runtime) {
        throw new Error(
          `{ runtime: "${result.runtime}" } is not supported for assets in ${hostType} files: ${filename}`,
        )
      }
      if (typeof result.relative === 'boolean') {
        relative = result.relative
      }
    } else if (result) {
      return result
    }
  }
  if (relative && !config.build.ssr) {
    return toRelative(filename, hostId)
  } else {
    return joinUrlSegments(config.base, filename)
  }
}

export const toOutputFilePathInCss = toOutputFilePathWithoutRuntime
export const toOutputFilePathInHtml = toOutputFilePathWithoutRuntime

function areSeparateFolders(a: string, b: string) {
  const na = normalizePath(a)
  const nb = normalizePath(b)
  return (
    na !== nb &&
    !na.startsWith(withTrailingSlash(nb)) &&
    !nb.startsWith(withTrailingSlash(na))
  )
}
