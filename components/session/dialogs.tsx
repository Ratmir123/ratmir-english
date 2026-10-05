'use client';

import { useRef } from 'react';
import { CheckIcon } from '@phosphor-icons/react';
import { Sheet } from '../ui/sheet';
import { CTA } from '../app/labels';

export type FinishIntent = 'finish' | 'complete' | 'defer';

/**
 * Confirmation before leaving a step. With an unsent draft it offers the real choices instead of a
 * silently disabled button (audit U-03): send and finish, discard and finish, or go back.
 */
export function FinishDialog({ intent, textActivity, hasDraft, onCancel, onConfirm, onSendAndFinish, onDiscardAndConfirm }: {
  intent: FinishIntent | null; textActivity: boolean; hasDraft: boolean;
  onCancel: () => void; onConfirm: () => void; onSendAndFinish: () => void; onDiscardAndConfirm: () => void;
}) {
  const accepted = useRef(false);
  const once = (run: () => void) => () => { if (accepted.current) return; accepted.current = true; run(); setTimeout(() => { accepted.current = false; }, 600); };
  if (!intent) return <Sheet open={false} onClose={onCancel} title="" />;
  const draftTitle = intent === 'finish' ? 'Есть неотправленный ответ' : 'Есть неотправленная попытка';
  const title = hasDraft ? draftTitle : intent === 'finish' ? (textActivity ? 'Перейти к разбору задания?' : 'Закончить разговор?') : intent === 'defer' ? 'На сегодня всё?' : 'Завершить занятие?';
  const detail = hasDraft
    ? intent === 'finish' ? 'Отправь его собеседнику и закончи — или удали черновик. После этого добавить реплики в этот разговор уже не получится.'
      : 'Черновик попытки не будет проверен. Удали его, чтобы завершить, или вернись и проверь попытку.'
    : intent === 'finish' ? `Твои ответы сохранятся, потом будет разбор. ${textActivity ? 'Добавить ответы в это задание' : 'Продолжить этот разговор'} уже не получится.`
      : intent === 'defer' ? 'Сохраним занятие. К новой попытке вернёшься из «Незаконченных» на главной — её успех пока не засчитан.'
        : 'Сохраним разбор и твои попытки. Опыт начисляется только за подтверждённое.';
  return <Sheet open onClose={onCancel} title={title} testId="finish-dialog"
    actions={<>
      {hasDraft && intent === 'finish' && <button type="button" className="button primary large block" data-testid="confirm-send-finish" onClick={once(onSendAndFinish)}>Отправить и закончить<CheckIcon size={18} /></button>}
      {hasDraft && <button type="button" className={`button ${intent === 'finish' ? 'secondary' : 'primary'} large block`} data-testid="confirm-discard-finish" onClick={once(onDiscardAndConfirm)}>
        Удалить черновик и {intent === 'finish' ? 'закончить' : 'завершить'}</button>}
      {!hasDraft && <button type="button" className="button primary large block" data-testid="confirm-finish" onClick={once(onConfirm)}>
        {intent === 'finish' ? 'Получить разбор' : intent === 'defer' ? 'Сохранить и на главную' : CTA.complete}<CheckIcon size={18} /></button>}
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
