import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PinPad } from './pin-pad';

describe('PinPad', () => {
  let component: PinPad;
  let fixture: ComponentFixture<PinPad>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PinPad],
    }).compileComponents();

    fixture = TestBed.createComponent(PinPad);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
