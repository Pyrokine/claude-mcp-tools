/**
 * evaluate 工具
 *
 * 在页面上下文执行 JavaScript
 */

import {writeFile} from 'fs/promises'
import {z} from 'zod'
import {formatErrorResponse, getSession} from '../core/index.js'

/**
 * evaluate 工具定义
 */
export const evaluateToolDefinition = {
    name: 'evaluate',
    description: '在页面上下文执行 JavaScript',
    inputSchema: {
        type: 'object' as const,
        properties: {
            script: {
                type: 'string',
                description: 'JavaScript 代码',
            },
            args: {
                type: 'array',
                description: '传递给脚本的参数',
            },
            output: {
                type: 'string',
                description: '输出文件路径（可选）。若指定，结果序列化为 JSON 写入文件',
            },
            timeout: {
                type: 'number',
                description: '脚本执行超时',
            },
        },
        required: ['script'],
    },
}

/**
 * evaluate 参数 schema
 */
const evaluateSchema = z.object({
                                    script: z.string(),
                                    args: z.array(z.unknown()).optional(),
                                    output: z.string().optional(),
                                    timeout: z.number().optional(),
                                })

type EvaluateParams = z.infer<typeof evaluateSchema>;

/**
 * evaluate 工具处理器
 */
export async function handleEvaluate(params: unknown): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}> {
    try {
        const args    = evaluateSchema.parse(params)
        const session = getSession()

        const result = await session.evaluate(args.script, args.args, args.timeout)

        if (args.output) {
            await writeFile(
                args.output,
                JSON.stringify(result, null, 2),
                'utf-8',
            )
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                                                 success: true,
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
                    text: JSON.stringify(
                        {
                            success: true,
                            result,
                        },
                        null,
                        2,
                    ),
                },
            ],
        }
    } catch (error) {
        return formatErrorResponse(error)
    }
}
