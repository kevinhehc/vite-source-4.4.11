import type {
  CustomPluginOptions,
  LoadResult,
  ObjectHook,
  PluginContext,
  ResolveIdResult,
  Plugin as RollupPlugin,
  TransformPluginContext,
  TransformResult,
} from 'rollup'
export type { PluginContext } from 'rollup'
import type { ConfigEnv, ResolvedConfig, UserConfig } from './config'
import type { ServerHook } from './server'
import type { IndexHtmlTransform } from './plugins/html'
import type { ModuleNode } from './server/moduleGraph'
import type { HmrContext } from './server/hmr'
import type { PreviewServerHook } from './preview'

/**
 * Vite plugins extends the Rollup plugin interface with a few extra
 * vite-specific options. A valid vite plugin is also a valid Rollup plugin.
 * On the contrary, a Rollup plugin may or may NOT be a valid vite universal
 * plugin, since some Rollup features do not make sense in an unbundled
 * dev server context. That said, as long as a rollup plugin doesn't have strong
 * coupling between its bundle phase and output phase hooks then it should
 * just work (that means, most of them).
 *
 * By default, the plugins are run during both serve and build. When a plugin
 * is applied during serve, it will only run **non output plugin hooks** (see
 * rollup type definition of {@link rollup#PluginHooks}). You can think of the
 * dev server as only running `const bundle = rollup.rollup()` but never calling
 * `bundle.generate()`.
 *
 * A plugin that expects to have different behavior depending on serve/build can
 * export a factory function that receives the command being run via options.
 *
 * If a plugin should be applied only for server or build, a function format
 * config file can be used to conditional determine the plugins to use.
 */

/**
 * vite 插件在 Rollup 插件接口的基础上，扩展了一些 Vite 特有的选项。
 * 一个合法的 Vite 插件也一定是合法的 Rollup 插件。
 * 但反过来，Rollup 插件未必总是兼容 Vite，因为 Rollup 中的一些特性，在 Vite 的非打包开发服务器场景下并不适用。
 * 不过，只要一个 Rollup 插件没有在打包阶段（bundle）和生成阶段（output）之间强耦合，通常都是可以直接在 Vite 中使用的（大多数插件都是可以的）。
 *
 * 默认情况下，插件在 开发（serve） 和 打包（build） 阶段都会运行。
 * 当插件应用在开发阶段时，它只会执行非输出相关的插件钩子（具体见 Rollup 的 PluginHooks 类型定义）。
 * 你可以把开发服务器（dev server）理解成：只执行了 const bundle = rollup.rollup()，但从来没有调用 bundle.generate()。
 *
 * 如果一个插件需要根据是开发（serve）还是打包（build）阶段，表现出不同的行为，它可以导出一个工厂函数，通过 options 参数接收当前执行的命令。
 *
 * 如果一个插件只想应用在开发服务器或者打包阶段，可以通过使用函数式格式的配置文件，来根据条件动态决定使用哪些插件。
 */
// Vite的插件，本质上也是一个 合法的Rollup插件，但带了一些自己新增的字段。
export interface Plugin extends RollupPlugin {
  /**
   * Enforce plugin invocation tier similar to webpack loaders.
   *
   * Plugin invocation order:
   * - alias resolution
   * - `enforce: 'pre'` plugins
   * - vite core plugins
   * - normal plugins
   * - vite build plugins
   * - `enforce: 'post'` plugins
   * - vite build post plugins
   */

  // 决定插件的执行顺序。
  //
  // 类似 webpack 的 loader 中 enforce: 'pre' / enforce: 'post'。
  // 执行顺序：
  // 先 处理 alias
  // 然后 enforce: 'pre' 的插件
  // 然后 Vite内建插件
  // 然后 普通插件
  //  然后 Vite打包相关插件
  // 然后 enforce: 'post' 的插件
  // 最后 Vite打包收尾插件
  enforce?: 'pre' | 'post'

  /**
   * Apply the plugin only for serve or build, or on certain conditions.
   */
  // 决定插件应用在哪个阶段：
  // 'serve'：只在开发服务器阶段起作用
  // 'build'：只在打包阶段起作用
  // 也可以给个函数，动态判断条件。
  apply?:
    | 'serve'
    | 'build'
    | ((this: void, config: UserConfig, env: ConfigEnv) => boolean)

  /**
   * Modify vite config before it's resolved. The hook can either mutate the
   * passed-in config directly, or return a partial config object that will be
   * deeply merged into existing config.
   *
   * Note: User plugins are resolved before running this hook so injecting other
   * plugins inside  the `config` hook will have no effect.
   *
   * 在 Vite 配置解析前修改配置。可以直接修改传入的配置对象，
   * 或返回一个部分配置对象，这个对象会被深度合并到现有配置中。
   *
   * 注意：用户插件在运行此钩子之前就已经解析完毕，
   * 所以在 `config` 钩子中动态注入插件不会生效。
   */
  // Vite配置解析完成之后，这个钩子触发。
  // 常用来保存最终的 config 配置，后面插件里可能要用。
  config?: ObjectHook<
    (
      this: void,
      config: UserConfig,
      env: ConfigEnv,
    ) => UserConfig | null | void | Promise<UserConfig | null | void>
  >

  /**
   * Use this hook to read and store the final resolved vite config.
   *
   * 使用这个钩子读取和存储最终解析后的 Vite 配置。
   */
  // 在 dev server 启动前调用，拿到 ViteDevServer。
  // 可以直接操作 server，比如加中间件、记录server实例等。
  // 可以返回一个 "post hook"，在Vite内置中间件加完后再执行。
  configResolved?: ObjectHook<
    (this: void, config: ResolvedConfig) => void | Promise<void>
  >

  /**
   * Configure the vite server. The hook receives the {@link ViteDevServer}
   * instance. This can also be used to store a reference to the server
   * for use in other hooks.
   *
   * The hooks will be called before internal middlewares are applied. A hook
   * can return a post hook that will be called after internal middlewares
   * are applied. Hook can be async functions and will be called in series.
   *
   * 配置 Vite 开发服务器。钩子接收 {@link ViteDevServer} 实例。
   * 也可以在这里保存服务器引用供其他钩子使用。
   *
   * 此钩子在应用内部中间件之前调用。
   * 可以返回一个后置钩子，在应用内部中间件之后调用。
   * 钩子可以是异步函数，并且会依次串行调用。
   */
  // 跟 configureServer 类似，不过是**预览服务器（vite preview）**的版本。
  configureServer?: ObjectHook<ServerHook>

  /**
   * Configure the preview server. The hook receives the {@link PreviewServerForHook}
   * instance. This can also be used to store a reference to the server
   * for use in other hooks.
   *
   * The hooks are called before other middlewares are applied. A hook can
   * return a post hook that will be called after other middlewares are
   * applied. Hooks can be async functions and will be called in series.
   *
   * 配置预览服务器。钩子接收 {@link PreviewServerForHook} 实例。
   * 也可以在这里保存服务器引用供其他钩子使用。
   *
   * 钩子会在其他中间件应用前调用。
   * 可以返回一个后置钩子，在其他中间件应用后调用。
   * 钩子可以是异步函数，并且会串行调用。
   */
  configurePreviewServer?: ObjectHook<PreviewServerHook>

  /**
   * Transform index.html.
   * The hook receives the following arguments:
   *
   * - html: string
   * - ctx?: vite.ServerContext (only present during serve)
   * - bundle?: rollup.OutputBundle (only present during build)
   *
   * It can either return a transformed string, or a list of html tag
   * descriptors that will be injected into the `<head>` or `<body>`.
   *
   * By default the transform is applied **after** vite's internal html
   * transform. If you need to apply the transform before vite, use an object:
   * `{ order: 'pre', handler: hook }`
   *
   * 用来转换 index.html。
   * 钩子接收以下参数：
   * - html: 字符串
   * - ctx?: vite.ServerContext（仅在 serve 阶段存在）
   * - bundle?: rollup.OutputBundle（仅在 build 阶段存在）
   *
   * 可以返回一个变换后的字符串，或返回一组 HTML 标签描述对象，
   * 这些对象会被注入到 `<head>` 或 `<body>` 中。
   *
   * 默认情况下，转换是在 Vite 内部 HTML 转换**之后**应用的。
   * 如果需要在 Vite 转换**之前**应用，可以返回对象格式：
   * `{ order: 'pre', handler: hook }`
   */

  // 专门给 index.html 文件定制处理。
  // 1、参数：
  // html：原html文本
  // ctx：服务器上下文（serve阶段才有）
  // bundle：打包结果（build阶段才有）
  // 2、返回值可以是：
  // 直接返回修改过的 HTML 字符串；
  // 或返回一组描述要插入到 <head> 或 <body> 里的 tag 列表。
  transformIndexHtml?: IndexHtmlTransform

  /**
   * Perform custom handling of HMR updates.
   * The handler receives a context containing changed filename, timestamp, a
   * list of modules affected by the file change, and the dev server instance.
   *
   * - The hook can return a filtered list of modules to narrow down the update.
   *   e.g. for a Vue SFC, we can narrow down the part to update by comparing
   *   the descriptors.
   *
   * - The hook can also return an empty array and then perform custom updates
   *   by sending a custom hmr payload via server.ws.send().
   *
   * - If the hook doesn't return a value, the hmr update will be performed as
   *   normal.
   *
   *   自定义 HMR（热更新）处理。
   * 处理器接收一个上下文对象，包含变更的文件名、时间戳、
   * 受影响模块的列表以及开发服务器实例。
   *
   * - 钩子可以返回一个过滤后的模块列表，以缩小更新范围。
   *   例如，对于 Vue SFC（单文件组件），可以通过比较描述符缩小需要更新的部分。
   *
   * - 钩子也可以返回空数组，然后通过 server.ws.send() 发送自定义 HMR 消息，执行自定义更新。
   *
   * - 如果钩子不返回值，将按正常流程进行 HMR 更新。
   */
  // 专门处理 HMR（热更新）。
  // 你可以：
  // 返回要更新的模块列表（定制更新范围）
  // 或直接发送自定义更新消息（server.ws.send）。
  handleHotUpdate?: ObjectHook<
    (
      this: void,
      ctx: HmrContext,
    ) => Array<ModuleNode> | void | Promise<Array<ModuleNode> | void>
  >

  /**
   * extend hooks with ssr flag
   */
  // 定制模块解析逻辑（比默认的 node-resolve 更早一步）。
  // 支持 SSR（服务器端渲染）时，options.ssr 会是 true。
  resolveId?: ObjectHook<
    (
      this: PluginContext,
      source: string,
      importer: string | undefined,
      options: {
        assertions: Record<string, string>
        custom?: CustomPluginOptions
        ssr?: boolean
        /**
         * @internal
         */
        scan?: boolean
        isEntry: boolean
      },
    ) => Promise<ResolveIdResult> | ResolveIdResult
  >

  // 拦截模块的加载，返回模块内容（而不是从磁盘读文件）。
  load?: ObjectHook<
    (
      this: PluginContext,
      id: string,
      options?: { ssr?: boolean },
    ) => Promise<LoadResult> | LoadResult
  >

  // 对模块的源码做转换处理。
  // 常用于像 Babel、Vue SFC、TypeScript这类插件
  transform?: ObjectHook<
    (
      this: TransformPluginContext,
      code: string,
      id: string,
      options?: { ssr?: boolean },
    ) => Promise<TransformResult> | TransformResult
  >
}

export type HookHandler<T> = T extends ObjectHook<infer H> ? H : T
