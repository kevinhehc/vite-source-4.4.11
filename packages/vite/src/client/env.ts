declare const __MODE__: string
declare const __DEFINES__: Record<string, any>

// 动态获取“全局对象”，确保兼容不同的运行环境（浏览器、Web Worker、Node.js 等）。

// 判断顺序解释：
// globalThis：现代 JS 的标准全局对象。
// self：在 Web Worker 环境下的全局对象。
// window：浏览器中的全局对象。
// Function('return this')()：在旧环境或非标准环境下兜底返回全局对象。
const context = (() => {
  if (typeof globalThis !== 'undefined') {
    return globalThis
  } else if (typeof self !== 'undefined') {
    return self
  } else if (typeof window !== 'undefined') {
    return window
  } else {
    return Function('return this')()
  }
})()

// assign defines
// __DEFINES__ 是构建时由 Vite 替换插入的变量，通常用于 宏定义、条件编译、环境变量注入 等。例如：
// const __DEFINES__ = {
//   'process.env.NODE_ENV': '"production"',
//   '__APP_VERSION__': '"1.0.0"'
// }
const defines = __DEFINES__
Object.keys(defines).forEach((key) => {
  // 将诸如 'process.env.NODE_ENV' 这种嵌套路径字符串分割为数组（['process', 'env', 'NODE_ENV']）。
  //
  // 然后逐级创建对象结构并赋值到全局对象上，如：
  // context.process = {
  //   env: {
  //     NODE_ENV: "production"
  //   }
  // }
  const segments = key.split('.')
  let target = context
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (i === segments.length - 1) {
      target[segment] = defines[key]
    } else {
      target = target[segment] || (target[segment] = {})
    }
  }
})
