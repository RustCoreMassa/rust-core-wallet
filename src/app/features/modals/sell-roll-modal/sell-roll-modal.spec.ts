import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SellRollModal } from './sell-roll-modal';

describe('SellRollModal', () => {
  let component: SellRollModal;
  let fixture: ComponentFixture<SellRollModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SellRollModal],
    }).compileComponents();

    fixture = TestBed.createComponent(SellRollModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
