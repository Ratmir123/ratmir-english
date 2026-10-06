'use client';

import { useRef } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { Sheet } from '../ui/sheet';
import { CTA } from '../app/labels';

export type FinishIntent = 'finish' | 'complete' | 'defer';

/**
 * Finishing asks only when something unsent would be lost (MOTION-PASS-0.5.2 §8.5): a draft reply or attempt. It offers
 * the real choices instead of a silently disabled button (audit U-03): send and finish, discard and go on, or go back.
 * Without a draft the step simply happens — no «Закончить разговор?» / «Завершить занятие?».
 */
export function FinishDialog({ intent, textActivity, onCancel, onSendAndFinish, onDiscardAndConfirm }: {
  intent: FinishIntent | null; textActivity: boolean;
  onCancel: () => void; onSendAndFinish?: () => void; onDiscardAndConfirm: () => void;
}) {
  const accepted = useRef(false);
  const once = (run: () => void) => () => { if (accepted.current) return; accepted.current = true; run(); setTimeout(() => { accepted.current = false; }, 600); };
  if (!intent) return <Sheet open={false} onClose={onCancel} title="" />;
  const title = intent === 'finish' ? (textActivity ? 'Есть неотправленный текст' : 'Есть неотправленный ответ') : 'Есть неотправленная попытка';
  const detail = intent === 'finish'
    ? `Отправь его и получи разбор — или удали черновик. После этого ${textActivity ? 'добавить ответы в это задание' : 'добавить реплики в этот разговор'} уже не получится.`
    : intent === 'defer' ? 'Черновик попытки не будет проверен. Удали его, чтобы отложить попытку, или вернись и проверь её.'
      : 'Черновик попытки не будет проверен. Удали его, чтобы завершить занятие, или вернись и проверь попытку.';
  const discard = intent === 'finish' ? 'Удалить черновик и закончить' : intent === 'defer' ? 'Удалить черновик и отложить' : 'Удалить черновик и завершить';
  return <Sheet open onClose={onCancel} title={title} testId="finish-dialog"
    actions={<>
      {intent === 'finish' && onSendAndFinish && <button type="button" className="button primary large block" data-testid="confirm-send-finish" onClick={once(onSendAndFinish)}>Отправить и закончить<CheckIcon size={18} /></button>}
      <button type="button" className={`button ${intent === 'finish' ? 'secondary' : 'primary'} large block`} data-testid="confirm-discard-finish" onClick={once(onDiscardAndConfirm)}>{discard}</button>
      <button type="button" className="button secondary block" autoFocus onClick={onCancel}>{CTA.back}</button>
    </>}>
    <p className="muted">{detail}</p>
  </Sheet>;
}

/** A transcript correction re-runs the review; say exactly what is lost before doing it (audit U-05). */
export function EditConfirmDialog({ open, disputed, retries, completed, onCancel, onConfirm, reanalyse = false }: {
  open: boolean; disputed: boolean; retries: number; completed: boolean; onCancel: () => void; onConfirm: () => void; reanalyse?: boolean;
}) {
  const lost = [
    'разбор будет пересчитан заново',
    retries > 0 ? `улучшенные попытки (${retries}) удалятся` : null,
    completed ? 'отметка «завершено» снимется, опыт за занятие пересчитается' : null,
  ].filter(Boolean).join('; ');
  return <Sheet open={open} onClose={onCancel} title={disputed ? 'Исключить реплику как спорную?' : 'Пересчитать разбор?'} subtitle={reanalyse ? 'Повторный разбор' : 'Исправление расшифровки'} testId="edit-confirm"
    actions={<>
      <button type="button" className="button primary large block" data-testid="confirm-edit" onClick={onConfirm}>{reanalyse ? 'Пересчитать' : disputed ? 'Исключить и пересчитать' : 'Сохранить и пересчитать'}</button>
      <button type="button" className="button secondary block" autoFocus onClick={onCancel}>{CTA.back}</button>
    </>}>
    <p className="muted">{reanalyse ? 'При пересчёте' : 'После исправления'} {lost}.</p>
  </Sheet>;
}
