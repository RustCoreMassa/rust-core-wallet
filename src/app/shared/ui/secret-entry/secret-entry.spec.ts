import { TestBed } from '@angular/core/testing';
import { UNLOCK_SECRET, UnlockSecret } from '../../../core/platform/unlock-secret';
import { SecretEntry } from './secret-entry';

function setup(kind: UnlockSecret) {
  TestBed.configureTestingModule({ providers: [{ provide: UNLOCK_SECRET, useValue: kind }] });
  const fixture = TestBed.createComponent(SecretEntry);
  const submitted: string[] = [];
  fixture.componentInstance.submitted.subscribe((secret) => submitted.push(secret));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, submitted };
}

describe('SecretEntry', () => {
  it('PIN: submits on the 6th digit, ignores more, and clears', () => {
    const { fixture, el, submitted } = setup('pin');
    const key = (k: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.key')].find((b) => b.textContent?.trim() === k)!;
    for (const k of ['1', '2', '3', '4', '5']) key(k).click();
    expect(submitted).toEqual([]);
    key('6').click();
    key('7').click();
    expect(submitted).toEqual(['123456']);

    fixture.componentInstance.clear();
    fixture.detectChanges();
    expect(el.querySelectorAll('.pin-dot.filled').length).toBe(0);
  });

  it('password: submits the typed password, never an empty one', () => {
    const { fixture, el, submitted } = setup('password');
    const input = el.querySelector<HTMLInputElement>('input')!;
    const form = el.querySelector('form')!;
    expect(input.type).toBe('password');
    expect(el.querySelector('.key')).toBeNull();

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(submitted).toEqual([]);

    input.value = 'correct horse battery';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(submitted).toEqual(['correct horse battery']);

    fixture.componentInstance.clear();
    fixture.detectChanges();
    expect(input.value).toBe('');
  });

  it('password: ignores submits while busy and can show the password', () => {
    const { fixture, el, submitted } = setup('password');
    fixture.componentRef.setInput('busy', true);
    const input = el.querySelector<HTMLInputElement>('input')!;
    input.value = 'correct horse battery';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(submitted).toEqual([]);

    el.querySelector<HTMLButtonElement>('.reveal')!.click();
    fixture.detectChanges();
    expect(input.type).toBe('text');
  });
});
