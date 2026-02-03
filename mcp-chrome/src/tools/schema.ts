/**
 * 公共 JSON Schema 定义
 *
 * 用于 MCP 工具的 inputSchema，确保客户端侧的类型提示和契约校验
 */

import {z} from 'zod'

/**
 * Target Zod Schema（运行时校验）
 *
 * 支持的定位方式：
 * - role/name: 可访问性树定位
 * - text: 文本内容定位
 * - label: 表单 label 定位
 * - placeholder: 输入框占位符定位
 * - title: title 属性定位
 * - alt: alt 属性定位
 * - testId: data-testid 定位
 * - css: CSS 选择器定位
 * - xpath: XPath 定位
 * - x/y: 坐标定位
 */
export const targetZodSchema = z.union([
                                           z.object({role: z.string(), name: z.string().optional()}),
                                           z.object({text: z.string(), exact: z.boolean().optional()}),
                                           z.object({label: z.string(), exact: z.boolean().optional()}),
                                           z.object({placeholder: z.string(), exact: z.boolean().optional()}),
                                           z.object({title: z.string(), exact: z.boolean().optional()}),
                                           z.object({alt: z.string(), exact: z.boolean().optional()}),
                                           z.object({testId: z.string()}),
                                           z.object({css: z.string()}),
                                           z.object({xpath: z.string()}),
                                           z.object({x: z.number(), y: z.number()}),
                                       ])

/**
 * Target JSON Schema（MCP 契约）
 *
 * 使用 oneOf 表示互斥的定位方式，客户端可根据此生成参数提示
 */
export const targetJsonSchema = {
    oneOf: [
        {
            type: 'object',
            title: '可访问性树定位',
            description: '通过 ARIA role 和 name 定位元素',
            properties: {
                role: {type: 'string', description: 'ARIA role（如 button、link、textbox）'},
                name: {type: 'string', description: '可访问名称（可选）'},
            },
            required: ['role'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: '文本内容定位',
            description: '通过元素文本内容定位',
            properties: {
                text: {type: 'string', description: '文本内容'},
                exact: {type: 'boolean', description: '是否精确匹配（默认 false）'},
            },
            required: ['text'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: 'Label 定位',
            description: '通过表单 label 文本定位关联的输入元素',
            properties: {
                label: {type: 'string', description: 'label 文本'},
                exact: {type: 'boolean', description: '是否精确匹配（默认 false）'},
            },
            required: ['label'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: 'Placeholder 定位',
            description: '通过输入框的 placeholder 属性定位',
            properties: {
                placeholder: {type: 'string', description: 'placeholder 文本'},
                exact: {type: 'boolean', description: '是否精确匹配（默认 false）'},
            },
            required: ['placeholder'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: 'Title 属性定位',
            description: '通过元素的 title 属性定位',
            properties: {
                title: {type: 'string', description: 'title 属性值'},
                exact: {type: 'boolean', description: '是否精确匹配（默认 false）'},
            },
            required: ['title'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: 'Alt 属性定位',
            description: '通过图片的 alt 属性定位',
            properties: {
                alt: {type: 'string', description: 'alt 属性值'},
                exact: {type: 'boolean', description: '是否精确匹配（默认 false）'},
            },
            required: ['alt'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: 'TestId 定位',
            description: '通过 data-testid 属性定位',
            properties: {
                testId: {type: 'string', description: 'data-testid 值'},
            },
            required: ['testId'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: 'CSS 选择器定位',
            description: '通过 CSS 选择器定位',
            properties: {
                css: {type: 'string', description: 'CSS 选择器'},
            },
            required: ['css'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: 'XPath 定位',
            description: '通过 XPath 表达式定位',
            properties: {
                xpath: {type: 'string', description: 'XPath 表达式'},
            },
            required: ['xpath'],
            additionalProperties: false,
        },
        {
            type: 'object',
            title: '坐标定位',
            description: '通过页面坐标定位',
            properties: {
                x: {type: 'number', description: 'X 坐标（像素）'},
                y: {type: 'number', description: 'Y 坐标（像素）'},
            },
            required: ['x', 'y'],
            additionalProperties: false,
        },
    ],
    description: '目标元素定位方式',
} as const
