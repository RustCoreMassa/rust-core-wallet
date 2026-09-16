import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SendModal } from './send-modal';

describe('SendModal', () => {
  let component: SendModal;
  let fixture: ComponentFixture<SendModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SendModal],
    }).compileComponents();

    fixture = TestBed.createComponent(SendModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
