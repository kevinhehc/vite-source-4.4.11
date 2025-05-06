// Modified and inlined to avoid extra dependency
// Source: https://github.com/terser/terser/blob/master/tools/terser.d.ts
// BSD Licensed https://github.com/terser/terser/blob/master/LICENSE

/*
Terser is released under the BSD license:

Copyright 2012-2018 (c) Mihai Bazon <mihai.bazon@gmail.com>

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

    * Redistributions of source code must retain the above
      copyright notice, this list of conditions and the following
      disclaimer.

    * Redistributions in binary form must reproduce the above
      copyright notice, this list of conditions and the following
      disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.
*/

export namespace Terser {
  // 支持的 ECMAScript 版本，用于决定压缩输出的目标语法。例如：
  // 5 → ES5
  // 2015 → ES6
  // 2020 → ES11
  export type ECMA = 5 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020

  export interface ParseOptions {
    // 用于控制 Terser 在 AST 解析阶段 的行为。
    // bare_returns: 允许 return 在函数外使用（适用于某些 REPL 场景）
    bare_returns?: boolean
    /** @deprecated legacy option. Currently, all supported EcmaScript is valid to parse. */
    // ecma: 已废弃，原用于限制可解析的 JS 版本（现在全版本均可解析）
    ecma?: ECMA
    // html5_comments: 保留 HTML 风格注释
    html5_comments?: boolean
    // shebang: 支持 #!/usr/bin/env node 解析
    shebang?: boolean
  }

  export interface CompressOptions {
    // 优化对 arguments 对象的使用（如：替换为参数名）
    arguments?: boolean
    // 将箭头函数转换为普通函数（取决于目标 ecma 版本）
    arrows?: boolean
    // 将布尔值转换为 0/1（可用于进一步压缩）
    booleans_as_integers?: boolean
    // 优化布尔表达式，如 !!x → x
    booleans?: boolean
    // 合并只被使用一次的变量定义到它们的使用位置
    collapse_vars?: boolean
    // 优化比较表达式，如 !(a < b) → a >= b
    comparisons?: boolean
    // 尝试优化计算属性，如 obj["a"] → obj.a
    computed_props?: boolean
    // 优化条件表达式，如 !0 ? x : y → x
    conditionals?: boolean
    // 删除永远不会执行的代码（如 if (false) {...}）
    dead_code?: boolean
    // 删除参数默认值与赋值中无效的部分，如 a = void 0
    defaults?: boolean
    // 优化 "use strict" 等指令的使用
    directives?: boolean
    // 删除所有 console.* 调用
    drop_console?: boolean
    // 删除 debugger 语句
    drop_debugger?: boolean
    // 指定输出代码的目标 ECMAScript 版本（影响语法特性）
    ecma?: ECMA
    // 常量表达式求值，如 2 + 3 → 5
    evaluate?: boolean
    // 将整个程序视为一个表达式（通常用于单一模块）
    expression?: boolean
    // 定义全局常量，类似 define 宏，配合 evaluate 进行条件编译
    global_defs?: object
    // 函数声明提前（可能提升作用域的函数）
    hoist_funs?: boolean
    // 尝试将常量对象属性提取出来，如 {a:1, b:2}.a → 1
    hoist_props?: boolean
    // 	变量声明提前（不推荐，可能改变语义）
    hoist_vars?: boolean
    // 是否兼容 IE8（关闭会跳过一些 IE8 安全检查）
    ie8?: boolean
    // 优化 if 语句中的 return/continue，如 if (a) return b; return c; → return a ? b : c;
    if_return?: boolean
    // 函数内联：控制是否把函数体内联到调用处（可加速但有风险）
    inline?: boolean | InlineFunctions
    // 将多个 var 合并为一个，如：var a=1; var b=2; → var a=1,b=2;
    join_vars?: boolean
    // 保留类名（用于调试、日志）
    keep_classnames?: boolean | RegExp
    // 保留未使用的函数参数（默认可能删除无用参数）
    keep_fargs?: boolean
    // 保留函数名（用于调试或反射）
    keep_fnames?: boolean | RegExp
    // 保留 Infinity（否则可能变成 1/0）
    keep_infinity?: boolean
    // 优化循环（如：合并、简化 while）
    loops?: boolean
    // 标明代码为 ES Module，会启用模块语义优化
    module?: boolean
    // 是否使用 !function(){} 包裹 IIFE（默认启用）
    negate_iife?: boolean
    // 压缩次数，默认 1，设置为 2+ 可提高压缩率但更耗时
    passes?: number
    // 优化对象属性访问（如字符串形式转点号）
    properties?: boolean
    // 指定无副作用函数，如 ["console.log"]，可剔除调用
    pure_funcs?: string[]
    // 假设对象属性访问无副作用（obj.prop）
    pure_getters?: boolean | 'strict'
    // 合并函数返回值到调用点
    reduce_funcs?: boolean
    // 合并变量（如使用 a = 1 → 直接替换）
    reduce_vars?: boolean
    // 合并多个语句为逗号表达式（压缩但影响可读性）
    sequences?: boolean | number
    // 删除无副作用的代码（与 package.json 中的 sideEffects: false 配合）
    side_effects?: boolean
    // 优化 switch 语句
    switches?: boolean
    // 是否压缩顶层作用域变量（可能重命名全局变量）
    toplevel?: boolean
    // 保留顶层变量或函数（结合 toplevel 使用）
    top_retain?: null | string | string[] | RegExp
    // 优化 typeof 表达式，如 typeof foo === "undefined"
    typeofs?: boolean
    // 不安全地优化箭头函数
    unsafe_arrows?: boolean
    // 启用所有不安全优化（前提：对语义无严格要求）
    unsafe?: boolean
    // 不安全地优化比较（可能重排操作顺序）
    unsafe_comps?: boolean
    // 优化 Function 构造函数调用（高风险）
    unsafe_Function?: boolean
    // 不安全地优化数学运算（可能引入精度误差）
    unsafe_math?: boolean
    // 不安全优化 Symbol.*
    unsafe_symbols?: boolean
    // 不安全优化方法调用（如假设 toString() 无副作用）
    unsafe_methods?: boolean
    // 不安全地优化 __proto__
    unsafe_proto?: boolean
    // 不安全优化正则表达式构造
    unsafe_regexp?: boolean
    // 将 undefined 视为常量（可能会变成 void 0）
    unsafe_undefined?: boolean
    // 	删除未使用的变量/函数（默认开启）
    unused?: boolean
  }

  export enum InlineFunctions {
    Disabled = 0,
    SimpleFunctions = 1,
    WithArguments = 2,
    WithArgumentsAndVariables = 3,
  }

  export interface MangleOptions {
    eval?: boolean
    keep_classnames?: boolean | RegExp
    keep_fnames?: boolean | RegExp
    module?: boolean
    nth_identifier?: SimpleIdentifierMangler | WeightedIdentifierMangler
    properties?: boolean | ManglePropertiesOptions
    reserved?: string[]
    safari10?: boolean
    toplevel?: boolean
  }

  /**
   * An identifier mangler for which the output is invariant with respect to the source code.
   */
  export interface SimpleIdentifierMangler {
    /**
     * Obtains the nth most favored (usually shortest) identifier to rename a variable to.
     * The mangler will increment n and retry until the return value is not in use in scope, and is not a reserved word.
     * This function is expected to be stable; Evaluating get(n) === get(n) should always return true.
     * @param n - The ordinal of the identifier.
     */
    get(n: number): string
  }

  /**
   * An identifier mangler that leverages character frequency analysis to determine identifier precedence.
   */
  export interface WeightedIdentifierMangler extends SimpleIdentifierMangler {
    /**
     * Modifies the internal weighting of the input characters by the specified delta.
     * Will be invoked on the entire printed AST, and then deduct mangleable identifiers.
     * @param chars - The characters to modify the weighting of.
     * @param delta - The numeric weight to add to the characters.
     */
    consider(chars: string, delta: number): number
    /**
     * Resets character weights.
     */
    reset(): void
    /**
     * Sorts identifiers by character frequency, in preparation for calls to get(n).
     */
    sort(): void
  }

  export interface ManglePropertiesOptions {
    builtins?: boolean
    debug?: boolean
    keep_quoted?: boolean | 'strict'
    nth_identifier?: SimpleIdentifierMangler | WeightedIdentifierMangler
    regex?: RegExp | string
    reserved?: string[]
  }

  export interface FormatOptions {
    ascii_only?: boolean
    /** @deprecated Not implemented anymore */
    beautify?: boolean
    braces?: boolean
    comments?:
      | boolean
      | 'all'
      | 'some'
      | RegExp
      | ((
          node: any,
          comment: {
            value: string
            type: 'comment1' | 'comment2' | 'comment3' | 'comment4'
            pos: number
            line: number
            col: number
          },
        ) => boolean)
    ecma?: ECMA
    ie8?: boolean
    keep_numbers?: boolean
    indent_level?: number
    indent_start?: number
    inline_script?: boolean
    keep_quoted_props?: boolean
    max_line_len?: number | false
    preamble?: string
    preserve_annotations?: boolean
    quote_keys?: boolean
    quote_style?: OutputQuoteStyle
    safari10?: boolean
    semicolons?: boolean
    shebang?: boolean
    shorthand?: boolean
    source_map?: SourceMapOptions
    webkit?: boolean
    width?: number
    wrap_iife?: boolean
    wrap_func_args?: boolean
  }

  export enum OutputQuoteStyle {
    PreferDouble = 0,
    AlwaysSingle = 1,
    AlwaysDouble = 2,
    AlwaysOriginal = 3,
  }

  export interface MinifyOptions {
    compress?: boolean | CompressOptions
    ecma?: ECMA
    enclose?: boolean | string
    ie8?: boolean
    keep_classnames?: boolean | RegExp
    keep_fnames?: boolean | RegExp
    mangle?: boolean | MangleOptions
    module?: boolean
    nameCache?: object
    format?: FormatOptions
    /** @deprecated deprecated */
    output?: FormatOptions
    parse?: ParseOptions
    safari10?: boolean
    sourceMap?: boolean | SourceMapOptions
    toplevel?: boolean
  }

  export interface MinifyOutput {
    code?: string
    map?: object | string
    decoded_map?: object | null
  }

  export interface SourceMapOptions {
    /** Source map object, 'inline' or source map file content */
    content?: object | string
    includeSources?: boolean
    filename?: string
    root?: string
    url?: string | 'inline'
  }
}
