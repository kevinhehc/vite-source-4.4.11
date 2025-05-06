import type {
  CSSModulesConfig,
  Drafts,
  Features,
  NonStandard,
  PseudoClasses,
  Targets,
} from 'lightningcss'

/**
 * Options are spread, so you can also use options that are not typed here like
 * visitor (not exposed because it would impact too much the bundle size)
 */
export type LightningCSSOptions = {
  // 类型：对象，键为浏览器名称，值为目标版本号
  // 用途：指定目标浏览器环境，决定需要兼容哪些 CSS 特性，自动进行降级（polyfill）
  // 示例：
  // targets: {
  //     chrome: '60',
  //     firefox: '65'
  //   }
  //
  targets?: Targets
  include?: Features
  exclude?: Features
  // 类型：对象
  // 用途：启用或禁用实验性的 CSS 功能草案（如 nesting, customMedia, mediaQueriesRangeSyntax 等）
  // drafts: {
  //     nesting: true,
  //     customMedia: true
  //   }
  drafts?: Drafts
  nonStandard?: NonStandard
  // PseudoClasses 通常用于 CSS 或类似 CSS 的样式系统中，表示元素在特定状态下的样式。
  // 常见的伪类包括：
  // :hover：鼠标悬停时的状态
  // :active：元素被激活（如点击）时的状态
  // :focus：元素获得焦点时的状态
  // :visited：链接已被访问过的状态
  // :link：未被访问的链接状态
  pseudoClasses?: PseudoClasses
  unusedSymbols?: string[]
  // 类型：布尔值或对象
  // 用途：是否启用 CSS Modules 支持，或将自定义配置传入
  //   cssModules: true
  //   // 或者
  //   cssModules: {
  //     pattern: '[name]__[local]--[hash:base64:5]'
  //   }
  //
  cssModules?: CSSModulesConfig
}
