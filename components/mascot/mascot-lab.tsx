'use client';
// Dev-only playground for the jelly mascot (app/mascot-lab). Not linked from the app; 404 in production.
import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOTION_LABELS, MASCOT_EMOTIONS, MASCOT_STATES, STATE_LABELS, type MascotEmotion, type MascotState } from '@/lib/mascot/emotions';
import { Mascot, type MascotHandle, type MascotLevelStore } from './mascot';
import styles from './mascot-lab.module.css';

type LevelStore = MascotLevelStore & { set(value: number): void };
function createLevelStore(): LevelStore {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => value,
    set(next) { value = Math.min(1, Math.max(0, next)); listeners.forEach(listener => listener()); },
  };
}

const GESTURES: readonly [string, string][] = [
  ['Нажми и держи край', 'вмятина ровно под пальцем, тело «вздувается» с другой стороны'],
  ['Нажми в центр', 'сплющивается (squash)'],
  ['Потяни в сторону', 'тянется к курсору, наклоняется, глаза смотрят вдоль'],
  ['Отпусти', 'желейное покачивание ~0,7 с'],
  ['Коснись', 'boing + прыжок; по кругу: подмигнул → хихикнул → рад → удивлён → любопытство'],
  ['4 касания за 2 с', 'смеётся 1,4 с'],
  ['9 касаний за 4 с', 'ворчит, потом смеётся'],
  ['Потряси (3 рывка за 1 с)', 'голова кружится, глаза-спирали'],
  ['Держи 0,6 с', '>_< сжался; отпусти — большой boing и радость'],
  ['Води мышью по окну', 'глаза и блик следят за курсором'],
  ['Tab → Enter / Space', 'та же реакция, без физического «шума»'],
  ['Не трогай 60 с', 'засыпает (zZ); любое действие будит: удивлён → рад'],
];

export function MascotLab() {
  const [state, setState] = useState<MascotState>('idle');
  const [emotion, setEmotion] = useState<MascotEmotion | null>(null);
  const [asReaction, setAsReaction] = useState(false);
  const [mic, setMic] = useState(0);
  const [speech, setSpeech] = useState(0);
  const [fakeSpeech, setFakeSpeech] = useState(false);
  const [fakeMic, setFakeMic] = useState(false);
  const [size, setSize] = useState(300);
  const [celebrate, setCelebrate] = useState(0);
  const [shown, setShown] = useState<[MascotEmotion, MascotEmotion]>(['calm', 'calm']);
  const micStore = useMemo(createLevelStore, []);
  const speechStore = useMemo(createLevelStore, []);
  const light = useRef<MascotHandle>(null);
  const dark = useRef<MascotHandle>(null);

  useEffect(() => { if (!fakeMic) micStore.set(mic); }, [mic, fakeMic, micStore]);
  useEffect(() => { if (!fakeSpeech) speechStore.set(speech); }, [speech, fakeSpeech, speechStore]);

  // A syllable-like envelope (≈5 syllables/s with word gaps) to test lip-sync without audio or any API.
  useEffect(() => {
    if (!fakeSpeech && !fakeMic) return;
    let frame = 0, syllableStart = 0, syllableLength = 0.16, gap = 0.06, peak = 0.8, start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      if (fakeSpeech) {
        let local = t - syllableStart;
        if (local > syllableLength + gap) {
          syllableStart = t; local = 0;
          syllableLength = 0.09 + Math.random() * 0.13;
          gap = Math.random() < 0.18 ? 0.22 + Math.random() * 0.2 : 0.02 + Math.random() * 0.07;
          peak = 0.45 + Math.random() * 0.55;
        }
        const shape = local < syllableLength ? Math.sin(Math.PI * local / syllableLength) : 0;
        speechStore.set(peak * Math.pow(shape, 0.7) + Math.random() * 0.03);
      }
      if (fakeMic) micStore.set(0.25 + 0.35 * Math.abs(Math.sin(t * 5.3)) * (0.6 + 0.4 * Math.sin(t * 1.7)) + Math.random() * 0.12);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); speechStore.set(speech); micStore.set(mic); };
    // Slider values are applied by the effects above when the oscillators stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fakeSpeech, fakeMic, speechStore, micStore]);

  function pick(value: MascotEmotion | null) {
    if (value && asReaction) { light.current?.play(value, 1.6); dark.current?.play(value, 1.6); return; }
    setEmotion(value);
  }
  function toggleSpeech() {
    const next = !fakeSpeech;
    setFakeSpeech(next);
    if (next) setState('speaking');
  }
  function toggleMic() {
    const next = !fakeMic;
    setFakeMic(next);
    if (next) setState('listening');
  }
  const common = {
    state, emotion: emotion ?? undefined, micLevelStore: micStore, speechLevelStore: speechStore, size, celebrate, exclusive: false,
    statusDescription: emotion ? EMOTION_LABELS[emotion] : STATE_LABELS[state],
  } as const;

  return <main className={styles.lab}>
    <header className={styles.header}>
      <div><span className={styles.kicker}>DEV · MASCOT LAB</span><h1>Желейный собеседник</h1>
        <p>Физика, лицо и эмоции по <code>planning/v05/MASCOT-SPEC.md</code>. Страница доступна только в режиме разработки.</p></div>
    </header>

    <section className={styles.stages} aria-label="Сцены">
      <div className={styles.stageLight}>
        <span className={styles.badge}>Светлая · {EMOTION_LABELS[shown[0]]} <code>{shown[0]}</code></span>
        <Mascot {...common} theme="light" handleRef={light} onEmotionChange={value => setShown(current => [value, current[1]])} />
      </div>
      <div className={styles.stageDark}>
        <span className={styles.badge}>Тёмная · {EMOTION_LABELS[shown[1]]} <code>{shown[1]}</code></span>
        <Mascot {...common} theme="dark" handleRef={dark} onEmotionChange={value => setShown(current => [current[0], value])} />
      </div>
    </section>

    <section className={styles.panel} aria-label="Управление">
      <div className={styles.group}>
        <h2>Состояние</h2>
        <div className={styles.row}>{MASCOT_STATES.map(value => <button key={value} type="button" aria-pressed={state === value} onClick={() => setState(value)}>{value}</button>)}</div>
      </div>
      <div className={styles.group}>
        <h2>Эмоция <label className={styles.inline}><input type="checkbox" checked={asReaction} onChange={event => setAsReaction(event.target.checked)} /> проиграть как реакцию (1,6 с)</label></h2>
        <div className={styles.row}>
          <button type="button" aria-pressed={emotion === null} onClick={() => pick(null)}>auto</button>
          {MASCOT_EMOTIONS.map(value => <button key={value} type="button" aria-pressed={emotion === value} onClick={() => pick(value)} title={EMOTION_LABELS[value]}>{value}</button>)}
        </div>
      </div>
      <div className={styles.grid}>
        <label className={styles.slider}><span>Микрофон {fakeMic ? '(осциллятор)' : mic.toFixed(2)}</span>
          <input type="range" min="0" max="1" step="0.01" value={mic} disabled={fakeMic} onChange={event => setMic(Number(event.target.value))} /></label>
        <label className={styles.slider}><span>Речь собеседника {fakeSpeech ? '(осциллятор)' : speech.toFixed(2)}</span>
          <input type="range" min="0" max="1" step="0.01" value={speech} disabled={fakeSpeech} onChange={event => setSpeech(Number(event.target.value))} /></label>
        <label className={styles.slider}><span>Размер {size}px</span>
          <input type="range" min="120" max="380" step="10" value={size} onChange={event => setSize(Number(event.target.value))} /></label>
      </div>
      <div className={styles.row}>
        <button type="button" aria-pressed={fakeSpeech} onClick={toggleSpeech}>{fakeSpeech ? 'Стоп речь' : 'Фейковая речь (lip-sync)'}</button>
        <button type="button" aria-pressed={fakeMic} onClick={toggleMic}>{fakeMic ? 'Стоп микрофон' : 'Фейковый микрофон'}</button>
        <button type="button" onClick={() => setCelebrate(value => value + 1)}>Праздник (joy + конфетти)</button>
        <button type="button" onClick={() => { light.current?.greet(); dark.current?.greet(); }}>Приветствие</button>
        <button type="button" onClick={() => { light.current?.tap(); dark.current?.tap(); }}>Тап</button>
        <button type="button" onClick={() => { light.current?.play('sleepy', 3); dark.current?.play('sleepy', 3); }}>Сон (3 с)</button>
      </div>
    </section>

    <section className={styles.columns}>
      <div className={styles.panel}>
        <h2>Жесты</h2>
        <ul className={styles.gestures}>{GESTURES.map(([gesture, effect]) => <li key={gesture}><strong>{gesture}</strong><span>{effect}</span></li>)}</ul>
      </div>
      <div className={styles.panel}>
        <h2>Все эмоции (статичная поза, один общий WebGL-контекст)</h2>
        <div className={styles.gallery}>
          {MASCOT_EMOTIONS.map(value => <figure key={value}>
            <Mascot still interactive={false} emotion={value} size={96} statusDescription={EMOTION_LABELS[value]} />
            <figcaption>{value}</figcaption>
          </figure>)}
        </div>
        <div className={styles.galleryDark}>
          {MASCOT_EMOTIONS.map(value => <figure key={value}>
            <Mascot still interactive={false} emotion={value} size={96} theme="dark" statusDescription={EMOTION_LABELS[value]} />
            <figcaption>{value}</figcaption>
          </figure>)}
        </div>
      </div>
    </section>
  </main>;
}
