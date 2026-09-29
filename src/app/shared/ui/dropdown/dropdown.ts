import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, input, model, signal } from '@angular/core';

export interface DropdownOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  /** Second line under the label (e.g. a token's full name, a short address). */
  readonly sublabel?: string;
  /** Right-aligned value (e.g. a balance). */
  readonly trailing?: string;
  /** Image URL shown before the label… */
  readonly icon?: string;
  /** …or a letter avatar: CSS background + text. */
  readonly avatar?: { readonly background: string; readonly text: string };
}

/**
 * Dropdown used instead of a native <select>: the browser draws a native
 * select's option list itself (its own width and look), which CSS can't
 * make match the field. This list opens at the field's width, under it,
 * in the app's style. Closes on pick, outside click or Escape.
 */
@Component({
  selector: 'app-dropdown',
  imports: [NgTemplateOutlet],
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.scss',
  host: {
    '(document:click)': 'closeOnOutsideClick($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
})
export class Dropdown<T extends string = string> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input.required<readonly DropdownOption<T>[]>();
  readonly value = model.required<T>();
  /** `id` for the trigger button, so a <label for> can point at it. */
  readonly inputId = input<string>();

  protected readonly open = signal(false);
  protected readonly selected = computed(() =>
    this.options().find((o) => o.value === this.value()),
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected pick(value: T): void {
    this.value.set(value);
    this.open.set(false);
  }

  protected closeOnOutsideClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
