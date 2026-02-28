/**
 * cookies 工具
 *
 * Cookie 管理：
 * - get: 获取 cookies（支持多种过滤条件）
 * - set: 设置 cookie
 * - delete: 删除指定 cookie
 * - clear: 清空 cookies（支持按域名过滤）
 */

import {writeFile} from 'fs/promises'
import {z} from 'zod'
import {formatErrorResponse, getUnifiedSession} from '../core/index.js'

/**
 * cookies 工具定义
 */
export const cookiesToolDefinition = {
    name: 'cookies',
    description: 'Cookie 管理：获取、设置、删除、清空',
    inputSchema: {
        type: 'object' as const,
        properties: {
            action: {
                type: 'string',
                enum: ['get', 'set', 'delete', 'clear'],
                description: '操作类型',
            },
            // 通用过滤参数（get/clear）
            url: {
                type: 'string',
                description: 'URL 过滤（get/clear/set/delete）',
            },
            name: {
                type: 'string',
                description: 'Cookie 名称（get/set/delete 必填）',
            },
            domain: {
                type: 'string',
                description: '域名过滤（get/clear）',
            },
            path: {
                type: 'string',
                description: '路径过滤（get）或设置路径（set）',
            },
            secure: {
                type: 'boolean',
                description: '只返回 secure cookies（get）或设置 secure 属性（set）',
            },
            session: {
                type: 'boolean',
                description: '只返回会话 cookies（get）',
            },
            // set 专用参数
            value: {
                type: 'string',
                description: 'Cookie 值（set）',
            },
            httpOnly: {
                type: 'boolean',
                description: 'httpOnly 属性（set）',
            },
            sameSite: {
                type: 'string',
                enum: ['Strict', 'Lax', 'None'],
                description: 'SameSite 属性（set）',
            },
            expirationDate: {
                type: 'number',
                description: '过期时间戳（set）',
            },
            // 输出
            output: {
                type: 'string',
                description: '输出文件路径（get）。若指定，cookies 导出为 JSON 文件',
            },
        },
        required: ['action'],
    },
}

/**
 * cookies 参数 schema
 */
const cookiesSchema = z.object({
    action: z.enum(['get', 'set', 'delete', 'clear']),
    // 通用过滤参数
    url: z.string().optional(),
    name: z.string().optional(),
    domain: z.string().optional(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    session: z.boolean().optional(),
    // set 专用参数
    value: z.string().optional(),
    httpOnly: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
    expirationDate: z.number().optional(),
    // 输出
    output: z.string().optional(),
})

type CookiesParams = z.infer<typeof cookiesSchema>;

/**
 * cookies 工具处理器
 */
export async function handleCookies(params: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}> {
    try {
        const args = cookiesSchema.parse(params)
        const unifiedSession = getUnifiedSession()

        switch (args.action) {
            case 'get': {
                // 构建过滤条件
                const filter: {
                    url?: string
                    name?: string
                    domain?: string
                    path?: string
                    secure?: boolean
                    session?: boolean
                } = {}
                if (args.url) filter.url = args.url
                if (args.name) filter.name = args.name
                if (args.domain) filter.domain = args.domain
                if (args.path) filter.path = args.path
                if (args.secure !== undefined) filter.secure = args.secure
                if (args.session !== undefined) filter.session = args.session

                const cookies = await unifiedSession.getCookies(filter) as Array<{
                    name: string
                    value: string
                    domain?: string
                    path?: string
                    secure?: boolean
                    httpOnly?: boolean
                    sameSite?: string
                    expirationDate?: number
                    session?: boolean
                }>

                if (args.output) {
                    await writeFile(args.output, JSON.stringify(cookies, null, 2), 'utf-8')
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    success: true,
                                    action: 'get',
                                    output: args.output,
                                    count: cookies.length,
                                }),
                            },
                        ],
                    }
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    success: true,
                                    action: 'get',
                                    count: cookies.length,
                                    cookies,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                }
            }

            case 'set': {
                if (!args.url) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: {
                                        code: 'INVALID_ARGUMENT',
                                        message: '设置 cookie 需要 url 参数',
                                    },
                                }),
                            },
                        ],
                        isError: true,
                    }
                }
                if (!args.name) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: {
                                        code: 'INVALID_ARGUMENT',
                                        message: '设置 cookie 需要 name 参数',
                                    },
                                }),
                            },
                        ],
                        isError: true,
                    }
                }
                if (args.value === undefined) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: {
                                        code: 'INVALID_ARGUMENT',
                                        message: '设置 cookie 需要 value 参数',
                                    },
                                }),
                            },
                        ],
                        isError: true,
                    }
                }

                await unifiedSession.setCookie(args.name, args.value, {
                    url: args.url,
                    domain: args.domain,
                    path: args.path,
                    secure: args.secure,
                    httpOnly: args.httpOnly,
                    sameSite: args.sameSite,
                    expirationDate: args.expirationDate,
                })

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                action: 'set',
                                url: args.url,
                                name: args.name,
                            }),
                        },
                    ],
                }
            }

            case 'delete': {
                if (!args.url) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: {
                                        code: 'INVALID_ARGUMENT',
                                        message: '删除 cookie 需要 url 参数',
                                    },
                                }),
                            },
                        ],
                        isError: true,
                    }
                }
                if (!args.name) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                    error: {
                                        code: 'INVALID_ARGUMENT',
                                        message: '删除 cookie 需要 name 参数',
                                    },
                                }),
                            },
                        ],
                        isError: true,
                    }
                }

                await unifiedSession.deleteCookie(args.url, args.name)

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                action: 'delete',
                                url: args.url,
                                name: args.name,
                            }),
                        },
                    ],
                }
            }

            case 'clear': {
                // 构建过滤条件
                const filter: {url?: string; domain?: string} = {}
                if (args.url) filter.url = args.url
                if (args.domain) filter.domain = args.domain

                const result = await unifiedSession.clearCookies(
                    Object.keys(filter).length > 0 ? filter : undefined,
                )

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                action: 'clear',
                                filter: Object.keys(filter).length > 0 ? filter : 'all',
                                count: result.count,
                            }),
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
                                    message: `未知操作: ${args.action}`,
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
