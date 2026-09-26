/*
 * 「前情提要」面板前端。
 *
 * 负责：#panel-recap 面板里的全部内容——左 70% 前情正文、右 30% 重要人物表；
 *       DM 视角的录制按钮（点一下开始、再点一下结束）、处理状态、重试 / 清空、手改后同步；
 *       玩家视角只读，没有内容时显示「等待 DM 进行讲述」。
 * 不负责：面板本身的悬浮展开 / 固定 / 拖拽 / 缩放（game.html 的浮动窗口系统管，
 *         面板外壳和左侧「前情」按钮是写在 game.html 里的静态标记）。
 *
 * 谁引入：game.html，在主 <script> 之后引入本文件，然后调用 Recap.init({...})。
 * 依赖：init 传进来的 { socket, mountEl, isDM }；
 *       音频降采样复用语音掷骰的 /voice-roll/pcm-worklet.js（16kHz / PCM16 单声道，每 100ms 一帧）。
 *
 * 用到的 socket 事件（服务端见 lib/recap/index.js）：
 *   recap:fetch / recap:start / recap:chunk / recap:stop / recap:cancel /
 *   recap:retry / recap:update / recap:text（→S）
 *   recap:sync / recap:status（←S）
 */
(function () {
    'use strict';

    /** DM 手改后多久同步一次（和共享笔记的手感一致） */
    const EDIT_DEBOUNCE_MS = 400;
    /** 和服务端 MAX_RECORD_MS 对齐：到点前端自己先结束 */
    const MAX_RECORD_MS = 30 * 60 * 1000;

    const PHASE_TEXT = {
        recording: '录制中…',
        transcribing: '正在整理转写…',
        summarizing: 'AI 正在总结…'
    };

    let ctx = null;
    let data = { brief: '', people: [], updatedAt: null };
    let status = { phase: 'idle', message: '', canRetry: false, asrEnabled: false, llmEnabled: false };
    let els = {};
    let editTimer = null;
    let rec = null;          // { stream, audioCtx, node, source, startedAt, tick, timer }
    let starting = false;    // getUserMedia / worklet 还没就绪

    /**
     * 初始化。由 game.html 在主脚本之后调用一次。
     * @param {object} opts
     * @param {object} opts.socket       已连接的 socket.io 客户端
     * @param {HTMLElement} opts.mountEl  #panel-recap 的 .float-panel-body
     * @param {boolean} opts.isDM         DM 可以录制和编辑，玩家只读
     */
    function init(opts) {
        ctx = opts;
        if (!ctx || !ctx.socket || !ctx.mountEl) {
            console.error('Recap.init 缺少 socket 或 mountEl');
            return;
        }
        buildDom();

        ctx.socket.on('recap:sync', (payload) => {
            if (!payload) return;
            data = {
                brief: payload.brief || '',
                people: Array.isArray(payload.people) ? payload.people : [],
                updatedAt: payload.updatedAt || null
            };
            render();
        });
        ctx.socket.on('recap:status', (payload) => {
            if (!payload) return;
            status = payload;
            // 录音途中服务端已经不在 recording 了（被拒、到时自动结束、识别连续失败）：
            // 麦克风不能继续开着
            if ((rec || starting) && status.phase !== 'recording') teardownRecording();
            renderStatus();
            render();
        });
        // 首次登录和断线重连都会收到 joinSuccess，每次都重新拉一份
        ctx.socket.on('joinSuccess', () => ctx.socket.emit('recap:fetch'));

        render();
        renderStatus();
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function buildDom() {
        const root = el('div', 'rc-root');

        const toolbar = el('div', 'rc-toolbar');
        if (ctx.isDM) {
            els.recBtn = el('button', 'rc-btn rc-rec');
            els.recBtn.type = 'button';
            els.recBtn.addEventListener('click', toggleRecording);
            toolbar.appendChild(els.recBtn);
        }
        els.status = el('span', 'rc-status');
        toolbar.appendChild(els.status);
        if (ctx.isDM) {
            els.retryBtn = el('button', 'rc-btn rc-retry', '重试总结');
            els.retryBtn.type = 'button';
            els.retryBtn.addEventListener('click', () => ctx.socket.emit('recap:retry'));
            els.clearBtn = el('button', 'rc-btn rc-clear', '清空');
            els.clearBtn.type = 'button';
            els.clearBtn.addEventListener('click', clearAll);
            toolbar.append(els.retryBtn, els.clearBtn);
        }
        root.appendChild(toolbar);

        const view = el('div', 'rc-view');
        const left = el('div', 'rc-left');
        if (ctx.isDM) {
            els.brief = el('textarea', 'rc-brief-input');
            els.brief.placeholder = '还没有前情提要。\n\n点「开始录制」，把之前发生的事讲一遍，点「结束录制」后 AI 会整理成前情提要，自动出现在这里。\n\n也可以直接在这里写或修改。';
            els.brief.addEventListener('input', scheduleEdit);
        } else {
            els.brief = el('div', 'rc-brief-text');
        }
        left.appendChild(els.brief);

        const right = el('div', 'rc-right');
        right.appendChild(el('div', 'rc-section-title', '重要人物'));
        els.people = el('div', 'rc-people');
        right.appendChild(els.people);
        if (ctx.isDM) {
            const addBtn = el('button', 'rc-add', '+ 添加人物');
            addBtn.type = 'button';
            addBtn.addEventListener('click', () => {
                data.people.push({ name: '', note: '', known: true });
                renderPeople();
                const inputs = els.people.querySelectorAll('.rc-person-name');
                if (inputs.length) inputs[inputs.length - 1].focus();
                scheduleEdit();
            });
            right.appendChild(addBtn);
        }

        view.append(left, right);
        root.appendChild(view);
        ctx.mountEl.appendChild(root);
    }

    /** 转写 / 总结期间 DM 不能改：结果一回来会整份覆盖，手打的内容会丢 */
    function isBusy() {
        return status.phase === 'transcribing' || status.phase === 'summarizing';
    }

    function render() {
        if (ctx.isDM) {
            if (els.brief.value !== data.brief) els.brief.value = data.brief;
            els.brief.readOnly = isBusy();
            els.brief.classList.toggle('rc-busy', isBusy());
        } else {
            els.brief.textContent = '';
            if (data.brief.trim()) {
                els.brief.textContent = data.brief;
                els.brief.classList.remove('rc-empty');
            } else {
                els.brief.classList.add('rc-empty');
                els.brief.textContent = status.phase === 'recording' ? 'DM 正在讲述前情…'
                    : (isBusy() ? 'DM 讲完了，正在整理前情…' : '等待 DM 进行讲述…');
            }
        }
        renderPeople();
    }

    function renderPeople() {
        els.people.textContent = '';
        const list = ctx.isDM ? data.people : data.people.filter(p => p.name);
        if (!list.length) {
            els.people.appendChild(el('div', 'rc-people-empty', ctx.isDM ? '暂无' : '—'));
            return;
        }
        data.people.forEach((p, i) => {
            if (!ctx.isDM && !p.name) return;
            const row = el('div', 'rc-person');
            if (ctx.isDM) {
                const head = el('div', 'rc-person-head');
                const name = el('input', 'rc-person-name');
                name.value = p.name;
                name.placeholder = '名字';
                name.readOnly = isBusy();
                name.addEventListener('input', () => {
                    p.name = name.value;
                    // DM 亲手改过的名字就算核对过了，「新」标记去掉
                    p.known = true;
                    tag.remove();
                    scheduleEdit();
                });
                const tag = el('span', 'rc-new', '新');
                tag.title = '对照表里没有，是 AI 从讲述里新加的——核对一下写法';
                const del = el('button', 'rc-person-del', '✕');
                del.type = 'button';
                del.title = '删除';
                del.addEventListener('click', () => {
                    if (isBusy()) return;
                    data.people.splice(i, 1);
                    renderPeople();
                    scheduleEdit();
                });
                head.append(name);
                if (p.name && p.known === false) head.append(tag);
                head.append(del);
                const note = el('textarea', 'rc-person-note');
                note.value = p.note || '';
                note.placeholder = '一句话说明';
                note.rows = 1;
                note.readOnly = isBusy();
                note.addEventListener('input', () => {
                    p.note = note.value;
                    autoGrow(note);
                    scheduleEdit();
                });
                row.append(head, note);
                els.people.appendChild(row);
                autoGrow(note);
            } else {
                row.append(el('div', 'rc-person-name-text', p.name));
                if (p.note) row.append(el('div', 'rc-person-note-text', p.note));
                els.people.appendChild(row);
            }
        });
    }

    function autoGrow(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    function renderStatus() {
        const phase = status.phase;
        let text = PHASE_TEXT[phase] || '';
        if (!text && status.message) text = status.message;
        if (ctx.isDM && !text) {
            if (!status.asrEnabled) text = '服务端未配置语音识别，只能手动编辑';
            else if (!status.llmEnabled) text = '服务端未配置 DEEPSEEK_API_KEY，只能手动编辑';
        }
        // 玩家只关心 DM 在不在讲，错误提示是给 DM 的
        if (!ctx.isDM && !PHASE_TEXT[phase]) text = '';
        els.status.textContent = text;
        els.status.classList.toggle('rc-status-busy', !!PHASE_TEXT[phase]);

        if (!ctx.isDM) return;
        const canRecord = status.asrEnabled && status.llmEnabled;
        if (rec || starting) {
            els.recBtn.classList.add('recording');
            updateRecLabel();
        } else {
            els.recBtn.classList.remove('recording');
            els.recBtn.textContent = '● 开始录制';
            els.recBtn.style.removeProperty('--rc-level');
        }
        els.recBtn.disabled = !canRecord || (!rec && !starting && phase !== 'idle');
        els.retryBtn.style.display = status.canRetry && phase === 'idle' ? '' : 'none';
        els.clearBtn.disabled = phase !== 'idle';
    }

    function updateRecLabel() {
        if (!rec) { els.recBtn.textContent = '■ 准备中…'; return; }
        const sec = Math.floor((Date.now() - rec.startedAt) / 1000);
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        els.recBtn.textContent = `■ 结束录制 ${mm}:${ss}`;
    }

    // ===== DM 手改 =====

    function scheduleEdit() {
        clearTimeout(editTimer);
        editTimer = setTimeout(flushEdit, EDIT_DEBOUNCE_MS);
    }

    /** 立刻把手改的内容发出去（开始录制前要先 flush，免得和总结结果打架） */
    function flushEdit() {
        clearTimeout(editTimer);
        editTimer = null;
        if (!ctx.isDM) return;
        data.brief = els.brief.value;
        ctx.socket.emit('recap:update', {
            brief: data.brief,
            people: data.people.map(p => ({ name: p.name, note: p.note }))
        });
    }

    function clearAll() {
        if (!confirm('确定清空前情提要和重要人物表吗？玩家那边也会一起清空。')) return;
        data = { brief: '', people: [], updatedAt: null };
        render();
        flushEdit();
    }

    // ===== 录制 =====

    function toggleRecording() {
        if (rec || starting) stopRecording();
        else startRecording();
    }

    /** 拿麦克风 → AudioWorklet 降采样 → 每帧发 recap:chunk。getUserMedia 需要 HTTPS 或 localhost */
    async function startRecording() {
        if (rec || starting || status.phase !== 'idle') return;
        if (editTimer) flushEdit();
        starting = true;
        renderStatus();

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });
        } catch (err) {
            starting = false;
            status = { ...status, message: err && err.name === 'NotAllowedError'
                ? '没有麦克风权限，请在浏览器里允许后再试'
                : '打不开麦克风，请检查设备' };
            renderStatus();
            return;
        }
        if (!starting) { stream.getTracks().forEach(t => t.stop()); return; }   // 授权期间又点了结束

        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            // 复用语音掷骰的降采样 worklet，两边的音频约定完全一样
            await audioCtx.audioWorklet.addModule('/voice-roll/pcm-worklet.js');
            if (!starting) {
                stream.getTracks().forEach(t => t.stop());
                audioCtx.close();
                return;
            }
            const source = audioCtx.createMediaStreamSource(stream);
            const node = new AudioWorkletNode(audioCtx, 'pcm-worklet');
            node.port.onmessage = (e) => {
                if (!rec || !e.data) return;
                ctx.socket.emit('recap:chunk', e.data.frame);
                const level = Math.min(1, (e.data.peak || 0) * 3);
                els.recBtn.style.setProperty('--rc-level', level.toFixed(2));
            };
            source.connect(node);   // 不接 destination，免得把自己的声音放出来

            ctx.socket.emit('recap:start');
            rec = {
                stream, audioCtx, node, source,
                startedAt: Date.now(),
                tick: setInterval(updateRecLabel, 1000),
                timer: setTimeout(stopRecording, MAX_RECORD_MS)
            };
            starting = false;
            renderStatus();
        } catch (err) {
            starting = false;
            console.error('前情提要：采集初始化失败', err);
            stream.getTracks().forEach(t => t.stop());
            status = { ...status, message: '录音初始化失败，请刷新页面再试' };
            renderStatus();
        }
    }

    /** 释放麦克风（指示灯要立刻灭掉） */
    function teardownRecording() {
        starting = false;
        if (!rec) return;
        clearTimeout(rec.timer);
        clearInterval(rec.tick);
        try { rec.node.port.onmessage = null; rec.node.disconnect(); rec.source.disconnect(); } catch { /* 忽略 */ }
        try { rec.stream.getTracks().forEach(t => t.stop()); } catch { /* 忽略 */ }
        try { rec.audioCtx.close(); } catch { /* 忽略 */ }
        rec = null;
    }

    function stopRecording() {
        if (starting && !rec) { starting = false; renderStatus(); return; }
        if (!rec) return;
        teardownRecording();
        ctx.socket.emit('recap:stop');
        renderStatus();
    }

    /**
     * 调试入口：跳过 ASR，直接拿一段文本去总结。仅 DM 有效。
     * 浏览器控制台里 Recap.debugText('上次大家到了村子……')
     * @param {string} text
     */
    function debugText(text) {
        if (!ctx) return;
        ctx.socket.emit('recap:text', { text: String(text || '') });
    }

    window.Recap = { init, debugText };
})();
