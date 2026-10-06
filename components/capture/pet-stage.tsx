'use client';

/*
 * The PC chubrik that lives on the screen (planning/v05/PASS-0.5.4.md §2). The 0.5.4 shell reports `quickStyle: 'pet'`: the
 * quick window is a transparent tool window over the work area, clicks pass through everything but the chubrik, its card, its
 * recording pill and its menu (`setClickThrough`). Drag it anywhere — it follows the cursor, a release with speed throws it, it
 * glides and bounces off the edges, and the stage motion feeds its jelly (`MascotHandle.carry`). Left click opens or folds its
 * card (or stops a recording), right click opens its menu, and only «Закрыть» there hides it. The hotkey and the tray summon
 * it (`onSummon`): the card opens with the field focused. It never closes on its own.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AppWindowIcon, ChatTeardropTextIcon, EarIcon, ListChecksIcon, StopIcon, XIcon } from '@phosphor-icons/react';
import { shortcutHint } from '@/lib/phrases/labels';
import type { DesktopStatus } from '../desktop-bridge';
import { Companion, type MascotEmotion, type MascotHandle } from '../shell/companion';
import { EASE_EXIT, EASE_OUT, MOTION_MS, prefersReducedMotion } from '../ui/motion';
import { CaptureCard, captureEmotion, listenEmotion } from './capture-card';
import { ListenPill } from './listen-view';
import { PET, clampPet, glideStep, petFractions, placeCard, placeMenu, releaseSpeed, restorePet, type Glide, type Point, type Side, type Size } from './pet-motion';
import type { Capture } from './use-capture';
import { useListen } from './use-listen';
import styles from './pet-stage.module.css';

type Drag = { id: number; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean; target: Point; samples: Array<[number, number, number]> };
type Motion = {
  drag: Drag | null; glide: Glide | null; frame: number; last: number;
  /** Smoothed stage velocity (px/s) and acceleration (px/s²) that feed the jelly. */
  vx: number; vy: number; ax: number; ay: number;
  /** The fastest bounce of the current throw (a hard one makes it dizzy). */
  impact: number;
};
type Placed = { size: Size | null; side: Side | null };

const bouncy = () => getComputedStyle(document.documentElement).getPropertyValue('--spring-bouncy').trim() || EASE_OUT;
const stageArea = () => ({ width: window.innerWidth, height: window.innerHeight });

function readSaved(): unknown {
  try { return JSON.parse(localStorage.getItem(PET.storageKey) ?? 'null'); } catch { return null; }
}
function writeSaved(point: Point) {
  try { localStorage.setItem(PET.storageKey, JSON.stringify(petFractions(point, stageArea()))); } catch { /* private storage: it starts bottom-right next time */ }
}

export function PetStage({ capture, status }: { capture: Capture; status: DesktopStatus | null }) {
  const listen = useListen({ source: 'system', origin: 'desktop' });
  const root = useRef<HTMLDivElement>(null);
  const pet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const cardBox = useRef<HTMLDivElement>(null);
  const pillBox = useRef<HTMLDivElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const mascot = useRef<MascotHandle>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<Point | null>(null);
  const [carried, setCarried] = useState(false);
  const phase = useRef<'hidden' | 'shown' | 'leaving'>('hidden');
  const position = useRef<Point>({ x: 0, y: 0 });
  const motion = useRef<Motion>({ drag: null, glide: null, frame: 0, last: 0, vx: 0, vy: 0, ax: 0, ay: 0, impact: 0 });
  const card = useRef<Placed>({ size: null, side: null });
  const pill = useRef<Placed>({ size: null, side: null });
  const ignoring = useRef<boolean | null>(null);
  const live = useRef({ open, menu, listen, capture });
  live.current = { open, menu, listen, capture };
  const recording = listen.phase === 'starting' || listen.phase === 'recording';
  const showCard = open && !recording;

  // ── Click-through: only the chubrik, its card, pill and menu catch the mouse ──
  const passThrough = useCallback((ignore: boolean) => {
    if (ignoring.current === ignore) return;
    ignoring.current = ignore;
    void window.ratmirDesktop?.setClickThrough?.(ignore)?.catch(() => undefined);
  }, []);
  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      passThrough(!(target?.closest('[data-hit]') || live.current.menu || motion.current.drag));
    };
    document.addEventListener('pointermove', onMove, true);
    return () => document.removeEventListener('pointermove', onMove, true);
  }, [passThrough]);

  // ── Layout: the chubrik at its point, the card and the pill above or below it (transform only) ──
  const layout = useCallback(() => {
    const element = pet.current;
    if (!element) return;
    const point = position.current, area = stageArea();
    element.style.transform = `translate3d(${(point.x - PET.size / 2).toFixed(1)}px, ${(point.y - PET.size / 2).toFixed(1)}px, 0)`;
    for (const [box, placed] of [[cardBox, card], [pillBox, pill]] as const) {
      const target = box.current;
      if (!target || !placed.current.size) continue;
      const place = placeCard(point, placed.current.size, area, placed.current.side);
      if (place.side !== placed.current.side) { placed.current.side = place.side; target.dataset.petSide = place.side; }
      target.style.transform = `translate3d(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px, 0)`;
      target.style.setProperty('--tail-x', `${place.tailX.toFixed(1)}px`);
      target.style.setProperty('--card-max', `${Math.floor(place.maxHeight)}px`);
    }
  }, []);

  // The card grows out of its tail, the pill out of the chubrik (transform-origin follows --tail-x, pet-stage.module.css).
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    for (const [box, shown] of [[cardBox, showCard], [pillBox, recording]] as const) {
      const inner = box.current?.firstElementChild as HTMLElement | null;
      if (shown && inner) inner.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: MOTION_MS.reveal, easing: EASE_OUT });
    }
  }, [showCard, recording]);

  // The card and the pill report their size (content changes, the field grows); the first report places them.
  useLayoutEffect(() => {
    const observed: Array<[HTMLDivElement | null, typeof card]> = [[cardBox.current, card], [pillBox.current, pill]];
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const placed = entry.target === cardBox.current ? card : pill;
        const box = entry.borderBoxSize?.[0];
        placed.current.size = box ? { width: box.inlineSize, height: box.blockSize } : { width: entry.contentRect.width, height: entry.contentRect.height };
      }
      layout();
    });
    for (const [element, placed] of observed) {
      if (!element) { placed.current = { size: null, side: null }; continue; }
      placed.current.size = { width: element.offsetWidth, height: element.offsetHeight };
      observer.observe(element);
    }
    layout();
    return () => observer.disconnect();
  }, [showCard, recording, layout]);

  // ── Motion loop: runs only while dragged, gliding or ringing out ──
  const frame = useCallback(function tick(now: number) {
    const state = motion.current;
    state.frame = 0;
    const dt = state.last ? Math.min(0.05, Math.max(0.001, (now - state.last) / 1000)) : 1 / 60;
    state.last = now;
    const before = position.current;
    let next = before;
    if (state.drag?.moved) next = state.drag.target;
    else if (state.glide) {
      const step = glideStep(state.glide, dt, stageArea());
      if (step.bounced) state.impact = Math.max(state.impact, Math.hypot(state.glide.vx, state.glide.vy) / PET.restitution);
      next = { x: state.glide.x, y: state.glide.y };
      if (step.done) {
        state.glide = null;
        writeSaved(next);
        setCarried(false);
        mascot.current?.play(state.impact > 1300 ? 'dizzy' : 'happy', state.impact > 1300 ? 1.2 : 0.8);
        state.impact = 0;
      }
    }
    position.current = next;
    // The stage's own velocity and acceleration, smoothed (pointer events are uneven), push the jelly.
    const vx = (next.x - before.x) / dt, vy = (next.y - before.y) / dt;
    const ax = (vx - state.vx) / dt, ay = (vy - state.vy) / dt;
    state.vx += (vx - state.vx) * 0.5; state.vy += (vy - state.vy) * 0.5;
    state.ax += (ax * 0.5 - state.ax) * 0.4; state.ay += (ay * 0.5 - state.ay) * 0.4;
    layout();
    const moving = !!state.drag?.moved || !!state.glide || Math.hypot(state.vx, state.vy) > 2 || Math.hypot(state.ax, state.ay) > 40;
    if (moving) {
      if (!prefersReducedMotion()) mascot.current?.carry(state.vx, state.vy, state.ax, state.ay);
      state.frame = requestAnimationFrame(tick);
    } else {
      mascot.current?.carry(0, 0, 0, 0);
      state.vx = state.vy = state.ax = state.ay = 0; state.last = 0;
    }
  }, [layout]);
  const run = useCallback(() => { if (!motion.current.frame) motion.current.frame = requestAnimationFrame(frame); }, [frame]);

  // ── Position: remembered, kept on the stage when the display changes ──
  useLayoutEffect(() => {
    position.current = restorePet(readSaved(), stageArea());
    layout();
    const onResize = () => {
      const state = motion.current;
      if (state.glide) state.glide = null;
      position.current = restorePet(readSaved(), stageArea());
      layout();
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(motion.current.frame); motion.current.frame = 0; };
  }, [layout]);

  // ── Appearing, summons, leaving ──
  const focusField = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => field.current?.focus({ preventScroll: true })));
  }, []);
  const enter = useCallback(() => {
    const element = root.current, chubrik = body.current;
    if (!element || phase.current === 'shown') return;
    phase.current = 'shown';
    element.dataset.phase = 'shown';
    ignoring.current = null;
    passThrough(true);
    position.current = clampPet(position.current, stageArea());
    layout();
    if (!chubrik) return;
    if (prefersReducedMotion()) chubrik.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    else {
      try { chubrik.animate([{ opacity: 0, transform: 'translate3d(0, 34%, 0) scale(.3)' }, { opacity: 1, transform: 'none' }], { duration: MOTION_MS.bouncy, easing: bouncy() }); }
      catch { chubrik.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }], { duration: MOTION_MS.bouncy, easing: EASE_OUT }); }
    }
  }, [layout, passThrough]);
  const summon = useCallback(() => {
    if (phase.current !== 'shown') enter();
    setMenu(null);
    const current = live.current;
    if (current.listen.phase === 'starting' || current.listen.phase === 'recording') return;
    // A fresh field for the next thing to remember (an unsaved text stays); a finished «Послушать» result gives way too.
    if (current.capture.saved) current.capture.reset();
    if (current.listen.phase === 'ready' || current.listen.phase === 'failed') current.listen.reset();
    setOpen(true);
    focusField();
  }, [enter, focusField]);
  const leave = useCallback(async () => {
    const element = root.current, chubrik = body.current;
    if (!element || phase.current !== 'shown') return;
    phase.current = 'leaving';
    setMenu(null);
    const current = live.current.listen;
    if (current.phase === 'starting' || current.phase === 'recording') current.cancel();
    const animations = [chubrik, cardBox.current, pillBox.current].filter((item): item is HTMLDivElement => !!item).map((item, index) =>
      item.animate(prefersReducedMotion()
        ? [{ opacity: 1 }, { opacity: 0 }]
        : index === 0 ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0, 24%, 0) scale(.3)' }] : [{ opacity: 1 }, { opacity: 0 }],
      { duration: index === 0 ? 260 : 160, easing: EASE_EXIT, fill: 'forwards' }));
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    if (phase.current !== 'leaving') { animations.forEach(animation => animation.cancel()); return; }
    setOpen(false);
    await window.ratmirDesktop?.hideQuick().catch(() => undefined);
    animations.forEach(animation => animation.cancel());
  }, []);

  useLayoutEffect(() => { if (root.current && phase.current === 'hidden') root.current.dataset.phase = 'hidden'; }, []);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { if (phase.current !== 'shown') enter(); return; }
      phase.current = 'hidden';
      if (root.current) root.current.dataset.phase = 'hidden';
      setMenu(null);
      const state = motion.current;
      state.drag = null; state.glide = null;
      cancelAnimationFrame(state.frame); state.frame = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = window.ratmirDesktop?.onSummon?.(summon) ?? (() => {});
    if (document.visibilityState === 'visible') enter();
    return () => { document.removeEventListener('visibilitychange', onVisibility); unsubscribe(); };
  }, [enter, summon]);

  // A finished recording opens the card on its result (it was folded into the pill meanwhile).
  useEffect(() => { if (listen.phase === 'uploading') setOpen(true); }, [listen.phase]);

  // ── Menu ──
  const openMenu = useCallback((point: Point) => {
    passThrough(false);
    setMenu(point);
  }, [passThrough]);
  const closeMenu = useCallback(() => { setMenu(null); passThrough(true); }, [passThrough]);
  useLayoutEffect(() => {
    const element = menuBox.current;
    if (!menu || !element) return;
    const place = placeMenu(menu, { width: element.offsetWidth, height: element.offsetHeight }, stageArea());
    element.style.left = `${place.x}px`; element.style.top = `${place.y}px`;
    element.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    // The stage catches every click while the menu is open: one outside it closes the menu.
    const onDown = (event: globalThis.PointerEvent) => { if (!(event.target instanceof Element && event.target.closest('[role="menu"]'))) closeMenu(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', closeMenu);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('blur', closeMenu); };
  }, [menu, closeMenu]);
  const choose = (action: () => void) => () => { closeMenu(); action(); };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuBox.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (event.key === 'Tab') event.preventDefault();
  };

  // ── Keyboard: Esc closes the menu, then folds the card; it never hides the chubrik ──
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      if (live.current.menu) { closeMenu(); pet.current?.focus({ preventScroll: true }); return; }
      if (live.current.open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeMenu]);

  // ── The chubrik under the pointer ──
  const toggle = () => {
    const current = live.current.listen;
    if (current.phase === 'recording') { current.stop(); return; }
    if (current.phase === 'starting') return;
    mascot.current?.tap();
    setOpen(value => {
      if (!value) focusField();
      return !value;
    });
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || phase.current !== 'shown') return;
    const state = motion.current;
    state.glide = null;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    const point = position.current;
    state.drag = { id: event.pointerId, offsetX: event.clientX - point.x, offsetY: event.clientY - point.y, startX: event.clientX, startY: event.clientY,
      moved: false, target: point, samples: [[event.timeStamp, point.x, point.y]] };
    passThrough(false);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = motion.current.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < PET.dragThreshold) return;
      drag.moved = true;
      setCarried(true);
      setMenu(null);
      mascot.current?.play('surprised', 0.45);
    }
    drag.target = clampPet({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }, stageArea());
    drag.samples.push([event.timeStamp, drag.target.x, drag.target.y]);
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0][0] > PET.sampleMs * 2) drag.samples.shift();
    run();
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = motion.current, drag = state.drag;
    if (!drag || drag.id !== event.pointerId) return;
    state.drag = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* released */ }
    if (!drag.moved) { if (event.type === 'pointerup') toggle(); return; }
    position.current = drag.target;
    const speed = event.type === 'pointerup' && !prefersReducedMotion() ? releaseSpeed(drag.samples, event.timeStamp) : { x: 0, y: 0 };
    state.glide = { x: drag.target.x, y: drag.target.y, vx: speed.x, vy: speed.y };
    state.impact = 0;
    run();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); return; }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      openMenu({ x: position.current.x, y: position.current.y });
      return;
    }
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const distance = event.shiftKey ? 120 : 24;
    position.current = clampPet({ x: position.current.x + step[0] * distance, y: position.current.y + step[1] * distance }, stageArea());
    layout();
    writeSaved(position.current);
  };

  const emotion: MascotEmotion | undefined = carried ? 'joy'
    : listen.phase !== 'idle' && listen.phase !== 'recording' ? listenEmotion(listen)
    : showCard ? captureEmotion(capture) : undefined;
  const hint = shortcutHint(status);
  return <div ref={root} className={styles.stage} data-testid="pet-stage">
    <div ref={pet} className={styles.pet} data-hit data-carried={carried || undefined} tabIndex={0} role="button"
      aria-label="Чубрик. Нажми, чтобы открыть карточку, перетащи, чтобы переместить, правая кнопка — меню"
      aria-haspopup="menu" aria-expanded={showCard}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onContextMenu={event => { event.preventDefault(); openMenu({ x: event.clientX, y: event.clientY }); }} onKeyDown={onKeyDown}
      data-testid="pet">
      <div ref={body} className={styles.body}>
        <Companion state={listen.phase === 'recording' ? 'listening' : 'idle'} micLevelStore={listen.phase === 'recording' ? listen.levelStore : undefined}
          emotion={emotion} size={PET.size} interactive={false} decorative exclusive={false} handleRef={mascot} />
      </div>
    </div>
    {showCard && <div ref={cardBox} className={styles.card} data-hit data-pet-side={card.current.side ?? 'above'}>
      <CaptureCard variant="pet" capture={capture} listen={listen} fieldRef={field} hint={hint} companion={{ box: pet, handle: mascot }}
        onClose={() => setOpen(false)}
        onOpenPhrases={() => void window.ratmirDesktop?.openTraining('phrases').catch(() => undefined)} />
    </div>}
    {recording && <div ref={pillBox} className={styles.pillBox} data-hit data-pet-side={pill.current.side ?? 'above'}>
      <ListenPill listen={listen} />
    </div>}
    {menu && <div ref={menuBox} className={styles.menu} data-hit role="menu" aria-label="Чубрик" onKeyDown={onMenuKey}>
      <button type="button" role="menuitem" onClick={choose(() => { if (live.current.listen.phase === 'idle' || live.current.listen.phase === 'ready' || live.current.listen.phase === 'failed') live.current.listen.reset(); setOpen(true); focusField(); })}>
        <ChatTeardropTextIcon size={18} aria-hidden="true" />Запомнить фразу</button>
      {recording
        ? <button type="button" role="menuitem" onClick={choose(() => live.current.listen.stop())}><StopIcon size={18} aria-hidden="true" />Остановить запись</button>
        : <button type="button" role="menuitem" disabled={listen.busy} onClick={choose(() => void live.current.listen.start())}><EarIcon size={18} aria-hidden="true" />Послушать</button>}
      <button type="button" role="menuitem" onClick={choose(() => void window.ratmirDesktop?.openTraining('phrases').catch(() => undefined))}>
        <ListChecksIcon size={18} aria-hidden="true" />Мои фразы</button>
      <button type="button" role="menuitem" onClick={choose(() => void window.ratmirDesktop?.openTraining().catch(() => undefined))}>
        <AppWindowIcon size={18} aria-hidden="true" />Открыть Smooth Talk</button>
      <hr aria-hidden="true" />
      <button type="button" role="menuitem" className={styles.danger} onClick={choose(() => void leave())} data-testid="pet-close">
        <XIcon size={18} aria-hidden="true" />Закрыть</button>
      {status && <p className={styles.menuHint}>{status.shortcutRegistered && status.shortcut ? `${status.shortcut} — позвать снова` : 'Позвать снова — из значка в трее'}</p>}
    </div>}
  </div>;
}
