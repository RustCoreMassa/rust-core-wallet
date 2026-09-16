import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BuyRollModal } from './buy-roll-modal';

describe('BuyRollModal', () => {
  let component: BuyRollModal;
  let fixture: ComponentFixture<BuyRollModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BuyRollModal],
    }).compileComponents();

    fixture = TestBed.createComponent(BuyRollModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
