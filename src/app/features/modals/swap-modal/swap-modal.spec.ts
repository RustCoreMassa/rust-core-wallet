import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SwapModal } from './swap-modal';

describe('SwapModal', () => {
  let component: SwapModal;
  let fixture: ComponentFixture<SwapModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwapModal],
    }).compileComponents();

    fixture = TestBed.createComponent(SwapModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
