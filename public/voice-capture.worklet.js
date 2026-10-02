/* No network or permissions here: this processor only captures ordered microphone PCM. */
class TrainingVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rate = 24000;
    this.ratio = sampleRate / this.rate;
    this.index = 0;
    this.nextSample = 0;
    this.previous = 0;
    this.chunk = new Int16Array(2400);
    this.offset = 0;
    this.squareSum = 0;
    this.total = 0;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data?.type === 'stop') this.stop();
    };
  }
  emit(value) {
    if (this.total >= 24000 * 480) { this.stop(); this.port.postMessage({ type: 'limit' }); return; }
    const clamped = Math.max(-1, Math.min(1, value));
    this.chunk[this.offset++] = Math.round(clamped * (clamped < 0 ? 32768 : 32767));
    this.squareSum += clamped * clamped;
    this.total++;
    if (this.offset === this.chunk.length) this.flush();
  }
  flush() {
    if (!this.offset) return;
    const pcm = this.chunk.slice(0, this.offset);
    const rms = Math.sqrt(this.squareSum / this.offset);
    const level = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.00001)) + 55) / 55));
    this.port.postMessage({ type: 'pcm', pcm: pcm.buffer, level }, [pcm.buffer]);
    this.offset = 0; this.squareSum = 0;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.flush(); this.port.postMessage({ type: 'stopped' });
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    for (let frame = 0; frame < channels[0].length && !this.stopped; frame++) {
      let value = 0;
      for (const channel of channels) value += channel[frame] || 0;
      value /= channels.length;
      // The context requests 24 kHz. Fractional interpolation preserves continuity
      // if a browser chooses a different hardware-supported context sample rate.
      while (this.nextSample <= this.index && !this.stopped) {
        const fraction = this.index === 0 ? 1 : this.nextSample - (this.index - 1);
        this.emit(this.previous + (value - this.previous) * fraction);
        this.nextSample += this.ratio;
      }
      this.previous = value; this.index++;
    }
    return !this.stopped;
  }
}
registerProcessor('training-voice-capture', TrainingVoiceCapture);
