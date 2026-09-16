import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PinLockPage } from './pin-lock-page';

describe('PinLockPage', () => {
  let component: PinLockPage;
  let fixture: ComponentFixture<PinLockPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PinLockPage],
    }).compileComponents();

    fixture = TestBed.createComponent(PinLockPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
