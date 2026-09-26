/*
 * AudioWorkletProcessor：把麦克风采到的 Float32 音频降采样成 ASR 要的
 * 16kHz / PCM16 LE / 单声道，按帧 postMessage 回主线程。
 *
 * 负责：降采样、Float32 → Int16、按 ~100ms 攒帧、顺带算一个音量值做波纹动画。
 * 不负责：建 AudioContext、发 socket（都在 voice-roll.js 里）。
 *
 * 谁加载：public/voice-roll/voice-roll.js 里
 *         audioContext.audioWorklet.addModule('/voice-roll/pcm-worklet.js')。
 * 依赖：无（Worklet 全局作用域里没有 window，也拿不到主线程的任何变量）。
 *
 * 设备采样率通常是 48000，ASR 要 16000，所以按整数/小数比例抽样。
 * 这里用线性插值取点：短句掷骰够用，不值得为它引一个重采样库。
 */

const TARGET_RATE = 16000;
const FRAME_MS = 100;
const FRAME_SAMPLES = TARGET_RATE * FRAME_MS / 1000;   // 1600 个采样点 = 3200 字节

class PcmWorklet extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ratio = sampleRate / TARGET_RATE;   // sampleRate 是 Worklet 的全局量
        this.buffer = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
        this.cursor = 0;    // 在输入流里的读取位置（浮点，按 ratio 前进）
        this.peak = 0;
    }

    /**
     * @param {Float32Array[][]} inputs 第一个输入的第一个声道就是麦克风单声道数据
     * @returns {boolean} 返回 true 让节点保持存活
     */
    process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (!ch || ch.length === 0) return true;

        // cursor 是相对于「本次 process 的这块数据」的位置，跨块时保留小数部分
        while (this.cursor < ch.length) {
            const i = Math.floor(this.cursor);
            const s = Math.max(-1, Math.min(1, ch[i]));
            this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            if (Math.abs(s) > this.peak) this.peak = Math.abs(s);

            if (this.filled === FRAME_SAMPLES) {
                // 传 ArrayBuffer 的所有权，避免每帧都复制一份
                const frame = this.buffer.slice().buffer;
                this.port.postMessage({ frame, peak: this.peak }, [frame]);
                this.filled = 0;
                this.peak = 0;
            }
            this.cursor += this.ratio;
        }
        this.cursor -= ch.length;
        return true;
    }
}

registerProcessor('pcm-worklet', PcmWorklet);
