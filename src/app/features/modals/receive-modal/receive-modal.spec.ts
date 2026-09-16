import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReceiveModal } from './receive-modal';

describe('ReceiveModal', () => {
  let component: ReceiveModal;
  let fixture: ComponentFixture<ReceiveModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReceiveModal],
    }).compileComponents();

    fixture = TestBed.createComponent(ReceiveModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
