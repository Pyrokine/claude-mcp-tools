/**
 * cookies 工具
 *
 * Cookie 管理：
 * - get: 获取 cookies
 * - set: 设置 cookie
 * - delete: 删除 cookie
 * - clear: 清空所有 cookies
 */

import {writeFile} from 'fs/promises'
import {z} from 'zod'
import {formatErrorResponse, getSession} from '../core/index.js'

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
            name: {
                type: 'string',
                description: 'Cookie 名（get/set/delete）',
            },
            value: {
                type: 'string',
                description: 'Cookie 值（set）',
            },
            options: {
                type: 'object',
                properties: {
                    domain: {type: 'string'},
                    path: {type: 'string'},
                    expires: {type: 'number'},
                    httpOnly: {type: 'boolean'},
                    secure: {type: 'boolean'},
                    sameSite: {type: 'string', enum: ['Strict', 'Lax', 'None']},
                },
                description: 'Cookie 选项（set）',
            },
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
                                   name: z.string().optional(),
                                   value: z.string().optional(),
                                   options: z
                                       .object({
                                                   domain: z.string().optional(),
                                                   path: z.string().optional(),
                                                   expires: z.number().optional(),
                                                   httpOnly: z.boolean().optional(),
                                                   secure: z.boolean().optional(),
                                                   sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
                                               })
                                       .optional(),
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
        const args    = cookiesSchema.parse(params)
        const session = getSession()

        switch (args.action) {
            case 'get': {
                const cookies = await session.getCookies()

                // 如果指定了 name，只返回匹配的 cookie
                const result = args.name
                               ? cookies.filter((c) => c.name === args.name)
                               : cookies

                if (args.output) {
                    await writeFile(args.output, JSON.stringify(result, null, 2), 'utf-8')
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({
                                                         success: true,
                                                         action: 'get',
                                                         output: args.output,
                                                         count: result.length,
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
                                    cookies: result,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                }
            }

            case 'set': {
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

                await session.setCookie(args.name, args.value, args.options)

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'set',
                                                     name: args.name,
                                                 }),
                        },
                    ],
                }
            }

            case 'delete': {
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

                await session.deleteCookie(args.name)

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'delete',
                                                     name: args.name,
                                                 }),
                        },
                    ],
                }
            }

            case 'clear': {
                await session.clearCookies()

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                                     success: true,
                                                     action: 'clear',
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
