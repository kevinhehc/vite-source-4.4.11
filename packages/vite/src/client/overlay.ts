import type { ErrorPayload } from 'types/hmrPayload'

// injected by the hmr plugin when served
declare const __BASE__: string

const base = __BASE__ || '/'

// set :host styles to make playwright detect the element as visible
const template = /*html*/ `
<style>
:host {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 99999;
  --monospace: 'SFMono-Regular', Consolas,
  'Liberation Mono', Menlo, Courier, monospace;
  --red: #ff5555;
  --yellow: #e2aa53;
  --purple: #cfa4ff;
  --cyan: #2dd9da;
  --dim: #c9c9c9;

  --window-background: #181818;
  --window-color: #d8d8d8;
}

.backdrop {
  position: fixed;
  z-index: 99999;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: scroll;
  margin: 0;
  background: rgba(0, 0, 0, 0.66);
}

.window {
  font-family: var(--monospace);
  line-height: 1.5;
  width: 800px;
  color: var(--window-color);
  margin: 30px auto;
  padding: 25px 40px;
  position: relative;
  background: var(--window-background);
  border-radius: 6px 6px 8px 8px;
  box-shadow: 0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22);
  overflow: hidden;
  border-top: 8px solid var(--red);
  direction: ltr;
  text-align: left;
}

pre {
  font-family: var(--monospace);
  font-size: 16px;
  margin-top: 0;
  margin-bottom: 1em;
  overflow-x: scroll;
  scrollbar-width: none;
}

pre::-webkit-scrollbar {
  display: none;
}

.message {
  line-height: 1.3;
  font-weight: 600;
  white-space: pre-wrap;
}

.message-body {
  color: var(--red);
}

.plugin {
  color: var(--purple);
}

.file {
  color: var(--cyan);
  margin-bottom: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.frame {
  color: var(--yellow);
}

.stack {
  font-size: 13px;
  color: var(--dim);
}

.tip {
  font-size: 13px;
  color: #999;
  border-top: 1px dotted #999;
  padding-top: 13px;
  line-height: 1.8;
}

code {
  font-size: 13px;
  font-family: var(--monospace);
  color: var(--yellow);
}

.file-link {
  text-decoration: underline;
  cursor: pointer;
}

kbd {
  line-height: 1.5;
  font-family: ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  font-weight: 700;
  background-color: rgb(38, 40, 44);
  color: rgb(166, 167, 171);
  padding: 0.15rem 0.3rem;
  border-radius: 0.25rem;
  border-width: 0.0625rem 0.0625rem 0.1875rem;
  border-style: solid;
  border-color: rgb(54, 57, 64);
  border-image: initial;
}
</style>
<div class="backdrop" part="backdrop">
  <div class="window" part="window">
    <pre class="message" part="message"><span class="plugin" part="plugin"></span><span class="message-body" part="message-body"></span></pre>
    <pre class="file" part="file"></pre>
    <pre class="frame" part="frame"></pre>
    <pre class="stack" part="stack"></pre>
    <div class="tip" part="tip">
      Click outside, press <kbd>Esc</kbd> key, or fix the code to dismiss.<br>
      You can also disable this overlay by setting
      <code part="config-option-name">server.hmr.overlay</code> to <code part="config-option-value">false</code> in <code part="config-file-name">vite.config.js.</code>
    </div>
  </div>
</div>
`

// 匹配文件路径+行列号
const fileRE = /(?:[a-zA-Z]:\\|\/).*?:\d+:\d+/g
// 匹配错误的 代码帧（code frame）：
const codeframeRE = /^(?:>?\s+\d+\s+\|.*|\s+\|\s*\^.*)\r?\n/gm

// Allow `ErrorOverlay` to extend `HTMLElement` even in environments where
// `HTMLElement` was not originally defined.
// 为了兼容某些环境下 HTMLElement 不存在的情况，使用了 默认类（Fallback class）防止报错。
const { HTMLElement = class {} as typeof globalThis.HTMLElement } = globalThis
// 这表示创建了一个自定义的 HTML 元素 <vite-error-overlay>，用于显示错误弹窗。
export class ErrorOverlay extends HTMLElement {
  root: ShadowRoot
  closeOnEsc: (e: KeyboardEvent) => void

  constructor(err: ErrorPayload['err'], links = true) {
    super()
    // 错误提示内容被封装在 Shadow DOM 中，不影响外部样式。
    this.root = this.attachShadow({ mode: 'open' })
    this.root.innerHTML = template

    codeframeRE.lastIndex = 0
    // err.frame 是 Vite 插件或编译器生成的代码帧字符串；
    // 如果有代码帧，就将 message 中的那部分剥离出来，单独展示。
    // 然后调用 this.text(selector, text, linkFiles) 方法设置各个部分的内容。
    const hasFrame = err.frame && codeframeRE.test(err.frame)
    const message = hasFrame
      ? err.message.replace(codeframeRE, '')
      : err.message
    if (err.plugin) {
      this.text('.plugin', `[plugin:${err.plugin}] `)
    }
    this.text('.message-body', message.trim())

    const [file] = (err.loc?.file || err.id || 'unknown file').split(`?`)
    if (err.loc) {
      this.text('.file', `${file}:${err.loc.line}:${err.loc.column}`, links)
    } else if (err.id) {
      this.text('.file', file)
    }

    if (hasFrame) {
      this.text('.frame', err.frame!.trim())
    }
    this.text('.stack', err.stack, links)

    this.root.querySelector('.window')!.addEventListener('click', (e) => {
      e.stopPropagation()
    })

    this.addEventListener('click', () => {
      this.close()
    })

    // 点击整个弹窗会关闭（除 .window 内部点击不触发关闭）。
    // 支持键盘 Esc 关闭。
    this.closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        this.close()
      }
    }

    document.addEventListener('keydown', this.closeOnEsc)
  }

  text(selector: string, text: string, linkFiles = false): void {
    const el = this.root.querySelector(selector)!
    if (!linkFiles) {
      el.textContent = text
    } else {
      let curIndex = 0
      let match: RegExpExecArray | null
      fileRE.lastIndex = 0
      while ((match = fileRE.exec(text))) {
        const { 0: file, index } = match
        if (index != null) {
          const frag = text.slice(curIndex, index)
          el.appendChild(document.createTextNode(frag))
          const link = document.createElement('a')
          link.textContent = file
          link.className = 'file-link'
          // 如果启用了 linkFiles，路径会变成可点击的链接，通过请求后端接口自动打开本地编辑器中的对应文件。
          link.onclick = () => {
            fetch(`${base}__open-in-editor?file=` + encodeURIComponent(file))
          }
          el.appendChild(link)
          curIndex += frag.length + file.length
        }
      }
    }
  }
  close(): void {
    this.parentNode?.removeChild(this)
    document.removeEventListener('keydown', this.closeOnEsc)
  }
}

// 如果全局未注册这个组件，则注册 <vite-error-overlay> 元素。
export const overlayId = 'vite-error-overlay'
const { customElements } = globalThis // Ensure `customElements` is defined before the next line.
if (customElements && !customElements.get(overlayId)) {
  customElements.define(overlayId, ErrorOverlay)
}
