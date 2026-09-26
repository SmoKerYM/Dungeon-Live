/*
 * 语音掷骰前端主体。
 *
 * 负责：识别结果的预览卡片（转写原文、标签、表达式）、自动确认倒计时、
 *       确认/取消按钮、错误提示，以及（第 5 期）麦克风按钮与录音采集。
 * 不负责：骰子结果的渲染——结果仍然走 game.html 现有的
 *         socket.on('dice:result') → addDiceMessage → buildDiceCard，
 *         保证语音投和手打投在聊天里长得一样、历史回放也一致。
 *
 * 谁引入：game.html，在主 <script> 之后引入本文件，然后调用 VoiceRoll.init({...})。
 * 依赖：init 传进来的 { socket, mountEl, isDM, getMyCharacter, escapeHtml }。
 *       不偷用 game.html 的全局变量——依赖关系要一眼可见。
 *
 * 用到的 socket 事件：
 *   voice:text（→S，调试用）、voice:confirm（→S）、voice:cancel（→S）
 *   voice:intent（←S，只发给说话者）、voice:error（←S）、voice:partial（←S，第 5 期）
 */
(function () {
    'use strict';

    /** 高置信度时自动掷骰前给玩家的反悔时间（用户已拍板 1.5 秒） */
    const AUTO_CONFIRM_MS = 1500;
    /** 预览卡片无人理会时自动消失的时间 */
    const PREVIEW_TTL_MS = 30000;
    /** 错误提示停留的时间 */
    const ERROR_TTL_MS = 5000;

    let ctx = null;             // init 传进来的依赖
    let current = null;         // { intentId, el, timers: [] } 当前这张预览卡片

    /**
     * 初始化。由 game.html 在主脚本之后调用一次。
     *
     * @param {object} opts
     * @param {object} opts.socket          已连接的 socket.io 客户端
     * @param {HTMLElement} opts.mountEl     挂载点（聊天输入框旁的空容器）
     * @param {boolean} opts.isDM            DM 不用这个功能（没有同名角色卡）
     * @param {() => object|null} opts.getMyCharacter 取「与自己同名的那张角色卡」的 getter；
     *        必须是 getter，因为 myCharacter 会在运行中被重新赋值
     * @param {(s: string) => string} opts.escapeHtml 复用 game.html 的转义函数
     */
    function init(opts) {
        ctx = opts;
        if (!ctx || !ctx.socket || !ctx.mountEl) {
            console.error('VoiceRoll.init 缺少 socket 或 mountEl');
            return;
        }

        // voice:intent（Server → Client）只发给说话者本人
        ctx.socket.on('voice:intent', showPreview);
        // voice:error（Server → Client）中文提示，给用户看
        ctx.socket.on('voice:error', (data) => showError(data && data.message));
    }

    /** 关掉当前预览卡片并清掉它的定时器 */
    function dismiss() {
        if (!current) return;
        current.timers.forEach(clearTimeout);
        if (current.el && current.el.parentNode) current.el.parentNode.removeChild(current.el);
        current = null;
    }

    /**
     * 渲染一张识别结果预览卡片。
     * autoConfirm 为 true 时进度条走完自动发 voice:confirm，期间随时可取消；
     * 为 false 时必须点「掷骰」——听错后投出去的骰子是公开的，重投伤桌上信任。
     *
     * @param {{intentId: string, transcript: string, label: string, expr: string,
     *          modifier: number, source: string, confidence: number, autoConfirm: boolean,
     *          intent: {advantage: string}}} data voice:intent 的 payload
     */
    function showPreview(data) {
        if (!ctx || !data || !data.intentId) return;
        dismiss();

        const esc = ctx.escapeHtml || (s => String(s));
        const adv = data.intent && data.intent.advantage;
        const advWord = adv === 'advantage' ? '（两次取高）'
            : (adv === 'disadvantage' ? '（两次取低）' : '');

        const el = document.createElement('div');
        el.className = 'vr-preview' + (data.autoConfirm ? '' : ' vr-unsure');
        el.innerHTML =
            (data.transcript ? `<div class="vr-preview-transcript">「${esc(data.transcript)}」</div>` : '') +
            '<div class="vr-preview-main">' +
                `<span class="vr-preview-label">${esc(data.label || '')}</span>` +
                `<span class="vr-preview-expr">${esc((data.expr || 'd20') + advWord)}</span>` +
            '</div>' +
            '<div class="vr-preview-actions">' +
                `<span class="vr-preview-hint">${data.autoConfirm ? '即将自动掷骰' : '没太听清，确认一下'}</span>` +
                '<button type="button" class="vr-btn vr-cancel">取消</button>' +
                '<button type="button" class="vr-btn vr-btn-primary vr-confirm">掷骰</button>' +
            '</div>' +
            (data.autoConfirm
                ? `<div class="vr-progress"><i style="animation-duration:${AUTO_CONFIRM_MS}ms"></i></div>`
                : '');

        ctx.mountEl.appendChild(el);
        current = { intentId: data.intentId, el, timers: [] };

        el.querySelector('.vr-confirm').addEventListener('click', () => confirmRoll(data.intentId));
        el.querySelector('.vr-cancel').addEventListener('click', () => cancelRoll(data.intentId));

        if (data.autoConfirm) {
            current.timers.push(setTimeout(() => confirmRoll(data.intentId), AUTO_CONFIRM_MS));
        }
        // 没人理会就自己消失，别一直挂在输入框上方（服务端那边 30 秒也会过期）
        current.timers.push(setTimeout(() => {
            if (current && current.intentId === data.intentId) cancelRoll(data.intentId);
        }, PREVIEW_TTL_MS));
    }

    /** 确认掷骰：voice:confirm（Client → Server）{ intentId } */
    function confirmRoll(intentId) {
        if (!current || current.intentId !== intentId) return;
        dismiss();
        ctx.socket.emit('voice:confirm', { intentId });
    }

    /** 放弃本次识别结果：voice:cancel（Client → Server）{ intentId } */
    function cancelRoll(intentId) {
        if (!current || current.intentId !== intentId) return;
        dismiss();
        ctx.socket.emit('voice:cancel', { intentId });
    }

    /**
     * 显示一条中文错误提示（没听清是哪项豁免 / 没听懂 / 没有同名角色卡）。
     * @param {string} message
     */
    function showError(message) {
        if (!ctx || !message) return;
        dismiss();

        const esc = ctx.escapeHtml || (s => String(s));
        const el = document.createElement('div');
        el.className = 'vr-preview vr-error';
        el.innerHTML =
            `<div class="vr-preview-error-text">${esc(message)}</div>`;
        ctx.mountEl.appendChild(el);

        current = { intentId: null, el, timers: [] };
        current.timers.push(setTimeout(dismiss, ERROR_TTL_MS));
    }

    /**
     * 调试入口：跳过 ASR，直接把一段文本喂进完整流程（判意图 → 预览 → 确认 → 掷骰）。
     * 在浏览器控制台里敲 VoiceRoll.debugText('带优势的隐匿') 就能测。
     *
     * @param {string} text
     */
    function debugText(text) {
        if (!ctx) return;
        ctx.socket.emit('voice:text', { text: String(text || '') });
    }

    window.VoiceRoll = { init, debugText };
})();
