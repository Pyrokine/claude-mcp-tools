/**
 * extract 工具
 *
 * 提取页面内容：
 * - text: 文本内容
 * - html: HTML 源码
 * - attribute: 元素属性
 * - screenshot: 截图
 * - state: 页面状态（精简的可交互元素列表）
 */

import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {writeFile} from 'fs/promises'
import {z} from 'zod'
import {formatErrorResponse, formatResponse, getSession, getUnifiedSession} from '../core/index.js'
import type {Target} from '../core/types.js'
import {targetToFindParams, targetZodSchema} from './schema.js'

/**
 * extract 参数 schema
 */
const extractSchema = z.object({
                                   type: z.enum(['text', 'html', 'attribute', 'screenshot', 'state'])
                                          .describe('提取类型'),
                                   target: targetZodSchema.optional().describe(
                                       '目标元素（attribute 必填；text/html 可选，省略则提取整个页面；screenshot/state 不需要）'),
                                   attribute: z.string().optional().describe('属性名（attribute）'),
                                   fullPage: z.boolean().optional().describe('是否全页面截图（screenshot）'),
                                   scale: z.number().optional().describe(
                                       '截图缩放比例（screenshot fullPage）。默认 1，设为 0.5 可降低分辨率加速大页面截图'),
                                   format: z.enum(['png', 'jpeg', 'webp']).optional().describe(
                                       '截图格式（screenshot）。默认 png，jpeg/webp 体积更小，复杂页面推荐 jpeg 减少超时'),
                                   quality: z.number().min(0).max(100).optional().describe(
                                       '截图质量（screenshot，仅 jpeg/webp 有效）。0-100，推荐 80'),
                                   output: z.string()
                                            .optional()
                                            .describe('输出文件路径（可选）。若指定，结果写入文件；否则返回内容'),
                                   tabId: z.string().optional().describe(
                                       '目标 Tab ID（可选，仅 Extension 模式）。不指定则使用当前 attach 的 tab。可操作非当前 attach 的 tab。CDP 模式下忽略此参数'),
                                   timeout: z.number().optional().describe('等待目标元素超时'),
                                   frame: z.union([z.string(), z.number()]).optional().describe(
                                       'iframe 定位（可选，仅 Extension 模式）。CSS 选择器（如 "iframe#main"）或索引（如 0）。不指定则在主框架操作'),
                               })

/**
 * extract 工具处理器
 */
async function handleExtract(args: z.infer<typeof extractSchema>): Promise<{
    content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
    isError?: boolean;
}> {
    try {
        const unifiedSession = getUnifiedSession()
        const useExtension   = unifiedSession.isExtensionConnected()
        const session        = getSession()

        // 多 tab 并行：临时切换到指定 tab
        return await unifiedSession.withTabId(args.tabId, async () => {
            return await unifiedSession.withFrame(args.frame, async () => {

                // Extension 路径：等待目标元素出现（如果指定了 target + timeout）
                if (useExtension && args.target && args.timeout !== undefined) {
                    await waitForTargetExtension(unifiedSession, args.target, args.timeout)
                }

                switch (args.type) {
                    case 'text': {
                        const text = useExtension
                                     ? await extractTextExtension(unifiedSession, args.target)
                                     : await extractText(session, args.target, args.timeout)
                        if (args.output) {
                            await writeFile(args.output, text, 'utf-8')
                            return formatResponse({
                                                      success: true,
                                                      type: 'text',
                                                      output: args.output,
                                                      size: text.length,
                                                  })
                        }
                        return formatResponse({
                                                  success: true,
                                                  type: 'text',
                                                  content: text,
                                              })
                    }

                    case 'html': {
                        const html = useExtension
                                     ? await extractHtmlExtension(unifiedSession, args.target)
                                     : await extractHTML(session, args.target, args.timeout)
                        if (args.output) {
                            await writeFile(args.output, html, 'utf-8')
                            return formatResponse({
                                                      success: true,
                                                      type: 'html',
                                                      output: args.output,
                                                      size: html.length,
                                                  })
                        }
                        return formatResponse({
                                                  success: true,
                                                  type: 'html',
                                                  content: html,
                                              })
                    }

                    case 'attribute': {
                        if (!args.target) {
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: JSON.stringify({
                                                                 error: {
                                                                     code: 'INVALID_ARGUMENT',
                                                                     message: 'attribute 提取需要 target 参数',
                                                                 },
                                                             }),
                                    },
                                ],
                                isError: true,
                            }
                        }
                        if (!args.attribute) {
                            return {
                                content: [
                                    {
                                        type: 'text',
                                        text: JSON.stringify({
                                                                 error: {
                                                                     code: 'INVALID_ARGUMENT',
                                                                     message: 'attribute 提取需要 attribute 参数',
                                                                 },
                                                             }),
                                    },
                                ],
                                isError: true,
                            }
                        }

                        let value: string | null
                        if (useExtension) {
                            value = await extractAttributeExtension(unifiedSession, args.target, args.attribute)
                        } else {
                            value = await extractAttribute(session, args.target, args.attribute, args.timeout)
                        }

                        return formatResponse({
                                                  success: true,
                                                  type: 'attribute',
                                                  attribute: args.attribute,
                                                  value,
                                              })
                    }

                    case 'screenshot': {
                        const base64 = await unifiedSession.screenshot({
                                                                           fullPage: args.fullPage ?? false,
                                                                           scale: args.scale,
                                                                           format: args.format,
                                                                           quality: args.quality,
                                                                       })
                        if (args.output) {
                            // 写入文件
                            await writeFile(args.output, Buffer.from(base64, 'base64'))
                            return formatResponse({
                                                      success: true,
                                                      type: 'screenshot',
                                                      output: args.output,
                                                  })
                        }
                        // 返回 base64 图片
                        return {
                            content: [
                                {
                                    type: 'image',
                                    data: base64,
                                    mimeType: `image/${args.format === 'jpeg' ? 'jpeg' : args.format ?? 'png'}`,
                                },
                            ],
                        }
                    }

                    case 'state': {
                        const state = await unifiedSession.readPage()
                        if (args.output) {
                            await writeFile(args.output, JSON.stringify(state, null, 2), 'utf-8')
                            return formatResponse({
                                                      success: true,
                                                      type: 'state',
                                                      output: args.output,
                                                  })
                        }
                        return formatResponse({
                                                  success: true,
                                                  type: 'state',
                                                  state,
                                              })
                    }

                    default:
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({
                                                             error: {
                                                                 code: 'INVALID_ARGUMENT',
                                                                 message: `未知提取类型: ${args.type}`,
                                                             },
                                                         }),
                                },
                            ],
                            isError: true,
                        }
                }

            }) // withFrame
        }) // withTabId
    } catch (error) {
        return formatErrorResponse(error)
    }
}

/**
 * 提取文本内容
 */
async function extractText(
    session: ReturnType<typeof getSession>,
    target?: Target,
    timeout?: number,
): Promise<string> {
    if (target) {
        const locator = session.createLocator(target, timeout !== undefined ? {timeout} : undefined)
        const text    = await locator.evaluateOn<string>(`function() {
      return this.textContent ?? '';
    }`)
        return text ?? ''
    }

    return session.evaluate<string>('document.body.innerText')
}

/**
 * 提取 HTML
 */
async function extractHTML(
    session: ReturnType<typeof getSession>,
    target?: Target,
    timeout?: number,
): Promise<string> {
    if (target) {
        const locator = session.createLocator(target, timeout !== undefined ? {timeout} : undefined)
        return await locator.evaluateOn<string>(`function() {
      return this.outerHTML;
    }`)
    }

    return session.evaluate<string>('document.documentElement.outerHTML')
}

/**
 * 提取属性
 */
async function extractAttribute(
    session: ReturnType<typeof getSession>,
    target: Target,
    attribute: string,
    timeout?: number,
): Promise<string | null> {
    const locator = session.createLocator(target, timeout !== undefined ? {timeout} : undefined)
    // 使用 JSON.stringify 安全转义属性名，防止 JS 注入
    return locator.evaluateOn<string | null>(`function() {
    return this.getAttribute(${JSON.stringify(attribute)});
  }`)
}

/**
 * Extension 模式：提取文本
 * 支持所有 Target 形式（css/xpath/text/role/label 等）
 */
async function extractTextExtension(
    unifiedSession: ReturnType<typeof getUnifiedSession>,
    target?: Target,
): Promise<string> {
    if (!target) {
        return unifiedSession.getText()
    }
    const {selector, text, xpath} = targetToFindParams(target)
    if (selector) {
        return unifiedSession.getText(selector)
    }

    // xpath/text 定位：通过 evaluate 在页面上下文中查找
    if (xpath) {
        return unifiedSession.evaluate<string>(
            `(function(xp) { var r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null); return r.singleNodeValue ? r.singleNodeValue.textContent || '' : '' })`,
            undefined, undefined, [xpath],
        )
    }
    if (text) {
        return unifiedSession.evaluate<string>(
            `(function(t) { var els = document.querySelectorAll('*'); for (var i = 0; i < els.length; i++) { var cn = els[i].childNodes; for (var j = 0; j < cn.length; j++) { if (cn[j].nodeType === 3 && cn[j].textContent && cn[j].textContent.includes(t)) return els[i].textContent || '' } } return '' })`,
            undefined, undefined, [text],
        )
    }
    return unifiedSession.getText()
}

/**
 * Extension 模式：提取 HTML
 * 支持所有 Target 形式（css/xpath/text/role/label 等）
 */
async function extractHtmlExtension(
    unifiedSession: ReturnType<typeof getUnifiedSession>,
    target?: Target,
    outer = true,
): Promise<string> {
    if (!target) {
        return unifiedSession.getHtml(undefined, outer)
    }
    const {selector, text, xpath} = targetToFindParams(target)
    if (selector) {
        return unifiedSession.getHtml(selector, outer)
    }

    const prop = outer ? 'outerHTML' : 'innerHTML'
    if (xpath) {
        return unifiedSession.evaluate<string>(
            `(function(xp, p) { var r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null); return r.singleNodeValue ? r.singleNodeValue[p] || '' : '' })`,
            undefined, undefined, [xpath, prop],
        )
    }
    if (text) {
        return unifiedSession.evaluate<string>(
            `(function(t, p) { var els = document.querySelectorAll('*'); for (var i = 0; i < els.length; i++) { var cn = els[i].childNodes; for (var j = 0; j < cn.length; j++) { if (cn[j].nodeType === 3 && cn[j].textContent && cn[j].textContent.includes(t)) return els[i][p] || '' } } return '' })`,
            undefined, undefined, [text, prop],
        )
    }
    return unifiedSession.getHtml(undefined, outer)
}

/**
 * Extension 模式：提取属性
 */
async function extractAttributeExtension(
    unifiedSession: ReturnType<typeof getUnifiedSession>,
    target: Target,
    attribute: string,
): Promise<string | null> {
    const {selector, text, xpath, nth: nthParam} = targetToFindParams(target as Target & { nth?: number })

    // xpath/text 定位需要先 find 得到 refId，再获取属性
    if (xpath || text) {
        const elements = await unifiedSession.find(selector, text, xpath)
        if (elements.length > 0) {
            const nth = nthParam ?? 0
            if (nth >= elements.length) {
                throw new Error(`第 ${nth} 个匹配元素不存在（共 ${elements.length} 个）`)
            }
            return unifiedSession.getAttribute(undefined, elements[nth].refId, attribute)
        }
        return null
    }

    if (selector) {
        return unifiedSession.getAttribute(selector, undefined, attribute)
    }

    return null
}

/**
 * Extension 模式：等待目标元素出现
 *
 * 在 extract 操作前轮询 find()，直到找到匹配元素或超时。
 * 用于实现 extract 的 timeout 参数语义。
 */
async function waitForTargetExtension(
    unifiedSession: ReturnType<typeof getUnifiedSession>,
    target: Target,
    timeout: number,
): Promise<void> {
    const startTime                              = Date.now()
    const retryDelay                             = 100
    const {selector, text, xpath, nth: nthParam} = targetToFindParams(target as Target & { nth?: number })
    const nth                                    = nthParam ?? 0
    let lastError: Error | null                  = null

    while (true) {
        const elapsed = Date.now() - startTime
        if (elapsed >= timeout) {
            const msg = `等待目标元素超时 (${timeout}ms)`
            throw new Error(lastError ? `${msg}: ${lastError.message}` : msg)
        }

        if (!unifiedSession.isExtensionConnected()) {
            lastError = new Error('Extension 未连接')
            await new Promise(r => setTimeout(r, retryDelay))
            continue
        }

        try {
            const remaining = timeout - elapsed
            const elements  = await unifiedSession.find(selector, text, xpath, remaining)
            if (elements.length > nth) {
                return
            }
        } catch (err) {
            // 暂时性错误（RPC 超时、发送失败、连接断开）可重试，其他确定性错误立即抛出
            if (err instanceof
                Error &&
                /Request timeout|Failed to send|disconnect|未连接|stopped|replaced/i.test(err.message)) {
                lastError = err
                await new Promise(r => setTimeout(r, retryDelay))
                continue
            }
            throw err
        }

        await new Promise(r => setTimeout(r, retryDelay))
    }
}

/**
 * 注册 extract 工具
 */
export function registerExtractTool(server: McpServer): void {
    server.registerTool('extract', {
        description: '提取页面内容：文本、HTML、属性、截图、状态',
        inputSchema: extractSchema,
    }, (args) => handleExtract(args))
}
