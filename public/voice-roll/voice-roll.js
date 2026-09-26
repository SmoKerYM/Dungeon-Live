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
 *   voice:start / voice:chunk / voice:stop / voice:cancel（→S，录音）
 *   voice:text（→S，调试用）、voice:confirm（→S）
 *   voice:intent（←S，只发给说话者）、voice:error（←S）、voice:partial（←S）
 */
(function () {
    'use strict';

    /** 高置信度时自动掷骰前给玩家的反悔时间（用户已拍板 1.5 秒） */
    const AUTO_CONFIRM_MS = 1500;
    /** 预览卡片无人理会时自动消失的时间 */
    const PREVIEW_TTL_MS = 30000;
    /** 错误提示停留的时间 */
    const ERROR_TTL_MS = 5000;
    /** 单次录音最长 8 秒，到点自动松手（服务端也按字节数兜了一道） */
    const MAX_RECORD_MS = 8000;

    let ctx = null;             // init 传进来的依赖
    let current = null;         // { intentId, el, timers: [] } 当前这张预览卡片
    let micBtn = null;          // 麦克风按钮
    let partialEl = null;       // 录音中显示实时转写的小条
    let rec = null;             // 录音中的资源 { stream, audioCtx, node, source, timer }
    let starting = false;       // getUserMedia 还没回来（这期间松手要能取消）

    /**
     * 初始化。由 game.html 在主脚本之后调用一次。
     *
     * @param {object} opts
     * @param {object} opts.socket          已连接的 socket.io 客户端
     * @param {HTMLElement} opts.mountEl     挂载点（聊天输入框旁的空容器）
     * @param {boolean} opts.isDM            DM 不用这个功能（没有同名角色卡）
     * @param {() => object|null} opts.getMyCharacter 取「与自己同名的那张角色卡」的 getter；
     *        必须是 getter，因为 myCharacter 会在运行中被重新赋值
     * @param {() => boolean} opts.getEnabled 服务端有没有配 ASR key（joinSuccess 的 voiceRollEnabled）；
     *        同样用 getter，因为 init 时 joinSuccess 还没回来
     * @param {(s: string) => string} opts.escapeHtml 复用 game.html 的转义函数
     */
    function init(opts) {
        ctx = opts;
        if (!ctx || !ctx.socket || !ctx.mountEl) {
            console.error('VoiceRoll.init 缺少 socket 或 mountEl');
            return;
        }

        buildMicButton();

        // voice:intent（Server → Client）只发给说话者本人
        ctx.socket.on('voice:intent', (data) => { hidePartial(); showPreview(data); });
        // voice:error（Server → Client）中文提示，给用户看
        ctx.socket.on('voice:error', (data) => {
            // 服务端在录音途中报错（限流、没配 key、识别失败）时不能继续占着麦克风
            if (rec || starting) teardownRecording();
            hidePartial();
            showError(data && data.message);
        });
        // voice:partial（Server → Client）边说边出的中间结果
        ctx.socket.on('voice:partial', (data) => showPartial(data && data.text));

        refreshAvailability();
    }

    /** 建麦克风按钮（按住说话、松开发送；移动端用 pointer 事件支持触屏长按） */
    function buildMicButton() {
        micBtn = document.createElement('button');
        micBtn.type = 'button';
        micBtn.id = 'vr-mic';
        micBtn.className = 'vr-mic';
        micBtn.innerHTML = '<span class="vr-mic-icon">🎤</span>';

        micBtn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (micBtn.disabled) return;
            // 捕获指针：手指/鼠标滑出按钮范围也还能收到 pointerup，不会漏掉松手
            try { micBtn.setPointerCapture(e.pointerId); } catch { /* 不支持就算了 */ }
            startRecording();
        });
        const release = () => stopRecording();
        micBtn.addEventListener('pointerup', release);
        micBtn.addEventListener('pointercancel', () => abortRecording());
        // 按住时别弹出右键菜单/选中文字
        micBtn.addEventListener('contextmenu', e => e.preventDefault());

        ctx.mountEl.appendChild(micBtn);
    }

    /**
     * 刷新麦克风按钮的可用状态。DM、没有同名角色卡、服务端没配 ASR key 时禁用。
     * game.html 在 myCharacter 变化（角色卡载入 / 未找到）之后要调一次。
     */
    function refreshAvailability() {
        if (!micBtn || !ctx) return;
        let reason = '';
        if (ctx.isDM) reason = 'DM 不需要语音掷骰';
        else if (ctx.getEnabled && !ctx.getEnabled()) reason = '服务端未配置语音识别';
        else if (ctx.getMyCharacter && !ctx.getMyCharacter()) reason = '未找到与你同名的角色卡';

        micBtn.disabled = !!reason;
        micBtn.title = reason || '按住说话：说出你要做的检定';
        micBtn.style.display = ctx.isDM ? 'none' : '';
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

    // ===== 录音 =====

    /**
     * 开始录音：拿麦克风 → AudioWorklet 降采样到 16kHz PCM16 → 每帧发 voice:chunk。
     * getUserMedia 需要 HTTPS 或 localhost；权限被拒时给中文提示。
     */
    async function startRecording() {
        if (rec || starting) return;
        starting = true;
        dismiss();

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });
        } catch (err) {
            starting = false;
            showError(err && err.name === 'NotAllowedError'
                ? '没有麦克风权限，请在浏览器里允许后再试'
                : '打不开麦克风，请检查设备');
            return;
        }

        // 松手比授权还快：把刚拿到的流关掉，什么都不发
        if (!starting) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            await audioCtx.audioWorklet.addModule('/voice-roll/pcm-worklet.js');
            if (!starting) {   // 加载期间松手了
                stream.getTracks().forEach(t => t.stop());
                audioCtx.close();
                return;
            }

            const source = audioCtx.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(audioCtx, 'pcm-worklet');
            node.port.onmessage = (e) => {
                if (!rec || !e.data) return;
                ctx.socket.emit('voice:chunk', e.data.frame);
                setMicLevel(e.data.peak);
            };
            source.connect(node);
            // 不接到 destination：接了会把自己的声音播出来，形成回声

            ctx.socket.emit('voice:start');
            rec = {
                stream, audioCtx, node, source,
                // 到 8 秒自动松手，和服务端的上限对齐
                timer: setTimeout(() => stopRecording(), MAX_RECORD_MS)
            };
            starting = false;
            micBtn.classList.add('recording');
            showPartial('正在听…');
        } catch (err) {
            starting = false;
            console.error('语音掷骰：采集初始化失败', err);
            stream.getTracks().forEach(t => t.stop());
            showError('录音初始化失败，请刷新页面再试');
        }
    }

    /** 释放采集资源（麦克风指示灯要立刻灭掉，别让玩家以为还在录） */
    function teardownRecording() {
        starting = false;
        if (!rec) return;
        clearTimeout(rec.timer);
        try { rec.node.port.onmessage = null; rec.node.disconnect(); rec.source.disconnect(); } catch { /* 忽略 */ }
        try { rec.stream.getTracks().forEach(t => t.stop()); } catch { /* 忽略 */ }
        try { rec.audioCtx.close(); } catch { /* 忽略 */ }
        rec = null;
        if (micBtn) { micBtn.classList.remove('recording'); micBtn.style.removeProperty('--vr-level'); }
    }

    /** 松手：音频发完了，等服务端的识别结果 */
    function stopRecording() {
        if (starting && !rec) { starting = false; return; }   // 还没真正开始就松手了
        if (!rec) return;
        teardownRecording();
        ctx.socket.emit('voice:stop');
        showPartial('识别中…');
    }

    /** 中途放弃（指针被系统取消等），什么都不投 */
    function abortRecording() {
        if (!rec && !starting) return;
        teardownRecording();
        ctx.socket.emit('voice:cancel', {});
        hidePartial();
    }

    /** 按音量给按钮一点波纹反馈 */
    function setMicLevel(peak) {
        if (!micBtn) return;
        const level = Math.min(1, (peak || 0) * 3);
        micBtn.style.setProperty('--vr-level', level.toFixed(2));
    }

    /**
     * 录音中的实时转写条（只有自己看得到）。
     * @param {string} text
     */
    function showPartial(text) {
        if (!ctx || !text) return;
        if (!partialEl) {
            partialEl = document.createElement('div');
            partialEl.className = 'vr-partial';
            ctx.mountEl.appendChild(partialEl);
        }
        partialEl.textContent = text;
    }

    /** 收起实时转写条 */
    function hidePartial() {
        if (partialEl && partialEl.parentNode) partialEl.parentNode.removeChild(partialEl);
        partialEl = null;
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

    window.VoiceRoll = { init, debugText, refreshAvailability };
})();
