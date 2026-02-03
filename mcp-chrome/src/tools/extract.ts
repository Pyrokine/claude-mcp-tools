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

import {writeFile} from 'fs/promises'
import {z} from 'zod'
import {formatErrorResponse, getSession} from '../core/index.js'
import type {Target} from '../core/types.js'
import {targetJsonSchema, targetZodSchema} from './schema.js'

/**
 * extract 工具定义
 */
export const extractToolDefinition = {
    name: 'extract',
    description: '提取页面内容：文本、HTML、属性、截图、状态',
    inputSchema: {
        type: 'object' as const,
        properties: {
            type: {
                type: 'string',
                enum: ['text', 'html', 'attribute', 'screenshot', 'state'],
                description: '提取类型',
            },
            target: {
                ...targetJsonSchema,
                description: '目标元素（attribute 必填；text/html 可选，省略则提取整个页面；screenshot/state 不需要）',
            },
            attribute: {
                type: 'string',
                description: '属性名（attribute）',
            },
            fullPage: {
                type: 'boolean',
                description: '是否全页面截图（screenshot）',
            },
            selector: {
                type: 'string',
                description: '限制范围（state）',
            },
            output: {
                type: 'string',
                description: '输出文件路径（可选）。若指定，结果写入文件；否则返回内容',
            },
            timeout: {
                type: 'number',
                description: '等待目标元素超时',
            },
        },
        required: ['type'],
    },
}

/**
 * extract 参数 schema
 */
const extractSchema = z.object({
                                   type: z.enum(['text', 'html', 'attribute', 'screenshot', 'state']),
                                   target: targetZodSchema.optional(),
                                   attribute: z.string().optional(),
                                   fullPage: z.boolean().optional(),
                                   selector: z.string().optional(),
                                   output: z.string().optional(),
                                   timeout: z.number().optional(),
                               })

type ExtractParams = z.infer<typeof extractSchema>;

/**
 * extract 工具处理器
 */
export async function handleExtract(params: unknown): Promise<{
    content: Array<{ type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
}> {
    try {
        const args    = extractSchema.parse(params)
        const session = getSession()

        switch (args.type) {
            case 'text': {
                const text = await extractText(session, args.target)
                if (args.output) {
                    await writeFile(args.output, text, 'utf-8')
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         type: 'text',
                                                         output: args.output,
                                                         size: text.length,
                                                     }),
                            },
                        ],
                    }
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     type: 'text',
                                                     content: text,
                                                 }),
                        },
                    ],
                }
            }

            case 'html': {
                const html = await extractHTML(session, args.target)
                if (args.output) {
                    await writeFile(args.output, html, 'utf-8')
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         type: 'html',
                                                         output: args.output,
                                                         size: html.length,
                                                     }),
                            },
                        ],
                    }
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     type: 'html',
                                                     content: html,
                                                 }),
                        },
                    ],
                }
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
                const value = await extractAttribute(
                    session,
                    args.target,
                    args.attribute,
                )
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     type: 'attribute',
                                                     attribute: args.attribute,
                                                     value,
                                                 }),
                        },
                    ],
                }
            }

            case 'screenshot': {
                const base64 = await session.screenshot(args.fullPage ?? false)
                if (args.output) {
                    // 写入文件
                    await writeFile(args.output, Buffer.from(base64, 'base64'))
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         type: 'screenshot',
                                                         output: args.output,
                                                     }),
                            },
                        ],
                    }
                }
                // 返回 base64 图片
                return {
                    content: [
                        {
                            type: 'image',
                            data: base64,
                            mimeType: 'image/png',
                        },
                    ],
                }
            }

            case 'state': {
                const state = await session.getPageState()
                if (args.output) {
                    await writeFile(args.output, JSON.stringify(state, null, 2), 'utf-8')
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         type: 'state',
                                                         output: args.output,
                                                     }),
                            },
                        ],
                    }
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     type: 'state',
                                                     state,
                                                 }, null, 2),
                        },
                    ],
                }
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
): Promise<string> {
    if (target) {
        // 定位元素并提取文本
        const locator = session.createLocator(target)
        const text    = await locator.evaluateOn<string>(`function() {
      return this.textContent ?? '';
    }`)
        return text ?? ''
    }

    // 提取整个页面文本
    return session.evaluate<string>('document.body.innerText')
}

/**
 * 提取 HTML
 */
async function extractHTML(
    session: ReturnType<typeof getSession>,
    target?: Target,
): Promise<string> {
    if (target) {
        const locator = session.createLocator(target)
        const html    = await locator.evaluateOn<string>(`function() {
      return this.outerHTML;
    }`)
        return html
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
): Promise<string | null> {
    const locator = session.createLocator(target)
    return locator.evaluateOn<string | null>(`function() {
    return this.getAttribute('${attribute}');
  }`)
}
