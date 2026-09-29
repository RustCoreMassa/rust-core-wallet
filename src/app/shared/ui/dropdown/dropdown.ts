import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

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

/** Gap between the field and the list, and the list's height cap (px). */
const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 260;
/** Keep the list this far from the viewport edges (px). */
const VIEWPORT_MARGIN = 12;

interface MenuPosition {
  readonly left: number;
  readonly width: number;
  /** Exactly one of top/bottom is set: below the field, or above it. */
  readonly top: number | null;
  readonly bottom: number | null;
  readonly maxHeight: number;
}

/**
 * Dropdown used instead of a native <select>: the browser draws a native
 * select's option list itself (its own width and look), which CSS can't
 * make match the field. This list opens at the field's width, in the app's
 * style. Closes on pick, outside click or Escape.
 *
 * The list is `position: fixed` at the field's on-screen coordinates, so it
 * floats above everything instead of stretching a scrollable parent (a modal)
 * and giving it a scrollbar. It opens upward when there's more room above
 * the field than below. Since a fixed list wouldn't follow the field, any
 * scroll or resize closes it.
 */
@Component({
  selector: 'app-dropdown',
  imports: [NgTemplateOutlet],
  templateUrl: './dropdown.html',
  styleUrl: './dropdown.scss',
  host: {
    '(document:click)': 'closeOnOutsideClick($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class Dropdown<T extends string = string> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');

  readonly options = input.required<readonly DropdownOption<T>[]>();
  readonly value = model.required<T>();
  /** `id` for the trigger button, so a <label for> can point at it. */
  readonly inputId = input<string>();

  protected readonly open = signal(false);
  protected readonly position = signal<MenuPosition | null>(null);
  protected readonly selected = computed(() =>
    this.options().find((o) => o.value === this.value()),
  );

  constructor() {
    // Capture phase: scroll events don't bubble, and any scrolling ancestor
    // (the modal, the page) moves the field away from the fixed list.
    const onScroll = (event: Event) => {
      const menu = this.host.nativeElement.querySelector('.dropdown-menu');
      if (this.open() && !menu?.contains(event.target as Node)) this.close();
    };
    const onResize = () => this.close();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.position.set(this.measure());
    this.open.set(true);
  }

  protected pick(value: T): void {
    this.value.set(value);
    this.close();
  }

  protected close(): void {
    this.open.set(false);
  }

  protected closeOnOutsideClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  /** Below the field if it fits (or has more room than above), else above. */
  private measure(): MenuPosition {
    const rect = this.trigger().nativeElement.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN;
    const openBelow = spaceBelow >= MENU_MAX_HEIGHT || spaceBelow >= spaceAbove;
    return {
      left: rect.left,
      width: rect.width,
      top: openBelow ? rect.bottom + MENU_GAP : null,
      bottom: openBelow ? null : window.innerHeight - rect.top + MENU_GAP,
      maxHeight: Math.min(MENU_MAX_HEIGHT, openBelow ? spaceBelow : spaceAbove),
    };
  }
}
