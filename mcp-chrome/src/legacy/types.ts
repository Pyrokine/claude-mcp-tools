import type {Browser} from 'puppeteer-core'

/**
 * 浏览器连接配置
 */
export interface BrowserConnectOptions {
    /** 调试端口，默认 9222 */
    port?: number;
    /** 主机地址，默认 localhost */
    host?: string;
    /** 连接别名 */
    alias?: string;
    /** 默认视口宽度 */
    viewportWidth?: number;
    /** 默认视口高度 */
    viewportHeight?: number;
}

/**
 * 浏览器会话
 */
export interface BrowserSession {
    alias: string;
    browser: Browser;
    host: string;
    port: number;
    connectedAt: Date;
    wsEndpoint: string;
}

/**
 * 页面信息
 */
export interface PageInfo {
    pageId: string;
    url: string;
    title: string;
    /** 是否是当前活动页面 */
    active: boolean;
}

/**
 * 可交互元素摘要
 */
export interface ElementSummary {
    /** 元素索引 */
    index: number;
    /** 标签名 */
    tag: string;
    /** 元素文本（截断） */
    text: string;
    /** CSS 选择器 */
    selector: string;
    /** 元素角色 */
    role?: string;
    /** 元素类型（input 的 type） */
    type?: string;
    /** 是否可见 */
    visible: boolean;
    /** 边界框 */
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

/**
 * 页面状态
 */
export interface PageState {
    url: string;
    title: string;
    /** 视口大小 */
    viewport: {
        width: number;
        height: number;
    };
    /** 页面滚动位置 */
    scroll: {
        x: number;
        y: number;
    };
    /** 可交互元素列表 */
    elements: ElementSummary[];
    /** 表单数量 */
    formCount: number;
    /** 链接数量 */
    linkCount: number;
}

/**
 * 鼠标按钮
 */
export type MouseButton = 'left' | 'right' | 'middle';

/**
 * 点击选项
 */
export interface ClickOptions {
    /** 鼠标按钮 */
    button?: MouseButton;
    /** 点击次数 */
    clickCount?: number;
    /** 点击前延迟（毫秒） */
    delay?: number;
    /** 修饰键 */
    modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
}

/**
 * 拖拽选项
 */
export interface DragOptions {
    /** 起始 X 坐标 */
    startX: number;
    /** 起始 Y 坐标 */
    startY: number;
    /** 结束 X 坐标 */
    endX: number;
    /** 结束 Y 坐标 */
    endY: number;
    /** 拖拽持续时间（毫秒） */
    duration?: number;
    /** 步数（中间点数量） */
    steps?: number;
}

/**
 * 截图选项
 */
export interface ScreenshotOptions {
    /** 是否全页面截图 */
    fullPage?: boolean;
    /** 截图格式 */
    format?: 'png' | 'jpeg' | 'webp';
    /** 图片质量（1-100，仅 jpeg/webp） */
    quality?: number;
    /** 截取区域 */
    clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** 是否包含背景 */
    omitBackground?: boolean;
}

/**
 * 滚动选项
 */
export interface ScrollOptions {
    /** 滚动方向 */
    direction?: 'up' | 'down' | 'left' | 'right';
    /** 滚动距离（像素） */
    distance?: number;
    /** 滚动到指定坐标 */
    x?: number;
    y?: number;
    /** 是否平滑滚动 */
    smooth?: boolean;
}

/**
 * 输入选项
 */
export interface TypeOptions {
    /** 每个字符之间的延迟（毫秒） */
    delay?: number;
    /** 是否在输入前清空 */
    clear?: boolean;
}

/**
 * 等待选项
 */
export interface WaitOptions {
    /** 超时时间（毫秒） */
    timeout?: number;
    /** 等待条件 */
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
}

/**
 * 像素颜色信息
 */
export interface PixelColor {
    r: number;
    g: number;
    b: number;
    a: number;
    hex: string;
}

/**
 * 网络请求信息
 */
export interface NetworkRequest {
    url: string;
    method: string;
    status?: number;
    type: string;
    timestamp: number;
}

/**
 * 控制台消息
 */
export interface ConsoleMessage {
    type: 'log' | 'info' | 'warn' | 'error' | 'debug';
    text: string;
    timestamp: number;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
    content: string | object;
    isError?: boolean;
}
